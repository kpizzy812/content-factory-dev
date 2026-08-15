/**
 * Регрессия: длительность сцены считается от ДЛИНЫ РЕПЛИКИ, а не берётся из
 * строки, которую написал сценарист.
 *
 * У ролика 23 в плане стояло `durationSec: 10` у всех девяти сцен. Это не расчёт:
 * `parseSceneDuration` брал строку из storyPlan, а `clampDurationToModel`
 * притягивал её к ближайшему из {5, 10} у Kling. Реплика при этом звучит 4-6
 * секунд, и остаток сцены — немой кадр; а там, где реплика ДЛИННЕЕ плановой
 * сцены, реконсиляция ускоряет и режет её — ровно тот обрыв фразы, который
 * слышит заказчик.
 *
 * Правило: сцене отдаётся наименьшая поддерживаемая моделью длительность, в
 * которую речь укладывается с запасом. Сцена без реплики живёт по плану.
 */

import { describe, expect, it } from "vitest"
import {
  estimateSpeechDurationSec,
  pickSceneDurationForSpeech,
  SPEECH_HEADROOM_SEC,
} from "~~/shared/types/video-runtime"
import { buildStoryVideoPlan } from "../../../server/utils/story-video-planner"
import type { StoryPlan } from "~~/shared/types/story"
import type { ModelMeta } from "../../../server/utils/video-models"

/** Kling: только 5 или 10 секунд. */
const KLING = {
  id: "kwaivgi/kling-v1.6-standard",
  name: "Kling 1.6",
  durationOptions: [5, 10],
} as unknown as ModelMeta

const words = (count: number) => Array.from({ length: count }, (_, i) => `слово${i}`).join(" ")

function storyPlan(scenes: Array<{
  order: number
  duration: string
  spokenLine?: string | null
  voiceoverLine?: string | null
}>): StoryPlan {
  return {
    scenes: scenes.map(s => ({
      order: s.order,
      duration: s.duration,
      purpose: "story",
      visualPromptGuidance: "кадр",
      subtitleCopy: "",
      subtitlePlacement: { position: "bottom", alignment: "center", avoidZones: [] },
      spokenLine: s.spokenLine ?? null,
      voiceoverLine: s.voiceoverLine ?? null,
    })),
    globalVisualSystem: { stylePrompt: "", colorPalette: [], mood: "", lighting: "" },
    protagonist: {
      type: "person", description: "", visualIdentifiers: [], initialState: "", finalState: "",
    },
    voiceoverPlan: { enabled: true, pacing: "moderate", narratorPersona: null, lines: [] },
  } as unknown as StoryPlan
}

function planFor(story: StoryPlan) {
  return buildStoryVideoPlan({
    storyPlan: story,
    videoModel: KLING,
    userImageCount: 9,
    userClipDuration: 5,
  })
}

describe("estimateSpeechDurationSec", () => {
  it("считает по числу слов и темпу", () => {
    // moderate = 2.8 слова в секунду.
    expect(estimateSpeechDurationSec(words(28), "moderate")).toBeCloseTo(10, 5)
    expect(estimateSpeechDurationSec(words(20), "slow")).toBeCloseTo(10, 5)
    expect(estimateSpeechDurationSec(words(35), "fast")).toBeCloseTo(10, 5)
  })

  it("пустая реплика — нулевая длительность, а не минимальная секунда", () => {
    expect(estimateSpeechDurationSec("   ", "moderate")).toBe(0)
  })
})

describe("pickSceneDurationForSpeech", () => {
  it("берёт наименьший вариант модели, в который речь влезает с запасом", () => {
    expect(pickSceneDurationForSpeech(2, { durationOptions: [5, 10] })).toBe(5)
    // 4.5 + запас уже не помещается в пятисекундный вариант.
    expect(pickSceneDurationForSpeech(4.5, { durationOptions: [5, 10] })).toBe(10)
  })

  it("речь длиннее любого варианта — берём максимальный, а не режем её", () => {
    expect(pickSceneDurationForSpeech(30, { durationOptions: [5, 10] })).toBe(10)
  })

  it("модель с непрерывным диапазоном получает целые секунды внутри границ", () => {
    expect(pickSceneDurationForSpeech(6.2, { durationRange: [3, 15] })).toBe(6.2 + SPEECH_HEADROOM_SEC)
    expect(pickSceneDurationForSpeech(0.2, { durationRange: [3, 15] })).toBe(3)
    expect(pickSceneDurationForSpeech(40, { durationRange: [3, 15] })).toBe(15)
  })

  it("ограничений модели нет — длительность равна речи с запасом", () => {
    expect(pickSceneDurationForSpeech(4, {})).toBe(4 + SPEECH_HEADROOM_SEC)
  })
})

describe("buildStoryVideoPlan: сцена живёт столько, сколько звучит её реплика", () => {
  it("короткая реплика не растягивает сцену до плановых десяти секунд", () => {
    const plan = planFor(storyPlan([
      { order: 1, duration: "10s", voiceoverLine: words(4) },
    ]))

    expect(plan.scenes[0]!.durationSec).toBe(5)
  })

  it("длинная реплика удлиняет сцену, а не ускоряется под план", () => {
    const plan = planFor(storyPlan([
      { order: 1, duration: "5s", voiceoverLine: words(25) },
    ]))

    expect(plan.scenes[0]!.durationSec).toBe(10)
  })

  it("реплика ведущей в кадре считается наравне с закадровой", () => {
    const plan = planFor(storyPlan([
      { order: 1, duration: "10s", spokenLine: words(3) },
    ]))

    expect(plan.scenes[0]!.durationSec).toBe(5)
  })

  it("сцена без реплики остаётся на плановой длительности", () => {
    const plan = planFor(storyPlan([
      { order: 1, duration: "10s", voiceoverLine: null },
    ]))

    expect(plan.scenes[0]!.durationSec).toBe(10)
  })

  it("расхождение с планом попадает в warnings — оператор должен его видеть", () => {
    const plan = planFor(storyPlan([
      { order: 1, duration: "10s", voiceoverLine: words(4) },
    ]))

    expect(plan.warnings.some(w => w.includes("Сцена 1") && w.includes("реплик"))).toBe(true)
  })

  it("общая длительность ролика считается по тем же длительностям сцен", () => {
    const plan = planFor(storyPlan([
      { order: 1, duration: "10s", voiceoverLine: words(4) },
      { order: 2, duration: "10s", voiceoverLine: words(25) },
    ]))

    expect(plan.totalDurationSec).toBe(15)
  })
})
