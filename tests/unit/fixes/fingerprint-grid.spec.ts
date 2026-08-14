/**
 * Отпечаток по сетке кадров.
 *
 * Три опорных кадра (начало, середина, конец) ловят повтор структуры, но
 * платформы работают иначе: TikTok сэмплирует кадры с интервалом порядка 1-2
 * секунд и считает перцептивный хеш каждого, а отпечатком ролика служит
 * последовательность этих хешей. Ролик, у которого совпали три опорные точки,
 * но разошлась вся середина, для нас дубль, а для платформы — нет; и наоборот.
 *
 * Сетка добавляется рядом с опорными кадрами, а не вместо них: старые записи
 * истории сеткой не обладают и обязаны продолжать сравниваться.
 */

import { describe, expect, it } from "vitest"
import {
  DEFAULT_FINGERPRINT_GRID_STEP_SEC,
  FINGERPRINT_GRID_DUPLICATE_RATIO,
  compareFingerprintGrids,
  pickFingerprintGridTimestamps,
} from "../../../server/utils/quality/video-fingerprint"

const A = "ffff0000ffff0000"
const B = "0000ffff0000ffff"
const C = "ff00ff00ff00ff00"

describe("pickFingerprintGridTimestamps", () => {
  it("режет ролик с шагом сетки, а не тремя точками", () => {
    const points = pickFingerprintGridTimestamps(9, 2)
    expect(points).toEqual([0.5, 2.5, 4.5, 6.5, 8.5])
  })

  it("отступ от краёв сохраняется: чёрный кадр совпадёт у всех роликов", () => {
    const points = pickFingerprintGridTimestamps(80, DEFAULT_FINGERPRINT_GRID_STEP_SEC)
    expect(points[0]).toBeGreaterThan(0)
    expect(points[points.length - 1]!).toBeLessThan(80)
  })

  it("короткий ролик всё равно даёт хотя бы одну точку", () => {
    expect(pickFingerprintGridTimestamps(1.2, 2).length).toBeGreaterThan(0)
  })

  it("некорректная длительность — пустой список, а не выдуманные точки", () => {
    expect(pickFingerprintGridTimestamps(0, 2)).toEqual([])
    expect(pickFingerprintGridTimestamps(Number.NaN, 2)).toEqual([])
  })

  it("длинный ролик не разносит сетку до бесконечности", () => {
    // Каждый кадр — это работа ffmpeg и байты в Json чека. Потолок обязан быть.
    expect(pickFingerprintGridTimestamps(3600, 2).length).toBeLessThanOrEqual(120)
  })
})

describe("compareFingerprintGrids", () => {
  it("одинаковые последовательности — дубль", () => {
    const grid = [A, B, C, A, B, C]
    const result = compareFingerprintGrids(grid, grid)
    expect(result.comparedFrames).toBe(6)
    expect(result.matchedFrames).toBe(6)
    expect(result.isDuplicate).toBe(true)
  })

  it("разные последовательности дублем не считаются", () => {
    expect(compareFingerprintGrids([A, A, A, A, A, A], [B, B, B, B, B, B]).isDuplicate).toBe(false)
  })

  it("на короткой сетке доля ничего не значит — вердикта нет", () => {
    // Три кадра из трёх это «сто процентов» и на паре одинаковых заставок.
    // Требовать долю можно только там, где сравнимых кадров достаточно.
    const grid = [A, B, C]
    expect(compareFingerprintGrids(grid, grid).isDuplicate).toBe(false)
    expect(compareFingerprintGrids(grid, grid).ratio).toBe(1)
  })

  it("совпадение ниже порога доли — не дубль", () => {
    // Общая заставка и общая посадка ведущего дают пару совпадений на роликах,
    // которые по содержанию разные. Блокировать по ним всю партию нельзя.
    const result = compareFingerprintGrids([A, B, B, B, B], [A, C, C, C, C])
    expect(result.matchedFrames).toBe(1)
    expect(result.isDuplicate).toBe(false)
  })

  it("сравнение идёт по общему префиксу: ролики разной длины сопоставимы", () => {
    const result = compareFingerprintGrids([A, B, C], [A, B])
    expect(result.comparedFrames).toBe(2)
    expect(result.matchedFrames).toBe(2)
  })

  it("пустая сетка у любой стороны — сравнивать нечего", () => {
    // Старые записи истории сетки не имеют. Это «не проверено», а не «уникально»:
    // решение принимает гейт, который видит comparedFrames = 0.
    expect(compareFingerprintGrids([], [A, B]).comparedFrames).toBe(0)
    expect(compareFingerprintGrids([A, B], []).isDuplicate).toBe(false)
  })

  it("негодный хеш в сетке пропускается, а не роняет сравнение", () => {
    const result = compareFingerprintGrids([A, "мусор", C], [A, B, C])
    expect(result.comparedFrames).toBe(2)
    expect(result.matchedFrames).toBe(2)
  })

  it("порог доли вынесен в константу и лежит между половиной и единицей", () => {
    expect(FINGERPRINT_GRID_DUPLICATE_RATIO).toBeGreaterThan(0.5)
    expect(FINGERPRINT_GRID_DUPLICATE_RATIO).toBeLessThanOrEqual(1)
  })
})
