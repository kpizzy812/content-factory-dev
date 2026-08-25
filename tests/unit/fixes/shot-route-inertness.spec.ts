/**
 * Task 6 («Сборка по кадрам»): инертность старого маршрута — доказана тестом,
 * а не заявлена.
 *
 * `runAssembly` теперь строит кадровый таймлайн (`shotTimeline`) внутри ветки
 * `extras.shotRouteActive`, и по пути гасит клип-позиционные вычисления
 * (`sceneSubtitles`, `clipTrackAlignment`, keyword pre-pass, Remotion-плашки),
 * которые раньше исполнялись безусловно. Три сценария обязаны остаться
 * ПОБАЙТОВО прежними:
 *
 *  A. Флага `shotRouteActive` нет вовсе (старый вызывающий, ролик без
 *     EDIT_PIPELINE) — `prisma.video`/`prisma.videoShot` не мокаются вовсе
 *     в этом файле: случайный поход в БД внутри кадровой ветки уронил бы
 *     тест `TypeError`, а не тихо продолжил работать неверно.
 *  B. `shotRouteActive: false` явно — тот же результат, что и без поля
 *     вовсе (сравнение опций `assembleVideo` побайтово, `toEqual`).
 *  C. `shotRouteActive: true`, но `VideoShot` в БД нет (в проде недостижимо:
 *     `video-pipeline.ts` проставляет флаг ТОЛЬКО по факту состоявшегося
 *     `runVideoEditPlan`) — `composeVideoShots` возвращает `null`, и
 *     `runAssembly` отказывается ЧЕСТНО (Сомнение 2, фикс-раунд 1, ревью), а
 *     не откатывается на клиповый путь: откат оставлял бы преflight-ворота
 *     подгона длины выключенными (они гасятся по флагу, а не по факту
 *     `composeResult`), и ролик собрался бы без подгона под трек со статусом
 *     «готов».
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { tmpdir } from "node:os"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"
import type { SubtitlePlacement } from "~~/shared/types/story"

const h = vi.hoisted(() => ({
  step: { id: 44, attemptCount: 0, actualCost: 0, outputSnapshot: null as unknown },
  logs: [] as string[],
  updates: [] as Record<string, unknown>[],
  assembleCalls: [] as Array<Record<string, unknown>>,
  videoShotRows: [] as Array<Record<string, unknown>>,
  videoAssetRows: [] as Array<Record<string, unknown>>,
  videoRow: null as Record<string, unknown> | null,
}))

// Н-3 (ре-ревью фикс-раунда 1): для теста «дубль order не роняет ролик без
// субтитров» composeVideoShots обязана реально СОБРАТЬСЯ (иначе сборка
// отказывает раньше, до того места, где решается, вызывать ли
// buildScenesByPositionForShotTimeline). renderShotComposition — единственная
// точка, где нужен настоящий ffmpeg; мокаем её в no-op, чтобы кадр считался
// собранным без реального процесса.
vi.mock("../../../server/utils/video-tools/shot-compose-runner", () => ({
  renderShotComposition: async () => {},
}))

vi.mock("../../../server/utils/video-pipeline-db", () => ({
  ensureStep: async () => h.step,
  updateStep: async (_id: number, patch: Record<string, unknown>) => { h.updates.push(patch) },
  appendStepLog: async (_id: number, line: string) => { h.logs.push(line) },
  isStepCompleted: () => false,
  updateVideoStatus: async () => undefined,
  STEP_ORDER: [
    "prompt_generation", "image_generation", "clip_generation", "voiceover_generation",
    "music_generation", "lip_sync_generation", "assembly", "transcription", "edit_plan",
  ],
}))

vi.mock("../../../server/utils/render", () => ({
  normalizeSceneClips: async (paths: string[]) => [...paths],
  probeSceneClipDurations: async (paths: string[]) => paths.map(p => (p ? 5 : null)),
  probeMediaDuration: async (path: string) => (path ? 5 : null),
  probeClipDurations: async (paths: string[]) => paths.map(() => 5),
  adjustAudioTempo: async () => ({ outputPath: "x", durationSec: 1 }),
  trimAudio: async () => ({ outputPath: "x", durationSec: 1 }),
  planClipExtension: () => ({ allowed: false, neededSec: 0, limitSec: 0 }),
}))

vi.mock("../../../server/utils/agents/subtitle-keyword-agent", () => ({
  runSubtitleKeywordAgent: async () => ({ segments: [] }),
}))
vi.mock("../../../server/utils/remotion/render", () => ({
  renderRemotionOverlays: async () => ({ status: "skipped", reason: "тест" }),
}))
vi.mock("../../../server/utils/storage/persist-asset", () => ({
  uploadLocalAsset: async (_p: string, storageKey: string) => ({ storageKey, storageProvider: "local" }),
}))
vi.mock("../../../server/utils/storage/download-to-storage", () => ({
  storageKeyToLegacyUrl: () => "/api/files/final.mp4",
}))
vi.mock("../../../server/utils/balance/cost-ledger", () => ({ logStepCost: async () => undefined }))

function installGlobals(withShotDb: boolean) {
  const g = globalThis as Record<string, unknown>
  g.getVideosDir = () => tmpdir()
  g.getAssetsDir = () => tmpdir()
  g.ensureDir = async () => {}
  g.safeUnlink = async () => {}
  g.logAgent = async () => {}
  g.assembleVideo = async (opts: Record<string, unknown>) => {
    h.assembleCalls.push(opts)
    return { filePath: "final.mp4", duration: 30, durationFit: undefined }
  }
  const prisma: Record<string, unknown> = {
    videoAsset: {
      findFirst: async () => null,
      findMany: async () => h.videoAssetRows,
      create: async () => ({}),
      update: async () => ({}),
    },
  }
  // Сценарий A (флага нет вовсе) намеренно НЕ даёт `video`/`videoShot` вовсе:
  // случайный поход в БД внутри кадровой ветки должен уронить тест ошибкой,
  // а не тихо продолжить с undefined.
  if (withShotDb) {
    prisma.video = {
      findUnique: async () => h.videoRow,
    }
    prisma.videoShot = {
      findMany: async () => h.videoShotRows,
      update: async () => ({}),
    }
  }
  g.prisma = prisma
}

const BOTTOM: SubtitlePlacement = { position: "bottom", alignment: "center", avoidZones: [] }

function plan(): StoryDrivenVideoPlan {
  return {
    mode: "story_driven",
    scenes: [1, 2, 3].map(order => ({
      order,
      durationSec: 5,
      subtitleCopy: `Сцена ${order}`,
      subtitlePlacement: BOTTOM,
      spokenLine: null,
      voiceoverLine: null,
    })),
    subtitleStyle: null,
  } as unknown as StoryDrivenVideoPlan
}

const CLIPS = ["c0.mp4", "c1.mp4", "c2.mp4"]

async function loadSteps(withShotDb: boolean) {
  installGlobals(withShotDb)
  return await import("../../../server/utils/video-pipeline-steps")
}

let scratchDir: string
let bgImagePath: string

beforeAll(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "cf-shot-route-inertness-"))
  bgImagePath = join(scratchDir, "bg.png")
  // Содержимое не важно — composeVideoShots (в этом тесте) только проверяет
  // существование файла (`defaultShotFileExists`) и записи assetPath, а
  // реальный рендер замокан (см. vi.mock выше).
  await writeFile(bgImagePath, "заглушка фона для проверки существования файла")
})

afterAll(async () => {
  await rm(scratchDir, { recursive: true, force: true }).catch(() => {})
})

beforeEach(() => {
  h.step = { id: 44, attemptCount: 0, actualCost: 0, outputSnapshot: null }
  h.logs.length = 0
  h.updates.length = 0
  h.assembleCalls.length = 0
  h.videoShotRows = []
  h.videoAssetRows = []
  h.videoRow = null
})

describe("Task 6: инертность старого маршрута — доказана тестом", () => {
  it("A. shotRouteActive не передан — assembleVideo не получает shotTimeline, prisma кадров не тронута", async () => {
    const steps = await loadSteps(false)

    const result = await steps.runAssembly(41, CLIPS, null, true, "Хук", "CTA", "portrait", plan(), {
      clipSceneOrders: [1, 2, 3],
    })

    expect(result.filePath).toBe("final.mp4")
    expect(h.assembleCalls).toHaveLength(1)
    expect(h.assembleCalls[0]!.shotTimeline).toBeUndefined()
    expect(h.assembleCalls[0]!.clips).toEqual(CLIPS)
  })

  it("B. shotRouteActive: false — результат ПОБАЙТОВО совпадает с отсутствием поля", async () => {
    const stepsWithout = await loadSteps(false)
    await stepsWithout.runAssembly(41, CLIPS, null, true, "Хук", "CTA", "portrait", plan(), {
      clipSceneOrders: [1, 2, 3],
    })
    const withoutFlagCall = h.assembleCalls[0]

    h.assembleCalls.length = 0
    h.logs.length = 0
    h.updates.length = 0

    const stepsFalse = await loadSteps(false)
    await stepsFalse.runAssembly(41, CLIPS, null, true, "Хук", "CTA", "portrait", plan(), {
      clipSceneOrders: [1, 2, 3],
      shotRouteActive: false,
    })
    const withFalseFlagCall = h.assembleCalls[0]

    expect(withFalseFlagCall).toEqual(withoutFlagCall)
  })

  // Сомнение 2 фикс-раунда 1 (ревью): раньше этот сценарий тихо откатывался на
  // клиповый путь — но откат был НЕ безопаснее старого маршрута, а опаснее
  // (см. докстринг у throw в runAssembly): `clipTrackAlignment`/преflight-ворота
  // подгона длины остаются выключены гейтом `!extras?.shotRouteActive`
  // независимо от того, собрались кадры или нет, и ролик с `alignedScenes`
  // (audio-first) уехал бы в хранилище БЕЗ подгона длины под трек со статусом
  // «готов». Честный отказ — правильное поведение (§10).
  it("C. shotRouteActive: true, но VideoShot в БД нет — сборка отказывается ЧЕСТНО, а не откатывается тихо", async () => {
    h.videoShotRows = [] // ролик БЕЗ единого кадра, несмотря на выставленный флаг
    h.videoRow = { editProfileId: null, editOverrides: null, editProfile: null, applicationId: null, voiceoverReconciliation: null }

    const steps = await loadSteps(true)
    await expect(
      steps.runAssembly(41, CLIPS, null, true, "Хук", "CTA", "portrait", plan(), {
        clipSceneOrders: [1, 2, 3],
        shotRouteActive: true,
      }),
    ).rejects.toThrow(/нет ни одной строки VideoShot/)

    // Готовым ролик не помечается — до assembleVideo сборка не доходит вовсе.
    expect(h.assembleCalls).toHaveLength(0)
    expect(h.updates.some(u => u.status === "completed")).toBe(false)
  })

  // Important 5 (ревью фикс-раунда 1): здесь проверяется ТОЛЬКО строка лога —
  // это честно и достаточно на уровне runAssembly, потому что extendVideoClip
  // вызывается ЕДИНСТВЕННЫМ местом кодовой базы, `runVoiceoverGeneration`, куда
  // runAssembly не ходит НИ НА КАКОМ маршруте: ассерт «extendVideoClip не
  // вызван» здесь был бы вакуумным (не может упасть в принципе, см. отчёт
  // фикс-раунда 1). Реальная проверка «политика extend_scene не оставляет
  // *_ext.mp4 на кадровом маршруте» — DB-тест на уровне ЦЕЛОГО пайплайна,
  // `tests/integration/audio-first-pipeline.spec.ts` (там она действительно
  // могла бы сработать, если бы устройство ветки сломалось).
  it("§8 — voiceoverReconciliation выключается ЯВНО на кадровом маршруте: лог называет причину", async () => {
    // Кадров нет (см. Сомнение 2 — сборка честно откажется), но лог о
    // политике пишется РАНЬШЕ этого отказа (сразу после чтения конфига
    // ролика, до вызова composeVideoShots) — порядок важен: оператор обязан
    // увидеть причину даже на ролике, которому нечего было собирать.
    h.videoShotRows = []
    h.videoRow = { editProfileId: null, editOverrides: null, editProfile: null, applicationId: null, voiceoverReconciliation: "extend_scene" }

    const steps = await loadSteps(true)
    await expect(
      steps.runAssembly(41, CLIPS, null, true, "Хук", "CTA", "portrait", plan(), {
        clipSceneOrders: [1, 2, 3],
        shotRouteActive: true,
      }),
    ).rejects.toThrow()

    expect(h.logs.some(l => l.includes("voiceoverReconciliation") && l.includes("extend_scene") && l.includes("не")))
      .toBe(true)
  })

  it("нейтральная политика (не задана) — лог о voiceoverReconciliation не появляется", async () => {
    h.videoShotRows = []
    h.videoRow = { editProfileId: null, editOverrides: null, editProfile: null, applicationId: null, voiceoverReconciliation: null }

    const steps = await loadSteps(true)
    await expect(
      steps.runAssembly(41, CLIPS, null, true, "Хук", "CTA", "portrait", plan(), {
        clipSceneOrders: [1, 2, 3],
        shotRouteActive: true,
      }),
    ).rejects.toThrow()

    expect(h.logs.some(l => l.includes("voiceoverReconciliation"))).toBe(false)
  })

  // Н-3 (ре-ревью фикс-раунда 1, Minor исполняемый в этом раунде): отказ на
  // дубле `order` не должен срабатывать, если субтитры выключены — показывать
  // чужой текст было бы попросту нечего. `buildScenesByPositionForShotTimeline`
  // теперь вызывается ТОЛЬКО под `subtitlesEnabled` (см. runAssembly).
  it("Н-3: дубль order с несошедшимся тождеством НЕ роняет ролик, если субтитры выключены", async () => {
    h.videoShotRows = [{
      id: "shot1", order: 0, startSec: 0, endSec: 2, sceneOrder: null,
      foreground: "none", pipEnabled: false, background: "library",
      assetPath: null, status: "planned",
    }]
    h.videoAssetRows = [{ order: 0, filePath: bgImagePath, contentType: "image/png" }]
    h.videoRow = { editProfileId: null, editOverrides: null, editProfile: null, applicationId: null, voiceoverReconciliation: null }

    // Дубль order [1,1,2] в плане, а в alignedScenes — только ДВЕ сцены с
    // order=1 (сцена order=2 «выпала из трека») — длины не совпадают
    // (тождество сломано), order дублируется среди alignedScenes. Если бы
    // buildScenesByPositionForShotTimeline позвали, она бы бросила (см.
    // shot-scenes-by-position.spec.ts). При выключенных субтитрах звать её
    // не должны вовсе.
    const dupOrderPlan: StoryDrivenVideoPlan = {
      mode: "story_driven",
      scenes: [1, 1, 2].map(order => ({
        order,
        durationSec: 5,
        subtitleCopy: `Сцена ${order}`,
        subtitlePlacement: BOTTOM,
        spokenLine: null,
        voiceoverLine: null,
      })),
      subtitleStyle: null,
    } as unknown as StoryDrivenVideoPlan

    const steps = await loadSteps(true)
    const result = await steps.runAssembly(41, CLIPS, null, false, "Хук", "CTA", "portrait", dupOrderPlan, {
      clipSceneOrders: [1, 1, 2],
      shotRouteActive: true,
      alignedScenes: [
        { order: 1, startSec: 0, endSec: 1, words: [] },
        { order: 1, startSec: 1, endSec: 2, words: [] },
      ] as never,
      voiceoverDurationSec: 2,
    })

    expect(result.filePath).toBe("final.mp4")
    expect(h.assembleCalls).toHaveLength(1)
    expect(h.assembleCalls[0]!.shotTimeline).toBeDefined()
  })

  // Н-5 (ре-ревью фикс-раунда 1): `trackDurationSec: extras?.voiceoverDurationSec
  // ?? последний.endSec` делал проверку покрытия хвоста таймлайна тавтологией —
  // фолбэк брал число ИЗ ТЕХ ЖЕ shots, которые assertShotsCoverTrack сверяет
  // против него же. Убрано: `voiceoverDurationSec` теперь обязателен на
  // кадровом маршруте, отсутствие — честный отказ, а не молчаливая тавтология.
  it("Н-5: voiceoverDurationSec не доехал — честный отказ, а не тавтологичный фолбэк на конец последнего кадра", async () => {
    h.videoShotRows = [{
      id: "shot1", order: 0, startSec: 0, endSec: 2, sceneOrder: null,
      foreground: "none", pipEnabled: false, background: "library",
      assetPath: null, status: "planned",
    }]
    h.videoAssetRows = [{ order: 0, filePath: bgImagePath, contentType: "image/png" }]
    h.videoRow = { editProfileId: null, editOverrides: null, editProfile: null, applicationId: null, voiceoverReconciliation: null }

    const steps = await loadSteps(true)
    await expect(
      steps.runAssembly(41, CLIPS, null, false, "Хук", "CTA", "portrait", plan(), {
        clipSceneOrders: [1, 2, 3],
        shotRouteActive: true,
        // voiceoverDurationSec НЕ передан — старый фолбэк подставил бы 2с
        // (endSec последнего кадра) и проверка покрытия PASS'ила бы всегда.
      }),
    ).rejects.toThrow(/измеренная длина трека не доехала/)

    expect(h.assembleCalls).toHaveLength(0)
  })
})
