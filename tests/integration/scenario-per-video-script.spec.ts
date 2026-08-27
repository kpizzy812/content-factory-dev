/**
 * Сценарий, ЛИЧНЫЙ для ролика: правка фразы на одном ролике не имеет права
 * менять текст соседнему.
 *
 * Дыра (найдена волной §9a, `task-3-tails-report.md` §7.2). Локальная замена
 * фразы обязана писать новый текст в сценарий — иначе полная перегенерация
 * трека молча вернёт старую фразу. Писала она в `ScenarioVariant.storyPlan`, а
 * вариант ОБЩИЙ: `Video.variantId` уникальности не даёт, и один вариант кормит
 * сколько угодно роликов. Правка одной фразы на ролике A переписывала сценарий
 * ролику B — уже снятому или снимающемуся, — и B при первой же перегенерации
 * синтезировал чужой текст и платил за него: TTS, а следом lip-sync всех сцен.
 *
 * Решение: правка живёт в `Video.scriptOverrides` (тот же приём, что
 * `Video.editOverrides` поверх `EditProfile`) и накладывается на общий вариант
 * при ЧТЕНИИ. Отсюда четыре свойства, каждое проверяется ниже на настоящей БД:
 *
 *  1. правка ролика A не видна ролику B и не трогает сам вариант;
 *  2. ролик без правок читает общий сценарий, а не копию (копии нет вовсе);
 *  3. полная перегенерация берёт текст ИМЕННО этого ролика;
 *  4. ролики, снятые до появления колонки, работают без миграции данных.
 *
 * Платных вызовов здесь нет: трогаются только порты БД и чистые функции.
 */

import { beforeEach, describe, expect, it } from "vitest"

import { prisma } from "~~/server/utils/prisma"
import { createReplaceSegmentDeps } from "~~/server/utils/voiceover/segment-replace-runner"
import { applyScriptOverrides, planVideoScriptOverride } from "~~/server/utils/voiceover/script-overrides"
import { loadVideoScriptSource, loadVideoStoryPlan } from "~~/server/utils/voiceover/script-source"
import { planTrackRegeneration } from "~~/server/utils/voiceover/track-regenerate"
import { mergeScriptLines } from "~~/server/utils/voiceover/script-merge"
import { buildTrackRequest } from "~~/server/utils/voiceover/track-builder"

// `logAgent` — авто-импорт Nitro; вне Nitro-процесса его подставляет тест.
import { logAgent } from "~~/server/utils/agent-logger"
;(globalThis as Record<string, unknown>).logAgent = logAgent

const OLD_TEXT = "Вторая реплика."
const NEW_TEXT = "Новая формулировка."

const STORY_PLAN = {
  version: "1.0",
  scenes: [
    { order: 1, spokenLine: "Первая реплика.", subtitleCopy: "Первая реплика." },
    { order: 2, spokenLine: OLD_TEXT, subtitleCopy: OLD_TEXT },
  ],
  voiceoverPlan: { enabled: true, lines: [] as Array<{ sceneOrder: number, text: string }> },
}

/** Снапшот шага озвучки: чем трек РЕАЛЬНО спет. */
function trackSnapshot(secondSceneText: string): Record<string, unknown> {
  return {
    route: "audio_first",
    trackPath: "/assets/track.mp3",
    durationSec: 20,
    trackFingerprint: "fp-1",
    voiceId: "voice-1",
    modelId: "minimax/speech-02-turbo",
    scenes: [
      { order: 1, text: "Первая реплика." },
      { order: 2, text: secondSceneText },
    ],
  }
}

const PRICING = { ttsUnit: "character", ttsBase: 0.00003, lipSyncUsdPerSecond: 0.07 }

let variantId: number
let videoA: number
let videoB: number
let stepA: number
let stepB: number

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
      editPipeline: true,
      status: "completed" as never,
      voiceoverLanguage: "ru",
      voiceoverPacing: "moderate",
      voiceoverVoiceId: "voice-1",
      voiceoverModelId: "minimax/speech-02-turbo",
    },
  })))
  videoA = videos[0]!.id
  videoB = videos[1]!.id

  const steps = await Promise.all([videoA, videoB].map(videoId => prisma.videoGenerationStep.create({
    data: {
      videoId,
      stepKey: "voiceover_generation" as never,
      stepIndex: 3,
      status: "completed" as never,
      attemptCount: 1,
      outputSnapshot: trackSnapshot(OLD_TEXT) as never,
    },
  })))
  stepA = steps[0]!.id
  stepB = steps[1]!.id
})

/** Ровно то, что делает раннер замены: посчитать правку и зафиксировать её. */
async function replaceOnVideo(videoId: number, stepId: number, newText: string): Promise<void> {
  const deps = createReplaceSegmentDeps()
  const source = await deps.store.loadScript(videoId)
  if (!source) throw new Error("у ролика нет сценария")

  const patch = planVideoScriptOverride({
    storyPlan: source.storyPlan,
    overrides: source.overrides,
    sceneOrder: 2,
    newText,
  })
  if (!patch.ok) throw new Error(patch.reason)

  await deps.store.commit(
    // Трек тоже получает новый текст — иначе перегенерация увидела бы
    // расхождение там, где его нет, и оплатила бы синтез заново.
    [{ stepId, snapshot: trackSnapshot(newText) }],
    patch.changed ? { videoId, overrides: patch.overrides } : null,
  )
}

/** Текст сцены в сценарии ГЛАЗАМИ ролика. */
function spokenOf(plan: unknown, order: number): string | null {
  const scenes = ((plan as Record<string, unknown> | null)?.scenes ?? []) as Array<{ order: number, spokenLine: string | null }>
  return scenes.find(scene => scene.order === order)?.spokenLine ?? null
}

/** Текст, который уйдёт в синтез при полной перегенерации трека этого ролика. */
async function trackTextOf(videoId: number): Promise<string> {
  const plan = await loadVideoStoryPlan(videoId) as {
    scenes?: Array<{ order: number, spokenLine: string | null }>
    voiceoverPlan?: { lines?: Array<{ sceneOrder: number, text: string }> }
  } | null
  return buildTrackRequest(mergeScriptLines({
    scenes: (plan?.scenes ?? []).map(scene => ({ order: scene.order, spokenLine: scene.spokenLine })),
    voiceoverLines: [],
  })).text
}

describe("сценарий ролика: правка одного не трогает соседей", () => {
  it("правка фразы на ролике A не видна ролику B того же варианта", async () => {
    await replaceOnVideo(videoA, stepA, NEW_TEXT)

    expect(spokenOf(await loadVideoStoryPlan(videoA), 2)).toBe(NEW_TEXT)
    // Главное утверждение задачи: у соседа текст прежний.
    expect(spokenOf(await loadVideoStoryPlan(videoB), 2)).toBe(OLD_TEXT)
    // И сам общий вариант не тронут — его читают ещё и генератор субтитров,
    // критик, и все будущие ролики этого сценария.
    const variant = await prisma.scenarioVariant.findUnique({ where: { id: variantId } })
    expect(spokenOf(variant!.storyPlan, 2)).toBe(OLD_TEXT)
  })

  it("ролик без правок не заводит копию плана — колонка остаётся пустой", async () => {
    await replaceOnVideo(videoA, stepA, NEW_TEXT)

    const [a, b] = await Promise.all([
      prisma.video.findUnique({ where: { id: videoA }, select: { scriptOverrides: true } }),
      prisma.video.findUnique({ where: { id: videoB }, select: { scriptOverrides: true } }),
    ])
    // Копия заводится ЛЕНИВО, при первой правке: иначе у каждого ролика
    // появился бы мёртвый дубль большого storyPlan.
    expect(b!.scriptOverrides).toBeNull()
    // А у правленого хранится одна строка, а не сценарий целиком.
    const lines = (a!.scriptOverrides as { lines?: unknown[] }).lines ?? []
    expect(lines).toHaveLength(1)
    expect(JSON.stringify(a!.scriptOverrides).length).toBeLessThan(JSON.stringify(STORY_PLAN).length)
  })

  it("полная перегенерация трека берёт текст ИМЕННО этого ролика", async () => {
    await replaceOnVideo(videoA, stepA, NEW_TEXT)

    // Тот же сборщик, что и у боевого шага озвучки: это буквально текст,
    // который уйдёт в синтез.
    expect(await trackTextOf(videoA)).toContain(NEW_TEXT)
    expect(await trackTextOf(videoA)).not.toContain(OLD_TEXT)
    expect(await trackTextOf(videoB)).toContain(OLD_TEXT)
    expect(await trackTextOf(videoB)).not.toContain(NEW_TEXT)
  })

  it("сосед не переплачивает: его перегенерация не видит изменений", async () => {
    await replaceOnVideo(videoA, stepA, NEW_TEXT)

    const plan = planTrackRegeneration({
      id: videoB,
      body: { confirmExpensive: true },
      video: {
        status: "completed",
        isLocked: false,
        voiceoverEnabled: false,
        voiceoverVoiceId: "voice-1",
        voiceoverModelId: "minimax/speech-02-turbo",
      },
      voiceoverStep: { status: "completed", snapshot: trackSnapshot(OLD_TEXT) },
      storyPlan: await loadVideoStoryPlan(videoB),
      shotsToRebuild: 12,
      pricing: PRICING,
    })

    // Утекай правка в общий вариант — здесь был бы `run`: ролик B оплатил бы
    // синтез всего трека и пересборку всех кадров ради чужой правки.
    expect(plan.kind).toBe("noop")
    expect(plan.kind === "noop" && plan.preview.changedSceneOrders).toEqual([])
  })

  it("правленый ролик тоже не платит второй раз: трек уже соответствует сценарию", async () => {
    await replaceOnVideo(videoA, stepA, NEW_TEXT)

    const plan = planTrackRegeneration({
      id: videoA,
      body: { confirmExpensive: true },
      video: {
        status: "completed",
        isLocked: false,
        voiceoverEnabled: false,
        voiceoverVoiceId: "voice-1",
        voiceoverModelId: "minimax/speech-02-turbo",
      },
      // После замены в снапшоте стоит НОВЫЙ текст — так его пишет раннер.
      voiceoverStep: { status: "completed", snapshot: trackSnapshot(NEW_TEXT) },
      storyPlan: await loadVideoStoryPlan(videoA),
      shotsToRebuild: 12,
      pricing: PRICING,
    })

    // Не читай перегенерация правки ролика, она увидела бы «сценарий говорит
    // старое, трек новое» — и оплатила бы возврат к СТАРОЙ фразе.
    expect(plan.kind).toBe("noop")
  })

  it("ролик, снятый до появления правок, читает общий сценарий", async () => {
    // Обратная совместимость: колонка добавлена миграцией и у всех прежних
    // роликов равна null. Никакой миграции данных для них не требуется.
    const source = await loadVideoScriptSource(videoB)

    expect(source!.overrides).toBeNull()
    expect(await loadVideoStoryPlan(videoB)).toEqual(STORY_PLAN)
  })

  it("ролик без варианта отдаёт пустой сценарий, а не падает", async () => {
    await prisma.video.update({ where: { id: videoB }, data: { variantId: null } })

    expect(await loadVideoScriptSource(videoB)).toBeNull()
    expect(await loadVideoStoryPlan(videoB)).toBeNull()
  })

  it("правка ролика и снапшоты шага фиксируются одной транзакцией", async () => {
    // Разъехавшись, они дали бы трек с новой фразой при сценарии со старой —
    // то есть ровно ту дыру, которую чиним, только внутри одного ролика.
    const deps = createReplaceSegmentDeps()
    const source = await deps.store.loadScript(videoA)
    const patch = planVideoScriptOverride({
      storyPlan: source!.storyPlan,
      overrides: source!.overrides,
      sceneOrder: 2,
      newText: NEW_TEXT,
    })
    expect(patch.ok).toBe(true)
    if (!patch.ok) return

    await expect(deps.store.commit(
      [
        { stepId: stepA, snapshot: trackSnapshot(NEW_TEXT) },
        { stepId: stepA + 100_000, snapshot: { boom: true } },
      ],
      { videoId: videoA, overrides: patch.overrides },
    )).rejects.toThrow()

    const video = await prisma.video.findUnique({ where: { id: videoA }, select: { scriptOverrides: true } })
    expect(video!.scriptOverrides).toBeNull()
    expect(spokenOf(await loadVideoStoryPlan(videoA), 2)).toBe(OLD_TEXT)
  })

  it("вторая правка той же сцены не плодит записи в ролике", async () => {
    await replaceOnVideo(videoA, stepA, NEW_TEXT)
    await replaceOnVideo(videoA, stepA, "Третья редакция.")

    const video = await prisma.video.findUnique({ where: { id: videoA }, select: { scriptOverrides: true } })
    expect((video!.scriptOverrides as { lines: unknown[] }).lines).toHaveLength(1)
    expect(spokenOf(await loadVideoStoryPlan(videoA), 2)).toBe("Третья редакция.")
    expect(spokenOf(await loadVideoStoryPlan(videoB), 2)).toBe(OLD_TEXT)
  })

  it("правка переживает сброс шага под полную перегенерацию", async () => {
    // `rerunVideoStep` сносит снапшоты и ассеты трека. Живи правка только в
    // снапшоте — она бы этого не пережила, и перегенерация вернула бы старую
    // фразу: правка обязана лежать на РОЛИКЕ.
    await replaceOnVideo(videoA, stepA, NEW_TEXT)
    await prisma.videoGenerationStep.update({
      where: { id: stepA },
      data: { status: "pending" as never, outputSnapshot: null as never },
    })

    expect(await trackTextOf(videoA)).toContain(NEW_TEXT)
  })
})
