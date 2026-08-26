/**
 * Шаги маршрута audio-first: единый трек и транскрипция.
 *
 * Проверяется то, за что платят деньги и чем режется звук:
 *  - отпечаток трека считается по ФИНАЛЬНОМУ файлу (после вставки пауз) — по
 *    нему lip-sync строит ключи кусков, и отпечаток «до пауз» означал бы ключи
 *    от одного файла при звуке из другого;
 *  - повторный прогон не синтезирует трек заново ни при живом файле, ни после
 *    рестарта, когда файл остался только в хранилище (у TTS нет seed: новый
 *    трек звучит иначе и обесценивает уже снятые аватарные кадры);
 *  - отказ транскрипции ролик не роняет, а её результат кэшируется по
 *    отпечатку трека.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const h = vi.hoisted(() => ({
  step: { id: 7, attemptCount: 0, actualCost: 0, status: "pending", outputSnapshot: null as unknown },
  stepCompleted: false,
  updates: [] as Array<Record<string, unknown>>,
  uploads: [] as string[],
  downloads: [] as string[],
  /** Ключи, по которым запрашивалась ПОДПИСАННАЯ ССЫЛКА (getSignedDownloadUrl). */
  signedUrlRequests: [] as string[],
  logs: [] as string[],
  /** Строки расхода: по ним видно, попали ли деньги упавшей попытки в отчёт. */
  ledger: [] as Array<{ stepKey: string, costUsd: number }>,
  /** Файл, который «скачивается» из хранилища, и его содержимое. */
  downloadWrites: null as null | (() => Promise<void>),
  /** Симулирует сбой самой записи расхода (обрыв БД) — не отказ провайдера. */
  updateStepFailsOnCostWrite: false,
  /** Что лежит в снапшоте шага озвучки этого ролика. */
  voiceoverSnapshot: null as unknown,
  /** Записи VideoAsset(type=transcript) — по ним видно, зарегистрирован ли файл в БД. */
  videoAssetWrites: [] as Array<{ op: "create" | "update", videoId?: number, type?: string }>,
  // Ответ провайдера по умолчанию совпадает со сценарием сцены (см. SCENES):
  // выравнивание сходится, и тест кэша проверяет кэш, а не отказ.
  transcriptionTask: vi.fn(async () => ({
    costUsd: 0.02,
    raw: { words: [
      { word: "первая", start: 0, end: 0.5 },
      { word: "реплика", start: 0.5, end: 1.1 },
    ] },
  })),
}))

vi.mock("../../../server/utils/video-pipeline-db", () => ({
  STEP_ORDER: [
    "prompt_generation", "image_generation", "clip_generation",
    "voiceover_generation", "music_generation", "lip_sync_generation", "assembly",
    "transcription",
  ],
  ensureStep: async () => h.step,
  updateStep: async (_id: number, data: Record<string, unknown>) => {
    // "actualCost" в data — это именно запись расхода (recordCost), а не смена
    // статуса шага: сбой моделируем точечно, чтобы отличить его от отказа
    // провайдера.
    if (h.updateStepFailsOnCostWrite && "actualCost" in data) {
      throw new Error("БД недоступна: запись расхода не выполнена")
    }
    h.updates.push(data)
  },
  appendStepLog: async (_id: number, message: string) => { h.logs.push(message) },
  isStepCompleted: () => h.stepCompleted,
  updateVideoStatus: async () => {},
}))

vi.mock("../../../server/utils/storage/persist-asset", () => ({
  uploadLocalAsset: async (localPath: string, storageKey: string) => {
    h.uploads.push(localPath)
    return {
      storageKey,
      storageProvider: "local",
      fileSizeBytes: 1n,
      // Отпечаток считается ХРАНИЛИЩЕМ по тому файлу, который ему отдали:
      // так в тесте видно, какой именно файл попал в ключи lip-sync.
      fileSha256: `sha:${localPath}`,
      contentType: "audio/mpeg",
    }
  },
}))

vi.mock("../../../server/utils/storage/download-to-storage", () => ({
  storageKeyToLegacyUrl: (key: string) => `/api/files/${key}`,
}))

vi.mock("../../../server/utils/storage", () => ({
  getStorageDriver: () => ({
    providerName: "local",
    downloadToFile: async (key: string, localPath: string) => {
      h.downloads.push(key)
      if (!h.downloadWrites) throw new Error("нет объекта в хранилище")
      await h.downloadWrites()
      return localPath
    },
    getSignedDownloadUrl: async (key: string) => {
      h.signedUrlRequests.push(key)
      return `https://cdn/${key}`
    },
  }),
}))

vi.mock("../../../server/utils/balance/cost-ledger", () => ({
  logStepCost: async (_stepId: number, stepKey: string, _service: unknown, costUsd: number) => {
    h.ledger.push({ stepKey, costUsd })
  },
}))
vi.mock("../../../server/utils/transcription/media-task", () => ({
  requestTranscription: h.transcriptionTask,
}))

let assetsDir = ""

function installGlobals() {
  const g = globalThis as Record<string, unknown>
  g.logAgent = async () => {}
  g.getAssetsDir = () => assetsDir
  g.ensureDir = async () => {}
  g.prisma = {
    videoAsset: {
      findFirst: async () => null,
      create: async (args: { data: { videoId: number, type: string } }) => {
        h.videoAssetWrites.push({ op: "create", videoId: args.data.videoId, type: args.data.type })
        return {}
      },
      update: async () => {
        h.videoAssetWrites.push({ op: "update" })
        return {}
      },
    },
    character: { findUnique: async () => ({ name: "Ведущая" }) },
    // Снапшот шага озвучки — по нему видно, начинали ли ролик собирать от звука.
    videoGenerationStep: { findFirst: async () => ({ outputSnapshot: h.voiceoverSnapshot }) },
  }
}

async function loadSteps() {
  installGlobals()
  return import("../../../server/utils/video-pipeline-steps")
}

const PLAN = {
  mode: "story_driven",
  scenes: [
    { order: 1, durationSec: 6, spokenLine: "Первая реплика. [пауза 2с]" },
    { order: 2, durationSec: 8, spokenLine: "Вторая реплика." },
  ],
  voiceoverPlan: { enabled: false, lines: [] },
} as never

const CONFIG = {
  voiceoverEnabled: false,
  voiceoverModelId: "minimax/speech-02-turbo",
  voiceoverVoiceId: "clone-1",
  voiceoverLanguage: "ru",
  voiceoverPacing: "moderate" as const,
  lipSyncCharacterId: "character-1",
}

beforeEach(async () => {
  assetsDir = await mkdtemp(join(tmpdir(), "cf-audio-first-"))
  h.step = { id: 7, attemptCount: 0, actualCost: 0, status: "pending", outputSnapshot: null }
  h.stepCompleted = false
  h.updates.length = 0
  h.uploads.length = 0
  h.downloads.length = 0
  h.signedUrlRequests.length = 0
  h.logs.length = 0
  h.ledger.length = 0
  h.videoAssetWrites.length = 0
  h.downloadWrites = null
  h.voiceoverSnapshot = null
  h.updateStepFailsOnCostWrite = false
  h.transcriptionTask.mockClear()
})

describe("признак «ролик уже начали собирать от звука»", () => {
  it("готовый трек в снапшоте — да, маршрут менять нельзя", async () => {
    h.voiceoverSnapshot = {
      route: "audio_first",
      trackPath: "/tmp/voiceover_track.mp3",
      trackFingerprint: "sha-трека",
      scenes: [],
    }
    const { hasAudioFirstTrack } = await loadSteps()

    expect(await hasAudioFirstTrack(44)).toBe(true)
  })

  it("снапшот-отказ (трек не синтезировался) — нет, терять нечего", async () => {
    h.voiceoverSnapshot = { route: "audio_first", reason: "empty_script" }
    const { hasAudioFirstTrack } = await loadSteps()

    expect(await hasAudioFirstTrack(44)).toBe(false)
  })

  it("снапшот прежнего маршрута — нет", async () => {
    h.voiceoverSnapshot = { mixedPath: "/tmp/voiceover_mix.mp3", sceneResults: [] }
    const { hasAudioFirstTrack } = await loadSteps()

    expect(await hasAudioFirstTrack(44)).toBe(false)
  })
})

describe("шаг единого трека", () => {
  it("отпечаток считается по файлу ПОСЛЕ вставки пауз", async () => {
    const { runAudioFirstVoiceover } = await loadSteps()
    const rawPath = join(assetsDir, "voiceover_track.mp3")
    const pausedPath = join(assetsDir, "voiceover_track_pauses.mp3")

    const result = await runAudioFirstVoiceover(44, CONFIG, PLAN, {
      synthesize: async () => ({ audioPath: rawPath, durationSec: 12.1, costUsd: 0.07 }),
      insertPauses: async () => ({
        path: pausedPath,
        durationSec: 14.05,
        skippedPauses: [],
        sourceDurationMeasureFailed: false,
        durationEstimated: false,
      }),
    })

    expect(h.uploads).toEqual([pausedPath])
    expect(result.trackFingerprint).toBe(`sha:${pausedPath}`)
    expect(result.trackPath).toBe(pausedPath)
    // Длительность — измеренная на готовом файле, а не «синтез плюс пауза».
    expect(result.durationSec).toBeCloseTo(14.05, 3)
  })

  it("сцены отдаются с очищенным от маркеров текстом — именно они идут в выравнивание", async () => {
    const { runAudioFirstVoiceover } = await loadSteps()

    const result = await runAudioFirstVoiceover(44, CONFIG, PLAN, {
      synthesize: async () => ({ audioPath: join(assetsDir, "t.mp3"), durationSec: 12, costUsd: 0.07 }),
      insertPauses: async (path: string) => ({
        path,
        durationSec: 14,
        skippedPauses: [],
        sourceDurationMeasureFailed: false,
        durationEstimated: false,
      }),
    })

    expect(result.scenes).toEqual([
      { order: 1, text: "Первая реплика." },
      { order: 2, text: "Вторая реплика." },
    ])
  })

  it("второй прогон не платит за уже синтезированный трек", async () => {
    const trackPath = join(assetsDir, "voiceover_track.mp3")
    await writeFile(trackPath, "audio")
    h.stepCompleted = true
    h.step.outputSnapshot = {
      route: "audio_first",
      trackPath,
      durationSec: 14.05,
      trackFingerprint: "sha-старого-трека",
      storageKey: "zavodcamp/videos/44/voiceover_mix.mp3",
      scenes: [{ order: 1, text: "Первая реплика." }],
      totalCostUsd: 0.07,
      modelId: "minimax/speech-02-turbo",
      voiceId: "clone-1",
    }
    const { runAudioFirstVoiceover } = await loadSteps()
    const synthesize = vi.fn()

    const result = await runAudioFirstVoiceover(44, CONFIG, PLAN, { synthesize: synthesize as never })

    expect(synthesize).not.toHaveBeenCalled()
    expect(result.status).toBe("completed")
    expect(result.trackFingerprint).toBe("sha-старого-трека")
    expect(result.totalCostUsd).toBe(0)
  })

  it("после рестарта трек тянется из хранилища, а не синтезируется заново", async () => {
    const trackPath = join(assetsDir, "voiceover_track.mp3")
    h.downloadWrites = async () => { await writeFile(trackPath, "audio") }
    h.stepCompleted = true
    h.step.outputSnapshot = {
      route: "audio_first",
      trackPath,
      durationSec: 14.05,
      trackFingerprint: "sha-старого-трека",
      storageKey: "zavodcamp/videos/44/voiceover_mix.mp3",
      scenes: [],
      totalCostUsd: 0.07,
      modelId: null,
      voiceId: "clone-1",
    }
    const { runAudioFirstVoiceover } = await loadSteps()
    const synthesize = vi.fn()

    const result = await runAudioFirstVoiceover(44, CONFIG, PLAN, { synthesize: synthesize as never })

    expect(h.downloads).toEqual(["zavodcamp/videos/44/voiceover_mix.mp3"])
    expect(synthesize).not.toHaveBeenCalled()
    expect(result.totalCostUsd).toBe(0)
  })

  it("без голоса синтеза не происходит вовсе — чужой голос на лицо ведущего недопустим", async () => {
    const { runAudioFirstVoiceover } = await loadSteps()
    const synthesize = vi.fn()

    await expect(runAudioFirstVoiceover(
      44,
      { ...CONFIG, voiceoverVoiceId: null },
      PLAN,
      { synthesize: synthesize as never },
    )).rejects.toThrow(/голос/i)

    expect(synthesize).not.toHaveBeenCalled()
    expect(h.updates.some(update => update.status === "failed")).toBe(true)
  })
})

describe("шаг транскрипции", () => {
  const TRACK = {
    path: "/tmp/voiceover_track.mp3",
    fingerprint: "sha-трека",
    storageKey: "zavodcamp/videos/44/voiceover_mix.mp3",
  }
  const SCENES = [{ order: 1, text: "Первая реплика." }]

  it("отказ провайдера ПОСЛЕ оплаты трека роняет шаг, а не собирает ролик без сцен ведущего", async () => {
    // Деградация «соберём по плановым длительностям» здесь недостижима: без
    // границ lip-sync пропустит каждую сцену ведущего, своих клипов у них нет,
    // и «готовый» ролик окажется склейкой перебивок под непрерывную речь.
    h.transcriptionTask.mockImplementationOnce(async () => { throw new Error("provider is down") })
    const { runVideoTranscription } = await loadSteps()

    await expect(runVideoTranscription({
      videoId: 44,
      track: TRACK,
      scenes: SCENES,
      language: "ru",
    })).rejects.toThrow(/границ/i)

    expect(h.updates.at(-1)).toMatchObject({ status: "failed" })
  })

  it("провайдеру НЕ передаётся ссылка из хранилища — только локальный путь трека (canary 26.08.2026: 422)", async () => {
    // Причина боевого отказа: локальный драйвер хранилища отдаёт ОТНОСИТЕЛЬНЫЙ
    // путь (`/api/files/...`), Replicate не может его скачать. Правильный
    // адрес заливкой байтов находит requestTranscription/runMediaTask сам —
    // getSignedDownloadUrl шагу транскрипции вообще не нужен.
    const { runVideoTranscription } = await loadSteps()

    await runVideoTranscription({
      videoId: 44,
      track: TRACK,
      scenes: SCENES,
      language: "ru",
    })

    expect(h.signedUrlRequests).toEqual([])
    expect(h.transcriptionTask).toHaveBeenCalledTimes(1)
    const [callArgs] = h.transcriptionTask.mock.calls[0]!
    expect(callArgs).toMatchObject({ audioPath: TRACK.path })
    expect(callArgs).not.toHaveProperty("audioUrl")
  })

  it("провайдер ответил и списал деньги, а ответ не разобрался — шаг падает, но расход записан", async () => {
    // Ровно та причина, по которой учёт денег стоит ДО броска: платёж уже
    // состоялся, и падение шага не повод потерять его в отчёте и в burn-rate.
    h.transcriptionTask.mockImplementationOnce(async () => ({ costUsd: 0.02, raw: { words: [] } }))
    const { runVideoTranscription } = await loadSteps()

    await expect(runVideoTranscription({
      videoId: 44,
      track: TRACK,
      scenes: SCENES,
      language: "ru",
    })).rejects.toThrow(/границ/i)

    expect(h.ledger).toEqual([{ stepKey: "transcription", costUsd: 0.02 }])
    // actualCost накоплен ДО отказа, иначе упавшая попытка обнулила бы траты.
    expect(h.updates.some(update => update.actualCost === 0.02)).toBe(true)
    expect(h.updates.at(-1)).toMatchObject({ status: "failed" })
    // Файл уже ушёл в хранилище (оплачен), а разбор упал — без строки
    // VideoAsset он остался бы сиротой вне каскада удаления и orphan-scan.
    expect(h.videoAssetWrites).toContainEqual({ op: "create", videoId: 44, type: "transcript" })
  })

  it("бросок внутри шага не теряет уже оплаченный расход", async () => {
    // Провайдер ответил и деньги списаны, а дальше упало сохранение
    // транскрипта (например, БД недоступна) — `runTranscriptionStep` в этом
    // месте ничего не перехватывает и бросает наружу. Расход обязан попасть в
    // ledger и в actualCost ДО того, как исключение уйдёт наверх. Иначе трек
    // оплачен, транскрипция оплачена, а шаг навсегда виснет в running без
    // следа в отчёте.
    h.transcriptionTask.mockImplementationOnce(async () => ({
      costUsd: 0.03,
      raw: { words: [
        { word: "первая", start: 0, end: 0.5 },
        { word: "реплика", start: 0.5, end: 1.1 },
      ] },
    }))
    const { runVideoTranscription } = await loadSteps()

    await expect(runVideoTranscription({
      videoId: 44,
      track: TRACK,
      scenes: SCENES,
      language: "ru",
    }, {
      saveTranscript: async () => { throw new Error("хранилище транскриптов недоступно") },
    })).rejects.toThrow()

    expect(h.ledger).toEqual([{ stepKey: "transcription", costUsd: 0.03 }])
    // actualCost накоплен ДО отказа, иначе упавшая попытка обнулила бы траты.
    expect(h.updates.some(update => update.actualCost === 0.03)).toBe(true)
    expect(h.updates.at(-1)).toMatchObject({ status: "failed" })
  })

  it("сбой самой записи расхода не выдаётся за отказ провайдера", async () => {
    // Провайдер ответил и назвал стоимость, а запись actualCost в БД упала
    // (обрыв соединения, конфликт). Если бы запись расхода выполнялась внутри
    // runTask-колбэка, который раннер (`runner.ts:83-99`) оборачивает в
    // try/catch, сбой самой записи превратился бы в «провайдер не ответил»:
    // costUsd обнулился бы, а шаг ушёл бы в failed с ПОДСТАВНОЙ причиной
    // "alignment_missing", где текст настоящей ошибки БД спрятан внутри
    // формулировки про недостающие границы слов. Запись — снаружи runTask,
    // поэтому сбой обязан дойти до вызывающего кода СЫРЫМ: сообщение должно
    // НАЧИНАТЬСЯ с текста ошибки БД, а не быть подстрокой внутри чужой.
    h.transcriptionTask.mockImplementationOnce(async () => ({
      costUsd: 0.05,
      raw: { words: [
        { word: "первая", start: 0, end: 0.5 },
        { word: "реплика", start: 0.5, end: 1.1 },
      ] },
    }))
    h.updateStepFailsOnCostWrite = true
    const { runVideoTranscription } = await loadSteps()

    await expect(runVideoTranscription({
      videoId: 44,
      track: TRACK,
      scenes: SCENES,
      language: "ru",
    })).rejects.toThrow(/^БД недоступна/)

    // Подставной причины нет НИГДЕ: ни в снапшоте шага (`failStep` кладёт её в
    // `outputSnapshot.reason`), ни в тексте ошибки шага, ни в его логе. И
    // «успешным» шаг тоже не объявлен — сбой не спрятался под другой конец.
    //
    // Проверяем именно отсутствие ПОДСТАВНОЙ причины, а не отсутствие статуса
    // "failed": увести шаг в failed с НАСТОЯЩЕЙ причиной (обернуть `recordCost`,
    // чтобы он не висел в running) — это улучшение, и запрещать его тестом
    // нельзя. Смысл проверки в паре с броском `/^БД недоступна/` выше: наверх
    // ушла сырая ошибка записи, а не пересказ про недостающие границы слов.
    const snapshotReasons = h.updates.map(update =>
      (update.outputSnapshot as { reason?: string } | null | undefined)?.reason)
    expect(snapshotReasons).not.toContain("alignment_missing")
    expect(h.updates.some(update => /границ/i.test(String(update.errorMessage ?? "")))).toBe(false)
    expect(h.logs.some(line => /границ/i.test(line))).toBe(false)
    expect(h.updates.some(update => update.status === "completed")).toBe(false)
  })

  it("отказ провайдера без ответа денег не пишет — списывать нечего", async () => {
    h.transcriptionTask.mockImplementationOnce(async () => { throw new Error("provider is down") })
    const { runVideoTranscription } = await loadSteps()

    await expect(runVideoTranscription({
      videoId: 44,
      track: TRACK,
      scenes: SCENES,
      language: "ru",
    })).rejects.toThrow()

    expect(h.ledger).toEqual([])
  })

  it("частичное выравнивание — успех с предупреждением в логе, а не шаг с ошибкой", async () => {
    // Слова провайдера совпадают со сценарием лишь отчасти: границы есть,
    // монтаж возможен. errorMessage у такого шага читался бы в UI как сбой.
    h.transcriptionTask.mockImplementationOnce(async () => ({
      costUsd: 0.02,
      raw: { words: [
        { word: "первая", start: 0, end: 0.5 },
        { word: "посторонний", start: 0.5, end: 1.0 },
        { word: "текст", start: 1.0, end: 1.5 },
      ] },
    }))
    const { runVideoTranscription } = await loadSteps()

    const result = await runVideoTranscription({
      videoId: 44,
      track: TRACK,
      scenes: [{ order: 1, text: "первая реплика ролика" }],
      language: "ru",
    })

    expect(result.status).toBe("degraded")
    expect(result.scenes.length).toBeGreaterThan(0)
    const final = h.updates.at(-1)!
    // Не просто «не записали ошибку», а СНЯЛИ её: шаг мог падать на прошлой
    // попытке, и текст той ошибки на успешном шаге читается в UI как сбой.
    expect(final).toMatchObject({ status: "completed", errorMessage: null })
    expect(h.logs.some(message => /предупреждение/i.test(message))).toBe(true)
  })

  it("готовый транскрипт того же трека не оплачивается второй раз", async () => {
    h.stepCompleted = true
    h.step.outputSnapshot = {
      trackFingerprint: "sha-трека",
      status: "completed",
      scenes: [{ order: 1, startSec: 0, endSec: 3.2, words: [] }],
      warning: null,
    }
    const { runVideoTranscription } = await loadSteps()

    const result = await runVideoTranscription({
      videoId: 44,
      track: TRACK,
      scenes: SCENES,
      language: "ru",
    })

    expect(h.transcriptionTask).not.toHaveBeenCalled()
    expect(result.scenes).toHaveLength(1)
    expect(result.costUsd).toBe(0)
  })

  it("перезаписанный трек обесценивает транскрипт — границы относились к другому звуку", async () => {
    h.stepCompleted = true
    h.step.outputSnapshot = {
      trackFingerprint: "sha-ПРОШЛОГО-трека",
      status: "completed",
      scenes: [{ order: 1, startSec: 0, endSec: 3.2, words: [] }],
      warning: null,
    }
    const { runVideoTranscription } = await loadSteps()

    await runVideoTranscription({
      videoId: 44,
      track: TRACK,
      scenes: SCENES,
      language: "ru",
    })

    expect(h.transcriptionTask).toHaveBeenCalledTimes(1)
  })

  it("без ключа в хранилище платного вызова не делает, но и «готовым» ролик не объявляет", async () => {
    const { runVideoTranscription } = await loadSteps()

    await expect(runVideoTranscription({
      videoId: 44,
      track: { ...TRACK, storageKey: null },
      scenes: SCENES,
      language: "ru",
    })).rejects.toThrow(/хранилищ/i)

    expect(h.transcriptionTask).not.toHaveBeenCalled()
    expect(h.updates.at(-1)).toMatchObject({ status: "failed" })
  })
})
