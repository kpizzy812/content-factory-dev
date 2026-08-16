/**
 * Сквозной прогон маршрута «монтаж от звука» на моках (Task 13).
 *
 * Модульные тесты проверяют куски маршрута по отдельности: выравнивание,
 * нарезку кусков трека, подгон длин, субтитры. Ни один из них не доказывает,
 * что маршрут СОБИРАЕТ РОЛИК. Здесь прогоняется настоящий `runVideoPipeline`
 * на настоящей тестовой БД, настоящем ffmpeg и настоящем хранилище — подменены
 * только внешние провайдеры, и подменены их штатными мок-режимами
 * (`REPLICATE_MOCK_MODE`, `ANTHROPIC_MOCK_MODE`, `FAL_MOCK_MODE`). Ни одного
 * платного вызова: `ENABLE_PAID_APIS=false` остаётся из `.env.test`.
 *
 * Что доказывается (бриф Task 13):
 *  1. шаги выполнены в порядке audio-first;
 *  2. озвучка синтезирована ОДИН раз (один ассет единого трека);
 *  3. транскрипт сохранён и переживает повтор прогона;
 *  4. повторный прогон не создал новых оплаченных задач;
 *  5. финальный файл существует и его длина совпадает с длиной трека.
 *
 * ЧЕГО ЗДЕСЬ НЕТ и почему: lip-sync у ролика выключен. Шаг сам по себе в
 * маршруте есть (и в порядке шагов проверяется), но заставить его отработать
 * НА МОКАХ сегодня нельзя: `runLipSyncStep` принимает только Replicate-модель
 * (`lip-sync-runner.ts`, ветка `preferredModel.provider…includes("replicate")`),
 * а мок Replicate по решению `server/utils/mock/fal-mock.ts` пишет вместо медиа
 * JSON-заглушку под именем `.mp4` (это зафиксировано отдельным тестом
 * `tests/unit/fixes/fal-mock-placeholder.spec.ts`). Такой «клип» ffmpeg не
 * склеит. Значит, нарезка кусков трека под губы сквозным прогоном пока не
 * покрыта — только модульными тестами Task 8.
 *
 * Почему globalThis: `server/utils/**` рассчитан на авто-импорты Nitro
 * (`prisma`, `logAgent`, `ensureDir`, `getAssetsDir`, `assembleVideo`…).
 * Вне Nuxt-процесса их подставляет тест — НАСТОЯЩИМИ реализациями из тех же
 * модулей, а не заглушками: подменять здесь что-либо значило бы проверять не
 * маршрут, а собственные моки.
 *
 * @vitest-environment node
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { prisma } from "../../server/utils/prisma"
import * as render from "../../server/utils/render"
import { logAgent } from "../../server/utils/agent-logger"
import { downloadFile } from "../../server/utils/video-helpers"
import { resetStorageDriver } from "../../server/utils/storage"
import { createError } from "h3"

const globals = globalThis as Record<string, unknown>

/**
 * Авто-импорты Nitro, которых нет в голом vitest.
 *
 * В бою Nitro раскладывает по глобальной области ВСЕ экспорты `server/utils/**`,
 * и пайплайн этим пользуется (`prisma`, `logAgent`, `ensureDir`, `getAssetsDir`,
 * `generateSceneImagePrompts`…). Перечислять их руками — гарантированная гонка
 * с кодом: любой новый авто-импорт ломал бы тест `ReferenceError`'ом далеко от
 * причины. Поэтому раскладываем ровно тем же способом — по всем модулям.
 *
 * Модуль, который не импортируется (ждёт своё окружение), пропускается: он
 * заведомо не участвует в маршруте, иначе прогон упал бы на его функции.
 */
async function installNitroAutoImports(): Promise<void> {
  const modules = import.meta.glob("../../server/utils/**/*.ts")
  for (const path of Object.keys(modules).sort()) {
    try {
      const loaded = await modules[path]!() as Record<string, unknown>
      for (const [name, value] of Object.entries(loaded)) {
        if (name === "default") continue
        if (!(name in globals)) globals[name] = value
      }
    } catch { /* модуль вне маршрута — его отсутствие проявится падением по делу */ }
  }
  // h3 тоже авто-импортится в Nitro: без него paid-guard падает
  // `createError is not defined` вместо своего внятного отказа.
  globals.createError = createError
  // Настоящие реализации важнее случайного порядка глоба.
  globals.prisma = prisma
  globals.logAgent = logAgent
  globals.downloadFile = downloadFile
  globals.ensureDir = render.ensureDir
  globals.safeUnlink = render.safeUnlink
  globals.getAssetsDir = render.getAssetsDir
  globals.getVideosDir = render.getVideosDir
  globals.assembleVideo = render.assembleVideo
}

/** Три сцены с репликами ведущего — ради них маршрут и существует. */
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
      voiceoverLine: null,
      spokenLine: line,
      continuityNotes: "",
      duration: "5s",
      cameraAngle: "medium",
      props: [],
    })),
    voiceoverPlan: { enabled: false, pacing: "moderate", lines: [] },
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

interface Fixture {
  videoId: number
  scenarioId: number
  appId: number
}

async function createVideoFixture(): Promise<Fixture> {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  const app = await prisma.app.create({
    data: { name: `AudioFirstApp ${seed}`, description: "фикстура сквозного прогона", keywords: [] },
  })
  const scenario = await prisma.scenario.create({
    data: { appId: app.id, status: "selected" as never },
  })
  const variant = await prisma.scenarioVariant.create({
    data: {
      scenarioId: scenario.id,
      variantIndex: 0,
      status: "accepted" as never,
      title: "Сквозной прогон",
      hook: "Хук ролика",
      body: "Тело ролика",
      cta: "Пиши слово",
      fullScript: SCENE_LINES.join(" "),
      visualStyleText: "чистый студийный свет",
      storyPlan: storyPlan() as never,
    },
  })
  await prisma.scenario.update({
    where: { id: scenario.id },
    data: { selectedVariantId: variant.id },
  })

  const video = await prisma.video.create({
    data: {
      scenarioId: scenario.id,
      variantId: variant.id,
      status: "pending" as never,
      format: "portrait" as never,
      // Маршрут фиксируется на ролике при создании — ровно как это делает
      // эндпоинт запуска (Task 12).
      editPipeline: true,
      voiceoverEnabled: true,
      voiceoverModelId: "fal-ai/elevenlabs/tts/turbo-v2.5",
      voiceoverVoiceId: "Rachel",
      voiceoverLanguage: "ru",
      voiceoverPacing: "moderate",
      // Мок fal отдаёт настоящие медиафайлы (ffmpeg-заглушки), Replicate — нет:
      // его мок пишет JSON под именем .mp4. Поэтому кадры и клипы идут через fal.
      imageModelId: "fal-ai/flux/dev",
      videoModelId: "fal-ai/kling-video/v3/standard/text-to-video",
      modelStrategy: "auto",
      generateAudio: false,
      musicEnabled: false,
      subtitlesEnabled: true,
      clipDuration: 5,
      imageCount: 3,
      renderQuality: "medium",
      targetPlatform: "tiktok",
      lipSyncEnabled: false,
    },
  })

  return { videoId: video.id, scenarioId: scenario.id, appId: app.id }
}

/**
 * Ключи шагов в порядке ФАКТИЧЕСКОГО выполнения.
 *
 * Момент шага — `startedAt`, а у пропущенного шага его нет вовсе (он не
 * запускался): такому берём `finishedAt` — время, когда оркестратор до него
 * дошёл и закрыл. Сортировка по одному `startedAt` уводила бы пропущенные шаги
 * в конец списка и врала про порядок маршрута.
 */
async function stepKeysInExecutionOrder(videoId: number): Promise<string[]> {
  const steps = await prisma.videoGenerationStep.findMany({
    where: { videoId },
    select: { id: true, stepKey: true, startedAt: true, finishedAt: true },
  })
  return steps
    .map(step => ({
      key: String(step.stepKey),
      at: (step.startedAt ?? step.finishedAt)?.getTime() ?? Number.MAX_SAFE_INTEGER,
      id: step.id,
    }))
    .sort((a, b) => a.at - b.at || a.id - b.id)
    .map(step => step.key)
}

/**
 * Номера попыток платных шагов: растут ТОЛЬКО когда шаг реально пошёл в
 * провайдера. Шаг, вернувший готовое из снапшота, счётчик не трогает.
 */
async function paidStepAttempts(videoId: number): Promise<Record<string, number>> {
  const steps = await prisma.videoGenerationStep.findMany({
    where: {
      videoId,
      stepKey: {
        in: [
          "voiceover_generation", "transcription", "image_generation",
          "clip_generation", "lip_sync_generation", "music_generation",
        ] as never[],
      },
    },
    select: { stepKey: true, attemptCount: true },
  })
  return Object.fromEntries(steps.map(step => [String(step.stepKey), step.attemptCount]))
}

/** Строки лога шага — по ним видно, ЧТО именно шаг сделал. */
async function stepLog(videoId: number, stepKey: string): Promise<string[]> {
  const step = await prisma.videoGenerationStep.findFirst({
    where: { videoId, stepKey: stepKey as never },
    select: { logs: true },
  })
  const logs = Array.isArray(step?.logs) ? step.logs : []
  return logs.map(entry => String((entry as { msg?: unknown }).msg ?? ""))
}

let storageRoot: string

describe("маршрут «монтаж от звука» собирает ролик целиком (моки)", () => {
  beforeAll(async () => {
    // Модель транскрипции в реестре integrated: false (цена не подтверждена
    // страницей модели). Штатный путь включения до canary — явная переменная:
    // при заданном requestedId реестр проверку integrated не делает.
    process.env.MEDIA_MODEL_TRANSCRIPTION = "openai/whisper"
    process.env.STORAGE_DRIVER = "local"
    storageRoot = await mkdtemp(join(tmpdir(), "cf-audio-first-"))
    // Два разных корня: STORAGE_LOCAL_ROOT — постоянное хранилище (драйвер),
    // UPLOADS_STORAGE_PATH — рабочий каталог ассетов ролика. Оба уводим из
    // репозитория, чтобы прогон не оставлял мусор в ./storage.
    process.env.STORAGE_LOCAL_ROOT = join(storageRoot, "bucket")
    process.env.UPLOADS_STORAGE_PATH = join(storageRoot, "uploads")
    resetStorageDriver()
    await installNitroAutoImports()
  })

  afterAll(async () => {
    delete process.env.MEDIA_MODEL_TRANSCRIPTION
    await rm(storageRoot, { recursive: true, force: true }).catch(() => {})
  })

  it("прогон, повтор прогона и совпадение длины ролика с длиной трека", async () => {
    const { videoId } = await createVideoFixture()
    const { runVideoPipeline } = await import("../../server/utils/video-pipeline")

    await runVideoPipeline(videoId)

    // 1. Шаги выполнены в порядке audio-first.
    expect(await stepKeysInExecutionOrder(videoId)).toEqual([
      "prompt_generation",
      "voiceover_generation",
      "transcription",
      "image_generation",
      "clip_generation",
      "lip_sync_generation",
      "music_generation",
      "assembly",
    ])

    // 2. Озвучка синтезирована ОДИН раз.
    const voiceoverAssets = await prisma.videoAsset.findMany({
      where: { videoId, type: "voiceover_mix" as never },
    })
    expect(voiceoverAssets).toHaveLength(1)

    // 3. Транскрипт сохранён.
    const transcriptAsset = await prisma.videoAsset.findFirst({
      where: { videoId, type: "transcript" as never },
    })
    expect(transcriptAsset).toBeTruthy()

    const video = await prisma.video.findUnique({ where: { id: videoId } })
    expect(video?.status).toBe("completed")
    expect(video?.filePath).toBeTruthy()

    // Выравнивание сошлось полностью: мок отдаёт слова НАШЕГО ЖЕ сценария, и
    // деградация здесь означала бы поломку разбора или самого выравнивания.
    const transcriptionSnapshot = await prisma.videoGenerationStep.findFirst({
      where: { videoId, stepKey: "transcription" as never },
      select: { outputSnapshot: true, status: true },
    })
    expect(transcriptionSnapshot?.status).toBe("completed")
    const snapshot = transcriptionSnapshot?.outputSnapshot as {
      status?: string
      scenes?: Array<{ order: number, startSec: number, endSec: number, words: unknown[] }>
    }
    expect(snapshot?.status).toBe("completed")
    expect(snapshot?.scenes).toHaveLength(SCENE_LINES.length)

    // 5. Финальный файл существует, и его длина совпадает с длиной трека.
    await expect(stat(video!.filePath!)).resolves.toBeTruthy()
    const trackDurationSec = await render.probeMediaDuration(voiceoverAssets[0]!.filePath!)
    const finalDurationSec = await render.probeMediaDuration(video!.filePath!)
    expect(trackDurationSec).not.toBeNull()
    expect(finalDurationSec).not.toBeNull()
    expect(trackDurationSec!).toBeGreaterThan(0)
    expect(Math.abs(finalDurationSec! - trackDurationSec!)).toBeLessThan(0.5)

    // Совпадение длин — не совпадение случайное: подгон под трек обязан быть
    // ПРИМЕНЁН. Без этой проверки тест прошёл бы и на ролике, у которого клипы
    // случайно суммировались в длину трека.
    const assemblyLog = await stepLog(videoId, "assembly")
    expect(assemblyLog.some(line => line.startsWith("Подгон длины клипов под трек:"))).toBe(true)

    // 4. Повторный прогон не создал новых оплаченных задач.
    //
    // Меряем тремя независимыми счётчиками: задачи провайдеров
    // (`MediaPrediction`), ассеты ролика и номера попыток платных шагов.
    // Каждый из них ловит свою дыру: первый — второй submit, второй — вторую
    // скачанную картинку, третий — повторный вызов TTS/транскрипции, который
    // ассетов не добавляет (файл перезаписывается по тому же пути).
    const predictionsBefore = await prisma.mediaPrediction.count({ where: { videoId } })
    const assetsBefore = await prisma.videoAsset.count({ where: { videoId } })
    const attemptsBefore = await paidStepAttempts(videoId)

    await runVideoPipeline(videoId)

    expect(await prisma.mediaPrediction.count({ where: { videoId } }) - predictionsBefore).toBe(0)
    expect(await prisma.videoAsset.count({ where: { videoId } }) - assetsBefore).toBe(0)
    expect(await paidStepAttempts(videoId)).toEqual(attemptsBefore)

    // 3 (вторая половина). Транскрипт ПЕРЕЖИЛ повтор прогона, трек не пересинтезирован.
    expect(await prisma.videoAsset.count({ where: { videoId, type: "transcript" as never } })).toBe(1)
    expect(await prisma.videoAsset.count({ where: { videoId, type: "voiceover_mix" as never } })).toBe(1)
    const snapshotAfterRerun = await prisma.videoGenerationStep.findFirst({
      where: { videoId, stepKey: "transcription" as never },
      select: { outputSnapshot: true },
    })
    expect((snapshotAfterRerun?.outputSnapshot as { scenes?: unknown[] })?.scenes)
      .toHaveLength(SCENE_LINES.length)
  }, 600_000)
})
