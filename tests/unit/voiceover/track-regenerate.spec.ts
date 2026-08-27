/**
 * Полная перегенерация трека — самая дорогая кнопка озвучки.
 *
 * Она пересинтезирует ВЕСЬ трек, а вместе с ним меняет отпечаток
 * (`trackFingerprint`), по которому считаются ключи кусков: обесцениваются все
 * аватарные кадры ролика. Правка одной фразы стоит ~$0.08, эта кнопка — ~$14
 * на ролике из двадцати сцен. Отсюда три требования, и все три проверяются
 * здесь, до единого платного вызова:
 *
 *  - молчаливого пути к ней нет: без `confirmExpensive` ручка отказывает и
 *    показывает, сколько кадров придётся пересобрать и во что это обойдётся;
 *  - повторный заход не платит второй раз: трек, уже соответствующий текущему
 *    сценарию и голосу, не пересинтезируется;
 *  - второй клик, пока прогон ещё идёт, не сбрасывает шаг заново.
 *
 * Функция чистая: ни БД, ни Nitro — вход целиком приходит аргументом.
 */

import { describe, expect, it } from "vitest"

import { planTrackRegeneration } from "~~/server/utils/voiceover/track-regenerate"

const STORY_PLAN = {
  version: "1.0",
  scenes: [
    { order: 1, spokenLine: "Первая реплика." },
    { order: 2, spokenLine: "Вторая реплика." },
    { order: 3, spokenLine: null },
  ],
  voiceoverPlan: {
    enabled: true,
    lines: [{ sceneOrder: 3, text: "Закадровая строка." }],
  },
}

/** Снапшот шага озвучки — трек, синтезированный ровно из STORY_PLAN. */
const SNAPSHOT_IN_SYNC = {
  route: "audio_first",
  trackPath: "/assets/44/voiceover_track.mp3",
  durationSec: 20,
  trackFingerprint: "fp-track-v1",
  storageKey: "zavodcamp/videos/44/voiceover_mix.mp3",
  scenes: [
    { order: 1, text: "Первая реплика." },
    { order: 2, text: "Вторая реплика." },
    { order: 3, text: "Закадровая строка." },
  ],
  modelId: "minimax/speech-02-turbo",
  voiceId: "voice-1",
}

const VIDEO = {
  status: "completed",
  isLocked: false,
  voiceoverEnabled: true,
  voiceoverVoiceId: "voice-1",
  voiceoverModelId: "minimax/speech-02-turbo",
}

/** Цены — те же единицы, что у `ModelMeta.pricing` (video-models.ts). */
const PRICING = { ttsUnit: "character", ttsBase: 0.00005, lipSyncUsdPerSecond: 0.07 }

function input(overrides: Record<string, unknown> = {}) {
  return {
    id: 44,
    body: { confirmExpensive: true },
    video: { ...VIDEO },
    voiceoverStep: { status: "completed", snapshot: { ...SNAPSHOT_IN_SYNC } },
    // Оператор уже поправил одну фразу — сценарий разошёлся с треком.
    storyPlan: {
      ...STORY_PLAN,
      scenes: STORY_PLAN.scenes.map(scene => (
        scene.order === 2 ? { ...scene, spokenLine: "Новая формулировка." } : scene
      )),
    },
    shotsToRebuild: 12,
    pricing: PRICING,
    ...overrides,
  }
}

describe("planTrackRegeneration", () => {
  it("без подтверждения отказывает и показывает цену вопроса", () => {
    // Операция обесценивает ВСЕ аватарные кадры ролика. Оператор обязан увидеть
    // это числом до нажатия, а не в счёте после.
    const plan = planTrackRegeneration(input({ body: {} }))

    expect(plan.kind).toBe("confirm")
    if (plan.kind !== "confirm") return
    expect(plan.statusCode).toBe(400)
    expect(plan.message).toMatch(/12/)
    expect(plan.message).toMatch(/\$/)
    expect(plan.preview.shotsToRebuild).toBe(12)
    expect(plan.preview.changedSceneOrders).toEqual([2])
    expect(plan.preview.estimatedCostUsd).toBeGreaterThan(0)
  })

  it("с подтверждением разрешает перегенерацию", () => {
    const plan = planTrackRegeneration(input())

    expect(plan.kind).toBe("run")
    if (plan.kind !== "run") return
    expect(plan.videoId).toBe(44)
    expect(plan.preview.characters).toBeGreaterThan(0)
  })

  it("трек, уже соответствующий сценарию, второй раз не оплачивается", () => {
    // Главная защита от двойной оплаты: сценарий и трек совпадают до символа —
    // синтезировать заново нечего, сколько ни жми.
    const plan = planTrackRegeneration(input({ storyPlan: STORY_PLAN }))

    expect(plan.kind).toBe("noop")
    if (plan.kind !== "noop") return
    expect(plan.reason).toMatch(/соответств/i)
    expect(plan.preview.changedSceneOrders).toEqual([])
  })

  it("второй клик, пока прогон идёт, не сбрасывает шаг заново", () => {
    // Шаг уже сброшен и синтезируется. Второй сброс снёс бы состояние живого
    // прогона, а второй запуск после его окончания оплатил бы синтез дважды.
    const plan = planTrackRegeneration(input({
      voiceoverStep: { status: "running", snapshot: null },
    }))

    expect(plan.kind).toBe("noop")
    if (plan.kind !== "noop") return
    expect(plan.reason).toMatch(/уже/i)
  })

  it("смена голоса — повод пересинтезировать даже при том же тексте", () => {
    // Клон голоса живёт в своей модели; трек, спетый прежним голосом, новой
    // настройке ролика не соответствует, хотя текст и не менялся.
    const plan = planTrackRegeneration(input({
      storyPlan: STORY_PLAN,
      video: { ...VIDEO, voiceoverVoiceId: "voice-2" },
    }))

    expect(plan.kind).toBe("run")
    if (plan.kind !== "run") return
    expect(plan.preview.voiceChanged).toBe(true)
  })

  it("принудительный пересинтез возможен, но только явным force", () => {
    // Оператор хочет чистый трек без стыка склейки. Это законно, но по
    // умолчанию так делать нельзя — иначе идемпотентность кнопки исчезает.
    const plan = planTrackRegeneration(input({
      storyPlan: STORY_PLAN,
      body: { confirmExpensive: true, force: true },
    }))

    expect(plan.kind).toBe("run")
  })

  it("force без подтверждения суммы не работает", () => {
    const plan = planTrackRegeneration(input({ storyPlan: STORY_PLAN, body: { force: true } }))

    expect(plan.kind).toBe("confirm")
  })

  it("заблокированный ролик отбивается 409", () => {
    const plan = planTrackRegeneration(input({ video: { ...VIDEO, isLocked: true } }))

    expect(plan).toMatchObject({ kind: "refuse", statusCode: 409 })
  })

  it("ролик в середине генерации отбивается 400", () => {
    const plan = planTrackRegeneration(input({ video: { ...VIDEO, status: "generating_clips" } }))

    expect(plan).toMatchObject({ kind: "refuse", statusCode: 400 })
  })

  it("ролик, ждущий решения оператора, перегенерировать можно", () => {
    // Тот же довод, что и у замены фразы: это остановленный ролик, прогона нет.
    const plan = planTrackRegeneration(input({ video: { ...VIDEO, status: "awaiting_operator" } }))

    expect(plan.kind).toBe("run")
  })

  it("ролик, который не собирали от звука, отбивается", () => {
    // Решение №2 хендоффа: маршрут начатого ролика не меняется задним числом.
    const plan = planTrackRegeneration(input({
      voiceoverStep: { status: "completed", snapshot: { route: "legacy" } },
    }))

    expect(plan).toMatchObject({ kind: "refuse", statusCode: 400 })
    if (plan.kind !== "refuse") return
    expect(plan.message).toMatch(/от звука/i)
  })

  it("несуществующий ролик — 404", () => {
    expect(planTrackRegeneration(input({ video: null }))).toMatchObject({ kind: "refuse", statusCode: 404 })
  })

  it("пустой сценарий не отправляется в синтез", () => {
    // `buildTrackRequest` на пустом тексте бросает. Отказ обязан быть внятным,
    // а не пятисоткой из недр сборщика.
    const plan = planTrackRegeneration(input({
      storyPlan: { scenes: [{ order: 1, spokenLine: null }], voiceoverPlan: { enabled: true, lines: [] } },
    }))

    expect(plan).toMatchObject({ kind: "refuse", statusCode: 400 })
  })

  it("выключенный нарратор не попадает в новый трек", () => {
    // Закадровые строки идут в трек только когда нарратор включён и планом, и
    // настройкой ролика (`runAudioFirstVoiceover`). Иначе сцена 3 исчезает — и
    // это тоже расхождение с треком, а не «ничего не изменилось».
    const plan = planTrackRegeneration(input({
      storyPlan: STORY_PLAN,
      video: { ...VIDEO, voiceoverEnabled: false },
    }))

    expect(plan.kind).toBe("run")
    if (plan.kind !== "run") return
    expect(plan.preview.changedSceneOrders).toEqual([3])
    expect(plan.preview.sceneCount).toBe(2)
  })

  it("смета считает и синтез, и повторный lip-sync", () => {
    const plan = planTrackRegeneration(input())

    expect(plan.kind).toBe("run")
    if (plan.kind !== "run") return
    // Символы всех сцен × цена символа + секунды трека × цена секунды губ.
    const expected = plan.preview.characters * PRICING.ttsBase
      + plan.preview.lipSyncSecondsToRepay * PRICING.lipSyncUsdPerSecond
    expect(plan.preview.estimatedCostUsd).toBeCloseTo(expected, 6)
    expect(plan.preview.lipSyncSecondsToRepay).toBe(20)
  })
})
