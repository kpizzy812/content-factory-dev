/**
 * Регрессия связки runAssembly → render: номер сцены доезжает до субтитров.
 *
 * Дефект: сцены без subtitleCopy сначала отфильтровывались, и дальше по конвейеру
 * ехал массив БЕЗ признака сцены. Render раскладывал его по позициям, а keyword-агент
 * нумеровал сегменты своей нумерацией — обе стороны считали «сцену» по-своему, и на
 * плане с молчащей сценой текст и подсветка уезжали на чужой клип.
 *
 * DB-free: слой БД замокан, автоимпортные глобалы Nuxt (assembleVideo/getVideosDir/
 * safeUnlink) подменены фейками — проверяем ровно то, что уходит в render.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { tmpdir } from "node:os"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"
import type { SubtitlePlacement } from "~~/shared/types/story"

vi.mock("../../../server/utils/video-pipeline-db", () => ({
  ensureStep: vi.fn(async () => ({ id: 1, attemptCount: 0, status: "pending", outputSnapshot: null })),
  updateStep: vi.fn(async () => {}),
  appendStepLog: vi.fn(async () => {}),
  isStepCompleted: vi.fn(() => false),
  updateVideoStatus: vi.fn(async () => {}),
  falStepRequest: vi.fn(async () => {}),
}))

const keywordAgent = vi.hoisted(() => ({
  calls: [] as Array<{ segments: Array<{ order: number; text: string }> }>,
}))

vi.mock("../../../server/utils/agents/subtitle-keyword-agent", () => ({
  runSubtitleKeywordAgent: vi.fn(async (opts: { segments: Array<{ order: number; text: string }> }) => {
    keywordAgent.calls.push({ segments: opts.segments })
    // Агент возвращает подсказки под тем же order, который получил на вход.
    return { segments: opts.segments.map(s => ({ order: s.order, keywords: [{ word: s.text, weight: 1 }] })) }
  }),
}))

const BOTTOM: SubtitlePlacement = { position: "bottom", alignment: "center", avoidZones: [] }

type AssembleCall = {
  topText: string
  bottomText: string
  sceneSubtitles?: Array<{ sceneIndex: number; text: string; durationSec: number }>
  keywordHints?: Array<{ order: number; keywords: Array<{ word: string; weight: number }> }>
}

const assembleCalls: AssembleCall[] = []

/** Сцена плана: заполнены только поля, которые читает runAssembly. */
function scene(order: number, subtitleCopy: string, durationSec = 5) {
  return { order, durationSec, subtitleCopy, subtitlePlacement: BOTTOM }
}

function makePlan(mode: StoryDrivenVideoPlan["mode"], scenes: ReturnType<typeof scene>[]) {
  return { mode, scenes, subtitleStyle: null } as unknown as StoryDrivenVideoPlan
}

async function loadRunAssembly() {
  // Автоимпорты Nuxt: в чистом vitest их нет — ставим фейки до импорта модуля.
  const g = globalThis as Record<string, unknown>
  g.getVideosDir = () => tmpdir()
  g.safeUnlink = async () => {}
  g.assembleVideo = async (opts: AssembleCall) => {
    assembleCalls.push(opts)
    return { filePath: "fake.mp4", duration: 12 }
  }
  const mod = await import("../../../server/utils/video-pipeline-steps")
  return mod.runAssembly
}

describe("runAssembly: sceneIndex переживает фильтрацию пустых субтитров", () => {
  beforeEach(() => {
    assembleCalls.length = 0
    keywordAgent.calls.length = 0
  })

  it("молчащая сцена выпадает, но номера оставшихся сцен сохраняются", async () => {
    const runAssembly = await loadRunAssembly()
    const plan = makePlan("story_driven", [
      scene(1, "Первая"),
      scene(2, ""),
      scene(3, "Третья"),
    ])

    await runAssembly(7, ["a.mp4", "b.mp4", "c.mp4"], null, true, "Хук", "CTA", "portrait", plan)

    const subs = assembleCalls[0]!.sceneSubtitles!
    expect(subs.map(s => s.text)).toEqual(["Первая", "Третья"])
    // Ключевое: вторая реплика помечена сценой 2 (0-based), а не позицией 1 в массиве.
    expect(subs.map(s => s.sceneIndex)).toEqual([0, 2])
  })

  it("сцена с пробельным subtitleCopy тоже не занимает номер", async () => {
    const runAssembly = await loadRunAssembly()
    const plan = makePlan("story_driven", [
      scene(1, "   "),
      scene(2, "Вторая"),
    ])

    await runAssembly(7, ["a.mp4", "b.mp4"], null, true, "", "", "portrait", plan)

    expect(assembleCalls[0]!.sceneSubtitles!.map(s => s.sceneIndex)).toEqual([1])
  })

  it("keyword-агент нумерует сегменты по сценам — тем же ключом, что читает render", async () => {
    const runAssembly = await loadRunAssembly()
    const plan = makePlan("story_driven", [
      scene(1, "Первая"),
      scene(2, ""),
      scene(3, "Третья"),
    ])

    await runAssembly(7, ["a.mp4", "b.mp4", "c.mp4"], null, true, "", "", "portrait", plan, {
      subtitlePreset: "hormozi",
    })

    // order = sceneIndex + 1: 1 и 3. Раньше было 1 и 2 — подсказка для «Третьей»
    // уезжала на молчащую сцену.
    expect(keywordAgent.calls[0]!.segments).toEqual([
      { order: 1, text: "Первая" },
      { order: 3, text: "Третья" },
    ])

    const call = assembleCalls[0]!
    const hintOrders = call.keywordHints!.map(h => h.order)
    const subIndexes = call.sceneSubtitles!.map(s => s.sceneIndex + 1)
    // Подсказки и субтитры должны адресоваться одинаково, иначе render их не сматчит.
    expect(hintOrders).toEqual(subIndexes)
  })

  it("story-driven не дублирует hook/cta поверх per-scene субтитров", async () => {
    const runAssembly = await loadRunAssembly()
    const plan = makePlan("story_driven", [scene(1, "Первая"), scene(2, "Вторая")])

    await runAssembly(7, ["a.mp4", "b.mp4"], null, true, "Хук", "CTA", "portrait", plan)

    expect(assembleCalls[0]!.topText).toBe("")
    expect(assembleCalls[0]!.bottomText).toBe("")
  })

  it("legacy_simple по-прежнему получает hook/cta и не получает per-scene субтитры", async () => {
    const runAssembly = await loadRunAssembly()
    const plan = makePlan("legacy_simple", [scene(1, "Первая")])

    await runAssembly(7, ["a.mp4"], null, true, "Хук", "CTA", "portrait", plan)

    expect(assembleCalls[0]!.topText).toBe("Хук")
    expect(assembleCalls[0]!.bottomText).toBe("CTA")
    expect(assembleCalls[0]!.sceneSubtitles).toBeUndefined()
  })

  it("при выключенных субтитрах ни текстов, ни субтитров в render не уходит", async () => {
    const runAssembly = await loadRunAssembly()
    const plan = makePlan("story_driven", [scene(1, "Первая")])

    await runAssembly(7, ["a.mp4"], null, false, "Хук", "CTA", "portrait", plan)

    expect(assembleCalls[0]!.topText).toBe("")
    expect(assembleCalls[0]!.bottomText).toBe("")
    expect(assembleCalls[0]!.sceneSubtitles).toBeUndefined()
  })
})
