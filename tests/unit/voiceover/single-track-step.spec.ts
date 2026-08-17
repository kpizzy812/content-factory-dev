import { describe, expect, it, vi } from "vitest"

import { runSingleTrackVoiceover } from "~~/server/utils/video-pipeline-steps"

const PLAN_SCENES = [
  { order: 1, spokenLine: "Первая реплика." },
  { order: 2, spokenLine: null },
]

function deps(overrides: Record<string, unknown> = {}) {
  return {
    synthesize: vi.fn(async () => ({ audioPath: "/tmp/track.mp3", durationSec: 6.4, costUsd: 0.07 })),
    // durationSec сознательно НЕ равен "6.4 + 2" (наивной сумме синтеза и
    // паузы) — так тест различает измеренный факт от арифметики (см. Task 7
    // review, находка 1).
    insertPauses: vi.fn(async (path: string) => ({
      path,
      durationSec: 8.35,
      skippedPauses: [],
      sourceDurationMeasureFailed: false,
      durationEstimated: false,
    })),
    log: vi.fn(async () => {}),
    ...overrides,
  }
}

describe("единый трек озвучки", () => {
  it("синтезирует ОДИН файл на весь ролик", async () => {
    const dependencies = deps()

    const result = await runSingleTrackVoiceover({
      videoId: 7,
      stepId: 4,
      scenes: PLAN_SCENES,
      voiceoverLines: [{ sceneOrder: 2, text: "Закадровая строка." }],
      voiceId: "clone-1",
      language: "ru",
      outputPath: "/tmp/track.mp3",
    }, dependencies as never)

    expect(dependencies.synthesize).toHaveBeenCalledTimes(1)
    const [call] = (dependencies.synthesize as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(call.text).toBe("Первая реплика. Закадровая строка.")
    expect(result.durationSec).toBeCloseTo(6.4, 3)
    expect(result.scenes.map(scene => scene.order)).toEqual([1, 2])
  })

  it("вставляет тишину по маркерам пауз", async () => {
    const dependencies = deps()

    const result = await runSingleTrackVoiceover({
      videoId: 7,
      stepId: 4,
      scenes: [{ order: 1, spokenLine: "Смотри. [пауза 2с]" }, { order: 2, spokenLine: "Вывод." }],
      voiceoverLines: [],
      voiceId: "clone-1",
      language: "ru",
      outputPath: "/tmp/track.mp3",
    }, dependencies as never)

    expect(dependencies.insertPauses).toHaveBeenCalledTimes(1)
    const [, pauses, synthDurationSec] = (dependencies.insertPauses as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(pauses).toEqual([{ afterSceneOrder: 1, durationSec: 2 }])
    // insertPauses обязан знать длину синтеза — она же фоллбек, если ffprobe
    // не измерит трек внутри него (Task 2 бриф).
    expect(synthDurationSec).toBeCloseTo(6.4, 3)
    // Длительность результата — то, что вернул insertPauses (факт), а НЕ
    // синтез + сумма пауз (6.4 + 2 = 8.4): арифметика и измерение здесь
    // намеренно разные числа, чтобы регресс на сложение был виден.
    expect(result.durationSec).toBeCloseTo(8.35, 3)
  })

  it("падает внятно, когда голос не задан — чужой голос на лицо ведущего недопустим", async () => {
    const dependencies = deps()

    await expect(runSingleTrackVoiceover({
      videoId: 7,
      stepId: 4,
      scenes: PLAN_SCENES,
      voiceoverLines: [],
      voiceId: null,
      language: "ru",
      outputPath: "/tmp/track.mp3",
    }, dependencies as never)).rejects.toThrow(/голос/i)

    // Гейт голоса обязан стоять ПЕРЕД платным вызовом синтеза — иначе
    // отсутствие голоса не спасает от списания денег за чужой голос.
    expect(dependencies.synthesize).not.toHaveBeenCalled()
  })

  it("паузу без точки вставки не глушит молча — пишет в лог, что тишина не добавлена", async () => {
    const dependencies = deps({
      insertPauses: vi.fn(async (path: string) => ({
        path,
        durationSec: 6.4, // тишина не легла — длительность как у чистого синтеза
        skippedPauses: [{ afterSceneOrder: 1, durationSec: 2 }],
        sourceDurationMeasureFailed: false,
        durationEstimated: false,
      })),
    })

    const result = await runSingleTrackVoiceover({
      videoId: 7,
      stepId: 4,
      scenes: [{ order: 1, spokenLine: "Смотри. [пауза 2с]" }, { order: 2, spokenLine: "Вывод." }],
      voiceoverLines: [],
      voiceId: "clone-1",
      language: "ru",
      outputPath: "/tmp/track.mp3",
    }, dependencies as never)

    expect(result.durationSec).toBeCloseTo(6.4, 3)
    const messages = (dependencies.log as ReturnType<typeof vi.fn>).mock.calls.map(call => call[1])
    expect(messages.some(m => typeof m === "string" && /не наш.*точк/i.test(m) && m.includes("1"))).toBe(true)
  })

  it("сбой замера исходника — честная причина в логе, а не «не нашли точку вставки»", async () => {
    // insertPauses пометил sourceDurationMeasureFailed: ffprobe не измерил
    // исходник, поэтому splitting не запускался вовсе — все паузы попали в
    // skippedPauses, но НЕ из-за отсутствия опорной сцены (Task 2 бриф,
    // решение 2). Лог обязан назвать настоящую причину.
    const dependencies = deps({
      insertPauses: vi.fn(async (path: string) => ({
        path,
        durationSec: 6.4, // фоллбек на длину синтеза, не 0
        skippedPauses: [{ afterSceneOrder: 1, durationSec: 2 }],
        sourceDurationMeasureFailed: true,
        durationEstimated: true,
      })),
    })

    const result = await runSingleTrackVoiceover({
      videoId: 7,
      stepId: 4,
      scenes: [{ order: 1, spokenLine: "Смотри. [пауза 2с]" }, { order: 2, spokenLine: "Вывод." }],
      voiceoverLines: [],
      voiceId: "clone-1",
      language: "ru",
      outputPath: "/tmp/track.mp3",
    }, dependencies as never)

    expect(result.durationSec).toBeCloseTo(6.4, 3)
    const messages = (dependencies.log as ReturnType<typeof vi.fn>).mock.calls.map(call => call[1])
    expect(messages.some(m => typeof m === "string" && /измерить/i.test(m))).toBe(true)
    // Старая (неверная для этого случая) причина показываться не должна.
    expect(messages.some(m => typeof m === "string" && /не наш.*точк/i.test(m))).toBe(false)
  })

  it("паузы реально вставлены, но замер результата не удался — честная оценка в логе, старая причина молчит", async () => {
    // sourceDurationMeasureFailed: false (сплайсинг прошёл, точка вставки
    // нашлась), но durationEstimated: true — ffprobe не смог измерить
    // ГОТОВЫЙ файл. Это другая причина, чем сбой замера исходника, и лог
    // обязан назвать именно её, а не молчать (Task 2 ревью, Important-1).
    const dependencies = deps({
      insertPauses: vi.fn(async (path: string) => ({
        path,
        durationSec: 8.4, // 6.4 (исходник) + 2 (пауза) — оценка суммой, не факт
        skippedPauses: [],
        sourceDurationMeasureFailed: false,
        durationEstimated: true,
      })),
    })

    const result = await runSingleTrackVoiceover({
      videoId: 7,
      stepId: 4,
      scenes: [{ order: 1, spokenLine: "Смотри. [пауза 2с]" }, { order: 2, spokenLine: "Вывод." }],
      voiceoverLines: [],
      voiceId: "clone-1",
      language: "ru",
      outputPath: "/tmp/track.mp3",
    }, dependencies as never)

    expect(result.durationSec).toBeCloseTo(8.4, 3)
    const messages = (dependencies.log as ReturnType<typeof vi.fn>).mock.calls.map(call => call[1])
    expect(messages.some(m => typeof m === "string" && /оценен/i.test(m))).toBe(true)
    // Ни «не измерили исходник», ни «не нашли точку вставки» здесь не звучат —
    // обе причины неверны для этого случая.
    expect(messages.some(m => typeof m === "string" && /паузы не вставлены/i.test(m))).toBe(false)
    expect(messages.some(m => typeof m === "string" && /не наш.*точк/i.test(m))).toBe(false)
  })
})
