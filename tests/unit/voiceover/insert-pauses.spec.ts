import { beforeEach, describe, expect, it, vi } from "vitest"

import { buildPauseInsertionPlan, insertVoiceoverPauses, planPauseSplit } from "~~/server/utils/voiceover/insert-pauses"

/**
 * `probeAudioDuration` (ffprobe) подменяем на уровне модуля `tts.ts` — по
 * образцу `media-task.spec.ts` и `clip-order-wiring.spec.ts`: замер честно
 * может вернуть 0 при сбое, и это нужно эмулировать без реального ffprobe.
 * ffmpeg-пайплайн (`fluent-ffmpeg`) подменяем по образцу
 * `subtitle-timeline.spec.ts` — реальный процесс в юнит-тестах не запускается.
 * vi.mock хойстится вверх файла самим vitest — порядок относительно импортов
 * выше не важен.
 */
const h = vi.hoisted(() => ({
  probeAudioDuration: vi.fn<(path: string) => Promise<number>>(),
  /** Графы `filter_complex`, реально отданные ffmpeg — по одному на прогон. */
  complexFilterCalls: [] as string[][],
}))

vi.mock("~~/server/utils/tts", () => ({ probeAudioDuration: h.probeAudioDuration }))

vi.mock("fluent-ffmpeg", () => {
  const makeCommand = () => {
    const handlers = new Map<string, (...args: unknown[]) => void>()
    const cmd: Record<string, unknown> = {}
    const chain = () => cmd
    Object.assign(cmd, {
      input: chain,
      // Граф записываем: он и есть то, что проверяется в тестах на пустые
      // куски — ассерт на возврат чистой функции не докажет, что в ffmpeg
      // ушёл именно он.
      complexFilter: (filters: string[]) => {
        h.complexFilterCalls.push(filters)
        return cmd
      },
      outputOptions: chain,
      output: chain,
      on: (event: string, cb: (...args: unknown[]) => void) => {
        handlers.set(event, cb)
        return cmd
      },
      // Успешный прогон: сразу отдаём 'end', никакого настоящего кодирования.
      run: () => { setTimeout(() => handlers.get("end")?.(), 0) },
    })
    return cmd
  }
  return { default: Object.assign(() => makeCommand(), {}) }
})

const scene = (order: number, text: string) => ({ order, text })

describe("расчёт точек разреза паузы (planPauseSplit)", () => {
  it("точка разреза — по доле символов сцены от всего текста", () => {
    const plan = planPauseSplit(
      [{ afterSceneOrder: 1, durationSec: 2 }],
      [scene(1, "12345"), scene(2, "12345")],
      10,
    )

    // Сцена 1 — ровно половина символов трека (5 из 10) → половина времени.
    expect(plan.points).toEqual([{ afterSceneOrder: 1, atSec: 5, durationSec: 2 }])
    expect(plan.skipped).toEqual([])
  })

  it("пауза без опорной сцены уходит в skipped, а не теряется молча", () => {
    // buildTrackRequest кладёт паузу в список ДО фильтра пустого текста —
    // сцена, целиком состоящая из маркера паузы, в `scenes` не попадает.
    const plan = planPauseSplit(
      [{ afterSceneOrder: 9, durationSec: 1.5 }],
      [scene(1, "abc")],
      10,
    )

    expect(plan.points).toEqual([])
    expect(plan.skipped).toEqual([{ afterSceneOrder: 9, durationSec: 1.5 }])
  })

  it("точки сортируются по времени, а не по порядку пауз на входе", () => {
    const plan = planPauseSplit(
      [{ afterSceneOrder: 2, durationSec: 1 }, { afterSceneOrder: 1, durationSec: 1 }],
      [scene(1, "12345"), scene(2, "12345"), scene(3, "12345")],
      15,
    )

    expect(plan.points.map(p => p.afterSceneOrder)).toEqual([1, 2])
  })

  it("сцены без текста — точек нет, все паузы пропущены", () => {
    const plan = planPauseSplit(
      [{ afterSceneOrder: 1, durationSec: 2 }],
      [scene(1, "")],
      10,
    )

    expect(plan.points).toEqual([])
    expect(plan.skipped).toEqual([{ afterSceneOrder: 1, durationSec: 2 }])
  })
})

describe("сборка ffmpeg-плана вставки тишины (buildPauseInsertionPlan)", () => {
  it("разрезает исходник и вставляет anullsrc нужной длины между кусками", () => {
    const plan = buildPauseInsertionPlan(
      "/tmp/track.mp3",
      [{ afterSceneOrder: 1, atSec: 5, durationSec: 2 }],
      10,
    )

    const joined = plan.filters.join("\n")
    expect(joined).toContain("atrim=0.000:5.000")
    expect(joined).toContain("atrim=5.000:10.000")
    expect(joined).toContain("anullsrc=channel_layout=stereo:sample_rate=44100")
    expect(joined).toContain("atrim=0:2.000")
    expect(plan.filters[plan.filters.length - 1]).toContain("concat=n=3:v=0:a=1")
  })

  it("без точек разреза — один кусок на весь трек, тишины нет", () => {
    const plan = buildPauseInsertionPlan("/tmp/track.mp3", [], 10)

    expect(plan.filters.some(f => f.includes("anullsrc"))).toBe(false)
    expect(plan.filters[plan.filters.length - 1]).toContain("concat=n=1:v=0:a=1")
  })

  it("выходной файл получает суффикс _paused, расширение сохраняется", () => {
    const plan = buildPauseInsertionPlan("/tmp/assets/voiceover_track.mp3", [], 10)

    expect(plan.outputPath).toBe("/tmp/assets/voiceover_track_paused.mp3")
  })

  it("несколько точек разреза дают несколько кусков тишины по порядку", () => {
    const plan = buildPauseInsertionPlan(
      "/tmp/track.mp3",
      [
        { afterSceneOrder: 1, atSec: 3, durationSec: 1 },
        { afterSceneOrder: 2, atSec: 7, durationSec: 2.5 },
      ],
      10,
    )

    const silenceCount = plan.filters.filter(f => f.includes("anullsrc")).length
    expect(silenceCount).toBe(2)
    expect(plan.filters[plan.filters.length - 1]).toContain("concat=n=5:v=0:a=1")
  })
})

describe("пустые куски трека не доезжают до concat (buildPauseInsertionPlan)", () => {
  // Кусок нулевой длины — это вход `concat` без единого сэмпла. ffmpeg на
  // таком графе в лучшем случае отдаёт мусор на стыке, в худшем падает, и
  // разбираться придётся уже по stderr готового ролика. Появляются такие
  // куски штатно, а не в экзотике: маркер в конце последней фразы даёт точку
  // разреза ровно на длине трека — то есть ровно случай локальной замены,
  // где синтезируется одна фраза и пауза стоит в её конце.

  it("пауза в самом конце трека не даёт хвостового куска нулевой длины", () => {
    const plan = buildPauseInsertionPlan(
      "/tmp/phrase.mp3",
      [{ afterSceneOrder: 2, atSec: 4, durationSec: 2 }],
      4,
    )

    expect(plan.filters.some(f => f.includes("atrim=4.000:4.000"))).toBe(false)
    expect(plan.filters[plan.filters.length - 1]).toBe("[seg0][sil0]concat=n=2:v=0:a=1[aout]")
  })

  it("точка разреза в самом начале трека не даёт головного куска нулевой длины", () => {
    // Достижимо, когда первая сцена осталась без символов: доля символов до
    // неё — ноль, точка разреза встаёт в начало трека.
    const plan = buildPauseInsertionPlan(
      "/tmp/track.mp3",
      [{ afterSceneOrder: 1, atSec: 0, durationSec: 1.5 }],
      10,
    )

    expect(plan.filters.some(f => f.includes("atrim=0.000:0.000"))).toBe(false)
    expect(plan.filters[plan.filters.length - 1]).toBe("[sil0][seg0]concat=n=2:v=0:a=1[aout]")
  })

  it("две паузы в одной точке идут встык, без пустого куска между ними", () => {
    // Два маркера в одной сцене дают две точки с одинаковым `atSec` —
    // buildTrackRequest кладёт в список каждый найденный маркер.
    const plan = buildPauseInsertionPlan(
      "/tmp/track.mp3",
      [
        { afterSceneOrder: 1, atSec: 5, durationSec: 1 },
        { afterSceneOrder: 1, atSec: 5, durationSec: 2 },
      ],
      10,
    )

    expect(plan.filters[plan.filters.length - 1]).toBe("[seg0][sil0][sil1][seg1]concat=n=4:v=0:a=1[aout]")
  })

  it("кусок короче миллисекунды в граф не попадает — в аргументах он всё равно нулевой", () => {
    // Аргументы `atrim` округляются до миллисекунд, поэтому решать «пустой
    // или нет» надо по тому, что реально уедет в ffmpeg, а не по исходным
    // числам: 4.0001..4.0002 в графе выглядит как 4.000:4.000.
    const plan = buildPauseInsertionPlan(
      "/tmp/track.mp3",
      [{ afterSceneOrder: 1, atSec: 4.0001, durationSec: 1 }],
      4.0002,
    )

    expect(plan.filters.some(f => f.includes("atrim=4.000:4.000"))).toBe(false)
    expect(plan.filters[plan.filters.length - 1]).toBe("[seg0][sil0]concat=n=2:v=0:a=1[aout]")
  })

  it("граф не собирается, когда резать нечего", () => {
    // `concat=n=0` — заведомо битая команда. Лучше отказ с внятной причиной,
    // чем ffmpeg, падающий на разборе фильтра.
    expect(() => buildPauseInsertionPlan("/tmp/track.mp3", [], 0)).toThrow(/резать нечего/)
  })
})

describe("фоллбек на длину синтеза при неудачном замере (insertVoiceoverPauses)", () => {
  // probeAudioDuration при ошибке ffprobe возвращает 0, а не бросает. Ноль
  // отсюда уезжает в снапшот шага и молча отключает подгон длины клипов и
  // реальные тайминги субтитров — без единой строки в логе. Фоллбек обязан
  // стоять на всех трёх точках замера внутри функции (см. Task 2 бриф).
  beforeEach(() => {
    h.probeAudioDuration.mockReset()
    h.complexFilterCalls.length = 0
  })

  it("маркер в конце единственной фразы — в ffmpeg уходит граф без пустых кусков", async () => {
    // Сквозная проверка случая локальной замены: одна фраза, маркер в её
    // конце, точка разреза совпадает с концом трека. Ассерт на чистую
    // функцию выше не доказывает, что в процесс ушёл именно этот граф.
    h.probeAudioDuration
      .mockResolvedValueOnce(4) // исходник
      .mockResolvedValueOnce(6) // результат со вставленной тишиной
    const pauses = [{ afterSceneOrder: 2, durationSec: 2 }]

    const result = await insertVoiceoverPauses(
      "/tmp/phrase.mp3",
      pauses,
      [scene(2, "Смотри сюда.")],
      4,
    )

    expect(result.durationSec).toBeCloseTo(6, 3)
    expect(result.skippedPauses).toEqual([])
    const filters = h.complexFilterCalls.at(-1) ?? []
    expect(filters.some(f => f.includes("atrim=4.000:4.000"))).toBe(false)
    expect(filters[filters.length - 1]).toBe("[seg0][sil0]concat=n=2:v=0:a=1[aout]")
  })

  it("неизмеримая длительность при отсутствии пауз — результат равен длине синтеза, а не нулю", async () => {
    h.probeAudioDuration.mockResolvedValueOnce(0)

    const result = await insertVoiceoverPauses("/tmp/track.mp3", [], [], 6.4)

    expect(result.durationSec).toBeCloseTo(6.4, 3)
    expect(result.skippedPauses).toEqual([])
    expect(result.sourceDurationMeasureFailed).toBe(false)
    // Пауз нет — сложить нечего, но это всё равно оценка, а не факт: замер
    // не удался, и вызывающий код обязан иметь возможность это увидеть.
    expect(result.durationEstimated).toBe(true)
  })

  it("замер исходника не удался при непустых паузах — фоллбек на синтез, причина размечена честно", async () => {
    h.probeAudioDuration.mockResolvedValueOnce(0)
    const pauses = [{ afterSceneOrder: 1, durationSec: 2 }]

    const result = await insertVoiceoverPauses(
      "/tmp/track.mp3",
      pauses,
      [scene(1, "12345"), scene(2, "12345")],
      6.4,
    )

    expect(result.durationSec).toBeCloseTo(6.4, 3)
    // Резать по оценённым долям было не от чего — ffmpeg не запускался,
    // путь остался исходным.
    expect(result.path).toBe("/tmp/track.mp3")
    expect(result.skippedPauses).toEqual(pauses)
    // Причина — сбой замера, а не отсутствие опорной сцены: вызывающий код
    // обязан различать эти случаи, иначе лог соврёт про «не нашли точку
    // вставки» там, где сцена нашлась бы, просто резать было не от чего.
    expect(result.sourceDurationMeasureFailed).toBe(true)
    expect(result.durationEstimated).toBe(true)
  })

  it("замер результата после ffmpeg не удался — оценка суммой исходника и вставленных пауз, а НЕ длина синтеза", async () => {
    // Ревью Task 2, находка Critical: паузы уже РЕАЛЬНО вставлены (ffmpeg
    // прошёл), поэтому длина синтеза (без пауз) занижала бы результат ровно
    // на сумму вставленной тишины. synthDurationSec здесь заведомо другое
    // число (999) — если бы фоллбек подставлял его, тест бы это поймал.
    h.probeAudioDuration
      .mockResolvedValueOnce(10) // исходник — измерен успешно, разрез возможен
      .mockResolvedValueOnce(0) // результат — ffprobe не смог измерить готовый файл
    const pauses = [{ afterSceneOrder: 1, durationSec: 2 }]

    const result = await insertVoiceoverPauses(
      "/tmp/track.mp3",
      pauses,
      [scene(1, "12345"), scene(2, "12345")],
      999,
    )

    // 10 (измеренный исходник) + 2 (реально вставленная пауза) = 12, а не 999.
    expect(result.durationSec).toBeCloseTo(12, 3)
    expect(result.path).toBe("/tmp/track_paused.mp3")
    expect(result.skippedPauses).toEqual([])
    // Разрез состоялся — точка вставки нашлась, дело не в ней.
    expect(result.sourceDurationMeasureFailed).toBe(false)
    // Но это оценка (сумма), а не факт (измерение) — вызывающий код обязан
    // различать это в логе, значение кэшируется дальше как есть.
    expect(result.durationEstimated).toBe(true)
  })

  it("несколько пауз, замер результата не удался — сумма учитывает КАЖДУЮ вставленную паузу", async () => {
    h.probeAudioDuration
      .mockResolvedValueOnce(20) // исходник
      .mockResolvedValueOnce(0) // результат не измерен
    const pauses = [
      { afterSceneOrder: 1, durationSec: 1.5 },
      { afterSceneOrder: 2, durationSec: 2.5 },
    ]

    const result = await insertVoiceoverPauses(
      "/tmp/track.mp3",
      pauses,
      [scene(1, "12345"), scene(2, "12345"), scene(3, "12345")],
      999,
    )

    // 20 + 1.5 + 2.5 = 24.
    expect(result.durationSec).toBeCloseTo(24, 3)
    expect(result.durationEstimated).toBe(true)
  })

  it("оба замера успешны — длительность результата это факт, а не оценка", async () => {
    h.probeAudioDuration
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(11.5)
    const pauses = [{ afterSceneOrder: 1, durationSec: 2 }]

    const result = await insertVoiceoverPauses(
      "/tmp/track.mp3",
      pauses,
      [scene(1, "12345"), scene(2, "12345")],
      999, // заведомо другое число — фоллбек не должен был примениться
    )

    expect(result.durationSec).toBeCloseTo(11.5, 3)
    expect(result.sourceDurationMeasureFailed).toBe(false)
    expect(result.durationEstimated).toBe(false)
  })

  it("точек разреза нет (все паузы пропущены) — длительность исходника это факт, не оценка", async () => {
    h.probeAudioDuration.mockResolvedValueOnce(10)
    // Пауза без опорной сцены — planPauseSplit не даёт точек, ffmpeg не
    // запускается, но исходник УЖЕ измерен ffprobe успешно.
    const pauses = [{ afterSceneOrder: 9, durationSec: 2 }]

    const result = await insertVoiceoverPauses(
      "/tmp/track.mp3",
      pauses,
      [scene(1, "12345")],
      999,
    )

    expect(result.durationSec).toBeCloseTo(10, 3)
    expect(result.skippedPauses).toEqual(pauses)
    expect(result.sourceDurationMeasureFailed).toBe(false)
    expect(result.durationEstimated).toBe(false)
  })
})
