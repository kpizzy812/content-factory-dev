/**
 * Единая точка вызова платной медиазадачи (§3.4 спецификации
 * docs/superpowers/specs/2026-08-07-replicate-media-contour.md).
 *
 * До этого каждая способность звала провайдера по-своему: шаг изображений —
 * `falStepRequest` с инлайн-payload, шаг клипов — `buildClipPayload` плюс
 * отдельный payload image-to-video, TTS — `buildProviderInput` + `extractAudioUrl`,
 * lip-sync — свой асинхронный контур. Провайдер и модель исполнения выбирались
 * подстрокой в id.
 *
 * Теперь маршрут решает СПЕКА: `spec.execution` выбирает ветку исполнения,
 * `spec.mapInput` собирает payload, `spec.extractOutput` разбирает ответ,
 * `spec.timeoutMs` задаёт ожидание. Добавление модели — одна запись в реестре.
 *
 * ДВЕ ВЕТКИ, обе уже существовали в коде:
 *  - sync_queue (fal) — `falStepRequest(stepId, spec.id, payload, unitKey)`
 *    с прежним reattach, дальше разбор выхода и скачивание файла. Поведение
 *    ветки не меняется: это перенос точки вызова, а не смена провайдера.
 *  - async_prediction (Replicate) — обобщение `runLipSync`: заливка входов,
 *    `submitOrResumePrediction`, ожидание при незаполненном
 *    `persistedStorageKey`, выгрузка из ПОСТОЯННОГО хранилища, удаление входов
 *    в `finally`, ретраи и фолбэк по `MediaProviderRetriesExhaustedError`.
 *
 * ТРИ УРОВНЯ ПЕРЕИСПОЛЬЗОВАНИЯ:
 *  1. `reuseLocalPath` — готовый файл на диске (то, что шаги проверяют сами по
 *     `VideoAsset` + `fs.access`): source="reused_asset", провайдера не трогаем;
 *  2. файла нет, но есть `MediaPrediction` с этим ключом идемпотентности и
 *     заполненным `persistedStorageKey` — тянем из своего хранилища,
 *     source="reused_prediction", провайдеру повторно НЕ платим. Раньше этого
 *     уровня в fal-контуре не было вовсе: потеря локального диска (перезапуск
 *     контейнера, другая нода) означала повторную оплату уже оплаченного;
 *  3. иначе сабмит: source="generated" — и только это считается «новой
 *     оплаченной задачей» в `generatedCount`.
 *
 * Чего здесь СПЕЦИАЛЬНО нет: подсчёта денег в ledger и выбора маршрута из env.
 * Маршрут разрешает вызывающий (`resolveMediaRoute`) и фиксирует его на прогоне;
 * ledger — шаг 3 плана.
 */

import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"

import { withTimeoutAndRetry } from "../external-call"
import { estimateMediaCost } from "./billing"
import { MediaProviderRetriesExhaustedError } from "./lip-sync"
import { buildMediaIdentity, type MediaIdentity } from "./media-identity"
import { requireSingleOutputUrl } from "./output"
import type {
  MediaCapability,
  MediaInputFor,
  MediaModelSpec,
  MediaProviderName,
  MediaSpecFor,
  MediaUsage,
  TextToImageInput,
  TextToVideoInput,
  TtsInput,
} from "./types"
import type { AssetStorageColumns } from "../storage/persist-asset"
import type { ReplicateConfig } from "../replicate/config"
import type { PredictionSubmission } from "../replicate/prediction-service"

/** Ретраи Replicate — те же два прохода, что и в `runLipSync`. */
const REPLICATE_MAX_ATTEMPTS = 2
const REPLICATE_RETRY_DELAY_MS = 2_000

export type MediaTaskSource = "reused_asset" | "reused_prediction" | "generated"

/** Локальный файл, который перед вызовом нужно залить провайдеру. */
export interface MediaInputUpload {
  /** Поле нормализованного входа, куда подставится публичный URL. */
  field: string
  path: string
  contentType: string
}

export interface MediaTaskRequest<C extends MediaCapability = MediaCapability> {
  capability: C
  /** Уже разрешённый маршрут: спека выбрана вызывающим, не глобальным флагом. */
  spec: MediaSpecFor<C>
  input: MediaInputFor<C>
  /**
   * Резервная спека той же способности. Включается ТОЛЬКО после
   * `MediaProviderRetriesExhaustedError` — ошибки конфигурации, валидации и
   * хранилища сменой провайдера не маскируются (§3.7).
   */
  fallbackSpec?: MediaSpecFor<C> | null
  /** Без videoId нет идентичности: уровень 2 и запись prediction недоступны. */
  videoId?: number | null
  videoAssetId?: number | null
  /**
   * Шаг ролика. Нет шага (TTS, генерация референсов) — идём прямым вызовом
   * провайдера без step-tracking, ровно как эти места работали раньше.
   */
  stepId?: number | null
  /** Ключ единицы работы — прямая замена falSubKey. */
  unitKey: string
  sceneOrder?: number
  outputPath: string
  inputUploads?: readonly MediaInputUpload[]
  /** Куда положить готовый файл в постоянном хранилище — это и даёт уровень 2. */
  persist?: { storageKey: string, contentType?: string } | null
  /** Готовый локальный файл: есть — платить не за что (уровень 1). */
  reuseLocalPath?: string | null
  /** Фактическое потребление, если вызывающий знает его точнее спеки. */
  usage?: MediaUsage
  /** Ретраи вокруг вызова провайдера (сегодня их применяет только TTS). */
  retry?: { maxRetries?: number, initialBackoffMs?: number, label?: string }
}

export interface MediaTaskResult {
  localPath: string
  provider: MediaProviderName
  modelId: string
  /** falRequestId ИЛИ MediaPrediction.id — смотря кто исполнял. */
  externalRef: string | null
  idempotencyKey: string | null
  costUsd: number
  source: MediaTaskSource
  effectiveDurationSec?: number
  /** Временный URL у провайдера. Постоянным источником не считается. */
  remoteUrl: string | null
  contentType?: string | null
  /** Колонки хранилища — заполнены, если запрашивали `persist`. */
  storage?: AssetStorageColumns
  /**
   * Сырой ответ провайдера. Нужен вызывающим за полями витрины (width/height
   * изображения), которых нет в нормализованном выходе.
   */
  raw?: unknown
}

/** Строка прогресса по единице работы — пишется в `VideoGenerationStep.artifacts`. */
export interface MediaTaskArtifact {
  unitKey: string
  sceneOrder: number
  provider: MediaProviderName
  modelId: string
  predictionId: string | null
  idempotencyKey: string | null
  source: MediaTaskSource
  costUsd: number
}

export interface PersistedPredictionRef {
  id: string
  externalId: string | null
  persistedStorageKey: string | null
}

export interface SavedPredictionInput {
  videoId: number
  videoAssetId?: number | null
  provider: MediaProviderName
  capability: MediaCapability
  model: string
  idempotencyKey: string
  externalId: string | null
  input: Record<string, unknown>
  outputUrl: string | null
  storage: AssetStorageColumns
}

export interface ReplicatePredictionExecution {
  predictionId: string
  persistedStorageKey: string
}

export interface RunMediaTaskDependencies {
  falStepRequest?: <T>(stepId: number, endpoint: string, input: object, subKey?: string) => Promise<T>
  falRequest?: <T>(endpoint: string, input: object) => Promise<T>
  falUploadFile?: (path: string, contentType: string) => Promise<string>
  /** falRequestId шага — его в `falStepRequest` не возвращают, читаем из шага. */
  readStepExternalRef?: (stepId: number) => Promise<string | null>
  downloadFile?: (url: string, destPath: string) => Promise<void>
  fileExists?: (path: string) => Promise<boolean>
  fingerprintFile?: (path: string) => Promise<string>
  uploadAsset?: (localPath: string, storageKey: string, contentType?: string) => Promise<AssetStorageColumns>
  materializeStorageFile?: (storageKey: string, destPath: string) => Promise<void>
  findPersistedPrediction?: (idempotencyKey: string) => Promise<PersistedPredictionRef | null>
  savePrediction?: (record: SavedPredictionInput) => Promise<string | null>
  appendStepArtifact?: (stepId: number, entry: MediaTaskArtifact) => Promise<void>
  replicateConfig?: ReplicateConfig
  executeReplicatePrediction?: (
    submission: PredictionSubmission,
    timeoutMs: number,
  ) => Promise<ReplicatePredictionExecution>
  uploadReplicateInput?: (path: string, contentType: string) => Promise<{ id?: string | null, url: string }>
  deleteReplicateInput?: (id: string) => Promise<void>
  requirePaidApis?: (service: string) => void
  sleep?: (ms: number) => Promise<void>
}

export async function runMediaTask<C extends MediaCapability>(
  request: MediaTaskRequest<C>,
  dependencies: RunMediaTaskDependencies = {},
): Promise<MediaTaskResult> {
  const spec = request.spec as unknown as MediaModelSpec
  if (spec.capability !== request.capability) {
    throw new Error(
      `Спека ${spec.registryKey} описывает ${spec.capability}, а задача — ${request.capability}`,
    )
  }

  // Уровень 1: файл уже лежит на диске — провайдера не трогаем вовсе.
  if (request.reuseLocalPath) {
    const fileExists = dependencies.fileExists ?? defaultFileExists
    if (await fileExists(request.reuseLocalPath)) {
      return {
        localPath: request.reuseLocalPath,
        provider: spec.provider,
        modelId: spec.id,
        externalRef: null,
        idempotencyKey: null,
        costUsd: 0,
        source: "reused_asset",
        remoteUrl: null,
      }
    }
  }

  return spec.execution === "async_prediction"
    ? runAsyncPredictionTask(request, spec, dependencies)
    : runSyncQueueTask(request, spec, dependencies)
}

// ─── Ветка sync_queue (fal): точка вызова прежняя ────────────────

async function runSyncQueueTask<C extends MediaCapability>(
  request: MediaTaskRequest<C>,
  spec: MediaModelSpec,
  dependencies: RunMediaTaskDependencies,
): Promise<MediaTaskResult> {
  const uploadFile = dependencies.falUploadFile ?? defaultFalUploadFile
  const prepared = await prepareInputs(
    request,
    dependencies,
    async (path, contentType) => ({ id: null, url: await uploadFile(path, contentType) }),
  )
  const mapped = spec.mapInput(prepared.input as never, {
    unitKey: request.unitKey,
    sceneOrder: request.sceneOrder,
  })
  const identity = buildIdentity(request, spec, prepared)

  const reused = await reuseFromStorage(request, spec, identity, dependencies)
  if (reused) return reused

  const raw = await callFal(request, spec, mapped.payload, dependencies)
  const output = spec.extractOutput(raw)
  const remoteUrl = requireSingleOutputUrl(output, `${spec.capability} ${request.unitKey}`)

  const downloadFile = dependencies.downloadFile ?? defaultDownloadFile
  await downloadFile(remoteUrl, request.outputPath)

  const storage = await persistOutput(request, dependencies)
  const externalRef = request.stepId != null
    ? await readStepExternalRef(request.stepId, dependencies)
    : null

  // Запись prediction'а для fal-ветки — это и есть уровень 2 для fal (§3.7):
  // без неё «сколько раз мы платили и что с этого осталось» неизвестно, а
  // потеря локального диска стоит второй оплаты.
  if (storage && identity) {
    await savePrediction(request, spec, identity, externalRef, mapped.payload, remoteUrl, storage, dependencies)
  }

  return {
    localPath: request.outputPath,
    provider: spec.provider,
    modelId: spec.id,
    externalRef,
    idempotencyKey: identity?.idempotencyKey ?? null,
    costUsd: safeCost(spec, request, prepared.input, mapped.effectiveDurationSec),
    source: "generated",
    effectiveDurationSec: mapped.effectiveDurationSec,
    remoteUrl,
    contentType: output.contentType ?? null,
    storage,
    raw,
  }
}

/**
 * Вызов fal. С шагом — прежний `falStepRequest` (persistent tracking + reattach,
 * `unitKey` в роли `falSubKey`). Без шага — прямой `falRequest`, как это и
 * делали TTS и эндпоинты генерации референсов.
 *
 * Таймаут ветки с шагом остаётся собственным таймаутом `fal.ts`: сузить его до
 * `spec.timeoutMs` можно только внутри поллинга, а `fal.ts` и `falStepRequest`
 * в объём этой волны не входят. Гонка «свой таймаут поверх чужого поллинга»
 * бросила бы оплаченную задачу вместо того, чтобы забрать результат.
 */
async function callFal<C extends MediaCapability>(
  request: MediaTaskRequest<C>,
  spec: MediaModelSpec,
  payload: Record<string, unknown>,
  dependencies: RunMediaTaskDependencies,
): Promise<unknown> {
  if (request.stepId != null) {
    const falStepRequest = dependencies.falStepRequest ?? defaultFalStepRequest
    return falStepRequest<unknown>(request.stepId, spec.id, payload, request.unitKey)
  }

  const falRequest = dependencies.falRequest ?? defaultFalRequest
  const call = () => falRequest<unknown>(spec.id, payload)
  if (!request.retry) return call()

  return withTimeoutAndRetry<unknown>(call, {
    label: request.retry.label ?? `${spec.capability} ${spec.id}`,
    // Таймаут берётся из спеки способности, а не из глобальной константы (§3.4).
    timeoutMs: spec.timeoutMs,
    maxRetries: request.retry.maxRetries ?? 1,
    initialBackoffMs: request.retry.initialBackoffMs ?? 3_000,
    onRetry: (attempt, error, delayMs) => {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[media-task] ${spec.id} attempt ${attempt} failed: ${message}. Retry in ${delayMs}ms`)
    },
  })
}

// ─── Ветка async_prediction (Replicate): обобщённый runLipSync ────

async function runAsyncPredictionTask<C extends MediaCapability>(
  request: MediaTaskRequest<C>,
  spec: MediaModelSpec,
  dependencies: RunMediaTaskDependencies,
): Promise<MediaTaskResult> {
  // Конфигурация читается ЛЕНИВО и только здесь: прогону, которому Replicate не
  // нужен, переменные REPLICATE_* не требуются (§3.4, P0-10).
  const config = dependencies.replicateConfig ?? (await import("../replicate/config")).readReplicateConfig()
  if (!config.mockMode) {
    const requirePaid = dependencies.requirePaidApis ?? (await import("../paid-guard")).requirePaidApisEnabled
    requirePaid("Replicate")
  }

  const sleep = dependencies.sleep ?? defaultSleep
  const uploader = dependencies.uploadReplicateInput
    ? null
    : (await import("../replicate/client")).createReplicateInputUploader(config)
  const uploadInput = dependencies.uploadReplicateInput
    ?? ((path: string, contentType: string) => uploader!.uploadFile(path, contentType))
  const deleteInput = dependencies.deleteReplicateInput
    ?? (async (id: string) => { await uploader?.deleteFile(id) })
  const uploadedIds: string[] = []

  try {
    const prepared = await prepareInputs(
      request,
      dependencies,
      (path, contentType) => withReplicateRetries(() => uploadInput(path, contentType), sleep),
    )
    uploadedIds.push(...prepared.uploadedIds)

    const mapped = spec.mapInput(prepared.input as never, {
      unitKey: request.unitKey,
      sceneOrder: request.sceneOrder,
    })
    const identity = buildIdentity(request, spec, prepared)
    if (!identity) {
      // Без ключа идемпотентности асинхронный контур теряет смысл: повтор
      // создаст второй оплаченный prediction, а recovery не свяжет их с задачей.
      throw new Error(
        `Задача ${spec.capability} на Replicate требует videoId — без него нет ключа идемпотентности`,
      )
    }

    const reused = await reuseFromStorage(request, spec, identity, dependencies)
    if (reused) {
      await writeArtifact(request, reused, dependencies)
      return reused
    }

    const execute = dependencies.executeReplicatePrediction
      ?? ((submission: PredictionSubmission, timeoutMs: number) => executePrediction(submission, timeoutMs, config))
    const execution = await withReplicateRetries(
      () => execute({
        videoId: request.videoId ?? null,
        videoAssetId: request.videoAssetId ?? null,
        model: spec,
        input: mapped.payload,
        webhookUrl: config.webhookUrl,
        idempotencyKey: identity.idempotencyKey,
        attemptScope: identity.attemptScope,
        attemptCeilingScope: identity.attemptCeilingScope,
      }, spec.timeoutMs),
      sleep,
    )

    const materialize = dependencies.materializeStorageFile ?? defaultMaterializeStorageFile
    await materialize(execution.persistedStorageKey, request.outputPath)
    const storage = await persistOutput(request, dependencies)

    const result: MediaTaskResult = {
      localPath: request.outputPath,
      provider: spec.provider,
      modelId: spec.id,
      externalRef: execution.predictionId,
      idempotencyKey: identity.idempotencyKey,
      costUsd: safeCost(spec, request, prepared.input, mapped.effectiveDurationSec),
      source: "generated",
      effectiveDurationSec: mapped.effectiveDurationSec,
      remoteUrl: null,
      storage,
    }
    await writeArtifact(request, result, dependencies)
    return result
  } catch (error) {
    // Фолбэк — только на исчерпание попыток провайдера и только на КОНКРЕТНУЮ
    // спеку резерва со своим маппером и своей ценой.
    if (error instanceof MediaProviderRetriesExhaustedError && request.fallbackSpec) {
      return runMediaTask({ ...request, spec: request.fallbackSpec, fallbackSpec: null }, dependencies)
    }
    throw error
  } finally {
    await Promise.allSettled(uploadedIds.map(id => deleteInput(id)))
  }
}

async function executePrediction(
  submission: PredictionSubmission,
  timeoutMs: number,
  config: ReplicateConfig,
): Promise<ReplicatePredictionExecution> {
  const [{ createReplicateProvider }, { createMockReplicateProvider }, { createPredictionService }] = await Promise.all([
    import("../replicate/client"),
    import("../replicate/mock"),
    import("../replicate/prediction-service"),
  ])
  const provider = config.mockMode
    ? createMockReplicateProvider()
    : createReplicateProvider({ config })
  const service = createPredictionService({ provider })

  let prediction = await service.submitOrResumePrediction(submission)
  if (!prediction.persistedStorageKey) {
    prediction = await service.waitForPrediction(prediction.id, {
      // Ожидание — по спеке способности: у клипов оно кратно длиннее, чем у
      // lip-sync, и общая константа означала бы брошенный оплаченный prediction.
      timeoutMs,
      pollIntervalMs: config.mockMode ? 0 : 5_000,
    })
  }
  if (!prediction.persistedStorageKey) {
    throw new Error(`Replicate prediction ${prediction.id} completed without durable output`)
  }
  return { predictionId: prediction.id, persistedStorageKey: prediction.persistedStorageKey }
}

async function withReplicateRetries<T>(
  operation: () => Promise<T>,
  sleep: (ms: number) => Promise<void>,
): Promise<T> {
  const { ReplicateProviderError } = await import("../replicate/errors")
  for (let attempt = 1; attempt <= REPLICATE_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof MediaProviderRetriesExhaustedError) throw error
      if (!(error instanceof ReplicateProviderError) || !error.retryable) throw error
      if (attempt === REPLICATE_MAX_ATTEMPTS) {
        throw new MediaProviderRetriesExhaustedError("replicate", attempt, error)
      }
      await sleep(REPLICATE_RETRY_DELAY_MS * attempt)
    }
  }
  throw new Error("Unreachable Replicate retry state")
}

// ─── Общее для обеих веток ───────────────────────────────────────

interface PreparedInput {
  input: Record<string, unknown>
  /** Тот же вход, но файлы представлены отпечатками — из него строится ключ. */
  identityInput: Record<string, unknown>
  fingerprints: Record<string, string>
  uploadedIds: string[]
}

async function prepareInputs<C extends MediaCapability>(
  request: MediaTaskRequest<C>,
  dependencies: RunMediaTaskDependencies,
  upload: (path: string, contentType: string) => Promise<{ id?: string | null, url: string }>,
): Promise<PreparedInput> {
  const input = { ...(request.input as unknown as Record<string, unknown>) }
  const identityInput = { ...input }
  const fingerprints: Record<string, string> = {}
  const uploadedIds: string[] = []
  const fingerprintFile = dependencies.fingerprintFile ?? sha256File

  for (const item of request.inputUploads ?? []) {
    const uploaded = await upload(item.path, item.contentType)
    input[item.field] = uploaded.url
    if (uploaded.id) uploadedIds.push(uploaded.id)
    const fingerprint = await fingerprintFile(item.path)
    fingerprints[item.field] = fingerprint
    identityInput[item.field] = `sha256:${fingerprint}`
  }

  return { input, identityInput, fingerprints, uploadedIds }
}

function buildIdentity<C extends MediaCapability>(
  request: MediaTaskRequest<C>,
  spec: MediaModelSpec,
  prepared: PreparedInput,
): MediaIdentity | null {
  if (request.videoId === null || request.videoId === undefined) return null
  const mappedForIdentity = spec.mapInput(prepared.identityInput as never, {
    unitKey: request.unitKey,
    sceneOrder: request.sceneOrder,
  })
  return buildMediaIdentity({
    capability: spec.capability,
    videoId: request.videoId,
    sceneOrder: request.sceneOrder ?? 0,
    modelId: spec.id,
    payload: mappedForIdentity.payload,
    fingerprints: prepared.fingerprints,
  })
}

/**
 * Уровень 2: файла на диске нет, но результат этой же задачи уже лежит в НАШЕМ
 * хранилище. Тянем оттуда — провайдеру повторно не платим.
 */
async function reuseFromStorage<C extends MediaCapability>(
  request: MediaTaskRequest<C>,
  spec: MediaModelSpec,
  identity: MediaIdentity | null,
  dependencies: RunMediaTaskDependencies,
): Promise<MediaTaskResult | null> {
  if (!identity) return null
  const find = dependencies.findPersistedPrediction ?? defaultFindPersistedPrediction
  const existing = await find(identity.idempotencyKey).catch((error: unknown) => {
    // Недоступность справочника не повод падать: хуже отсутствия
    // переиспользования только потерянная задача.
    console.warn(`[media-task] поиск оплаченного результата не удался: ${describeError(error)}`)
    return null
  })
  if (!existing?.persistedStorageKey) return null

  const materialize = dependencies.materializeStorageFile ?? defaultMaterializeStorageFile
  await materialize(existing.persistedStorageKey, request.outputPath)
  const storage = await persistOutput(request, dependencies)

  return {
    localPath: request.outputPath,
    provider: spec.provider,
    modelId: spec.id,
    externalRef: existing.id,
    idempotencyKey: identity.idempotencyKey,
    // За уже оплаченный результат второй раз не платят — в generatedCount такая
    // единица работы не попадает.
    costUsd: 0,
    source: "reused_prediction",
    remoteUrl: null,
    storage,
  }
}

async function persistOutput<C extends MediaCapability>(
  request: MediaTaskRequest<C>,
  dependencies: RunMediaTaskDependencies,
): Promise<AssetStorageColumns | undefined> {
  if (!request.persist) return undefined
  const upload = dependencies.uploadAsset ?? defaultUploadAsset
  return upload(request.outputPath, request.persist.storageKey, request.persist.contentType)
}

async function savePrediction<C extends MediaCapability>(
  request: MediaTaskRequest<C>,
  spec: MediaModelSpec,
  identity: MediaIdentity,
  externalId: string | null,
  payload: Record<string, unknown>,
  remoteUrl: string | null,
  storage: AssetStorageColumns,
  dependencies: RunMediaTaskDependencies,
): Promise<void> {
  if (request.videoId === null || request.videoId === undefined) return
  const save = dependencies.savePrediction ?? defaultSavePrediction
  try {
    await save({
      videoId: request.videoId,
      videoAssetId: request.videoAssetId ?? null,
      provider: spec.provider,
      capability: spec.capability,
      model: spec.id,
      idempotencyKey: identity.idempotencyKey,
      externalId,
      input: payload,
      outputUrl: remoteUrl,
      storage,
    })
  } catch (error) {
    // Учёт не должен ронять уже оплаченную и скачанную задачу.
    console.warn(`[media-task] не удалось записать MediaPrediction: ${describeError(error)}`)
  }
}

async function writeArtifact<C extends MediaCapability>(
  request: MediaTaskRequest<C>,
  result: MediaTaskResult,
  dependencies: RunMediaTaskDependencies,
): Promise<void> {
  if (request.stepId == null) return
  const append = dependencies.appendStepArtifact ?? defaultAppendStepArtifact
  try {
    await append(request.stepId, {
      unitKey: request.unitKey,
      sceneOrder: request.sceneOrder ?? 0,
      provider: result.provider,
      modelId: result.modelId,
      predictionId: result.externalRef,
      idempotencyKey: result.idempotencyKey,
      source: result.source,
      costUsd: result.costUsd,
    })
  } catch (error) {
    console.warn(`[media-task] прогресс шага не записан: ${describeError(error)}`)
  }
}

/**
 * Потребление для расчёта цены. Вызывающий может передать своё (TTS знает
 * длительность только после probe), иначе выводим из нормализованного входа.
 */
function deriveUsage(
  spec: MediaModelSpec,
  input: Record<string, unknown>,
  effectiveDurationSec: number | undefined,
): MediaUsage {
  switch (spec.capability) {
    case "text_to_image": {
      const value = input as unknown as TextToImageInput
      return {
        images: value.count,
        megapixels: (value.width * value.height * value.count) / 1_000_000,
      }
    }
    case "text_to_video":
    case "image_to_video": {
      const value = input as unknown as TextToVideoInput
      return {
        outputSeconds: effectiveDurationSec ?? value.durationSec,
        withAudio: value.withAudio,
        resolution: value.resolution,
      }
    }
    case "text_to_speech": {
      const value = input as unknown as TtsInput
      return { characters: value.text.length }
    }
    default:
      return {}
  }
}

/**
 * Цена по спеке того, кто РЕАЛЬНО исполнял. Не выводится (у TTS до probe нет
 * длительности) — ноль, а не выдуманное число: деньги считает вызывающий.
 */
function safeCost<C extends MediaCapability>(
  spec: MediaModelSpec,
  request: MediaTaskRequest<C>,
  input: Record<string, unknown>,
  effectiveDurationSec: number | undefined,
): number {
  try {
    return estimateMediaCost(spec, request.usage ?? deriveUsage(spec, input, effectiveDurationSec))
  } catch {
    return 0
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ─── Реализации по умолчанию (все импорты ленивые) ───────────────

async function defaultFileExists(path: string): Promise<boolean> {
  const { access } = await import("node:fs/promises")
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function defaultFalStepRequest<T>(
  stepId: number,
  endpoint: string,
  input: object,
  subKey?: string,
): Promise<T> {
  const { falStepRequest } = await import("../video-pipeline-db")
  return falStepRequest<T>(stepId, endpoint, input, subKey)
}

async function defaultFalRequest<T>(endpoint: string, input: object): Promise<T> {
  const { falRequest } = await import("../fal")
  return falRequest<T>(endpoint, input)
}

async function defaultFalUploadFile(path: string, contentType: string): Promise<string> {
  const { falUploadFile } = await import("../fal")
  return falUploadFile(path, contentType)
}

async function defaultDownloadFile(url: string, destPath: string): Promise<void> {
  const { downloadFile } = await import("../video-helpers")
  await downloadFile(url, destPath)
}

async function defaultUploadAsset(
  localPath: string,
  storageKey: string,
  contentType?: string,
): Promise<AssetStorageColumns> {
  const { uploadLocalAsset } = await import("../storage/persist-asset")
  return uploadLocalAsset(localPath, storageKey, contentType)
}

async function defaultMaterializeStorageFile(storageKey: string, destPath: string): Promise<void> {
  const { getStorageDriver } = await import("../storage")
  await getStorageDriver().downloadToFile(storageKey, destPath)
}

async function readStepExternalRef(
  stepId: number,
  dependencies: RunMediaTaskDependencies,
): Promise<string | null> {
  const read = dependencies.readStepExternalRef ?? defaultReadStepExternalRef
  try {
    return await read(stepId)
  } catch {
    return null
  }
}

async function defaultReadStepExternalRef(stepId: number): Promise<string | null> {
  const step = await prisma.videoGenerationStep.findUnique({
    where: { id: stepId },
    select: { falRequestId: true },
  })
  return step?.falRequestId ?? null
}

async function defaultFindPersistedPrediction(
  idempotencyKey: string,
): Promise<PersistedPredictionRef | null> {
  const record = await prisma.mediaPrediction.findUnique({
    where: { idempotencyKey },
    select: { id: true, externalId: true, persistedStorageKey: true },
  })
  return record ?? null
}

/**
 * Запись о fal-задаче в `MediaPrediction`.
 *
 * Ключ хранилища здесь — ключ сцены, а не отдельная копия под
 * `mediaPredictionOutput`: файл уже залит шагом, и второй объект означал бы
 * удвоенный трафик ради той же ссылки.
 */
async function defaultSavePrediction(record: SavedPredictionInput): Promise<string | null> {
  const { sanitizePredictionSnapshot } = await import("../replicate/prediction-state")
  const now = new Date()
  const saved = await prisma.mediaPrediction.upsert({
    where: { idempotencyKey: record.idempotencyKey },
    update: {
      status: "succeeded",
      persistenceStatus: "persisted",
      persistedStorageKey: record.storage.storageKey,
      persistedStorageProvider: record.storage.storageProvider,
      persistedFileSizeBytes: record.storage.fileSizeBytes,
      persistedFileSha256: record.storage.fileSha256,
      persistedContentType: record.storage.contentType,
      outputUrl: record.outputUrl,
      completedAt: now,
      terminalAt: now,
    },
    create: {
      videoId: record.videoId,
      videoAssetId: record.videoAssetId ?? null,
      provider: record.provider,
      capability: record.capability,
      model: record.model,
      externalId: record.externalId,
      idempotencyKey: record.idempotencyKey,
      status: "succeeded",
      inputSnapshot: sanitizePredictionSnapshot(record.input) as never,
      outputUrl: record.outputUrl,
      persistenceStatus: "persisted",
      persistedStorageKey: record.storage.storageKey,
      persistedStorageProvider: record.storage.storageProvider,
      persistedFileSizeBytes: record.storage.fileSizeBytes,
      persistedFileSha256: record.storage.fileSha256,
      persistedContentType: record.storage.contentType,
      submittedAt: now,
      completedAt: now,
      terminalAt: now,
    },
    select: { id: true },
  })
  return saved.id
}

/**
 * Прогресс Replicate-ветки. Колонки `fal*` в ней не пишутся, поэтому состояние
 * по ВСЕМ единицам работы шага живёт в свободной колонке `artifacts`
 * (`schema.prisma:901`) — это больше, чем давал `falQueueStatus` с его одной
 * последней сценой. Запись по unitKey замещается: перезапуск сцены не должен
 * плодить дубликаты строк.
 */
async function defaultAppendStepArtifact(stepId: number, entry: MediaTaskArtifact): Promise<void> {
  const step = await prisma.videoGenerationStep.findUnique({
    where: { id: stepId },
    select: { artifacts: true },
  })
  const current = Array.isArray(step?.artifacts) ? (step.artifacts as unknown[]) : []
  const rest = current.filter((item) => {
    if (!item || typeof item !== "object") return true
    return (item as { unitKey?: unknown }).unitKey !== entry.unitKey
  })
  await prisma.videoGenerationStep.update({
    where: { id: stepId },
    data: { artifacts: [...rest, entry] as never },
  })
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256")
    const stream = createReadStream(path)
    stream.on("error", reject)
    stream.on("data", chunk => hash.update(chunk))
    stream.on("end", () => resolve(hash.digest("hex")))
  })
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export type { MediaTaskInput }
