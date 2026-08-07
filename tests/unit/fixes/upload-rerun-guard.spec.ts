/**
 * Регрессии на три дефекта автоповтора официальных публикаций:
 *
 *   1. Автоповтор заливал видео на YouTube второй раз. Адаптер youtube.ts делает
 *      resumable-init и один PUT всего файла, params.resume не читает вообще:
 *      если PUT долетел до Google, а ответ потерялся, ролик уже на канале, а у
 *      нас failed с пустым platformPostId. Планировщик через пять минут заливал
 *      дубль — до трёх штук, полностью автоматически.
 *   2. Ветка автоповтора голодала: записи с терминальной ошибкой отсеивались уже
 *      после выборки из БД и не менялись вообще, поэтому десяток «мёртвых»
 *      загрузок занимал всю пачку тика навсегда.
 *   3. Загрузка, залипшая в pending/uploading после смерти процесса, не
 *      поднималась ничем: тик её не выбирает, ручной retry отвечал 400.
 *
 * Сьюта чистая: ни БД, ни сети. prisma подменяется в globalThis до импорта.
 *
 * @vitest-environment node
 */
import { describe, it, expect, afterEach } from "vitest"
import { MAX_UPLOAD_ATTEMPTS } from "~~/server/utils/upload-retry-policy"
import {
  STUCK_UPLOAD_TIMEOUT_MS,
  checkUploadRerun,
  isResumableUploadPlatform,
  planFailedUploadAttemptPatch,
  planManualUploadRetry,
} from "~~/server/utils/upload-rerun-guard"

const NOW = new Date("2026-08-07T12:00:00.000Z")

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000)
}

// ══════════════ 1. Дубль поста на площадке без resume ══════════════

describe("isResumableUploadPlatform", () => {
  it("знает только площадки с идемпотентным продолжением", () => {
    expect(isResumableUploadPlatform("tiktok")).toBe(true)
    expect(isResumableUploadPlatform("instagram")).toBe(true)
    expect(isResumableUploadPlatform("YouTube")).toBe(false)
    expect(isResumableUploadPlatform("vk")).toBe(false)
    expect(isResumableUploadPlatform(null)).toBe(false)
  })
})

describe("checkUploadRerun", () => {
  it("запрещает автоповтор YouTube после состоявшейся попытки", () => {
    const decision = checkUploadRerun({ platform: "youtube", attemptCount: 1, trigger: "auto" })
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) {
      expect(decision.reason).toContain("youtube")
      expect(decision.reason).toContain("Проверьте канал")
    }
  })

  it("пропускает первый прогон YouTube — заливать дубль ещё нечему", () => {
    expect(checkUploadRerun({ platform: "youtube", attemptCount: 0, trigger: "auto" }))
      .toEqual({ allowed: true })
  })

  it("не мешает человеку: ручной retry разрешён на любой площадке", () => {
    expect(checkUploadRerun({ platform: "youtube", attemptCount: 2, trigger: "manual" }))
      .toEqual({ allowed: true })
  })

  it("разрешает автоповтор там, где адаптер продолжает публикацию", () => {
    expect(checkUploadRerun({ platform: "tiktok", attemptCount: 2, trigger: "auto" }))
      .toEqual({ allowed: true })
    expect(checkUploadRerun({ platform: "instagram", attemptCount: 1, trigger: "auto" }))
      .toEqual({ allowed: true })
  })

  it("незнакомую площадку считает опасной", () => {
    expect(checkUploadRerun({ platform: "vk", attemptCount: 1, trigger: "auto" }).allowed).toBe(false)
  })
})

// ══════════════ 2. Голодание ветки автоповтора ══════════════

describe("planFailedUploadAttemptPatch", () => {
  it("выводит терминальную ошибку из выборки планировщика через attemptCount", () => {
    // Планировщик берёт кандидатов запросом attemptCount < MAX, поэтому только
    // так запись перестаёт занимать место в пачке из десяти.
    expect(planFailedUploadAttemptPatch({
      permanent: true,
      attemptCounted: true,
      attemptCountAfterRun: 1,
    })).toEqual({ attemptCount: MAX_UPLOAD_ATTEMPTS })
  })

  it("не занижает счётчик, если ручных повторов было больше лимита", () => {
    expect(planFailedUploadAttemptPatch({
      permanent: true,
      attemptCounted: true,
      attemptCountAfterRun: 7,
    })).toEqual({ attemptCount: 7 })
  })

  it("транзиентный сбой после учтённой попытки счётчик не трогает", () => {
    expect(planFailedUploadAttemptPatch({
      permanent: false,
      attemptCounted: true,
      attemptCountAfterRun: 2,
    })).toEqual({})
  })

  it("транзиентный сбой до шага uploading досчитывает попытку сам", () => {
    expect(planFailedUploadAttemptPatch({
      permanent: false,
      attemptCounted: false,
      attemptCountAfterRun: 1,
    })).toEqual({ attemptCount: { increment: 1 } })
  })
})

// ══════════════ 3. Залипшие pending/uploading ══════════════

describe("planManualUploadRetry", () => {
  it("разрешает повтор для failed и blocked_by_env", () => {
    expect(planManualUploadRetry({ status: "failed", updatedAt: NOW }, NOW))
      .toEqual({ allowed: true, stuck: false })
    expect(planManualUploadRetry({ status: "blocked_by_env", updatedAt: NOW }, NOW))
      .toEqual({ allowed: true, stuck: false })
  })

  it("поднимает залипшую в pending загрузку (процесс умер до старта пайплайна)", () => {
    const decision = planManualUploadRetry(
      { status: "pending", updatedAt: minutesAgo(31) },
      NOW,
    )
    expect(decision).toEqual({ allowed: true, stuck: true })
  })

  it("поднимает залипшую в uploading загрузку", () => {
    expect(planManualUploadRetry({ status: "uploading", updatedAt: minutesAgo(120) }, NOW))
      .toEqual({ allowed: true, stuck: true })
  })

  it("не даёт перезапустить живой прогон", () => {
    const decision = planManualUploadRetry({ status: "uploading", updatedAt: minutesAgo(2) }, NOW)
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) expect(decision.message).toContain("выполняется")
  })

  it("отказывает на терминальных статусах", () => {
    const decision = planManualUploadRetry({ status: "published", updatedAt: minutesAgo(500) }, NOW)
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) expect(decision.message).toContain("published")
  })

  it("без updatedAt считает запись залипшей — иначе её не поднять никогда", () => {
    expect(planManualUploadRetry({ status: "pending", updatedAt: null }, NOW))
      .toEqual({ allowed: true, stuck: true })
  })
})

// ══════════════ watchdog: возврат залипших в очередь ══════════════

interface StuckRow {
  id: number
  status: string
  updatedAt: Date
}

const savedGlobals = new Map<string, unknown>()

function setGlobal(name: string, value: unknown): void {
  const holder = globalThis as unknown as Record<string, unknown>
  if (!savedGlobals.has(name)) savedGlobals.set(name, holder[name])
  holder[name] = value
}

afterEach(() => {
  const holder = globalThis as unknown as Record<string, unknown>
  for (const [name, value] of savedGlobals) holder[name] = value
  savedGlobals.clear()
})

/** Фейковый prisma.upload на массиве строк — ровно те методы, что нужны watchdog-у. */
function installUploadDb(rows: StuckRow[]) {
  setGlobal("prisma", {
    upload: {
      findMany: async (args: { where: Record<string, any>; take?: number }) => {
        const statuses: string[] = args.where.status?.in ?? []
        const before: Date | undefined = args.where.updatedAt?.lt
        const matched = rows.filter(row =>
          statuses.includes(row.status)
          && (!before || row.updatedAt.getTime() < before.getTime()))
        return matched.slice(0, args.take ?? matched.length).map(row => ({ ...row }))
      },
      updateMany: async (args: { where: Record<string, any>; data: Record<string, unknown> }) => {
        const row = rows.find(r => r.id === args.where.id)
        if (!row) return { count: 0 }
        if (args.where.status && row.status !== args.where.status) return { count: 0 }
        Object.assign(row, args.data)
        return { count: 1 }
      },
    },
    factoryPublication: { findFirst: async () => null, updateMany: async () => ({ count: 0 }) },
  })
  return rows
}

describe("releaseStuckUploads", () => {
  it("возвращает в failed только те pending/uploading, что стоят дольше таймаута", async () => {
    const rows = installUploadDb([
      { id: 1, status: "pending", updatedAt: new Date(NOW.getTime() - STUCK_UPLOAD_TIMEOUT_MS - 60_000) },
      { id: 2, status: "uploading", updatedAt: minutesAgo(120) },
      { id: 3, status: "pending", updatedAt: minutesAgo(1) },
      { id: 4, status: "published", updatedAt: minutesAgo(500) },
    ])

    const { releaseStuckUploads } = await import("~~/server/utils/upload-stuck-watchdog")
    const released = await releaseStuckUploads(NOW)

    expect(released).toBe(2)
    expect(rows.find(r => r.id === 1)!.status).toBe("failed")
    expect(rows.find(r => r.id === 2)!.status).toBe("failed")
    // Живой прогон и уже опубликованное не трогаем.
    expect(rows.find(r => r.id === 3)!.status).toBe("pending")
    expect(rows.find(r => r.id === 4)!.status).toBe("published")
  })

  it("оставляет ошибку, которую политика автоповтора считает транзиентной", async () => {
    const rows = installUploadDb([
      { id: 1, status: "pending", updatedAt: minutesAgo(90) },
    ])

    const { releaseStuckUploads } = await import("~~/server/utils/upload-stuck-watchdog")
    await releaseStuckUploads(NOW)

    const { isPermanentUploadError } = await import("~~/server/utils/upload-retry-policy")
    const message = (rows[0] as unknown as { errorMessage: string }).errorMessage
    expect(message).toContain("прерван")
    // Иначе запись мгновенно улетела бы в permanent_error и осталась мёртвой.
    expect(isPermanentUploadError(message)).toBe(false)
  })
})
