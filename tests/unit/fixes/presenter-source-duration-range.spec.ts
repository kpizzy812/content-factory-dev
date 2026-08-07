/**
 * Регрессия на reservePresenterSourceClip.
 *
 * Дефект L4: подбор шёл в два шага — сначала точное попадание ±0.35 с, а если
 * такого клипа нет, брался ЛЮБОЙ активный клип ведущего. Сцене на 6 с могли
 * отдать исходник на 1.5 или 14 с: kling-lip-sync такой либо отвергает, либо
 * режет, а стоимость при этом считалась по плановой длительности сцены и
 * хронометраж ролика уезжал от плановых 70-90 с.
 *
 * Теперь кандидаты жёстко ограничены диапазоном модели, а внутри диапазона
 * берётся ближайший по длительности (least-used остаётся вторичным критерием).
 *
 * DB-free: prisma подменён на таблицу в памяти, которая честно применяет
 * where/orderBy/take — тест проверяет поведение выборки, а не текст запроса.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { reservePresenterSourceClip } from "../../../server/utils/presenter-source-selector"

interface FakeClipRow {
  id: string
  characterId: string
  isActive: boolean
  durationSec: number
  usageCount: number
  lastUsedAt: Date | null
  createdAt: Date
  fileUrl: string
  name: string
  storageKey: string | null
}

interface FakeWhere {
  characterId?: string
  isActive?: boolean
  durationSec?: { gte?: number; lte?: number }
}

const h = vi.hoisted(() => ({ rows: [] as unknown[] }))

/** Минимальная реализация фильтра prisma — только то, что использует селектор. */
function matchesWhere(row: FakeClipRow, where: FakeWhere | undefined): boolean {
  if (!where) return true
  if (where.characterId !== undefined && row.characterId !== where.characterId) return false
  if (where.isActive !== undefined && row.isActive !== where.isActive) return false
  const range = where.durationSec
  if (range) {
    if (typeof range.gte === "number" && row.durationSec < range.gte) return false
    if (typeof range.lte === "number" && row.durationSec > range.lte) return false
  }
  return true
}

function compare(a: unknown, b: unknown): number {
  // null в prisma-сортировке asc идёт последним — для наших наборов этого достаточно.
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1
  if (b === null || b === undefined) return -1
  const left = a instanceof Date ? a.getTime() : Number(a)
  const right = b instanceof Date ? b.getTime() : Number(b)
  return left - right
}

function sortRows(rows: FakeClipRow[], orderBy: Array<Record<string, "asc" | "desc">> | undefined): FakeClipRow[] {
  if (!orderBy?.length) return rows
  return [...rows].sort((a, b) => {
    for (const clause of orderBy) {
      const [field, direction] = Object.entries(clause)[0] as [keyof FakeClipRow, "asc" | "desc"]
      const delta = compare(a[field], b[field])
      if (delta !== 0) return direction === "desc" ? -delta : delta
    }
    return 0
  })
}

vi.mock("../../../server/utils/prisma", () => {
  const table = {
    findMany: async (args: { where?: FakeWhere; orderBy?: Array<Record<string, "asc" | "desc">>; take?: number }) => {
      const filtered = (h.rows as FakeClipRow[]).filter(row => matchesWhere(row, args?.where))
      const sorted = sortRows(filtered, args?.orderBy)
      return typeof args?.take === "number" ? sorted.slice(0, args.take) : sorted
    },
    // findFirst нужен, чтобы СТАРАЯ реализация тоже работала против этой фейковой
    // таблицы — иначе тест «падает на старом» был бы ошибкой окружения, а не дефекта.
    findFirst: async (args: { where?: FakeWhere; orderBy?: Array<Record<string, "asc" | "desc">> }) => {
      const filtered = (h.rows as FakeClipRow[]).filter(row => matchesWhere(row, args?.where))
      return sortRows(filtered, args?.orderBy)[0] ?? null
    },
    update: async (args: { where: { id: string }; data: { usageCount?: { increment: number } } }) => {
      const row = (h.rows as FakeClipRow[]).find(r => r.id === args.where.id)!
      row.usageCount += args.data.usageCount?.increment ?? 0
      row.lastUsedAt = new Date()
      return row
    },
  }

  return {
    prisma: {
      presenterSourceClip: table,
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ presenterSourceClip: table }),
    },
  }
})

let sequence = 0

function clip(overrides: Partial<FakeClipRow> & { id: string; durationSec: number }): FakeClipRow {
  sequence++
  return {
    characterId: "char-1",
    isActive: true,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: new Date(2026, 0, sequence),
    fileUrl: `https://example.invalid/${overrides.id}.mp4`,
    name: `${overrides.id}.mp4`,
    storageKey: null,
    ...overrides,
  }
}

beforeEach(() => {
  sequence = 0
  h.rows = []
})

describe("reservePresenterSourceClip: диапазон длительности модели", () => {
  it("клип вне 2-10 с не резервируется, даже если он единственный", async () => {
    h.rows = [clip({ id: "too-long", durationSec: 14 })]

    const reserved = await reservePresenterSourceClip({
      characterId: "char-1",
      durationSec: 6,
      minDurationSec: 2,
      maxDurationSec: 10,
    })

    // Раньше fallback-ветка отдавала этот клип и сцена получала видео чужой длины.
    expect(reserved).toBeNull()
    expect((h.rows as FakeClipRow[])[0]!.usageCount).toBe(0)
  })

  it("слишком короткий клип тоже отсекается", async () => {
    h.rows = [clip({ id: "too-short", durationSec: 1.4 })]

    const reserved = await reservePresenterSourceClip({
      characterId: "char-1",
      durationSec: 5,
      minDurationSec: 2,
      maxDurationSec: 10,
    })

    expect(reserved).toBeNull()
  })

  it("из пула выбирается подходящий по длине, а не первый попавшийся least-used", async () => {
    // 6.5с не попадает в старое «точное» окно ±0.35, поэтому старая ветка
    // сваливалась в fallback и отдавала least-used клип на 15 секунд.
    h.rows = [
      clip({ id: "out-of-range", durationSec: 15, usageCount: 0 }),
      clip({ id: "in-range", durationSec: 6.5, usageCount: 3 }),
    ]

    const reserved = await reservePresenterSourceClip({
      characterId: "char-1",
      durationSec: 6,
      minDurationSec: 2,
      maxDurationSec: 10,
    })

    expect(reserved?.id).toBe("in-range")
  })

  it("внутри диапазона берётся ближайший по длительности", async () => {
    // Ни один кандидат не попадает в старое окно ±0.35 → старый код брал least-used "far".
    h.rows = [
      clip({ id: "far", durationSec: 9.5, usageCount: 0 }),
      clip({ id: "closest", durationSec: 6.8, usageCount: 1 }),
      clip({ id: "middle", durationSec: 8, usageCount: 2 }),
    ]

    const reserved = await reservePresenterSourceClip({
      characterId: "char-1",
      durationSec: 6,
      minDurationSec: 2,
      maxDurationSec: 10,
    })

    // Старая логика: точного попадания ±0.35 нет → fallback на least-used "far".
    expect(reserved?.id).toBe("closest")
  })

  it("при равной близости побеждает наименее использованный из диапазона", async () => {
    // out-of-range создан раньше и тоже с usageCount=0 — старый fallback брал именно его.
    h.rows = [
      clip({ id: "out-of-range", durationSec: 14, usageCount: 0 }),
      clip({ id: "used-more", durationSec: 7, usageCount: 5 }),
      clip({ id: "used-less", durationSec: 7, usageCount: 0 }),
    ]

    const reserved = await reservePresenterSourceClip({
      characterId: "char-1",
      durationSec: 6,
      minDurationSec: 2,
      maxDurationSec: 10,
    })

    expect(reserved?.id).toBe("used-less")
    expect(reserved?.usageCount).toBe(1)
  })

  it("чужой персонаж и выключенные клипы не спасают: подходящего активного нет", async () => {
    h.rows = [
      clip({ id: "other-character", characterId: "char-2", durationSec: 6 }),
      clip({ id: "inactive", isActive: false, durationSec: 6 }),
      // Единственный активный клип нужного персонажа — вне диапазона модели.
      clip({ id: "own-but-too-long", durationSec: 14 }),
    ]

    const reserved = await reservePresenterSourceClip({
      characterId: "char-1",
      durationSec: 6,
      minDurationSec: 2,
      maxDurationSec: 10,
    })

    expect(reserved).toBeNull()
  })

  it("без явных границ действует дефолт kling-lip-sync 2-10 с", async () => {
    h.rows = [clip({ id: "too-long", durationSec: 11 })]

    const reserved = await reservePresenterSourceClip({ characterId: "char-1", durationSec: 9 })

    expect(reserved).toBeNull()
  })

  it("сцена, которую модель не покрывает, исходника ведущего не получает", async () => {
    h.rows = [
      clip({ id: "short-edge", durationSec: 2.2, usageCount: 0 }),
      clip({ id: "long-edge", durationSec: 9.4, usageCount: 1 }),
    ]

    // ОБНОВЛЁННОЕ ОЖИДАНИЕ. Раньше тест закреплял «зажать цель в 10 с и взять
    // 9.4-секундный клип» — это и есть дефект: сцена на 30 с в сборке становилась
    // 9.4-секундной. Клип, укорачивающий сцену на 20 с, брать нельзя ни при каких
    // usageCount; правильный исход — остаться на сгенерированном клипе.
    const reserved = await reservePresenterSourceClip({
      characterId: "char-1",
      durationSec: 30,
      minDurationSec: 2,
      maxDurationSec: 10,
    })

    expect(reserved).toBeNull()
    expect((h.rows as FakeClipRow[]).every(row => row.usageCount === (row.id === "long-edge" ? 1 : 0))).toBe(true)
  })

  it("клип внутри диапазона модели, но чужой длины, не резервируется", async () => {
    // Ровно сценарий L5: у персонажа есть только короткие нарезки, сцена длинная.
    h.rows = [
      clip({ id: "too-short", durationSec: 2.5, usageCount: 0 }),
      clip({ id: "also-short", durationSec: 3, usageCount: 0 }),
    ]

    const reserved = await reservePresenterSourceClip({
      characterId: "char-1",
      durationSec: 9,
      minDurationSec: 2,
      maxDurationSec: 10,
    })

    expect(reserved).toBeNull()
  })

  it("клип нужной длины не вытесняется из пула ордой least-used коротышей", async () => {
    // CANDIDATE_POOL_SIZE=50: 60 трёхсекундных с usageCount=0 раньше забирали весь
    // take, и девятисекундный (usageCount=2) в память вообще не попадал.
    h.rows = [
      ...Array.from({ length: 60 }, (_, i) => clip({ id: `short-${i}`, durationSec: 3, usageCount: 0 })),
      clip({ id: "exact", durationSec: 9, usageCount: 2 }),
    ]

    const reserved = await reservePresenterSourceClip({
      characterId: "char-1",
      durationSec: 9,
      minDurationSec: 2,
      maxDurationSec: 10,
    })

    expect(reserved?.id).toBe("exact")
  })
})
