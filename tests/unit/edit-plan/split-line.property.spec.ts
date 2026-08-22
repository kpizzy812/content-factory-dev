/**
 * Тест-свойство для `splitLongPresenterLine` (задание Task 4, урок Task 3:
 * примерные тесты дважды пропустили дефекты, которые перебор находит за
 * секунды — в частности зависание на вырожденной паузе, см. поправку 2 к
 * брифу и докстринг `split-line.ts`).
 *
 * Детерминированный (сид фиксирован) перебор нескольких сотен раскладок слов:
 * густые паузы, редкие паузы, слова строго встык (без единой паузы вообще),
 * паузы почти нулевой ширины у самого курсора (ровно то, что зависало в
 * дозаявочной реализации) и их смесь в одной реплике. Длительность реплики
 * варьируется от чуть больше потолка до многократно длиннее — чтобы дробление
 * происходило и в один, и в несколько проходов подряд.
 *
 * Свойства, обязанные держаться на ЛЮБОМ входе, который способен построить
 * генератор, БЕЗ исключений внутри проверки (единственное условие —
 * предусловие генератора «слов минимум одно», вырожденный пустой случай уже
 * закрыт отдельным unit-тестом в `split-line.spec.ts`):
 *
 * 1. `parts` и `interludes` вместе покрывают реплику от начала до конца без
 *    дыр и без нахлёстов.
 * 2. Ни одна часть (`parts`) не длиннее потолка модели.
 * 3. Ни один сегмент (ни часть, ни перебивка) не имеет неположительной длины.
 * 4. Функция завершается за конечное и малое время — сам факт того, что тест
 *    дошёл до проверок (а не завис), это уже часть свойства; дополнительно
 *    измеряется время каждого сценария как защита от «не зависает, но очень
 *    медленно» деградации.
 */

import { describe, expect, it } from "vitest"

import { splitLongPresenterLine } from "~~/server/utils/edit-plan/split-line"
import type { AlignedScene } from "~~/server/utils/transcription/align"

/** Детерминированный PRNG (mulberry32) — тот же приём, что в `repair.property.spec.ts`. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!
}

function randRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min)
}

type WordLayoutKind = "dense" | "sparse" | "touching" | "narrow" | "mixed"

/**
 * Раскладки слов реплики. "narrow" — паузы почти нулевой ширины (0-20мс),
 * специально нацелены на класс дефекта из поправки 2: узкая пауза у самого
 * курсора снапается обратно в текущий кадр. "touching" — гарантированно НИ
 * ОДНОЙ паузы вообще (слова строго встык, как отдаёт `interpolate()` в
 * `align.ts`), структурно другой случай (`inRange` пуст изначально, а не
 * отфильтрован до пустоты).
 */
function generateWords(rng: () => number, targetSec: number, kind: WordLayoutKind): AlignedScene["words"] {
  const words: AlignedScene["words"] = []
  let cursor = randRange(rng, 0, 0.2)
  let index = 0

  const gapFor = (localKind: Exclude<WordLayoutKind, "mixed">): number => {
    if (localKind === "dense") return randRange(rng, 0.05, 0.3)
    if (localKind === "sparse") return randRange(rng, 1.0, 4.0)
    if (localKind === "touching") return 0
    return randRange(rng, 0, 0.02) // narrow
  }

  while (cursor < targetSec - 0.1 && words.length < 60) {
    const wordLen = randRange(rng, 0.1, 0.6)
    const end = Math.min(cursor + wordLen, targetSec)
    if (end <= cursor) break
    words.push({ text: `w${index}`, startSec: cursor, endSec: end, matched: true })
    index += 1

    const localKind = kind === "mixed" ? pick(rng, ["dense", "sparse", "touching", "narrow"] as const) : kind
    cursor = end + gapFor(localKind)
  }

  // Гарантия непустоты (предусловие, не исключение внутри проверки): пустая
  // реплика — отдельный, структурно другой случай, закрытый unit-тестом.
  if (words.length === 0) words.push({ text: "w0", startSec: 0, endSec: Math.max(targetSec, 0.2), matched: true })

  return words
}

interface Scenario {
  seed: number
  fps: number
  maxDurationSec: number
  brollAllowed: boolean
  scene: AlignedScene
  label: string
}

function buildScenario(seed: number): Scenario {
  const rng = mulberry32(seed * 2654435761)
  const fps = pick(rng, [24, 25, 30, 60])
  const maxDurationSec = pick(rng, [3, 5, 8, 10])
  const brollAllowed = rng() < 0.5
  const kind = pick(rng, ["dense", "sparse", "touching", "narrow", "mixed"] as const)
  // От чуть длиннее потолка до многократно длиннее — один сплит и каскад из нескольких.
  const targetSec = maxDurationSec * randRange(rng, 1.05, 6)
  const words = generateWords(rng, targetSec, kind)

  const scene: AlignedScene = {
    order: 1,
    startSec: words[0]!.startSec,
    endSec: words[words.length - 1]!.endSec,
    words,
  }

  const label = `seed=${seed} fps=${fps} max=${maxDurationSec} broll=${brollAllowed} kind=${kind} `
    + `span=${(scene.endSec - scene.startSec).toFixed(3)} words=${words.length}`
  return { seed, fps, maxDurationSec, brollAllowed, scene, label }
}

/** Ближайшая граница кадра — та же формула, что `snapSecToFrame` в `segment-cut.ts`. */
function snap(sec: number, fps: number): number {
  return fps > 0 ? Math.round(sec * fps) / fps : sec
}

function checkProperties({ scene, maxDurationSec, fps, brollAllowed, label }: Scenario): void {
  const startedAt = Date.now()
  const result = splitLongPresenterLine({ scene, maxDurationSec, fps, brollAllowed })
  const elapsedMs = Date.now() - startedAt

  // Свойство 4 (частично): защита от «не зависает, но очень медленно».
  // Настоящее зависание тест-раннер поймает собственным таймаутом раньше, чем
  // эта проверка вообще выполнится — сам факт того, что мы сюда дошли, уже
  // часть свойства.
  expect(elapsedMs, `${label}: дробление одной реплики не должно занимать заметное время`).toBeLessThan(200)

  const allSegments = [...result.parts, ...result.interludes]

  // Свойство 3: ни один сегмент не имеет неположительной длины. Безусловно.
  for (const seg of allSegments) {
    expect(seg.endSec - seg.startSec, `${label}: сегмент [${seg.startSec}, ${seg.endSec}] неположительной длины`)
      .toBeGreaterThan(0)
  }

  // Свойство 2: ни одна ЧАСТЬ (не перебивка) не длиннее потолка модели. Безусловно.
  for (const part of result.parts) {
    expect(part.endSec - part.startSec, `${label}: часть [${part.startSec}, ${part.endSec}] длиннее потолка`)
      .toBeLessThanOrEqual(maxDurationSec + 1e-6)
  }

  // Свойство 1: части и перебивки вместе покрывают реплику без дыр и нахлёстов. Безусловно.
  const covered = allSegments.slice().sort((a, b) => a.startSec - b.startSec)
  const expectedStart = snap(scene.startSec, fps)
  const expectedEnd = snap(scene.endSec, fps)
  expect(covered.length, `${label}: дробление не вернуло ни одного сегмента`).toBeGreaterThan(0)
  expect(covered[0]!.startSec, `${label}: покрытие не начинается с начала реплики`)
    .toBeCloseTo(expectedStart, 6)
  expect(covered[covered.length - 1]!.endSec, `${label}: покрытие не доходит до конца реплики`)
    .toBeCloseTo(expectedEnd, 6)
  for (let i = 1; i < covered.length; i += 1) {
    expect(covered[i]!.startSec, `${label}: дыра или нахлёст между сегментами ${i - 1} и ${i}`)
      .toBeCloseTo(covered[i - 1]!.endSec, 6)
  }
}

/**
 * Коммитный диапазон — несколько сотен, как того требует задание. Каждый
 * сценарий дешёвый (до 60 слов, до пары десятков итераций дробления), поэтому
 * даже 400 сценариев укладываются в миллисекунды суммарно.
 */
const ITERATIONS = 400

describe("свойства дробления длинной реплики (property-based)", () => {
  for (let seed = 1; seed <= ITERATIONS; seed += 1) {
    it(`сценарий #${seed}`, () => {
      checkProperties(buildScenario(seed))
    })
  }
})
