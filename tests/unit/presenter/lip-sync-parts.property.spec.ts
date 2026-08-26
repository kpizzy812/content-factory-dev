/**
 * Тест-свойство для `planLipSyncParts` — слоя, который превращает чистое
 * дробление реплики (`splitLongPresenterLine`, §5.3) в план ПЛАТНЫХ вызовов
 * lip-sync.
 *
 * Свойства самого дробления (рез по паузе, перебивка, WARN, завершаемость)
 * уже закреплены в `tests/unit/edit-plan/split-line.property.spec.ts`. Здесь
 * проверяется ровно то, что добавляет этот слой и за что платят деньги:
 *
 *  1. **Каждая часть укладывается в потолок модели.** Часть длиннее потолка
 *     провайдер отобьёт уже после оплаты подготовки, и сцена останется без
 *     губ — исходный дефект ролика 30.
 *  2. **Части покрывают реплику от её начала до её конца.** Непокрытый хвост
 *     это и есть та самая несинхронизированная концовка; непокрытая голова —
 *     ведущая, молчащая под живую речь с первой секунды.
 *  3. **Ни дыр, ни нахлёстов** (при запрещённой перебивке — покрытие
 *     буквальное; при разрешённой дыра допустима ровно там, где §5.3 сама
 *     ставит перебивку, и нахлёст запрещён всё равно).
 *  4. **Порядок частей монотонен** — иначе вторая часть играла бы раньше
 *     первой.
 *  5. **Реплика короче потолка НЕ дробится.** Это прямое денежное требование:
 *     лишняя часть — второй платный вызов на пустом месте.
 *  6. **Часть не вылезает за конец трека** — звука там нет.
 *
 * Домен обязан порождать реплики И длиннее потолка, И короче, И вовсе без
 * пауз, И вовсе без слов: без этого перебор проверял бы одну ветку и молчал
 * бы про остальные. Насыщенность домена замеряется и утверждается отдельным
 * тестом — на этой работе генератор, выродившийся в одну ветку, уже был.
 */

import { describe, expect, it } from "vitest"

import { planLipSyncParts } from "~~/server/utils/presenter/lip-sync-parts"
import { snapSecToFrame, trackEndFrame } from "~~/server/utils/voiceover/segment-cut"
import type { AlignedScene } from "~~/server/utils/transcription/align"

/** Детерминированный PRNG (mulberry32) — тот же приём, что в соседних тест-свойствах. */
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

type WordLayoutKind = "dense" | "sparse" | "touching" | "narrow" | "mixed" | "none"

/**
 * Раскладки слов реплики.
 *  - `touching` — слова строго встык, НИ ОДНОЙ паузы (так отдаёт
 *    `interpolate()` в `align.ts`): дробить по §5.3 не по чему;
 *  - `none` — слов нет вовсе (выравнивание сцену не разобрало): дробление
 *    невозможно в принципе, и это отдельная ветка `planLipSyncParts`;
 *  - `narrow` — паузы в доли кадра;
 *  - `sparse` — паузы, заведомо «намеренные» (§5.3 п.1).
 */
function generateWords(rng: () => number, startSec: number, endSec: number, kind: WordLayoutKind): AlignedScene["words"] {
  if (kind === "none") return []

  const words: AlignedScene["words"] = []
  let cursor = startSec
  let index = 0

  const gapFor = (localKind: Exclude<WordLayoutKind, "mixed" | "none">): number => {
    if (localKind === "dense") return randRange(rng, 0.05, 0.3)
    if (localKind === "sparse") return randRange(rng, 0.4, 2.5)
    if (localKind === "touching") return 0
    return randRange(rng, 0, 0.05)
  }

  while (cursor < endSec - 0.1 && words.length < 80) {
    const wordLen = randRange(rng, 0.1, 0.6)
    const wordEnd = Math.min(cursor + wordLen, endSec)
    if (wordEnd <= cursor) break
    words.push({ text: `w${index}`, startSec: cursor, endSec: wordEnd, matched: true })
    index += 1
    const localKind = kind === "mixed"
      ? pick(rng, ["dense", "sparse", "touching", "narrow"] as const)
      : kind as Exclude<WordLayoutKind, "mixed" | "none">
    cursor = wordEnd + gapFor(localKind)
  }

  // Последнее слово обязано доходить до конца сцены: иначе граница реплики и
  // граница слов расходятся, и «покрытие реплики» проверялось бы на выдумке.
  if (words.length > 0) words[words.length - 1]!.endSec = endSec
  return words
}

const FPS_DOMAIN = [24, 25, 29.97, 23.976, 30, 60] as const
const MAX_DURATION_DOMAIN = [2, 3, 5, 8, 10] as const

interface Scenario {
  seed: number
  fps: number
  maxDurationSec: number
  brollAllowed: boolean
  trackDurationSec: number
  scene: AlignedScene
  kind: WordLayoutKind
  label: string
}

function buildScenario(seed: number): Scenario {
  const rng = mulberry32(seed * 2654435761)
  const fps = pick(rng, FPS_DOMAIN)
  const maxDurationSec = pick(rng, MAX_DURATION_DOMAIN)
  const brollAllowed = rng() < 0.5
  const kind = pick(rng, ["dense", "sparse", "touching", "narrow", "mixed", "none"] as const)
  // От заметно КОРОЧЕ потолка (один вызов, дробить нельзя) до многократно
  // длиннее (каскад частей).
  const spanSec = maxDurationSec * randRange(rng, 0.2, 6)
  const startSec = randRange(rng, 0, 40)
  const endSec = startSec + spanSec
  const words = generateWords(rng, startSec, endSec, kind)
  // Трек то длиннее сцены, то обрезает её хвост — клэмп обязан работать.
  const trackDurationSec = rng() < 0.25
    ? startSec + spanSec * randRange(rng, 0.3, 0.95)
    : endSec + randRange(rng, 0, 20)

  const scene: AlignedScene = { order: 1, startSec, endSec, words }
  const label = `seed=${seed} fps=${fps} max=${maxDurationSec} broll=${brollAllowed} kind=${kind} `
    + `span=${spanSec.toFixed(3)} track=${trackDurationSec.toFixed(3)} words=${words.length}`
  return { seed, fps, maxDurationSec, brollAllowed, trackDurationSec, scene, kind, label }
}

function checkProperties(scenario: Scenario): void {
  const { fps, maxDurationSec, brollAllowed, trackDurationSec, scene, label } = scenario
  const plan = planLipSyncParts({ scene, maxDurationSec, fps, brollAllowed, trackDurationSec })

  const trackEnd = trackEndFrame(trackDurationSec, fps)
  const expectedStart = Math.min(Math.max(0, snapSecToFrame(scene.startSec, fps)), trackEnd)
  const expectedEnd = Math.max(expectedStart, Math.min(snapSecToFrame(scene.endSec, fps), trackEnd))
  const guard = 1e-9

  // 0. Часть всегда есть: иначе сцена молча осталась бы без единого вызова.
  expect(plan.parts.length, `${label}: частей не оказалось вовсе`).toBeGreaterThan(0)

  // 4. Порядок монотонен, нахлёстов нет.
  for (let index = 1; index < plan.parts.length; index += 1) {
    const previous = plan.parts[index - 1]!
    const current = plan.parts[index]!
    expect(current.index, `${label}: номера частей не монотонны`).toBe(previous.index + 1)
    expect(current.startSec, `${label}: часть ${index} начинается раньше конца предыдущей (нахлёст)`)
      .toBeGreaterThanOrEqual(previous.endSec - guard)
  }

  // 2. Покрытие реплики: от её начала до её конца.
  expect(plan.parts[0]!.startSec, `${label}: первая часть не с начала реплики`).toBeCloseTo(expectedStart, 9)
  expect(plan.parts.at(-1)!.endSec, `${label}: последняя часть не до конца реплики`).toBeCloseTo(expectedEnd, 9)

  for (const part of plan.parts) {
    // 6. За конец трека часть не вылезает — звука там нет.
    expect(part.endSec, `${label}: часть ${part.index} за концом трека`).toBeLessThanOrEqual(trackEnd + guard)
    // Вырожденных частей нет: пустой вызов оплачивался бы за тишину.
    if (expectedEnd > expectedStart) {
      expect(part.endSec, `${label}: часть ${part.index} вырождена`).toBeGreaterThan(part.startSec)
    }
  }

  // 1. Каждая часть укладывается в потолок модели — кроме честно названного
  //    случая «дробить нечем» (нет пословных границ): там часть одна, и её
  //    окно обрывает уже `planSegmentCut`, а план кадров закрывает нарушением
  //    `presenter_scene_too_long`.
  if (!plan.splitUnavailable) {
    for (const part of plan.parts) {
      expect(part.endSec - part.startSec, `${label}: часть ${part.index} длиннее потолка`)
        .toBeLessThanOrEqual(maxDurationSec + guard)
    }
  } else {
    expect(plan.parts.length, `${label}: дробить нечем, а частей больше одной`).toBe(1)
  }

  // 3. Перебивка запрещена — покрытие буквальное, без единой дыры.
  if (!brollAllowed) {
    for (let index = 1; index < plan.parts.length; index += 1) {
      expect(plan.parts[index]!.startSec, `${label}: дыра между частями ${index - 1} и ${index}`)
        .toBeCloseTo(plan.parts[index - 1]!.endSec, 9)
    }
  }

  // 5. Реплика короче потолка НЕ дробится — прямое денежное требование.
  if (expectedEnd - expectedStart <= maxDurationSec) {
    expect(plan.parts.length, `${label}: короткая реплика разбита — это лишний платный вызов`).toBe(1)
  }
}

const CHUNKS = 10
const PER_CHUNK = 2_000
const TOTAL = CHUNKS * PER_CHUNK

describe("свойства плана частей длинной реплики", () => {
  for (let chunk = 0; chunk < CHUNKS; chunk += 1) {
    it(`раскладки ${chunk * PER_CHUNK + 1}-${(chunk + 1) * PER_CHUNK}`, () => {
      for (let offset = 0; offset < PER_CHUNK; offset += 1) {
        checkProperties(buildScenario(chunk * PER_CHUNK + offset + 1))
      }
    })
  }
})

describe("насыщенность домена: перебор обязан бить по всем веткам", () => {
  it("реплики и длиннее потолка, и короче, и без единой паузы, и вовсе без слов", () => {
    let longerThanCap = 0
    let shorterThanCap = 0
    let withoutPauses = 0
    let withoutWords = 0
    let splitIntoParts = 0
    let clampedByTrack = 0

    for (let seed = 1; seed <= TOTAL; seed += 1) {
      const scenario = buildScenario(seed)
      const { fps, maxDurationSec, trackDurationSec, scene } = scenario
      const trackEnd = trackEndFrame(trackDurationSec, fps)
      const startSec = Math.min(Math.max(0, snapSecToFrame(scene.startSec, fps)), trackEnd)
      const endSec = Math.max(startSec, Math.min(snapSecToFrame(scene.endSec, fps), trackEnd))

      if (endSec - startSec > maxDurationSec) longerThanCap += 1
      else shorterThanCap += 1
      if (scene.words.length === 0) withoutWords += 1
      else if (!scene.words.some((word, index) => index > 0 && word.startSec > scene.words[index - 1]!.endSec)) {
        withoutPauses += 1
      }
      if (trackEnd < snapSecToFrame(scene.endSec, fps) - 1e-9) clampedByTrack += 1

      const plan = planLipSyncParts({ ...scenario, trackDurationSec })
      if (plan.parts.length > 1) splitIntoParts += 1
    }

    // Замер на этом генераторе (20 000 раскладок): длиннее потолка 16 548,
    // короче 3 452, без слов 3 398, без единой паузы 3 535, реально разбито на
    // части 13 766, обрезано концом трека 5 146. Пороги ниже — с запасом вниз:
    // тест обязан краснеть на ВЫРОЖДЕНИИ домена, а не на его дрожании.
    expect(longerThanCap / TOTAL, `длиннее потолка: ${longerThanCap}/${TOTAL}`).toBeGreaterThan(0.5)
    expect(shorterThanCap / TOTAL, `короче потолка: ${shorterThanCap}/${TOTAL}`).toBeGreaterThan(0.1)
    expect(withoutWords / TOTAL, `без слов: ${withoutWords}/${TOTAL}`).toBeGreaterThan(0.1)
    expect(withoutPauses / TOTAL, `без единой паузы: ${withoutPauses}/${TOTAL}`).toBeGreaterThan(0.05)
    expect(splitIntoParts / TOTAL, `реально разбито на части: ${splitIntoParts}/${TOTAL}`).toBeGreaterThan(0.3)
    expect(clampedByTrack / TOTAL, `обрезано концом трека: ${clampedByTrack}/${TOTAL}`).toBeGreaterThan(0.1)
  })
})
