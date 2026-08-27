/**
 * Точки паузы пошагового режима НА МАРШРУТЕ «монтаж от звука» (§9).
 *
 * Task 6 расставил `pauseAfterStep` в десяти местах обоих маршрутов, но сквозным
 * прогоном исполнялись только точки ПРЕЖНЕГО маршрута: интеграционный тест
 * Task 6 идёт с `editPipeline: false`, где первый шаг — `prompt_generation`.
 * Три audio-first-специфичные точки — `transcription`, `edit_plan`,
 * `shot_background` — держал один табличный тест по `executionOrderFor(true)`,
 * то есть проверялся ПОРЯДОК шагов, а не факт, что оркестратор действительно
 * встаёт в этих местах. Пропущенный `return` после любой из них табличный тест
 * не заметил бы вовсе: он не исполняет оркестратор.
 *
 * Здесь прогоняется настоящий `runVideoPipeline` по маршруту audio-first на
 * настоящей тестовой БД, настоящем ffmpeg и настоящем хранилище. Внешние
 * провайдеры подменены их штатными мок-режимами из `.env.test`
 * (`ANTHROPIC_MOCK_MODE`, `FAL_MOCK_MODE`, `REPLICATE_MOCK_MODE`),
 * `ENABLE_PAID_APIS=false` — ни одного платного вызова. Приём и фикстура взяты
 * из `tests/integration/audio-first-pipeline.spec.ts`, где этот же маршрут уже
 * доводится до готового файла.
 *
 * ПОЧЕМУ ПРОГОН НАЧИНАЕТСЯ С СЕРЕДИНЫ. Первые две точки паузы маршрута
 * (`prompt_generation`, `voiceover_generation`) уже исполнены сквозным прогоном
 * в `stepwise-approval.spec.ts`, и вставать на них здесь значило бы два лишних
 * полных прогона ради уже доказанного. Поэтому ролик стартует с
 * `approvedStepKey = "voiceover_generation"` — это НЕ обходной люк, а ровно то
 * состояние, которое оставляет в БД настоящее «принять» (`applyStepwiseApproval`
 * пишет то же поле тем же значением). Дальше по маршруту тест идёт настоящими
 * вызовами «принять», без единой прямой записи в БД.
 *
 * Почему globalThis: `server/utils/**` рассчитан на авто-импорты Nitro
 * (`prisma`, `logAgent`, `ensureDir`…). Вне Nuxt-процесса их подставляет тест —
 * настоящими реализациями из тех же модулей.
 *
 * @vitest-environment node
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createError } from "h3"

import { prisma } from "../../server/utils/prisma"
import * as render from "../../server/utils/render"
import { logAgent } from "../../server/utils/agent-logger"
import { downloadFile } from "../../server/utils/video-helpers"
import { resetStorageDriver } from "../../server/utils/storage"
import { AWAITING_OPERATOR_STATUS } from "../../server/utils/video-pipeline-stepwise"
import { executionOrderFor } from "../../server/utils/video-pipeline-run-policy"

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

const SPOKEN_LINES = [
  "Первая сцена рассказывает про запуск проекта",
  "Вторая сцена показывает результат за неделю",
  "Третья сцена зовёт написать кодовое слово",
]
const NARRATION_LINE = "Закадровый голос подводит итог недели"
const SCENE_LINES = [...SPOKEN_LINES, NARRATION_LINE]

/**
 * Пауза в произносимом тексте — настоящая тишина от ffmpeg.
 *
 * Мок TTS отдаёт заглушку фиксированной ~1-секундной длины, и без пауз весь
 * сценарий укладывается в эту секунду: интервалы сцен вырождаются, а выравнивание
 * и план монтажа считают на пустом месте. Три паузы растягивают ИЗМЕРЕННЫЙ трек
 * до ~10 с — ровно так же это сделано в `audio-first-pipeline.spec.ts`.
 */
const SCENE_PAUSE_SEC = 3

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
      voiceoverLine: index < SPOKEN_LINES.length ? null : line,
      spokenLine: index < SPOKEN_LINES.length ? `${line} [пауза ${SCENE_PAUSE_SEC}с]` : null,
      continuityNotes: "",
      duration: "5s",
      cameraAngle: "medium",
      props: [],
    })),
    voiceoverPlan: {
      enabled: true,
      narratorPersona: null,
      pacing: "moderate",
      emotionalContour: [],
      syncGuidance: "",
      lines: [{ sceneOrder: SCENE_LINES.length, text: NARRATION_LINE, emotion: "neutral", pauseAfter: "none" }],
    },
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

/**
 * Ролик маршрута audio-first с включённым пошаговым режимом.
 *
 * `approvedStepKey` задаётся при создании — см. шапку файла: это состояние,
 * которое оставляет настоящее «принять», а не обход правила.
 */
async function createAudioFirstFixture(approvedStepKey: string): Promise<number> {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  const app = await prisma.app.create({
    data: { name: `StepwiseAudioFirst ${seed}`, description: "фикстура точек паузы", keywords: [] },
  })
  const scenario = await prisma.scenario.create({ data: { appId: app.id, status: "selected" as never } })
  const variant = await prisma.scenarioVariant.create({
    data: {
      scenarioId: scenario.id,
      variantIndex: 0,
      status: "accepted" as never,
      title: "Пошаговый audio-first",
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
      // Маршрут фиксируется на ролике — ровно как это делает эндпоинт запуска.
      editPipeline: true,
      stepwiseApproval: true,
      approvedStepKey: approvedStepKey as never,
      voiceoverEnabled: true,
      voiceoverModelId: "fal-ai/elevenlabs/tts/turbo-v2.5",
      voiceoverVoiceId: "Rachel",
      voiceoverLanguage: "ru",
      voiceoverPacing: "moderate",
      imageModelId: "fal-ai/flux/dev",
      videoModelId: "fal-ai/kling-video/v3/standard/text-to-video",
      modelStrategy: "auto",
      generateAudio: false,
      musicEnabled: false,
      subtitlesEnabled: true,
      // Lip-sync выключен намеренно: он идёт ПОСЛЕ всех трёх проверяемых точек,
      // а его исходники (библиотека персонажа) — отдельная тяжёлая фикстура.
      // Сюда бы она не добавила ничего, кроме минут прогона.
      lipSyncEnabled: false,
      clipDuration: 5,
      imageCount: 3,
      renderQuality: "medium",
      targetPlatform: "tiktok",
    },
  })
  return video.id
}

async function videoFacts(videoId: number) {
  const video = await prisma.video.findUniqueOrThrow({
    where: { id: videoId },
    select: {
      status: true, awaitingStepKey: true, approvedStepKey: true,
      isLocked: true, lockedAt: true, finishedAt: true,
    },
  })
  return {
    ...video,
    status: String(video.status),
    awaitingStepKey: video.awaitingStepKey ? String(video.awaitingStepKey) : null,
    approvedStepKey: video.approvedStepKey ? String(video.approvedStepKey) : null,
  }
}

/**
 * Статус и число попыток шага.
 *
 * Строки шагов оркестратор заводит ЗАРАНЕЕ, в статусе `pending`, — «шаг не
 * начинался» это не отсутствие записи, а нулевой `attemptCount` при
 * незавершённом статусе. Первая версия теста проверяла отсутствие записи и
 * краснела на живом коде: точка паузы отрабатывала правильно, врал тест.
 */
async function stepFacts(videoId: number, stepKey: string): Promise<{ status: string, attemptCount: number }> {
  const step = await prisma.videoGenerationStep.findFirst({
    where: { videoId, stepKey: stepKey as never },
    select: { status: true, attemptCount: true },
  })
  return step ? { status: String(step.status), attemptCount: step.attemptCount } : { status: "absent", attemptCount: 0 }
}

let storageRoot: string
const PATCHED_ENV = [
  "MEDIA_MODEL_TRANSCRIPTION",
  "STORAGE_DRIVER",
  "STORAGE_LOCAL_ROOT",
  "UPLOADS_STORAGE_PATH",
] as const
const previousEnv = new Map<string, string | undefined>()

function patchEnv(name: (typeof PATCHED_ENV)[number], value: string): void {
  if (!previousEnv.has(name)) previousEnv.set(name, process.env[name])
  process.env[name] = value
}

describe("пошаговый режим встаёт в точках паузы маршрута «монтаж от звука»", () => {
  beforeAll(async () => {
    // Прогон настоящий: без мок-режимов он ушёл бы в живых провайдеров.
    expect(process.env.ANTHROPIC_MOCK_MODE).toBe("true")
    expect(process.env.FAL_MOCK_MODE).toBe("true")
    expect(process.env.REPLICATE_MOCK_MODE).toBe("true")
    expect(process.env.ENABLE_PAID_APIS).not.toBe("true")

    // Без модели транскрипции маршрут audio-first неисполним, и ролик ушёл бы
    // прежним путём целиком — то есть проверялись бы не те точки паузы.
    // Модель в реестре integrated: false, штатный путь включения — переменная.
    patchEnv("MEDIA_MODEL_TRANSCRIPTION", "openai/whisper")
    patchEnv("STORAGE_DRIVER", "local")
    storageRoot = await mkdtemp(join(tmpdir(), "cf-stepwise-af-"))
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

  it("три точки маршрута исполняются по очереди: transcription → edit_plan → shot_background", async () => {
    const videoId = await createAudioFirstFixture("voiceover_generation")
    const { runVideoPipeline, applyStepwiseApproval } = await import("../../server/utils/video-pipeline")

    // Порядок берём из самого маршрута, а не переписываем константой: разойдись
    // они, тест проверял бы собственную копию порядка.
    const order = executionOrderFor(true)
    expect(order.slice(2, 5)).toEqual(["transcription", "edit_plan", "shot_background"])

    for (const expectedStep of ["transcription", "edit_plan", "shot_background"] as const) {
      // Прогон обязан ВЕРНУТЬСЯ, а не повиснуть: сам await и есть проверка того,
      // что ожидание устроено вне прогона.
      await runVideoPipeline(videoId)

      const video = await videoFacts(videoId)
      expect(video.status, `ролик обязан встать после ${expectedStep}`).toBe(AWAITING_OPERATOR_STATUS)
      expect(video.awaitingStepKey).toBe(expectedStep)

      // Шаг доведён до конца ДО паузы — иначе оператору предъявлять нечего.
      expect((await stepFacts(videoId, expectedStep)).status).toBe("completed")

      // Блокировка отпущена штатным finally: ролик не заперт ни для оператора,
      // ни для следующего прогона.
      expect(video.isLocked).toBe(false)
      expect(video.lockedAt).toBeNull()
      // Ожидание — середина работы, а не финал.
      expect(video.finishedAt).toBeNull()

      // СЛЕДУЮЩИЙ шаг не начинался: пропущенный `return` после точки паузы
      // проявился бы именно здесь — оркестратор поехал бы дальше за деньги.
      const nextStep = order[order.indexOf(expectedStep) + 1]!
      const next = await stepFacts(videoId, nextStep)
      expect(next.attemptCount, `${nextStep} не должен был начаться`).toBe(0)
      expect(["absent", "pending"], `${nextStep} не должен был начаться`).toContain(next.status)

      // Двигаемся дальше настоящим «принять», без прямых записей в БД.
      const approved = await applyStepwiseApproval(videoId, "approve")
      expect(approved.approvedStepKey).toBe(expectedStep)
    }

    // После приёмки shot_background ролик снят с ожидания и готов идти дальше.
    const final = await videoFacts(videoId)
    expect(final.status).toBe("pending")
    expect(final.awaitingStepKey).toBeNull()
    expect(final.approvedStepKey).toBe("shot_background")
  }, 600_000)
})
