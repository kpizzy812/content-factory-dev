import { describe, expect, it } from "vitest"

import { planShotComposition, type ShotSources } from "~~/server/utils/video-tools/shot-compose"
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

  it("движение неподвижного фона различается у соседних кадров", () => {
    const a = planShotComposition({ shot: shot({ order: 3, foreground: "none" }), sources: sources({ presenterPath: null }), profile: PROFILE, ...CANVAS })
    const b = planShotComposition({ shot: shot({ order: 4, foreground: "none" }), sources: sources({ presenterPath: null }), profile: PROFILE, ...CANVAS })
    expect((a as { variationIndex: number }).variationIndex)
      .not.toBe((b as { variationIndex: number }).variationIndex)
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
