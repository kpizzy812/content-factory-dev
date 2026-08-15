/**
 * Фрагмент ведущей подбирается под ФАКТИЧЕСКУЮ речь, а не под план сцены.
 *
 * Измерено на ролике 21: реплика первой сцены — 77 символов, звучит 5.9 с.
 * Сцена была запланирована на 9–10 с, и под неё взялся фрагмент 9.83 с.
 * `kling-lip-sync` синхронизирует губы только на длину аудио, поэтому
 * оставшиеся 3.9 с шли исходным видео: ведущая говорит, звука нет. В готовом
 * ролике таких дыр набралось 20 секунд из 50 — сорок процентов хронометража.
 *
 * План сцены — это намерение сценариста, а не факт. Факт создаёт TTS, и знать
 * его можно только после синтеза.
 */

import { describe, expect, it } from "vitest"
import {
  isSourceDurationCloseToScene,
  pickClosestPresenterCandidate,
  presenterTargetDuration,
} from "~~/server/utils/presenter/scene-clip-mapping"

describe("под какую длительность искать фрагмент", () => {
  it("под измеренную речь, когда она известна", () => {
    expect(presenterTargetDuration(5.9, 9)).toBe(5.9)
  })

  it("под план, пока речи ещё нет", () => {
    // До синтеза плана нет альтернативы. Но это запасной путь, а не основной.
    expect(presenterTargetDuration(null, 9)).toBe(9)
  })

  it("негодный замер речи не подменяет план нулём", () => {
    // Ноль означал бы «искать фрагмент нулевой длины» — не нашлось бы ничего,
    // и сцена молча осталась бы без ведущей.
    expect(presenterTargetDuration(0, 9)).toBe(9)
    expect(presenterTargetDuration(Number.NaN, 9)).toBe(9)
    expect(presenterTargetDuration(-1, 9)).toBe(9)
  })
})

describe("что это меняет на реальной библиотеке", () => {
  // Длительности взяты из библиотеки Лианы: 106 фрагментов, нарезанных по
  // речевым паузам, от 2.00 до 9.93 с.
  const library = [
    { durationSec: 2.0 }, { durationSec: 2.81 }, { durationSec: 3.05 },
    { durationSec: 4.41 }, { durationSec: 5.27 }, { durationSec: 6.16 },
    { durationSec: 7.14 }, { durationSec: 8.17 }, { durationSec: 9.64 },
  ]

  it("под речь 5.9 с находится близкий фрагмент", () => {
    const picked = pickClosestPresenterCandidate(library, 5.9)
    expect(picked?.durationSec).toBe(6.16)
    // И он действительно близок — немого хвоста почти нет.
    expect(Math.abs(picked!.durationSec - 5.9)).toBeLessThan(0.5)
  })

  it("старое поведение брало фрагмент под план и промахивалось по речи", () => {
    // Сцена «9 секунд» → фрагмент 9.64 с. Речь при этом 5.9 с, разрыв 3.7 с —
    // ровно тот немой хвост, который слышно в ролике.
    const byPlan = pickClosestPresenterCandidate(library, 9)
    expect(byPlan?.durationSec).toBe(9.64)
    expect(isSourceDurationCloseToScene(byPlan!.durationSec, 5.9)).toBe(false)
  })

  it("подбор под речь проходит проверку соответствия, подбор под план — нет", () => {
    const speechSec = 5.9
    const bySpeech = pickClosestPresenterCandidate(library, speechSec)!
    expect(isSourceDurationCloseToScene(bySpeech.durationSec, speechSec)).toBe(true)
  })
})
