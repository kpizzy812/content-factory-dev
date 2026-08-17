import { describe, expect, it, vi } from "vitest"

import { runTranscriptionStep } from "~~/server/utils/transcription/runner"

const SCENES = [
  { order: 1, text: "тело меняется" },
  { order: 2, text: "здоровье улучшается" },
]

const INPUT = {
  videoId: 7,
  stepId: 3,
  audioPath: "/tmp/voiceover.mp3",
  audioUrl: "https://cdn/voiceover.mp3",
  scenes: SCENES,
  language: "ru",
  outputPath: "/tmp/transcript.json",
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    runTask: vi.fn(async () => ({
      costUsd: 0.02,
      raw: {
        words: [
          { word: "тело", start: 0, end: 0.4 },
          { word: "меняется", start: 0.4, end: 1.1 },
          { word: "здоровье", start: 1.4, end: 2.0 },
          { word: "улучшается", start: 2.0, end: 2.8 },
        ],
      },
    })),
    saveTranscript: vi.fn(async () => {}),
    log: vi.fn(async () => {}),
    ...overrides,
  }
}

describe("шаг транскрипции", () => {
  it("отдаёт сценам фактические границы и стоимость", async () => {
    const result = await runTranscriptionStep(INPUT, deps() as never)

    expect(result.status).toBe("completed")
    expect(result.scenes[0]).toMatchObject({ order: 1, startSec: 0, endSec: 1.1 })
    expect(result.scenes[1]).toMatchObject({ order: 2, startSec: 1.4, endSec: 2.8 })
    expect(result.costUsd).toBeCloseTo(0.02, 6)
  })

  it("сохраняет выровненный транскрипт — повтор прогона не теряет тайминги", async () => {
    const dependencies = deps()

    await runTranscriptionStep(INPUT, dependencies as never)

    expect(dependencies.saveTranscript).toHaveBeenCalledTimes(1)
    const [payload] = (dependencies.saveTranscript as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(payload).toMatchObject({ videoId: 7 })
    expect(payload.scenes[0]).toMatchObject({ order: 1 })
  })

  it("сообщает о деградации, когда транскрипт не сошёлся со сценарием", async () => {
    const dependencies = deps({
      runTask: vi.fn(async () => ({
        costUsd: 0.02,
        raw: { words: [
          { word: "посторонний", start: 0, end: 0.5 },
          { word: "текст", start: 0.5, end: 1.0 },
        ] },
      })),
    })

    const result = await runTranscriptionStep(INPUT, dependencies as never)

    expect(result.status).toBe("degraded")
    expect(result.warning).toMatch(/выравнивание/i)
  })

  it("сам не бросает исключение при отказе провайдера — возвращает пустой результат, ронять шаг обязан вызывающий код", async () => {
    const dependencies = deps({
      runTask: vi.fn(async () => { throw new Error("provider is down") }),
    })

    const result = await runTranscriptionStep(INPUT, dependencies as never)

    expect(result.status).toBe("skipped")
    expect(result.scenes).toEqual([])
    expect(result.warning).toMatch(/provider is down/)
    expect(dependencies.saveTranscript).not.toHaveBeenCalled()
  })
})
