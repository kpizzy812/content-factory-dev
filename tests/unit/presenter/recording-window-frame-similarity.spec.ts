/**
 * Task 6b (2026-08-17-presenter-recordings-and-speech-cut): чистая часть
 * перцептивного контроля похожести окна речи ведущего (spec §6.2) —
 * `findSimilarRecentFrame` сравнивает свежий хэш с историей БЕЗ БД и БЕЗ
 * ffmpeg. Оркестрация (снятие кадра, перерезервирование) живёт в соседнем
 * `recording-window-frame-guard.ts` (требует ffmpeg и БД, покрыта отдельно —
 * lip-sync-recording-window.spec.ts и presenter-recording.spec.ts).
 *
 * Модуль намеренно свой, а не общий с guard.ts (Minor 6 из ревью фикс-раунда
 * 1): guard.ts статически тянет `../prisma` и `./ffmpeg-adapter`, и этот
 * DB-free тест не должен затягивать обе зависимости только чтобы проверить
 * чистое сравнение строк.
 */

import { describe, expect, it } from "vitest"

import { findSimilarRecentFrame } from "~~/server/utils/presenter/recording-window-frame-similarity"

const BASE = "0000000000000000"
// 2 бита отличия от BASE — в пределах порога по умолчанию (6).
const NEAR = "0000000000000003"
// Все 64 бита отличаются — далеко за порогом.
const FAR = "ffffffffffffffff"
// Неверный формат: не hex-строка нужной длины.
const CORRUPT = "not-a-hash"

describe("findSimilarRecentFrame: чистое решение о похожести кадра", () => {
  it("нет истории — дубля нет", () => {
    expect(findSimilarRecentFrame(BASE, [])).toBeNull()
  })

  it("совпало — возвращает похожий хэш из истории", () => {
    expect(findSimilarRecentFrame(BASE, [FAR, NEAR])).toBe(NEAR)
  })

  it("не совпало — все хэши истории далеко за порогом", () => {
    expect(findSimilarRecentFrame(BASE, [FAR])).toBeNull()
  })

  it("битый хэш в истории не роняет сравнение остальных", () => {
    // Битый хэш идёт ПЕРВЫМ — если бы он ронял цикл целиком, до NEAR дело бы
    // не дошло.
    expect(findSimilarRecentFrame(BASE, [CORRUPT, NEAR])).toBe(NEAR)
  })

  it("битый хэш в истории без валидной похожей записи даёт «нет дубля», а не падение", () => {
    expect(findSimilarRecentFrame(BASE, [CORRUPT, FAR])).toBeNull()
  })

  it("уважает переданный порог: то, что похоже при 6, не похоже при 1", () => {
    expect(findSimilarRecentFrame(BASE, [NEAR], 6)).toBe(NEAR)
    expect(findSimilarRecentFrame(BASE, [NEAR], 1)).toBeNull()
  })
})
