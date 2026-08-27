/**
 * Пошаговый режим ждёт решения оператора ВНЕ прогона (§9 плана
 * «Локальная замена сегмента и интерфейс монтажа», Task 6).
 *
 * Чистое правило «останавливаться ли после шага» живёт в
 * `tests/unit/fixes/stepwise-wait.spec.ts`. Здесь проверяется то, что без БД
 * проверить нечем и ради чего режим вообще устроен именно так:
 *
 *  1. прогон ДОВОДИТ шаг до конца, ставит ролик в `awaiting_operator` и
 *     ЗАВЕРШАЕТСЯ — процесс не висит;
 *  2. блокировка ролика ОТПУЩЕНА (`isLocked=false`, `lockedAt=null`);
 *  3. состояние ожидания живёт в БД и переживает РЕСТАРТ ПРОЦЕССА: после
 *     сброса модулей (новый реестр блокировок в памяти) ролик всё ещё ждёт, а
 *     новый прогон свободно берёт блокировку — значит она не утекла;
 *  4. новый прогон САМ ролик не продолжает — снова встаёт на том же шаге и не
 *     платит за уже выполненный;
 *  5. watchdog (`planStalledVideoRecovery` + его SQL-фильтр) такой ролик не
 *     подхватывает: иначе он оплатил бы следующий шаг за оператора, которого
 *     никто не спрашивал;
 *  6. «принять» двигает прогон на следующий шаг, не переоплачивая принятый;
 *  7. «перегенерировать» переигрывает шаг и снова спрашивает оператора.
 *
 * Прогон настоящий (`runVideoPipeline`) на настоящей тестовой БД; внешние
 * провайдеры подменены их штатными мок-режимами из `.env.test`
 * (`ANTHROPIC_MOCK_MODE`, `FAL_MOCK_MODE`, `REPLICATE_MOCK_MODE`) —
 * `ENABLE_PAID_APIS=false`, ни одного платного вызова.
 *
 * Ролик намеренно идёт ПРЕЖНИМ маршрутом (`editPipeline: false`): первый его
 * шаг — `prompt_generation`, самый дешёвый в прогоне, и пауза наступает ещё до
 * единого платного медиа-вызова. Маршрут на правило не влияет (это проверено
 * табличным тестом по обоим порядкам в чистой сьюте), а прогон здесь короче.
 *
 * Почему globalThis: `server/utils/**` рассчитан на авто-импорты Nitro
 * (`prisma`, `logAgent`, `ensureDir`…). Вне Nuxt-процесса их подставляет тест —
 * настоящими реализациями из тех же модулей (приём взят из
 * `tests/integration/audio-first-pipeline.spec.ts`).
 *
 * @vitest-environment node
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createError } from "h3"

import { prisma } from "../../server/utils/prisma"
import * as render from "../../server/utils/render"
import { logAgent } from "../../server/utils/agent-logger"
import { downloadFile } from "../../server/utils/video-helpers"
import { resetStorageDriver } from "../../server/utils/storage"
import {
  planStalledVideoRecovery,
  RESUMABLE_VIDEO_STATUSES,
  type StalledVideoCandidate,
} from "../../server/utils/video-pipeline-run-policy"
import { AWAITING_OPERATOR_STATUS } from "../../server/utils/video-pipeline-stepwise"

const globals = globalThis as Record<string, unknown>

/** См. одноимённую константу в audio-first-pipeline.spec.ts: точка входа worker_threads. */
const NOT_A_MODULE = ["/pipeline-code-worker.ts"]

async function installNitroAutoImports(): Promise<void> {
  const modules = import.meta.glob("../../server/utils/**/*.ts")
  for (const path of Object.keys(modules).sort()) {
    if (NOT_A_MODULE.some(tail => path.endsWith(tail))) continue
    try {
      const loaded = await modules[path]!() as Record<string, unknown>
      for (const [name, value] of Object.entries(loaded)) {
        if (name === "default") continue
        if (!(name in globals)) globals[name] = value
      }
    } catch { /* модуль вне маршрута — его отсутствие проявится падением по делу */ }
  }
  globals.createError = createError
  globals.prisma = prisma
  globals.logAgent = logAgent
  globals.downloadFile = downloadFile
  globals.ensureDir = render.ensureDir
  globals.safeUnlink = render.safeUnlink
  globals.getAssetsDir = render.getAssetsDir
  globals.getVideosDir = render.getVideosDir
  globals.assembleVideo = render.assembleVideo
}

const SCENE_LINES = [
  "Первая сцена рассказывает про запуск проекта",
  "Вторая сцена показывает результат за неделю",
  "Третья сцена зовёт написать кодовое слово",
]

function storyPlan() {
  return {
    version: "story-driven-1.0",
    storyArc: {
      template: "discovery",
      premise: "p",
      conflict: "c",
      turningPoint: "t",
      resolution: "r",
      emotionalJourney: ["curiosity", "excitement", "satisfaction"],
    },
    scenes: SCENE_LINES.map((line, index) => ({
      order: index + 1,
      purpose: `сцена ${index + 1}`,
      setting: "студия",
      action: "ведущий говорит в камеру",
      whatChanges: "меняется тема",
      emotionalState: "спокойствие",
      appIntegrationBeat: null,
      visualPromptGuidance: `studio shot, presenter, scene ${index + 1}`,
      subtitleCopy: line,
      subtitlePlacement: { position: "bottom", alignment: "center", avoidZones: [] },
      // Ни одной реплики В КАДРЕ: ролик не должен уходить в lip-sync и
      // presenterOnly — иначе первый шаг прогона пропускается, и паузу после
      // него проверять было бы не на чем.
      voiceoverLine: null,
      spokenLine: null,
      continuityNotes: "",
      duration: "5s",
      cameraAngle: "medium",
      props: [],
    })),
    voiceoverPlan: { enabled: false, narratorPersona: null, pacing: "moderate", emotionalContour: [], syncGuidance: "", lines: [] },
    subtitleStyle: null,
    globalVisualSystem: {
      stylePrompt: "clean studio, soft key light",
      colorPalette: ["#101010", "#f5f5f5"],
      mood: "уверенный",
      lighting: "мягкий свет",
    },
    protagonist: {
      type: "person",
      description: "ведущий",
      initialState: "сомневается",
      finalState: "уверен",
      visualIdentifiers: ["тёмная толстовка"],
    },
    continuityBible: { protagonistLock: "", environmentLock: "", propsLock: [], forbidden: [] },
    appIntegrationStrategy: "мельком",
    negativeConstraints: [],
    fullScript: SCENE_LINES.join(" "),
  }
}

/** Ролик с включённым пошаговым режимом на прежнем маршруте. */
async function createVideoFixture(stepwiseApproval: boolean | null): Promise<number> {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  const app = await prisma.app.create({
    data: { name: `StepwiseApp ${seed}`, description: "фикстура пошагового режима", keywords: [] },
  })
  const scenario = await prisma.scenario.create({
    data: { appId: app.id, status: "selected" as never },
  })
  const variant = await prisma.scenarioVariant.create({
    data: {
      scenarioId: scenario.id,
      variantIndex: 0,
      status: "accepted" as never,
      title: "Пошаговый прогон",
      hook: "Хук ролика",
      body: "Тело ролика",
      cta: "Пиши слово",
      fullScript: SCENE_LINES.join(" "),
      visualStyleText: "чистый студийный свет",
      storyPlan: storyPlan() as never,
    },
  })
  await prisma.scenario.update({ where: { id: scenario.id }, data: { selectedVariantId: variant.id } })

  const video = await prisma.video.create({
    data: {
      scenarioId: scenario.id,
      variantId: variant.id,
      status: "pending" as never,
      format: "portrait" as never,
      editPipeline: false,
      stepwiseApproval,
      voiceoverEnabled: false,
      musicEnabled: false,
      lipSyncEnabled: false,
      subtitlesEnabled: false,
      generateAudio: false,
      imageModelId: "fal-ai/flux/dev",
      videoModelId: "fal-ai/kling-video/v3/standard/text-to-video",
      modelStrategy: "auto",
      clipDuration: 5,
      imageCount: 3,
      renderQuality: "medium",
      targetPlatform: "tiktok",
    },
  })
  return video.id
}

interface StepFacts {
  status: string
  attemptCount: number
  actualCost: number | null
}

async function stepFacts(videoId: number, stepKey: string): Promise<StepFacts | null> {
  const step = await prisma.videoGenerationStep.findFirst({
    where: { videoId, stepKey: stepKey as never },
    select: { status: true, attemptCount: true, actualCost: true },
  })
  return step ? { status: String(step.status), attemptCount: step.attemptCount, actualCost: step.actualCost } : null
}

async function videoFacts(videoId: number) {
  const video = await prisma.video.findUniqueOrThrow({
    where: { id: videoId },
    select: {
      status: true, awaitingStepKey: true, approvedStepKey: true,
      isLocked: true, lockedAt: true, lockedReason: true,
      currentStep: true, finishedAt: true,
    },
  })
  return { ...video, status: String(video.status), awaitingStepKey: video.awaitingStepKey ? String(video.awaitingStepKey) : null }
}

/**
 * «Рестарт процесса»: сбрасываем кэш модулей и импортируем пайплайн заново.
 *
 * Новый импорт — новый `lockRegistry` в памяти (video-pipeline-db.ts), то есть
 * ровно то состояние, в котором оказывается перезапущенный воркер. Если прогон
 * оставил бы блокировку в БД, новый `runVideoPipeline` бросил бы «уже запущен».
 */
async function freshPipelineModule() {
  vi.resetModules()
  return import("../../server/utils/video-pipeline")
}

let storageRoot: string
const PATCHED_ENV = ["STORAGE_DRIVER", "STORAGE_LOCAL_ROOT", "UPLOADS_STORAGE_PATH"] as const
const previousEnv = new Map<string, string | undefined>()

function patchEnv(name: (typeof PATCHED_ENV)[number], value: string): void {
  if (!previousEnv.has(name)) previousEnv.set(name, process.env[name])
  process.env[name] = value
}

describe("пошаговый режим ждёт оператора вне прогона", () => {
  beforeAll(async () => {
    // Прогон настоящий: без мок-режимов он ушёл бы в живых провайдеров.
    expect(process.env.ANTHROPIC_MOCK_MODE).toBe("true")
    expect(process.env.FAL_MOCK_MODE).toBe("true")
    expect(process.env.REPLICATE_MOCK_MODE).toBe("true")
    expect(process.env.ENABLE_PAID_APIS).not.toBe("true")

    patchEnv("STORAGE_DRIVER", "local")
    storageRoot = await mkdtemp(join(tmpdir(), "cf-stepwise-"))
    patchEnv("STORAGE_LOCAL_ROOT", join(storageRoot, "bucket"))
    patchEnv("UPLOADS_STORAGE_PATH", join(storageRoot, "uploads"))
    resetStorageDriver()
    await installNitroAutoImports()
  })

  afterAll(async () => {
    for (const [name, value] of previousEnv) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    previousEnv.clear()
    resetStorageDriver()
    await rm(storageRoot, { recursive: true, force: true }).catch(() => {})
  })

  it("шаг доводится до конца, ролик уходит в ожидание и НЕ держит блокировку", async () => {
    const videoId = await createVideoFixture(true)
    const { runVideoPipeline } = await import("../../server/utils/video-pipeline")

    // Прогон обязан ВЕРНУТЬСЯ, а не повиснуть в ожидании решения: сам await
    // здесь и есть проверка «процесс завершает работу».
    await runVideoPipeline(videoId)

    const video = await videoFacts(videoId)
    expect(video.status).toBe(AWAITING_OPERATOR_STATUS)
    expect(video.awaitingStepKey).toBe("prompt_generation")
    expect(video.currentStep).toBe("prompt_generation")

    // Блокировка отпущена штатным finally — ролик не заперт ни для оператора,
    // ни для следующего прогона.
    expect(video.isLocked).toBe(false)
    expect(video.lockedAt).toBeNull()
    expect(video.lockedReason).toBeNull()

    // Ролик не «закончен»: ожидание — это середина работы, а не финал.
    expect(video.finishedAt).toBeNull()

    // Шаг доведён до конца, а следующий даже не начинался.
    expect((await stepFacts(videoId, "prompt_generation"))?.status).toBe("completed")
    const nextStep = await stepFacts(videoId, "image_generation")
    expect(nextStep?.status ?? "pending").toBe("pending")
    expect(nextStep?.attemptCount ?? 0).toBe(0)
  })

  it("выключенный режим прогон не останавливает вовсе", async () => {
    const videoId = await createVideoFixture(null)
    const { runVideoPipeline } = await import("../../server/utils/video-pipeline")

    // Прогон целиком здесь не нужен и дорог по времени — достаточно факта, что
    // после ПЕРВОГО шага ролик в ожидание не ушёл. Отменяем сразу после него.
    const controller = new AbortController()
    let sawPromptDone = false
    const watcher = setInterval(() => {
      void (async () => {
        const step = await stepFacts(videoId, "prompt_generation")
        if (step?.status === "completed") {
          sawPromptDone = true
          controller.abort()
        }
      })()
    }, 50)

    await runVideoPipeline(videoId, { signal: controller.signal }).catch(() => { /* отмена ожидаема */ })
    clearInterval(watcher)

    expect(sawPromptDone).toBe(true)
    const video = await videoFacts(videoId)
    expect(video.status).not.toBe(AWAITING_OPERATOR_STATUS)
    expect(video.awaitingStepKey).toBeNull()
  })

  it("watchdog ролик в ожидании не видит — ни правилом, ни SQL-фильтром", async () => {
    const videoId = await createVideoFixture(true)
    const { runVideoPipeline } = await import("../../server/utils/video-pipeline")
    await runVideoPipeline(videoId)

    // 1. SQL-фильтр кандидатов (`server/plugins/video-recovery.ts:83`) — тот же
    //    запрос, что делает плагин. Ролик в него не попадает вовсе.
    const scanned = await prisma.video.findMany({
      where: { status: { in: RESUMABLE_VIDEO_STATUSES as never } },
      select: { id: true },
    })
    expect(scanned.map(row => row.id)).not.toContain(videoId)

    // 2. И даже попади он в правило напрямую (чужой вызов, ручной прогон) —
    //    решение «не трогать».
    const row = await prisma.video.findUniqueOrThrow({
      where: { id: videoId },
      select: { id: true, status: true, isLocked: true, lockedAt: true, startedAt: true, createdAt: true, updatedAt: true },
    })
    const candidate: StalledVideoCandidate = { ...row, status: String(row.status) }
    const [decision] = planStalledVideoRecovery([candidate], { now: Date.now() + 24 * 60 * 60_000 })
    expect(decision?.action).toBe("skip")
    expect(decision?.reason).toBe("terminal_status")
  })

  it("рестарт процесса ожидание переживает, а новый прогон сам его не продолжает", async () => {
    const videoId = await createVideoFixture(true)
    const first = await import("../../server/utils/video-pipeline")
    await first.runVideoPipeline(videoId)

    const before = await stepFacts(videoId, "prompt_generation")

    // Рестарт: реестр блокировок в памяти обнулён. Прогон обязан взять
    // блокировку заново — то есть прошлый её действительно отпустил в БД.
    const { runVideoPipeline } = await freshPipelineModule()
    await runVideoPipeline(videoId)

    const video = await videoFacts(videoId)
    expect(video.status).toBe(AWAITING_OPERATOR_STATUS)
    expect(video.awaitingStepKey).toBe("prompt_generation")
    expect(video.isLocked).toBe(false)

    // Шаг переиспользован из снапшота: ни новой попытки, ни новых денег.
    const after = await stepFacts(videoId, "prompt_generation")
    expect(after?.attemptCount).toBe(before?.attemptCount)
    expect(after?.actualCost).toBe(before?.actualCost)

    // И следующий шаг по-прежнему не тронут — «продолжить» само не случилось.
    expect((await stepFacts(videoId, "image_generation"))?.attemptCount ?? 0).toBe(0)
  })

  it("«принять» двигает прогон дальше и не переоплачивает принятый шаг", async () => {
    const videoId = await createVideoFixture(true)
    const { runVideoPipeline, applyStepwiseApproval } = await import("../../server/utils/video-pipeline")
    await runVideoPipeline(videoId)

    const before = await stepFacts(videoId, "prompt_generation")

    const result = await applyStepwiseApproval(videoId, "approve")
    expect(result.approvedStepKey).toBe("prompt_generation")

    // Решение записано ДО прогона и переживает его: ролик снят с ожидания.
    const afterApproval = await videoFacts(videoId)
    expect(afterApproval.status).toBe("pending")
    expect(afterApproval.awaitingStepKey).toBeNull()
    expect(afterApproval.approvedStepKey).toBe("prompt_generation")

    // Ручка запускает прогон fire-and-forget; тест зовёт его сам, чтобы
    // дождаться результата, — вызов тот же самый.
    await runVideoPipeline(videoId)

    const video = await videoFacts(videoId)
    expect(video.status).toBe(AWAITING_OPERATOR_STATUS)
    // Встали на СЛЕДУЮЩЕМ шаге, а не на принятом — иначе оператор жал бы
    // «принять» бесконечно, ни разу не сдвинувшись.
    expect(video.awaitingStepKey).toBe("image_generation")

    const after = await stepFacts(videoId, "prompt_generation")
    expect(after?.attemptCount).toBe(before?.attemptCount)
    expect(after?.actualCost).toBe(before?.actualCost)
  }, 60_000)

  it("«принять» на ролике не в ожидании отвергается — принимать нечего", async () => {
    const videoId = await createVideoFixture(true)
    const { applyStepwiseApproval } = await import("../../server/utils/video-pipeline")

    // 1. Свежий ролик: ни статуса ожидания, ни шага.
    await expect(applyStepwiseApproval(videoId, "approve")).rejects.toMatchObject({ statusCode: 409 })

    // 2. Решает СТАТУС, а не заполненное поле шага. Шаг в записи мог остаться от
    //    прошлой паузы, а прогон уже идти дальше: принять его сейчас значило бы
    //    вмешаться в живой прогон и сбить ему статус на pending.
    await prisma.video.update({
      where: { id: videoId },
      data: { status: "generating_images" as never, awaitingStepKey: "prompt_generation" as never },
    })
    await expect(applyStepwiseApproval(videoId, "approve")).rejects.toMatchObject({ statusCode: 409 })
    // Живой прогон не тронут — статус остался своим.
    expect((await videoFacts(videoId)).status).toBe("generating_images")

    // 3. И наоборот: статус ожидания без шага — тоже отказ, принимать нечего.
    await prisma.video.update({
      where: { id: videoId },
      data: { status: AWAITING_OPERATOR_STATUS as never, awaitingStepKey: null },
    })
    await expect(applyStepwiseApproval(videoId, "approve")).rejects.toMatchObject({ statusCode: 409 })
  })

  it("«перегенерировать» переигрывает шаг и снова спрашивает оператора", async () => {
    const videoId = await createVideoFixture(true)
    const { runVideoPipeline, applyStepwiseApproval } = await import("../../server/utils/video-pipeline")
    await runVideoPipeline(videoId)

    const before = await stepFacts(videoId, "prompt_generation")

    const result = await applyStepwiseApproval(videoId, "regenerate")
    expect(result.regeneratedStepKey).toBe("prompt_generation")
    // Принятым шаг НЕ считается: его как раз просят переделать.
    expect((await videoFacts(videoId)).approvedStepKey).toBeNull()
    expect((await stepFacts(videoId, "prompt_generation"))?.status).toBe("pending")

    await runVideoPipeline(videoId)

    const video = await videoFacts(videoId)
    expect(video.status).toBe(AWAITING_OPERATOR_STATUS)
    expect(video.awaitingStepKey).toBe("prompt_generation")

    // Шаг реально переигран, а не поднят из снапшота.
    const after = await stepFacts(videoId, "prompt_generation")
    expect(after!.attemptCount).toBeGreaterThan(before!.attemptCount)
  }, 60_000)
})
