import { describe, expect, it } from "vitest"

import { pickNearestBackground, planShotComposition, type ShotSources } from "~~/server/utils/video-tools/shot-compose"
import type { LipSyncedClipPath } from "~~/server/utils/video-tools/pip-compose"

// В тестах бренд создаётся кастом ОСОЗНАННО: продакшн-код так делать не имеет
// права (единственный минт — markLipSynced в lip-sync-runner.ts), но тест
// обязан уметь построить вход.
const PRESENTER = "/a/scene_1_lipsync_fit.mp4" as LipSyncedClipPath

const PROFILE = { pipPosition: "bottom_right" as const, pipSize: 0.28, pipEnabled: true }
const CANVAS = { canvasWidth: 1080, canvasHeight: 1920, fps: 30 }

function sources(over: Partial<ShotSources> = {}): ShotSources {
  return { presenterPath: PRESENTER, sceneStartSec: 4.0, backgroundPath: "/a/shot_3_bg.png", backgroundIsStill: true, ...over }
}

const shot = (over: Partial<{ order: number, startSec: number, endSec: number, pipEnabled: boolean, foreground: string }> = {}) => ({
  order: 3, startSec: 5.8, endSec: 7.6, pipEnabled: true, foreground: "presenter", ...over,
})

describe("композиция кадра", () => {
  it("ведущий без фона — полный экран, смещение считается ОТ НАЧАЛА СЦЕНЫ", () => {
    const plan = planShotComposition({ shot: shot({ pipEnabled: false }), sources: sources({ backgroundPath: null }), profile: PROFILE, ...CANVAS })
    expect(plan).toMatchObject({ kind: "presenter_full", presenterPath: PRESENTER })
    // 5.8 − 4.0 = 1.8, притянуто к кадру.
    expect((plan as { offsetSec: number }).offsetSec).toBeCloseTo(1.8, 6)
    expect((plan as { durationSec: number }).durationSec).toBeCloseTo(1.8, 6)
  })

  it("фон без ведущего — полный экран фона", () => {
    const plan = planShotComposition({ shot: shot({ foreground: "none" }), sources: sources({ presenterPath: null }), profile: PROFILE, ...CANVAS })
    expect(plan).toMatchObject({ kind: "background_full", backgroundPath: "/a/shot_3_bg.png", backgroundIsStill: true })
  })

  it("ведущий поверх фона при включённом PiP — ветка pip и готовые фильтры наложения", () => {
    const plan = planShotComposition({ shot: shot(), sources: sources(), profile: PROFILE, ...CANVAS })
    expect(plan!.kind).toBe("pip")
    const filters = (plan as { pipFilters: string[] }).pipFilters
    // Фон — [0:v], ведущий — [1:v]: обратный порядок прячет PiP под фоном.
    expect(filters.some(f => f.startsWith("[1:v]"))).toBe(true)
    expect(filters.at(-1)).toContain("[0:v][pip]overlay=")
    expect(filters.at(-1)).toContain("[vout]")
  })

  it("PiP несёт СВОИ backgroundIsStill/presenterOffsetSec из sources — оба поля не захардкожены (ре-ревью Task 5, фикс-раунд 1)", () => {
    // backgroundIsStill: false — отличается от дефолта sources() (true), иначе
    // мутация "захардкожено true" осталась бы незамеченной: значение совпало
    // бы со входом случайно, а не потому что поле реально прокинуто.
    const plan = planShotComposition({
      shot: shot(), sources: sources({ backgroundIsStill: false }), profile: PROFILE, ...CANVAS,
    })
    expect(plan!.kind).toBe("pip")
    expect((plan as { backgroundIsStill: boolean }).backgroundIsStill).toBe(false)
    // 5.8 − 4.0 = 1.8 — то же смещение, что и в тесте "полный экран,
    // смещение от начала сцены"; ненулевое, поэтому мутация "захардкожено 0"
    // отличима от правильного значения.
    expect((plan as { presenterOffsetSec: number }).presenterOffsetSec).toBeCloseTo(1.8, 6)
  })

  it("PiP выключен на КАДРЕ — ведущий занимает весь экран, фон отбрасывается", () => {
    const plan = planShotComposition({ shot: shot({ pipEnabled: false }), sources: sources(), profile: PROFILE, ...CANVAS })
    expect(plan!.kind).toBe("presenter_full")
  })

  it("PiP выключен в ПРОФИЛЕ — тот же исход, даже если кадр просит", () => {
    const plan = planShotComposition({ shot: shot({ pipEnabled: true }), sources: sources(), profile: { ...PROFILE, pipEnabled: false }, ...CANVAS })
    expect(plan!.kind).toBe("presenter_full")
  })

  it("presenter-кадр без своей сцены не берёт чужой клип — фон на весь экран", () => {
    // Модель может вернуть foreground: "presenter" при sceneOrder: null, и
    // валидация плана такого правила не имеет (ре-ревью фикс-раунда 24.08).
    // Клипа ведущего у такого кадра нет физически: он привязан к сцене.
    const plan = planShotComposition({
      shot: shot({ foreground: "presenter" }),
      sources: sources({ presenterPath: null }),
      profile: PROFILE, ...CANVAS,
    })
    expect(plan!.kind).toBe("background_full")
  })

  it("ни ведущего, ни фона — null: такой кадр не существует и обязан быть слит", () => {
    const plan = planShotComposition({
      shot: shot({ foreground: "none" }),
      sources: sources({ presenterPath: null, backgroundPath: null }),
      profile: PROFILE, ...CANVAS,
    })
    expect(plan).toBeNull()
  })

  it("альбомный холст не ломает геометрию окна PiP", () => {
    const plan = planShotComposition({
      shot: shot(), sources: sources(), profile: { ...PROFILE, pipSize: 0.5 },
      canvasWidth: 1920, canvasHeight: 1080, fps: 30,
    })
    const overlay = (plan as { pipFilters: string[] }).pipFilters.at(-1)!
    const [, x, y] = overlay.match(/overlay=(\d+):(\d+)/)!
    expect(Number(x)).toBeGreaterThanOrEqual(0)
    expect(Number(y)).toBeGreaterThanOrEqual(0)
  })

  it("без явной группы кадр остаётся сам себе траекторией — соседи различаются", () => {
    const a = planShotComposition({ shot: shot({ order: 3, foreground: "none" }), sources: sources({ presenterPath: null }), profile: PROFILE, ...CANVAS })
    const b = planShotComposition({ shot: shot({ order: 4, foreground: "none" }), sources: sources({ presenterPath: null }), profile: PROFILE, ...CANVAS })
    expect((a as { variation: { index: number } }).variation.index)
      .not.toBe((b as { variation: { index: number } }).variation.index)
    expect((a as { variation: { offsetSec: number } }).variation.offsetSec).toBe(0)
    expect((a as { variation: { spanSec: number } }).variation.spanSec)
      .toBeCloseTo((a as { durationSec: number }).durationSec, 6)
  })

  it("группа фона доезжает до композиции — и в полноэкранный фон, и в PiP", () => {
    // Кусок группы обязан донести своё смещение и длину группы до ffmpeg:
    // без этого движение перезапускается на каждом кадре (дефект ролика 30).
    const variation = { index: 2, offsetSec: 1.8, spanSec: 5.4 }
    const full = planShotComposition({
      shot: shot({ foreground: "none" }), sources: sources({ presenterPath: null }),
      profile: PROFILE, variation, ...CANVAS,
    })
    expect((full as { variation: typeof variation }).variation).toEqual(variation)

    const pip = planShotComposition({ shot: shot(), sources: sources(), profile: PROFILE, variation, ...CANVAS })
    expect(pip!.kind).toBe("pip")
    expect((pip as { variation: typeof variation }).variation).toEqual(variation)
  })

  it("границы кадра притянуты к сетке кадров — иначе конкат уводит таймлайн", () => {
    const plan = planShotComposition({
      shot: shot({ startSec: 5.7777, endSec: 7.6111, pipEnabled: false }),
      sources: sources({ backgroundPath: null }), profile: PROFILE, ...CANVAS,
    })
    const duration = (plan as { durationSec: number }).durationSec
    expect(Math.abs(duration * 30 - Math.round(duration * 30))).toBeLessThan(1e-6)
  })

  it("отрицательное смещение невозможно: кадр начинается не раньше своей сцены", () => {
    const plan = planShotComposition({
      shot: shot({ startSec: 3.0, endSec: 4.5, pipEnabled: false }),
      sources: sources({ sceneStartSec: 4.0, backgroundPath: null }), profile: PROFILE, ...CANVAS,
    })
    expect((plan as { offsetSec: number }).offsetSec).toBeGreaterThanOrEqual(0)
  })
})

/**
 * Второй эшелон защиты от замороженного лица (дефект ролика 30).
 *
 * План монтажа уже не имеет права поставить ведущего дальше, чем достаёт клип
 * его сцены (`presenter_scene_too_long`, `edit-plan/validate.ts`). Но клип
 * приходит от провайдера, и его фактическая длина — не то, что заказали:
 * у сцены 9 заказали 10.00с, `kwaivgi/kling-lip-sync` вернул 9.90с. Разницу
 * добивает удержание последнего кадра, и если кадру достался именно
 * удержанный хвост, показывать надо ФОН, а не застывшее лицо.
 */
describe("композиция не морозит лицо: клип короче своего отрезка", () => {
  // Сцена 9 ролика 30: начало 79.57, клип живой 9.90с.
  const LIVE_SEC = 9.9
  const sceneSources = (over: Partial<ShotSources> = {}): ShotSources => ({
    presenterPath: PRESENTER,
    sceneStartSec: 79.57,
    backgroundPath: "/a/shot_7_bg.png",
    backgroundIsStill: true,
    presenterLiveSec: LIVE_SEC,
    ...over,
  })
  const sceneShot = (startSec: number, endSec: number, pipEnabled = false) =>
    ({ order: 7, startSec, endSec, pipEnabled, foreground: "presenter" })

  it("кадр целиком внутри живой части — ведущий как обычно", () => {
    // 87.67-89.29 -> смещение 8.10, конец 9.72 при живых 9.90.
    const plan = planShotComposition({
      shot: sceneShot(87.67, 89.29), sources: sceneSources(), profile: PROFILE, ...CANVAS,
    })
    expect(plan!.kind).toBe("presenter_full")
  })

  it("кадр уезжает в удержанный хвост — на экране фон, а не застывшее лицо", () => {
    // 89.29-90.93 -> смещение 9.72, конец 11.36 при живых 9.90: почти весь
    // кадр пришёлся бы на замороженный кадр.
    const plan = planShotComposition({
      shot: sceneShot(89.29, 90.93), sources: sceneSources(), profile: PROFILE, ...CANVAS,
    })
    expect(plan!.kind).toBe("background_full")
    expect((plan as { backgroundPath: string }).backgroundPath).toBe("/a/shot_7_bg.png")
  })

  it("PiP с замёрзшим ведущим тоже схлопывается в фон — окно PiP замерзать не должно", () => {
    const plan = planShotComposition({
      shot: sceneShot(89.29, 90.93, true), sources: sceneSources(), profile: PROFILE, ...CANVAS,
    })
    expect(plan!.kind).toBe("background_full")
  })

  it("недобор в доли кадра ведущего не отменяет — иначе квантование модели стирало бы целые кадры", () => {
    // Заказали 10.00с, модель вернула 9.90с: кадр 88.0-89.6 (конец 10.03)
    // выходит за живое всего на 0.13с. Отменять из-за этого весь кадр значило
    // бы терять полторы секунды лица на каждом ролике.
    const plan = planShotComposition({
      shot: sceneShot(88.0, 89.6), sources: sceneSources(), profile: PROFILE, ...CANVAS,
    })
    expect(plan!.kind).toBe("presenter_full")
  })

  it("живая длина неизвестна — поведение прежнее, ведущий на месте", () => {
    const plan = planShotComposition({
      shot: sceneShot(89.29, 90.93), sources: sceneSources({ presenterLiveSec: null }), profile: PROFILE, ...CANVAS,
    })
    expect(plan!.kind).toBe("presenter_full")
  })

  it("фона нет вовсе — замёрзший ведущий остаётся последним средством, а не чёрный экран", () => {
    const plan = planShotComposition({
      shot: sceneShot(89.29, 90.93), sources: sceneSources({ backgroundPath: null }), profile: PROFILE, ...CANVAS,
    })
    expect(plan!.kind).toBe("presenter_full")
  })
})

describe("ближайший доступный фон", () => {
  it("берётся ближайший по номеру кадра, при равенстве — предыдущий", () => {
    const available = new Map([[2, "/a/shot_2_bg.png"], [6, "/a/shot_6_bg.png"]])
    expect(pickNearestBackground(4, available)).toBe("/a/shot_2_bg.png")
    expect(pickNearestBackground(5, available)).toBe("/a/shot_6_bg.png")
    expect(pickNearestBackground(2, available)).toBe("/a/shot_2_bg.png")
  })

  it("фонов нет вовсе — null, решение принимает вызывающий", () => {
    expect(pickNearestBackground(4, new Map())).toBeNull()
  })
})
