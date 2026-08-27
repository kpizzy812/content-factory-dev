/**
 * Клонирование голоса ведущего: всё, что вокруг спеки `replicate:minimax-voice-cloning`.
 *
 * Логика перенесена из `scripts/clone-voice.ts` (§9 спеки
 * `docs/superpowers/specs/2026-08-16-audio-first-editing-design.md`, Task 5
 * плана `2026-08-17-segment-replace-and-ui.md`). Разовая административная
 * операция: голос обучается один раз, дальше `voice_id` живёт на персонаже и
 * уходит в обычную TTS-спеку без единой правки кода.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ МОДУЛЬ, А НЕ ТЕЛО ЭНДПОИНТА. Здесь всё, что стоит денег:
 * проверки до оплаты, два уровня дедупликации и разбор ответа. Эндпоинт поверх
 * этого — разбор multipart и права. Модуль без Nitro-глобалей и без БД в
 * сигнатуре гоняется чистой сьютой (`tests/unit/media-provider/voice-clone.spec.ts`),
 * то есть каждое правило про $3 проверяется без стенда.
 *
 * ТРИ ВЕЩИ, КОТОРЫЕ ЗДЕСЬ ГЛАВНЫЕ.
 *
 * 1. ПРОГОН СТОИТ $3, И СУММУ ПОДТВЕРЖДАЮТ ЯВНО — прямой перенос `--yes` из
 *    скрипта. Сумма сверяется со СПЕКОЙ, а не с локальной константой: цена
 *    живёт в одном месте, иначе «подтвердил одно, списали другое».
 *
 * 2. ОБРАЗЕЦ ПРОВЕРЯЕТСЯ ДО ОПЛАТЫ. Формат, размер и длительность модель
 *    проверяет уже ПОСЛЕ создания задачи — её отказ стоит полной цены.
 *
 * 3. ПОВТОР НЕ ПЛАТИТ ВТОРОЙ РАЗ, и защит на это две, потому что штатный
 *    механизм медиареестра здесь не работает. Ключ идемпотентности
 *    (`buildMediaIdentity`) считается по payload'у, а в payload'е стоит
 *    ПОДПИСАННАЯ ссылка на образец — она новая при каждом запросе, значит и
 *    ключ новый, и `reuseFromStorage` никогда не совпадёт. Поэтому:
 *      - уровень A: `Character.voiceSampleSha1` + `voiceModelId` + `voiceId` —
 *        тот же файл под ту же целевую модель уже обучен, платить не за что;
 *      - уровень B: детерминированный ключ ответа в нашем хранилище
 *        (`StorageKeys.characterVoiceClone`) — на случай, когда деньги списаны и
 *        ответ получен, а запись на персонажа не доехала (упала БД, рестарт
 *        процесса). Это ровно то «переживает рестарт», которого требует AGENTS.md.
 *
 * ПУБЛИЧНЫЙ URL ОБРАЗЦА — отдельная история, см. `resolveVoiceSamplePublicUrl`.
 */

import { createHash } from "node:crypto"

import { urlPathExtension } from "./model-specs"
import { StorageKeys } from "../storage/keys"
import type { MediaTaskRequest, MediaTaskResult, RunMediaTaskDependencies } from "./run-media-task"
import type { StorageProvider, UploadOptions } from "../storage/types"
import type { VoiceCloningModelSpec } from "./types"

/** MIME → расширение. Нужен, когда браузер прислал файл без внятного имени. */
const EXTENSION_BY_MIME: Record<string, string> = {
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/wave": ".wav",
  "audio/vnd.wave": ".wav",
  "audio/mp4": ".m4a",
  "audio/m4a": ".m4a",
  "audio/x-m4a": ".m4a",
}

/** Content-Type заливки образца в наше хранилище — по его расширению. */
const MIME_BY_EXTENSION: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
}

/**
 * Ошибка операции с кодом HTTP.
 *
 * Модуль намеренно не зовёт `createError` из h3: он должен собираться и
 * гоняться вне Nitro. Эндпоинт переводит код в ответ одной строкой.
 */
export class VoiceCloneError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message)
    this.name = "VoiceCloneError"
  }
}

export interface VoiceCloneCharacter {
  id: string
  appId: number
  voiceId: string | null
  voiceModelId: string | null
  voiceSampleSha1: string | null
}

export interface VoiceCloneSample {
  bytes: Buffer
  filename: string | null
  mimeType: string | null
}

export interface VoiceCloneRequest {
  character: VoiceCloneCharacter
  sample: VoiceCloneSample
  /** Под какую TTS-модель обучается голос: тот же id в другой модели не существует. */
  targetModel: string
  /** Подтверждённая оператором сумма. Обязана совпасть с ценой спеки. */
  confirmUsd: number
  noiseReduction?: boolean
  volumeNormalization?: boolean
  userId?: number | null
}

/**
 * Откуда взялся `voice_id`:
 *  - `reused_character` — уже записан на персонаже (уровень A), денег не стоил;
 *  - `reused_storage` — оплаченный ответ нашёлся в хранилище (уровень B);
 *  - `cloned` — новый прогон, $3 списаны.
 */
export type VoiceCloneSource = "reused_character" | "reused_storage" | "cloned"

export interface VoiceCloneResult {
  voiceId: string
  targetModel: string
  sampleSha1: string
  sampleStorageKey: string
  costUsd: number
  source: VoiceCloneSource
}

/** Узкая часть драйвера хранилища, которой пользуется клон. */
export interface VoiceCloneStorage {
  readonly providerName: StorageProvider
  uploadBuffer(key: string, data: Buffer, opts?: UploadOptions): Promise<unknown>
  exists(key: string): Promise<boolean>
  downloadToBuffer(key: string): Promise<Buffer>
  getSignedDownloadUrl(key: string, opts?: { expiresInSec?: number, responseContentType?: string }): Promise<string>
}

export interface VoiceCloneCostEntry {
  service: string
  model: string
  costUsd: number
  userId?: number | null
  action?: string
  metadata?: Record<string, unknown>
}

export interface VoiceCloneDeps {
  spec?: VoiceCloningModelSpec
  storage?: VoiceCloneStorage
  /**
   * Длительность образца в секундах.
   *
   * Несостоявшийся замер разрешено сообщать обоими способами — нулём (ffprobe
   * отработал, длительности нет) или броском (ffprobe не прочитал файл). Оба
   * дают отказ 422 ДО оплаты, см. `cloneCharacterVoice`; бросок при этом не
   * обязан быть `VoiceCloneError`.
   */
  probeSampleDurationSec?: (bytes: Buffer, extension: string) => Promise<number>
  runTask?: (
    request: MediaTaskRequest<"voice_cloning">,
    dependencies?: RunMediaTaskDependencies,
  ) => Promise<MediaTaskResult>
  logCost?: (entry: VoiceCloneCostEntry) => Promise<void>
  saveCharacterVoice?: (
    characterId: string,
    data: { voiceId: string, voiceModelId: string, voiceSampleSha1: string },
  ) => Promise<void>
  /** Мок-режим провайдера: наружу не уходит ничего, требования к ссылке мягче. */
  mockMode?: boolean
  makeWorkDir?: () => Promise<string>
  cleanupWorkDir?: (dir: string) => Promise<void>
}

/**
 * Ссылка на образец, по которой файл заберёт САМ MiniMax.
 *
 * `minimax/voice-cloning` не крутится на железе Replicate — это прокси к API
 * MiniMax: Replicate передаёт ему ссылку, а скачивает файл MiniMax своим
 * клиентом, без наших заголовков (`docs/operations/replicate.md` §«Голос
 * ведущей», оплаченный прогон 15.08.2026). Отсюда два требования, и оба
 * проверяются ДО оплаты:
 *
 *  1. АБСОЛЮТНЫЙ http(s)-адрес. Ссылка Files API Replicate
 *     (`api.replicate.com/v1/files/{id}`) не годится: MiniMax получает по ней
 *     401. Наш локальный драйвер отдаёт `/api/files/{key}` — относительный путь
 *     за нашей же авторизацией, до него MiniMax не дотянется тем более.
 *     Годится подписанная ссылка GCS: она абсолютна и работает без нашей
 *     авторизации, а подпись едет в query.
 *  2. РАСШИРЕНИЕ В ПУТИ. Формат MiniMax определяет по нему, и ошибка приходит
 *     как «invalid file ext for voice clone» — уже ПОСЛЕ создания задачи, то
 *     есть за $3. Query при этом не считается: `?name=sample.mp3` расширения не
 *     даёт, файл скачивают по пути.
 *
 * В мок-режиме первое требование снимается: наружу не уходит ничего, а стенду
 * на локальном драйвере нужно пройти маршрут целиком. Второе не снимается
 * никогда — иначе стенд не проверял бы то самое место, из-за которого маршрут
 * и падает на боевых деньгах.
 */
export function resolveVoiceSamplePublicUrl(input: {
  signedUrl: string
  storageProvider: StorageProvider
  mockMode: boolean
  allowedExtensions: readonly string[]
}): string {
  const url = input.signedUrl.trim()
  if (!url) {
    throw new VoiceCloneError("Хранилище не вернуло ссылку на образец голоса", 500)
  }

  if (!isAbsoluteHttpUrl(url) && !input.mockMode) {
    throw new VoiceCloneError(
      `Образец голоса должен быть доступен MiniMax по ПУБЛИЧНОЙ ссылке, а драйвер хранилища `
      + `«${input.storageProvider}» вернул «${url}». Модель minimax/voice-cloning — прокси к API `
      + "MiniMax: файл скачивает он сам, без нашей авторизации. Клон отменён ДО оплаты — иначе задача "
      + "упала бы уже созданной, то есть за $3. Включите драйвер с публичными подписанными ссылками "
      + "(STORAGE_DRIVER=gcs) либо гоняйте клон в мок-режиме.",
      500,
    )
  }

  const extension = urlPathExtension(url)
  if (!extension || !input.allowedExtensions.includes(extension)) {
    throw new VoiceCloneError(
      `Ссылка на образец обязана оканчиваться расширением файла (${input.allowedExtensions.join(", ")}), `
      + `а получено «${extension || "без расширения"}». MiniMax опознаёт формат по пути ссылки и `
      + "отвергает файл уже ПОСЛЕ создания задачи — за наши деньги.",
      500,
    )
  }

  return url
}

/**
 * Расширение образца: сначала из имени файла, потом из MIME.
 *
 * Имя главнее: браузер шлёт `audio/mpeg` и на m4a тоже, а модель различает.
 */
export function resolveVoiceSampleExtension(
  sample: Pick<VoiceCloneSample, "filename" | "mimeType">,
  allowedExtensions: readonly string[],
): string {
  const fromName = extensionOf(sample.filename ?? "")
  if (fromName && allowedExtensions.includes(fromName)) return fromName

  const fromMime = EXTENSION_BY_MIME[(sample.mimeType ?? "").toLowerCase().split(";")[0]!.trim()]
  if (fromMime && allowedExtensions.includes(fromMime)) return fromMime

  throw new VoiceCloneError(
    `Формат образца модель не принимает (имя «${sample.filename ?? "—"}», тип `
    + `«${sample.mimeType ?? "—"}»). Допустимые: ${allowedExtensions.join(", ")}.`,
    415,
  )
}

/**
 * `voice_id` из ответа модели.
 *
 * Ответ обязан быть структурой `{ voice_id, preview, model }`. Всё остальное —
 * брак, и молчать о нём нельзя: до этой задачи мок ветки `sync_json` отдавал
 * ТРАНСКРИПТ, и без явной проверки персонажу записался бы пустой голос, а
 * оператор узнал бы об этом на первом же ролике.
 */
export function extractClonedVoiceId(raw: unknown): string {
  const voiceId = raw && typeof raw === "object"
    ? (raw as { voice_id?: unknown }).voice_id
    : undefined
  if (typeof voiceId !== "string" || !voiceId.trim()) {
    throw new VoiceCloneError(
      "Модель клонирования не вернула voice_id — в ответе его нет или он пуст. "
      + "Персонажу ничего не записано: пустой голос сломал бы озвучку молча. "
      + `Сырой ответ: ${describeRaw(raw)}`,
      502,
    )
  }
  return voiceId.trim()
}

/**
 * Область идемпотентности задачи вне ролика.
 *
 * Полный ключ всё равно разъедется (в него входит подписанная ссылка), но
 * ПРЕФИКС остаётся человекочитаемым: по нему в `MediaPrediction` видно, за
 * какой образец под какую модель мы платили. Тот же приём, что у вариаций
 * портрета (`buildVariationIdentityScope`).
 */
export function buildVoiceCloneIdentityScope(
  characterId: string,
  targetModel: string,
  sampleSha1: string,
): string {
  return `character:${characterId}:voice-clone:${targetModel}:${sampleSha1}`
}

/**
 * sha1 образца — 16 hex, как у соседей (`PresenterSourceClip.sha1`,
 * `CharacterReferenceImage.sha1`). Одна длина на весь проект: этим же значением
 * называется объект в хранилище, и второй нотации здесь взяться неоткуда.
 */
export function voiceSampleSha1(bytes: Buffer): string {
  return createHash("sha1").update(bytes).digest("hex").slice(0, 16)
}

export async function cloneCharacterVoice(
  request: VoiceCloneRequest,
  deps: VoiceCloneDeps = {},
): Promise<VoiceCloneResult> {
  const spec = deps.spec ?? await defaultSpec()
  const constraints = spec.constraints

  const targetModel = request.targetModel?.trim()
  if (!targetModel) {
    throw new VoiceCloneError(
      "Не указана целевая TTS-модель: голос обучается ПОД конкретную модель, "
      + "и тот же voice_id в другой модели не существует",
      400,
    )
  }

  // Подтверждение суммы — первым делом и по цене СПЕКИ.
  const price = spec.billing.unit === "flat" ? spec.billing.usd : Number.NaN
  if (!Number.isFinite(price)) {
    throw new VoiceCloneError(
      `Спека ${spec.registryKey} тарифицируется не фиксированной суммой — подтверждать нечего`,
      500,
    )
  }
  if (request.confirmUsd !== price) {
    throw new VoiceCloneError(
      `Прогон клонирования стоит $${price}, подтвердите сумму: поле confirmUsd должно быть равно ${price}`,
      400,
    )
  }

  // Проверки образца ДО оплаты — те же, что в scripts/clone-voice.ts.
  const extension = resolveVoiceSampleExtension(request.sample, constraints.audioExtensions)
  const bytes = request.sample.bytes
  if (bytes.length > constraints.maxBytes) {
    throw new VoiceCloneError(
      `Образец ${(bytes.length / 1048576).toFixed(1)} МБ, предел модели `
      + `${Math.round(constraints.maxBytes / 1048576)} МБ`,
      413,
    )
  }

  const probe = deps.probeSampleDurationSec ?? defaultProbeSampleDurationSec
  /**
   * Замер НЕ СОСТОЯЛСЯ — две разные ветки, и обе обязаны кончаться отказом 422
   * ДО заливки образца и ДО модели.
   *
   *  1. Замер вернул 0. `getVideoDuration` (`../video-tools/ffmpeg.ts`) отдаёт
   *     ноль ровно тогда, когда ffprobe отработал успешно, но длительности в
   *     метаданных нет.
   *  2. Замер БРОСИЛ. На ошибке самого ffprobe тот же `getVideoDuration`
   *     `reject`-ит промис через `wrapBinaryError`, и битый файл (текст с
   *     расширением .mp3, оборванный контейнер) идёт именно сюда. Раньше
   *     обычный `Error` летел мимо `VoiceCloneError`, ручка мапит в HTTP только
   *     его — и оператор на нечитаемом файле получал 500 вместо внятного
   *     «файл не читается как аудио». Ветка 422 при этом была недостижима.
   *
   * ЛОВИМ ЗДЕСЬ, А НЕ В `defaultProbeSampleDurationSec` И ТЕМ БОЛЕЕ НЕ В
   * `getVideoDuration`. Контракт «без замера не платим» принадлежит этой
   * функции, а не одной конкретной реализации замера: почини мы это внутри
   * дефолтной, любой другой замер (тест, будущий драйвер) снова уронил бы
   * пятисотку. А `getVideoDuration` трогать нельзя тем более — его ноль и его
   * бросок различают все остальные вызывающие (`extractFramesFfmpeg` на нуле
   * падает своим сообщением), и превращение броска в ноль проглотило бы ошибку
   * там, где она значима.
   *
   * ПРИЧИНА НЕ ГЛОТАЕТСЯ: текст ffprobe уходит в сообщение отказа. Пустые
   * метаданные лечатся перекодированием образца, а упавший ffprobe — это битый
   * файл или отсутствующий бинарь; один текст на две причины стёр бы разницу.
   */
  let durationSec: number
  try {
    durationSec = await probe(bytes, extension)
  } catch (error) {
    throw new VoiceCloneError(
      `Не удалось прочитать образец как аудио (${describeError(error)}) — `
      + "без замера длительности прогон не запускаем: модель отвергла бы такой файл "
      + "уже ПОСЛЕ создания задачи, то есть за наши деньги",
      422,
    )
  }
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new VoiceCloneError(
      "Не удалось измерить длительность образца (ffprobe вернул 0) — "
      + "без замера прогон не запускаем: модель отвергает такой файл уже за деньги",
      422,
    )
  }
  if (durationSec < constraints.minDurationSec || durationSec > constraints.maxDurationSec) {
    throw new VoiceCloneError(
      `Длительность образца ${durationSec.toFixed(1)} с вне диапазона модели `
      + `${constraints.minDurationSec}-${constraints.maxDurationSec} с`,
      422,
    )
  }

  const sampleSha1 = voiceSampleSha1(bytes)
  const character = request.character
  const sampleStorageKey = StorageKeys.characterVoiceSample(
    character.appId,
    character.id,
    sampleSha1,
    extension,
  )
  const cloneStorageKey = StorageKeys.characterVoiceClone(
    character.appId,
    character.id,
    sampleSha1,
    targetModel,
  )

  // Уровень A: тот же образец под ту же модель уже обучен — платить не за что.
  if (
    character.voiceSampleSha1 === sampleSha1
    && character.voiceModelId === targetModel
    && character.voiceId?.trim()
  ) {
    return {
      voiceId: character.voiceId.trim(),
      targetModel,
      sampleSha1,
      sampleStorageKey,
      costUsd: 0,
      source: "reused_character",
    }
  }

  const storage = deps.storage ?? await defaultStorage()
  const saveCharacterVoice = deps.saveCharacterVoice ?? defaultSaveCharacterVoice

  // Уровень B: деньги уже списаны когда-то раньше, а запись на персонажа не
  // доехала. Ответ лежит в хранилище под детерминированным ключом — берём его.
  const paidEarlier = await readStoredClone(storage, cloneStorageKey)
  if (paidEarlier !== undefined) {
    const voiceId = extractClonedVoiceId(paidEarlier)
    await saveCharacterVoice(character.id, { voiceId, voiceModelId: targetModel, voiceSampleSha1: sampleSha1 })
    return { voiceId, targetModel, sampleSha1, sampleStorageKey, costUsd: 0, source: "reused_storage" }
  }

  // Образец кладётся в НАШЕ хранилище: только оттуда берётся ссылка, годная
  // для MiniMax (см. resolveVoiceSamplePublicUrl).
  await storage.uploadBuffer(sampleStorageKey, bytes, {
    contentType: MIME_BY_EXTENSION[extension] ?? "application/octet-stream",
  })
  const signedUrl = await storage.getSignedDownloadUrl(sampleStorageKey, {
    // Обучение занимает минуты, ссылка живёт заведомо дольше прогона.
    expiresInSec: 6 * 3600,
    responseContentType: MIME_BY_EXTENSION[extension],
  })
  const audioUrl = resolveVoiceSamplePublicUrl({
    signedUrl,
    storageProvider: storage.providerName,
    mockMode: deps.mockMode ?? process.env.REPLICATE_MOCK_MODE === "true",
    allowedExtensions: constraints.audioExtensions,
  })

  const runTask = deps.runTask ?? await defaultRunTask()
  const workDir = await (deps.makeWorkDir ?? defaultMakeWorkDir)()
  let task: MediaTaskResult
  try {
    task = await runTask({
      capability: "voice_cloning",
      spec,
      input: {
        audioUrl,
        targetModel,
        noiseReduction: request.noiseReduction,
        volumeNormalization: request.volumeNormalization,
      },
      identityScope: buildVoiceCloneIdentityScope(character.id, targetModel, sampleSha1),
      unitKey: `character:${character.id}:voice-clone`,
      outputPath: joinPath(workDir, `${sampleSha1}.json`),
      // Ответ переезжает в хранилище под детерминированный ключ — это и есть
      // уровень B дедупликации на следующий заход.
      persist: { storageKey: cloneStorageKey, contentType: "application/json" },
    })
  } finally {
    await (deps.cleanupWorkDir ?? defaultCleanupWorkDir)(workDir).catch(() => {})
  }

  const voiceId = extractClonedVoiceId(task.raw)
  const costUsd = Number(task.costUsd.toFixed(6))

  await saveCharacterVoice(character.id, {
    voiceId,
    voiceModelId: targetModel,
    voiceSampleSha1: sampleSha1,
  })

  const logCost = deps.logCost ?? defaultLogCost
  try {
    await logCost({
      service: task.provider,
      model: task.modelId,
      costUsd,
      userId: request.userId ?? null,
      action: "voice_cloning",
      metadata: { characterId: character.id, targetModel, sampleSha1 },
    })
  } catch (error) {
    // Учёт не должен ронять уже оплаченный и полученный клон: потерять voice_id
    // из-за недоступной БД значит заплатить $3 второй раз на следующем заходе.
    console.warn(`[voice-clone] расход не записан в ledger: ${describeError(error)}`)
  }

  return { voiceId, targetModel, sampleSha1, sampleStorageKey, costUsd, source: "cloned" }
}

/**
 * Уже оплаченный ответ из хранилища. `undefined` — его там нет.
 *
 * Повреждённый объект не молчит и НЕ перегенерируется: наличие ключа —
 * доказательство того, что за него уже заплатили, и повторный прогон оплатил бы
 * его второй раз. Тот же довод, что у `reuseFromStorage` в `run-media-task.ts`.
 */
async function readStoredClone(storage: VoiceCloneStorage, key: string): Promise<unknown> {
  const exists = await storage.exists(key).catch((error: unknown) => {
    // Недоступность хранилища — не повод считать, что оплаченного ответа нет:
    // такой вывод стоил бы $3. Падаем честно.
    throw new VoiceCloneError(
      `Не удалось проверить, оплачен ли этот клон раньше (${describeError(error)}) — `
      + "прогон не запускаем, чтобы не заплатить второй раз",
      503,
    )
  })
  if (!exists) return undefined

  const buffer = await storage.downloadToBuffer(key)
  try {
    return JSON.parse(buffer.toString("utf8"))
  } catch (error) {
    throw new VoiceCloneError(
      `Оплаченный ответ клонирования по ключу ${key} не читается (${describeError(error)}). `
      + "Автоматически не перезапускаем: это списало бы $3 повторно — разберитесь с объектом вручную.",
      500,
    )
  }
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".")
  if (dot <= 0) return ""
  return name.slice(dot).toLowerCase()
}

function joinPath(dir: string, name: string): string {
  return `${dir.replace(/[\\/]+$/, "")}/${name}`
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function describeRaw(raw: unknown): string {
  try {
    return JSON.stringify(raw)?.slice(0, 300) ?? String(raw)
  } catch {
    return String(raw)
  }
}

// ─── Реализации по умолчанию (импорты ленивые: модуль обязан собираться вне Nitro) ───

async function defaultSpec(): Promise<VoiceCloningModelSpec> {
  const { resolveMediaRoute } = await import("./registry")
  return resolveMediaRoute("voice_cloning").primary as VoiceCloningModelSpec
}

async function defaultStorage(): Promise<VoiceCloneStorage> {
  const { getStorageDriver } = await import("../storage")
  return getStorageDriver()
}

async function defaultRunTask(): Promise<NonNullable<VoiceCloneDeps["runTask"]>> {
  const { runMediaTask } = await import("./run-media-task")
  return request => runMediaTask(request)
}

async function defaultLogCost(entry: VoiceCloneCostEntry): Promise<void> {
  const { logServiceCost } = await import("../balance/cost-ledger")
  await logServiceCost(entry)
}

async function defaultSaveCharacterVoice(
  characterId: string,
  data: { voiceId: string, voiceModelId: string, voiceSampleSha1: string },
): Promise<void> {
  await prisma.character.update({ where: { id: characterId }, data })
}

/**
 * Длительность образца. Тот же ffprobe, каким меряются исходные клипы ведущего
 * (`server/api/characters/[id]/source-clips/index.post.ts`): образец приходит
 * буфером, поэтому кладём его во временный файл — ffprobe читает файл.
 *
 * Ошибку ffprobe НЕ гасим здесь: она несёт причину («ffprobe exited with code
 * 1», «бинарь не найден»), а превратить её в отказ 422 с сохранением причины —
 * дело `cloneCharacterVoice`, где живёт правило «без замера не платим».
 */
async function defaultProbeSampleDurationSec(bytes: Buffer, extension: string): Promise<number> {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const { getVideoDuration } = await import("../video-tools/ffmpeg")

  const dir = await mkdtemp(join(tmpdir(), "voice-sample-"))
  const filePath = join(dir, `sample${extension}`)
  try {
    await writeFile(filePath, bytes)
    return await getVideoDuration(filePath)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

async function defaultMakeWorkDir(): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  return mkdtemp(join(tmpdir(), "voice-clone-"))
}

async function defaultCleanupWorkDir(dir: string): Promise<void> {
  const { rm } = await import("node:fs/promises")
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}
