import { describe, expect, it } from "vitest"

import { DEFAULT_EDIT_PROFILE, resolveEditProfile } from "~~/server/utils/edit-plan/profile"

describe("разрешение монтажного профиля", () => {
  it("без профиля и переопределений отдаёт дефолты", () => {
    const resolved = resolveEditProfile(null, null)

    expect(resolved.brollRatio).toBeCloseTo(0.4, 6)
    expect(resolved.shotChangeSec).toBeCloseTo(1.8, 6)
    expect(resolved.generativeVideoEnabled).toBe(false)
    expect(resolved).toEqual(DEFAULT_EDIT_PROFILE)
  })

  it("профиль перекрывает дефолты", () => {
    const resolved = resolveEditProfile({ brollRatio: 0.6, pipEnabled: true }, null)

    expect(resolved.brollRatio).toBeCloseTo(0.6, 6)
    expect(resolved.pipEnabled).toBe(true)
    expect(resolved.shotChangeSec).toBeCloseTo(1.8, 6)
  })

  it("переопределение ролика главнее профиля", () => {
    const resolved = resolveEditProfile({ pipEnabled: true, brollRatio: 0.6 }, { pipEnabled: false })

    expect(resolved.pipEnabled).toBe(false)
    expect(resolved.brollRatio).toBeCloseTo(0.6, 6)
  })

  it("мусор в переопределениях игнорируется, а не роняет монтаж", () => {
    // editOverrides — Json из БД, туда может приехать что угодно.
    const resolved = resolveEditProfile(null, { brollRatio: "много", pipSize: null, чужое: 1 })

    expect(resolved.brollRatio).toBeCloseTo(0.4, 6)
    expect(resolved.pipSize).toBeCloseTo(DEFAULT_EDIT_PROFILE.pipSize, 6)
  })

  it("зажимает доли в осмысленный диапазон", () => {
    // Доля перебивок 2.0 и PiP на весь кадр — это не «смелая настройка», а
    // сломанный ролик.
    const resolved = resolveEditProfile({ brollRatio: 2, pipSize: 5 }, null)

    expect(resolved.brollRatio).toBeLessThanOrEqual(1)
    expect(resolved.brollRatio).toBeGreaterThanOrEqual(0)
    expect(resolved.pipSize).toBeLessThanOrEqual(0.5)
  })

  it("не даёт шагу смены картинки уехать в ноль", () => {
    // shotChangeSec = 0 дал бы бесконечное число кадров при нарезке.
    expect(resolveEditProfile({ shotChangeSec: 0 }, null).shotChangeSec).toBeGreaterThan(0)
    expect(resolveEditProfile({ shotChangeSec: -3 }, null).shotChangeSec).toBeGreaterThan(0)
  })

  it("неизвестный угол PiP заменяется дефолтным", () => {
    expect(resolveEditProfile({ pipPosition: "середина" as never }, null).pipPosition)
      .toBe(DEFAULT_EDIT_PROFILE.pipPosition)
  })
})
