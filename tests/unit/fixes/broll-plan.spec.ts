/**
 * Раскладка сцен на говорящую голову и перебивки.
 *
 * Решение от 14.08.2026: перебивка — это картинка плюс движение камеры, а не
 * сгенерированный клип. Секунда перебивки стоит долю кадра flux ($0.025 за
 * штуку) вместо $0.045 за каждую секунду text-to-video, а движение делает
 * монтаж, который уже есть.
 *
 * Целевая доля перебивок — около 40% хронометража (практика короткого видео
 * 60/40). Раскладка обязана быть проверяемой без ffmpeg и без сети.
 */

import { describe, expect, it } from "vitest"
import {
  DEFAULT_BROLL_RATIO,
  planSceneKinds,
} from "../../../server/utils/broll-plan"

const scene = (order: number, durationSec: number, spokenLine: string | null) =>
  ({ order, durationSec, spokenLine })

describe("planSceneKinds", () => {
  it("сцена с репликой всегда остаётся говорящей головой", () => {
    // spokenLine означает, что человек говорит в кадре. Подменять его
    // перебивкой нельзя ни ради доли, ни ради экономии.
    const result = planSceneKinds({
      scenes: [scene(0, 9, "Привет"), scene(1, 9, null)],
    })
    expect(result.kinds[0]).toBe("presenter")
  })

  it("сцены без реплики становятся перебивками", () => {
    const result = planSceneKinds({
      scenes: [scene(0, 9, "Привет"), scene(1, 9, null)],
    })
    expect(result.kinds[1]).toBe("broll")
  })

  it("считает фактическую долю перебивок по хронометражу, а не по числу сцен", () => {
    // Три сцены по 5 секунд и одна на 45 — доля по счёту и по времени
    // расходится втрое. Зритель смотрит время, а не список.
    const result = planSceneKinds({
      scenes: [scene(0, 45, "длинная реплика"), scene(1, 5, null), scene(2, 5, null), scene(3, 5, null)],
    })
    expect(result.brollSeconds).toBe(15)
    expect(result.actualRatio).toBeCloseTo(0.25, 2)
  })

  it("перебор перебивок отмечается: ролик без ведущей — не тот продукт", () => {
    // Если реплик нет вовсе, весь ролик станет перебивками. Это не ошибка
    // раскладки, но планировщик обязан сказать об этом вслух.
    const result = planSceneKinds({
      scenes: [scene(0, 9, null), scene(1, 9, null)],
    })
    expect(result.actualRatio).toBe(1)
    expect(result.warning).toBeTruthy()
  })

  it("попадание в целевую долю предупреждения не даёт", () => {
    const result = planSceneKinds({
      scenes: [scene(0, 6, "раз"), scene(1, 6, "два"), scene(2, 8, null)],
    })
    expect(result.actualRatio).toBeCloseTo(0.4, 1)
    expect(result.warning).toBeNull()
  })

  it("целевая доля вынесена в константу и близка к сорока процентам", () => {
    expect(DEFAULT_BROLL_RATIO).toBeGreaterThan(0.3)
    expect(DEFAULT_BROLL_RATIO).toBeLessThan(0.5)
  })

  it("пустой список сцен не роняет раскладку", () => {
    const result = planSceneKinds({ scenes: [] })
    expect(result.kinds).toEqual([])
    expect(result.actualRatio).toBe(0)
  })

  it("картинки нужны ровно перебивкам — планировщик обязан их заказать", () => {
    // Сегодня генерация кадров пропускается ради экономии. С перебивками кадр
    // становится не промежуточным артефактом, а материалом сцены.
    const result = planSceneKinds({
      scenes: [scene(0, 9, "реплика"), scene(1, 9, null), scene(2, 9, null)],
    })
    expect(result.needsImages).toEqual([1, 2])
  })
})
