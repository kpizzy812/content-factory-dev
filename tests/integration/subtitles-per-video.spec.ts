/**
 * Субтитры, ЛИЧНЫЕ для ролика: правка подписи на одном ролике не имеет права
 * менять её соседу по варианту.
 *
 * Дыра. Коммит `f6df7d0` увёл правку ФРАЗЫ из общего `ScenarioVariant.storyPlan`
 * в per-video `Video.scriptOverrides`, но `POST /api/videos/[id]/edit-subtitles`
 * остался на старом пути: он патчил `subtitleCopy` и `subtitlePlacement` прямо в
 * `storyPlan.scenes[]` варианта. Вариант ОБЩИЙ — `Video.variantId` уникальности
 * не даёт, один вариант кормит сколько угодно роликов, а конвейер и вовсе берёт
 * вариант через `Scenario.selectedVariantId` и на ролик не смотрит. Значит
 * правка субтитров ролика A переписывала подписи ролику B: B при первой же
 * пересборке (`rerunVideoStep('assembly')`, а её запускает и сама эта ручка)
 * получал чужой текст в кадре.
 *
 * Решение то же, что у фразы, и в ТОЙ ЖЕ колонке `Video.scriptOverrides`,
 * отдельным списком `subtitles`. Отсюда четыре свойства, каждое проверяется
 * ниже на настоящей БД:
 *
 *  1. правка ролика A не видна ролику B и не трогает сам вариант;
 *  2. патч заводится ЛЕНИВО: ролик без правок читает общий сценарий, копии нет;
 *  3. сборка ролика видит ИМЕННО его подписи (проверено тем же планировщиком,
 *     из которого субтитры уезжают в рендер);
 *  4. ролики, снятые до появления колонки, работают без миграции данных.
 *
 * Платных вызовов здесь нет: трогаются только порты БД и чистые функции.
 * `rerunVideoStep` не дёргается вовсе — он поднял бы весь конвейер.
 */

import { beforeEach, describe, expect, it } from "vitest"

import { prisma } from "~~/server/utils/prisma"
import { applyScriptOverrides } from "~~/server/utils/voiceover/script-overrides"
import { loadVideoStoryPlan, saveVideoSubtitleOverrides } from "~~/server/utils/voiceover/script-source"
import { buildStoryVideoPlan } from "~~/server/utils/story-video-planner"
import { getDefaultVideoModel } from "~~/server/utils/video-models"

const OLD_COPY = "СТАРАЯ ПОДПИСЬ"
const NEW_COPY = "НОВАЯ ПОДПИСЬ"

const STORY_PLAN = {
  version: "1.0",
  // Планировщик читает их безусловно на story-driven маршруте.
  globalVisualSystem: { stylePrompt: "стиль", colorPalette: "палитра", mood: "настроение" },
  protagonist: { type: "person", description: "ведущая", visualIdentifiers: [] },
  scenes: [
    {
      order: 1,
      spokenLine: "Первая реплика.",
      subtitleCopy: "ПЕРВАЯ ПОДПИСЬ",
      subtitlePlacement: { position: "bottom", alignment: "center", avoidZones: [] },
      // duration + visualPromptGuidance обязательны: без них
      // `detectRuntimeMode` объявляет план legacy, и планировщик уходит по
      // ветке без субтитров — тест проверял бы не то.
      duration: "5s",
      visualPromptGuidance: "кадр 1",
    },
    {
      order: 2,
      spokenLine: "Вторая реплика.",
      subtitleCopy: OLD_COPY,
      subtitlePlacement: { position: "bottom", alignment: "center", avoidZones: [] },
      duration: "5s",
      visualPromptGuidance: "кадр 2",
    },
  ],
  voiceoverPlan: { enabled: true, lines: [] as Array<{ sceneOrder: number, text: string }> },
}

let variantId: number
let videoA: number
let videoB: number

beforeEach(async () => {
  // beforeEach, не beforeAll: tests/setup.ts делает TRUNCATE после каждого it.
  const scenario = await prisma.scenario.create({ data: { status: "draft" } })
  const variant = await prisma.scenarioVariant.create({
    data: {
      scenarioId: scenario.id,
      variantIndex: 0,
      title: "t",
      hook: "h",
      body: "b",
      cta: "c",
      fullScript: "s",
      visualStyleText: "v",
      storyPlan: STORY_PLAN as never,
    },
  })
  variantId = variant.id

  // ДВА ролика на ОДНОМ варианте — та самая конфигурация, ради которой всё.
  const videos = await Promise.all([0, 1].map(() => prisma.video.create({
    data: {
      scenarioId: scenario.id,
      variantId: variant.id,
      status: "completed" as never,
      voiceoverLanguage: "ru",
    },
  })))
  videoA = videos[0]!.id
  videoB = videos[1]!.id
})

/** Подпись сцены в сценарии ГЛАЗАМИ ролика. */
function subtitleOf(plan: unknown, order: number): string | null {
  const scenes = ((plan as Record<string, unknown> | null)?.scenes ?? []) as Array<{
    order: number
    subtitleCopy?: string
  }>
  return scenes.find(scene => scene.order === order)?.subtitleCopy ?? null
}

function placementOf(plan: unknown, order: number): Record<string, unknown> | null {
  const scenes = ((plan as Record<string, unknown> | null)?.scenes ?? []) as Array<{
    order: number
    subtitlePlacement?: Record<string, unknown>
  }>
  return scenes.find(scene => scene.order === order)?.subtitlePlacement ?? null
}

/**
 * Подпись, которая ФАКТИЧЕСКИ уедет в рендер этого ролика.
 *
 * Через тот же `buildStoryVideoPlan`, что зовёт `runVideoPipeline`: именно его
 * `videoPlan.scenes[].subtitleCopy` читают и раскладка субтитров в `runAssembly`,
 * и плашки Remotion. Проверять сырую колонку было бы проверкой самой себя.
 */
async function renderedSubtitleOf(videoId: number, order: number): Promise<string | null> {
  const plan = await loadVideoStoryPlan(videoId)
  const videoPlan = buildStoryVideoPlan({
    storyPlan: plan as never,
    videoModel: getDefaultVideoModel(),
    userImageCount: 2,
    userClipDuration: 5,
  })
  return videoPlan.scenes.find(scene => scene.order === order)?.subtitleCopy ?? null
}

describe("субтитры ролика: правка одного не трогает соседей", () => {
  it("правка субтитра на ролике A не видна ролику B того же варианта", async () => {
    const result = await saveVideoSubtitleOverrides(videoA, [{ order: 2, subtitleCopy: NEW_COPY }])
    expect(result.changed).toBe(true)

    expect(subtitleOf(await loadVideoStoryPlan(videoA), 2)).toBe(NEW_COPY)
    // Главное утверждение задачи: у соседа подпись прежняя.
    expect(subtitleOf(await loadVideoStoryPlan(videoB), 2)).toBe(OLD_COPY)
    // И сам общий вариант не тронут — его читают критик, policy-чек и все
    // будущие ролики этого сценария.
    const variant = await prisma.scenarioVariant.findUnique({ where: { id: variantId } })
    expect(subtitleOf(variant!.storyPlan, 2)).toBe(OLD_COPY)
  })

  it("в кадр каждого ролика уедет ЕГО подпись", async () => {
    await saveVideoSubtitleOverrides(videoA, [{ order: 2, subtitleCopy: NEW_COPY }])

    expect(await renderedSubtitleOf(videoA, 2)).toBe(NEW_COPY)
    expect(await renderedSubtitleOf(videoB, 2)).toBe(OLD_COPY)
  })

  it("позиция субтитра тоже личная для ролика", async () => {
    await saveVideoSubtitleOverrides(videoA, [
      { order: 1, subtitlePlacement: { position: "top", alignment: "left" } },
    ])

    expect(placementOf(await loadVideoStoryPlan(videoA), 1))
      .toEqual({ position: "top", alignment: "left", avoidZones: [] })
    expect(placementOf(await loadVideoStoryPlan(videoB), 1))
      .toEqual({ position: "bottom", alignment: "center", avoidZones: [] })
  })

  it("ролик без правок не заводит копию плана — колонка остаётся пустой", async () => {
    await saveVideoSubtitleOverrides(videoA, [{ order: 2, subtitleCopy: NEW_COPY }])

    const [a, b] = await Promise.all([
      prisma.video.findUnique({ where: { id: videoA }, select: { scriptOverrides: true } }),
      prisma.video.findUnique({ where: { id: videoB }, select: { scriptOverrides: true } }),
    ])
    // Патч заводится ЛЕНИВО, при первой правке: иначе у каждого ролика появился
    // бы мёртвый дубль большого storyPlan.
    expect(b!.scriptOverrides).toBeNull()
    // А у правленого хранится одна строка, а не сценарий целиком.
    expect((a!.scriptOverrides as { subtitles?: unknown[] }).subtitles).toHaveLength(1)
    expect(JSON.stringify(a!.scriptOverrides).length).toBeLessThan(JSON.stringify(STORY_PLAN).length)
  })

  it("ролик, снятый до появления правок, читает общий сценарий", async () => {
    // Обратная совместимость: колонка добавлена миграцией и у всех прежних
    // роликов равна null. Никакой миграции данных для них не требуется.
    expect(await loadVideoStoryPlan(videoB)).toEqual(STORY_PLAN)
    expect(applyScriptOverrides(STORY_PLAN, null)).toBe(STORY_PLAN)
  })

  it("правка той же сцены второй раз не плодит записи", async () => {
    await saveVideoSubtitleOverrides(videoA, [{ order: 2, subtitleCopy: NEW_COPY }])
    await saveVideoSubtitleOverrides(videoA, [{ order: 2, subtitleCopy: "ТРЕТЬЯ РЕДАКЦИЯ" }])

    const a = await prisma.video.findUnique({ where: { id: videoA }, select: { scriptOverrides: true } })
    expect((a!.scriptOverrides as { subtitles: unknown[] }).subtitles).toHaveLength(1)
    expect(subtitleOf(await loadVideoStoryPlan(videoA), 2)).toBe("ТРЕТЬЯ РЕДАКЦИЯ")
    expect(subtitleOf(await loadVideoStoryPlan(videoB), 2)).toBe(OLD_COPY)
  })

  it("тот же текст второй раз не пишет ничего", async () => {
    // Пустая запись — это лишний UPDATE ролика и лишняя пересборка mp4 на
    // каждый клик «сохранить».
    const result = await saveVideoSubtitleOverrides(videoA, [{ order: 2, subtitleCopy: OLD_COPY }])

    expect(result.changed).toBe(false)
    const a = await prisma.video.findUnique({ where: { id: videoA }, select: { scriptOverrides: true } })
    expect(a!.scriptOverrides).toBeNull()
  })

  it("ролик без варианта не падает и ничего не пишет", async () => {
    await prisma.video.update({ where: { id: videoB }, data: { variantId: null } })

    const result = await saveVideoSubtitleOverrides(videoB, [{ order: 2, subtitleCopy: NEW_COPY }])
    expect(result.changed).toBe(false)
    expect(result.reason).toBeTruthy()
  })
})
