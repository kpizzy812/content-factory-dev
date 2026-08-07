/**
 * Регрессия: story-driven ролик с включёнными субтитрами не уходит в рендер немым.
 *
 * Дефект: в story-driven режиме legacy-тексты hook/CTA намеренно не рендерятся —
 * за надписи отвечают per-scene субтитры. Но subtitleCopy сцены оператор может
 * очистить (POST /api/videos/[id]/edit-subtitles принимает пустую строку), а сцена
 * без клипа отсеивается сама. Если после сборки список субтитров опустел, ролик
 * собирался вообще без единой надписи при subtitlesEnabled=true — и ни строчки об
 * этом в логе шага: оператор видел «субтитры: true» и пустой экран.
 *
 * Ожидаемое поведение: откат на legacy hook/CTA (единственный текст, который у нас
 * есть) плюс WARN в лог шага. Если и hook/CTA пусты — хотя бы явный WARN.
 *
 * DB-free: слой БД замокан, автоимпортные глобалы Nuxt (assembleVideo/getVideosDir/
 * safeUnlink) подменены фейками — проверяем ровно то, что уходит в render.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { tmpdir } from "node:os"
import type { StoryDrivenVideoPlan } from "~~/shared/types/video-runtime"
import type { SubtitlePlacement } from "~~/shared/types/story"

const stepLogs = vi.hoisted(() => ({ lines: [] as string[] }))

vi.mock("../../../server/utils/video-pipeline-db", () => ({
  ensureStep: vi.fn(async () => ({ id: 1, attemptCount: 0, status: "pending", outputSnapshot: null })),
  updateStep: vi.fn(async () => {}),
  appendStepLog: vi.fn(async (_id: number, msg: string) => { stepLogs.lines.push(msg) }),
  isStepCompleted: vi.fn(() => false),
  updateVideoStatus: vi.fn(async () => {}),
  falStepRequest: vi.fn(async () => {}),
}))

vi.mock("../../../server/utils/agents/subtitle-keyword-agent", () => ({
  runSubtitleKeywordAgent: vi.fn(async () => ({ segments: [] })),
}))

const BOTTOM: SubtitlePlacement = { position: "bottom", alignment: "center", avoidZones: [] }

type AssembleCall = {
  topText: string
  bottomText: string
  sceneSubtitles?: Array<{ sceneIndex: number; text: string }>
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

/** Есть ли в логе шага предупреждение про отсутствие текстов сцен. */
function hasEmptySubsWarning(): boolean {
  return stepLogs.lines.some(l => l.includes("ни у одной сцены нет текста") || l.includes("нет ни у сцен"))
}

describe("runAssembly: пустые per-scene субтитры не оставляют ролик немым", () => {
  beforeEach(() => {
    assembleCalls.length = 0
    stepLogs.lines.length = 0
  })

  it("все сцены с пустым subtitleCopy — откат на legacy hook/CTA + WARN в логе шага", async () => {
    const runAssembly = await loadRunAssembly()
    const plan = makePlan("story_driven", [scene(1, ""), scene(2, "   "), scene(3, "")])

    await runAssembly(7, ["a.mp4", "b.mp4", "c.mp4"], null, true, "Хук", "CTA", "portrait", plan)

    const call = assembleCalls[0]!
    expect(call.sceneSubtitles).toBeUndefined()
    // Без отката ролик вышел бы вообще без надписей при subtitlesEnabled=true.
    expect(call.topText).toBe("Хук")
    expect(call.bottomText).toBe("CTA")
    expect(hasEmptySubsWarning()).toBe(true)
  })

  it("ни одна сцена не сопоставилась с клипом — тот же откат", async () => {
    const runAssembly = await loadRunAssembly()
    // Порядок нарезки знает только сцены 7 и 8 — сцен плана в нём нет вовсе.
    const plan = makePlan("story_driven", [scene(1, "Первая"), scene(2, "Вторая")])

    await runAssembly(7, ["a.mp4", "b.mp4"], null, true, "Хук", "CTA", "portrait", plan, {
      clipSceneOrders: [7, 8],
    })

    const call = assembleCalls[0]!
    expect(call.sceneSubtitles).toBeUndefined()
    expect(call.topText).toBe("Хук")
    expect(call.bottomText).toBe("CTA")
    expect(hasEmptySubsWarning()).toBe(true)
  })

  it("hook/CTA тоже пусты — откатываться не на что, но WARN всё равно есть", async () => {
    const runAssembly = await loadRunAssembly()
    const plan = makePlan("story_driven", [scene(1, ""), scene(2, "")])

    await runAssembly(7, ["a.mp4", "b.mp4"], null, true, "  ", "", "portrait", plan)

    const call = assembleCalls[0]!
    expect(call.topText).toBe("")
    expect(call.bottomText).toBe("")
    expect(hasEmptySubsWarning()).toBe(true)
  })

  it("субтитры выключены — ни откатов, ни предупреждений", async () => {
    const runAssembly = await loadRunAssembly()
    const plan = makePlan("story_driven", [scene(1, ""), scene(2, "")])

    await runAssembly(7, ["a.mp4", "b.mp4"], null, false, "Хук", "CTA", "portrait", plan)

    const call = assembleCalls[0]!
    expect(call.topText).toBe("")
    expect(call.bottomText).toBe("")
    expect(hasEmptySubsWarning()).toBe(false)
  })

  it("хотя бы один субтитр есть — legacy-тексты по-прежнему не дублируются поверх", async () => {
    const runAssembly = await loadRunAssembly()
    const plan = makePlan("story_driven", [scene(1, ""), scene(2, "Вторая")])

    await runAssembly(7, ["a.mp4", "b.mp4"], null, true, "Хук", "CTA", "portrait", plan)

    const call = assembleCalls[0]!
    expect(call.sceneSubtitles!.map(s => s.sceneIndex)).toEqual([1])
    expect(call.topText).toBe("")
    expect(call.bottomText).toBe("")
    expect(hasEmptySubsWarning()).toBe(false)
  })

  it("legacy_simple не трогаем: hook/CTA как и раньше, без лишнего WARN", async () => {
    const runAssembly = await loadRunAssembly()
    const plan = makePlan("legacy_simple", [scene(1, "Первая")])

    await runAssembly(7, ["a.mp4"], null, true, "Хук", "CTA", "portrait", plan)

    const call = assembleCalls[0]!
    expect(call.topText).toBe("Хук")
    expect(call.bottomText).toBe("CTA")
    expect(hasEmptySubsWarning()).toBe(false)
  })
})
