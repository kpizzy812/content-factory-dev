import { describe, expect, it } from "vitest"

import { shiftAlignmentAfterSplice } from "~~/server/utils/voiceover/alignment-shift"

const FPS = 30

function scene(order: number, startSec: number, endSec: number) {
  return {
    order,
    startSec,
    endSec,
    words: [{ text: `сцена${order}`, startSec, endSec, matched: true }],
  }
}

const SCENES = [scene(1, 0, 3.9), scene(2, 4.0, 9.8), scene(3, 10.0, 15.0)]

const PLAN = {
  cutStartSec: 4.0,
  cutEndSec: 9.8,
  crossfadeSec: 0.02,
  anchoredToSilence: { start: true, end: true },
}

/** Длина трека ДО вклейки: рез 4.0-9.8 оставляет и голову, и хвост. */
const TRACK_SEC = 20

type ShiftArgs = Parameters<typeof shiftAlignmentAfterSplice>[0]

function run(overrides: Partial<ShiftArgs> = {}) {
  return shiftAlignmentAfterSplice({
    scenes: SCENES,
    plan: PLAN,
    replacementScene: scene(2, 0, 6.2),
    replacementDurationSec: 6.2,
    trackDurationSec: TRACK_SEC,
    // Длина склеенного трека ИЗМЕРЕНА ffprobe (решение №5 плана), а не сложена:
    // acrossfade укорачивает результат на кроссфейд с каждого стыка.
    splicedTrackDurationSec: 20.4,
    fps: FPS,
    ...overrides,
  })
}

/** Лежит ли граница ровно на кадре. Денежный инвариант — см. решение №3. */
function isOnFrame(sec: number): boolean {
  return Math.abs(sec * FPS - Math.round(sec * FPS)) < 1e-6
}

describe("пересчёт выравнивания после вклейки", () => {
  it("сцены до вклейки не двигаются вовсе", () => {
    const result = run()

    expect(result.scenes[0]).toMatchObject({ order: 1, startSec: 0, endSec: 3.9 })
    expect(result.movedSceneOrders).not.toContain(1)
  })

  it("сцены после вклейки сдвигаются на дельту длительности", () => {
    // Трек измерен: было 20 с, стало 20.4 — всё, что дальше выреза, уезжает на +0.4.
    const result = run()

    expect(result.deltaSec).toBeCloseTo(0.4, 3)
    expect(result.scenes[2]!.startSec).toBeCloseTo(10.4, 3)
    expect(result.movedSceneOrders).toContain(3)
  })

  it("слова сцены после вклейки уезжают вместе с её границами", () => {
    // Границы сцены сдвинуть, а слова оставить на месте — это караоке, которое
    // загорается на полсекунды раньше звука на всём остатке ролика.
    const result = run()

    const third = result.scenes.find(s => s.order === 3)!
    expect(third.words[0]!.startSec).toBeCloseTo(10.4, 3)
    expect(third.words[0]!.endSec).toBeCloseTo(15.4, 3)
  })

  it("заменённая сцена получает границы из своего транскрипта", () => {
    const result = run({
      replacementScene: {
        order: 2,
        startSec: 0.1,
        endSec: 6.0,
        words: [
          { text: "новая", startSec: 0.1, endSec: 2.0, matched: true },
          { text: "фраза", startSec: 2.2, endSec: 6.0, matched: true },
        ],
      },
    })

    const replaced = result.scenes.find(s => s.order === 2)!
    // Границы слов внутри новой фразы — свои, но сдвинутые на точку вклейки.
    // Точка вклейки — не cutStartSec, а cutStartSec минус кроссфейд: acrossfade
    // накладывает начало новой фразы на хвост головы (4.0 - 0.02 = 3.98).
    // 3.98 + 0.1 = 4.08, притянуто к кадру 30 fps → 122/30 = 4.0667.
    expect(replaced.words[0]!.startSec).toBeCloseTo(4.0667, 3)
    // 3.98 + 6.0 = 9.98 → 299/30 = 9.9667.
    expect(replaced.words[1]!.endSec).toBeCloseTo(9.9667, 3)
  })

  it("при той же измеренной длине не двигается никто", () => {
    const result = run({
      replacementScene: scene(2, 0, 5.8),
      replacementDurationSec: 5.8,
      splicedTrackDurationSec: 20,
    })

    expect(result.deltaSec).toBeCloseTo(0, 6)
    // Сама заменённая сцена в списке остаётся: её звук другой, и кадр надо
    // пересобрать даже при неизменной длине.
    expect(result.movedSceneOrders).toEqual([2])
  })

  it("дельта меньше половины кадра не двигает границы и не переоплачивает lip-sync", () => {
    // Решение №3: ключ переиспользования куска считается по ПРИТЯНУТЫМ к кадру
    // границам. Сдвиг в 10 мс при 30 fps даёт тот же кадр, тот же кусок и тот же
    // ключ — помечать такие сцены на пересборку значит заново оплатить lip-sync
    // всего остатка ролика на пустом месте.
    const result = run({ splicedTrackDurationSec: 20.01 })

    expect(result.deltaSec).toBeCloseTo(0.01, 3)
    expect(result.scenes[2]!.startSec).toBeCloseTo(10.0, 6)
    expect(result.movedSceneOrders).toEqual([2])
  })

  it("границы притянуты к кадру — иначе весь ролик переоплатит lip-sync", () => {
    const result = run({
      replacementScene: scene(2, 0, 6.217),
      replacementDurationSec: 6.217,
      splicedTrackDurationSec: 20.417,
    })

    for (const s of result.scenes) {
      expect(isOnFrame(s.startSec)).toBe(true)
      expect(isOnFrame(s.endSec)).toBe(true)
    }
  })

  it("слова тоже притянуты к кадру", () => {
    // Субтитры рисуются покадрово: несглаженная граница слова даёт дрожание
    // подсветки в караоке на кадр туда-сюда.
    const result = run({ splicedTrackDurationSec: 20.417 })

    for (const s of result.scenes) {
      for (const word of s.words) {
        expect(isOnFrame(word.startSec)).toBe(true)
        expect(isOnFrame(word.endSec)).toBe(true)
      }
    }
  })

  it("измеренная длина склеенного трека побеждает арифметику", () => {
    // Арифметика дала бы +0.36, ffprobe говорит +0.9: кодек добавил своё, и
    // верить надо замеру (решение №5), иначе весь хвост уедет от звука.
    const result = run({ splicedTrackDurationSec: 20.9 })

    expect(result.deltaSec).toBeCloseTo(0.9, 3)
    expect(result.scenes[2]!.startSec).toBeCloseTo(10.9, 3)
  })

  it("без замера дельта считается с поправкой на кроссфейд каждого стыка", () => {
    // Склейка головы, фразы и хвоста — два стыка acrossfade, и каждый съедает
    // свой кроссфейд. Наивное «новая минус старая» ошибётся на 0.04 с, то есть
    // больше кадра при 30 fps.
    const both = run({ splicedTrackDurationSec: undefined })
    expect(both.deltaSec).toBeCloseTo(6.2 - 5.8 - 0.04, 6)

    // Рез с нуля: головы нет, стык всего один.
    const tailOnly = run({
      splicedTrackDurationSec: undefined,
      plan: { ...PLAN, cutStartSec: 0, cutEndSec: 5.8 },
    })
    expect(tailOnly.deltaSec).toBeCloseTo(6.2 - 5.8 - 0.02, 6)
  })

  it("провальный замер длительности не выдаётся за дельту", () => {
    // `probeAudioDuration` при ошибке ffprobe возвращает 0, а не бросает
    // (известный дефект, план стр. 53). Принять этот 0 за длину склейки значит
    // сдвинуть весь хвост ролика на минус двадцать секунд.
    const result = run({ splicedTrackDurationSec: 0 })

    expect(result.deltaSec).toBeCloseTo(6.2 - 5.8 - 0.04, 6)
  })

  it("порядок сцен сохраняется и хронология не ломается", () => {
    const result = run({
      replacementScene: scene(2, 0, 2.0),
      replacementDurationSec: 2.0,
      splicedTrackDurationSec: 16.2,
    })

    expect(result.scenes.map(s => s.order)).toEqual([1, 2, 3])
    for (let i = 1; i < result.scenes.length; i += 1) {
      expect(result.scenes[i]!.startSec).toBeGreaterThanOrEqual(result.scenes[i - 1]!.endSec - 1e-6)
    }
    // Трек укоротился — хвост уехал назад, и эти кадры тоже пересобираются.
    expect(result.movedSceneOrders).toContain(3)
  })

  it("замена встаёт в хронологию, даже если выравнивание её пропустило", () => {
    // `alignScriptToTranscript` выбрасывает сцены без токенов, поэтому
    // заменяемой сцены может не быть в списке вовсе.
    const result = run({
      replacementScene: scene(5, 0, 6.2),
      scenes: [scene(1, 0, 3.9), scene(3, 10.0, 15.0)],
    })

    expect(result.scenes.map(s => s.order)).toEqual([1, 5, 3])
  })

  it("сцены, целиком попавшие внутрь выреза, не остаются призраками", () => {
    // Вырез 4.0-9.8 накрывает сцену 9 целиком — заменённая занимает её место,
    // и второй записи о ней быть не должно.
    const result = run({ scenes: [...SCENES, scene(9, 5.0, 6.0)] })

    expect(result.scenes.filter(s => s.order === 9)).toHaveLength(0)
    expect(result.movedSceneOrders).toContain(9)
  })

  it("сцена, которой вырез снёс хвост, сохраняет уцелевшие слова", () => {
    // Пауза, по которой резали, могла лежать ВНУТРИ соседней реплики. Выкинуть
    // такую сцену целиком значит потерять субтитры к звуку, который никуда не делся.
    const result = run({
      scenes: [
        {
          order: 7,
          startSec: 3.0,
          endSec: 5.0,
          words: [
            { text: "уцелело", startSec: 3.0, endSec: 3.5, matched: true },
            { text: "срезано", startSec: 4.5, endSec: 5.0, matched: true },
          ],
        },
        scene(2, 4.0, 9.8),
      ],
    })

    const kept = result.scenes.find(s => s.order === 7)!
    expect(kept.words.map(w => w.text)).toEqual(["уцелело"])
    expect(kept.startSec).toBeCloseTo(3.0, 3)
    expect(kept.endSec).toBeCloseTo(3.5, 3)
    expect(result.movedSceneOrders).toContain(7)
  })

  it("сцена, которой вырез снёс голову, сдвигает уцелевший хвост на дельту", () => {
    const result = run({
      scenes: [
        scene(2, 4.0, 9.8),
        {
          order: 8,
          startSec: 9.0,
          endSec: 11.0,
          words: [
            { text: "срезано", startSec: 9.0, endSec: 9.5, matched: true },
            { text: "уцелело", startSec: 10.2, endSec: 11.0, matched: true },
          ],
        },
      ],
    })

    const kept = result.scenes.find(s => s.order === 8)!
    expect(kept.words.map(w => w.text)).toEqual(["уцелело"])
    expect(kept.startSec).toBeCloseTo(10.6, 3)
    expect(kept.endSec).toBeCloseTo(11.4, 3)
    expect(result.movedSceneOrders).toContain(8)
  })

  it("сцена с тем же order за пределами выреза не задваивает список пересборки", () => {
    // `order` в проекте дублируется (см. комментарий в `transcription/align.ts`),
    // и одна и та же сцена не должна попасть в список дважды.
    const result = run({
      scenes: [scene(1, 0, 3.9), scene(2, 4.0, 9.8), scene(2, 10.0, 15.0)],
    })

    expect(result.movedSceneOrders).toEqual([2])
    expect(result.scenes).toHaveLength(3)
  })

  it("две сцены с одним order внутри выреза дают одну замену, а не две", () => {
    const result = run({
      scenes: [scene(2, 4.2, 5.0), scene(2, 6.0, 9.0)],
    })

    expect(result.scenes.filter(s => s.order === 2)).toHaveLength(1)
  })

  it("кроссфейд длиннее головы не выносит точку вклейки в минус", () => {
    // `crossfadeSec` приходит снаружи и сверху не зажат (отчёт Task 1).
    const result = run({ plan: { ...PLAN, crossfadeSec: 5.0 } })

    const replaced = result.scenes.find(s => s.order === 2)!
    expect(replaced.startSec).toBeCloseTo(0, 6)
    expect(replaced.startSec).toBeGreaterThanOrEqual(0)
  })

  it("не мутирует входное выравнивание", () => {
    // Старое выравнивание остаётся в снапшоте шага: испортив его на месте,
    // потеряем возможность откатиться к состоянию до вклейки.
    const scenes = [scene(1, 0, 3.9), scene(2, 4.0, 9.8), scene(3, 10.0, 15.0)]
    const before = JSON.stringify(scenes)

    run({ scenes })

    expect(JSON.stringify(scenes)).toBe(before)
  })
})
