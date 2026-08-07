/**
 * Регрессия на честность сборщика метрик.
 *
 * Дефекты, которые здесь закрыты:
 *  - ошибки подсчёта переходов и чтения снимков подписчиков глушились в 0/[]
 *    через `.catch(() => ...)`, и ноль уезжал в PostMetrics как ИЗМЕРЕННАЯ
 *    величина: транзиентный таймаут Postgres обнулял ctr у ролика с реальными
 *    переходами, при этом ни в errors, ни в логе об этом ничего не было;
 *  - «история подписчиков есть» считалось по числу строк из базы, а не по числу
 *    различимых точек: два одинаковых снимка давали необъявленный ноль прироста;
 *  - прирост подписчиков не считался, если аккаунт подключили к скраперу позже,
 *    чем вышли ролики (снимка ДО публикации нет) — типовой случай.
 *
 * @vitest-environment node
 */
import { afterEach, describe, expect, it } from "vitest"

import type { DecryptedAccount, MetricsContext, MetricsResult } from "~~/server/utils/social/types"

const globals = globalThis as unknown as Record<string, unknown>

const socialAccount = {
  id: 7,
  platform: "instagram",
  displayName: "Reforma IG",
  platformUserId: "ig-1",
  accessToken: "enc:token",
  refreshToken: null,
  expiresAt: null,
}

function snapshot(iso: string, followers: number) {
  return { fetchedAt: new Date(iso), followers }
}

interface Harness {
  /** Снимки по убыванию времени — сборщик читает их именно так. */
  snapshots?: Array<{ fetchedAt: Date; followers: number }>
  clicks?: number
  /** Подсчёт переходов падает — имитация таймаута базы. */
  clicksFail?: string
  /** Чтение снимков падает. */
  snapshotsFail?: string
  /** Последняя записанная строка PostMetrics (что было измерено в прошлый раз). */
  previous?: { ctr: number; followerGain: number } | null
}

describe("collectMetrics: не выдаёт «не смогли посчитать» за измеренный ноль", () => {
  const saved = {
    prisma: globals.prisma,
    decrypt: globals.decrypt,
    logAgent: globals.logAgent,
    getSocialAdapter: globals.getSocialAdapter,
  }

  afterEach(() => {
    Object.assign(globals, saved)
  })

  function install(harness: Harness = {}) {
    const created: Array<Record<string, any>> = []
    const logs: Array<{ level: string; message: string; meta: any }> = []
    let previousLookups = 0

    globals.prisma = {
      upload: {
        findMany: async () => [
          {
            id: 501,
            status: "published",
            platformPostId: "media-1",
            updatedAt: new Date("2026-08-01T10:00:00.000Z"),
            socialAccount,
            video: { duration: 30 },
            factoryPublication: { id: "pub-1", publishedAt: new Date("2026-08-01T10:00:00.000Z") },
          },
        ],
      },
      postMetrics: {
        create: async ({ data }: { data: Record<string, any> }) => {
          created.push(data)
          return data
        },
        findFirst: async () => {
          previousLookups++
          return harness.previous ?? null
        },
      },
      attributionEvent: {
        count: async () => {
          if (harness.clicksFail) throw new Error(harness.clicksFail)
          return harness.clicks ?? 0
        },
      },
      accountMetricsSnapshot: {
        findMany: async () => {
          if (harness.snapshotsFail) throw new Error(harness.snapshotsFail)
          return harness.snapshots ?? []
        },
      },
    }
    globals.decrypt = (value: string) => value.replace(/^enc:/, "")
    globals.logAgent = async (
      _agent: string,
      level: string,
      message: string,
      meta: unknown,
    ) => {
      logs.push({ level, message, meta })
    }
    globals.getSocialAdapter = () => ({
      uploadVideo: async () => ({ platformPostId: "", platformPostUrl: "" }),
      getPostMetrics: async (
        _account: DecryptedAccount,
        _postId: string,
        _context?: MetricsContext,
      ): Promise<MetricsResult> => ({
        views: 1_000,
        likes: 10,
        comments: 2,
        shares: 1,
        watchThrough: 0.4,
        ctr: 0,
        followerGain: 0,
      }),
    })

    return { created, logs, previousLookups: () => previousLookups }
  }

  async function collect() {
    const { collectMetrics } = await import("~~/server/utils/metrics-collector")
    return collectMetrics()
  }

  it("упавший подсчёт переходов не обнуляет ctr и попадает в errors", async () => {
    const spy = install({
      clicksFail: "canceling statement due to statement timeout",
      previous: { ctr: 0.07, followerGain: 12 },
    })

    const result = await collect()

    // Старое поведение: ctr = 0 «как измеренный», errors пустой.
    expect(spy.created[0]!.ctr).toBeCloseTo(0.07, 6)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.uploadId).toBe(501)
    expect(result.errors[0]!.error).toContain("statement timeout")
    // Сырые счётчики платформы измерены — выбрасывать их из-за упавшей
    // производной метрики незачем.
    expect(spy.created[0]).toMatchObject({ views: 1_000, likes: 10, watchThrough: 0.4 })
  })

  it("рассказывает о непосчитанных метриках в логе уровня warn", async () => {
    const spy = install({ clicksFail: "connection terminated" })

    await collect()

    const warn = spy.logs.find(entry => entry.level === "warn")
    expect(warn).toBeDefined()
    expect(warn!.message).toContain("не посчитан")
    expect(warn!.meta.notMeasured).toEqual([
      {
        uploadId: 501,
        reason: "переходы: connection terminated",
        keptPrevious: false,
      },
    ])
  })

  it("без прошлых измерений пишет ноль, но не молча", async () => {
    const spy = install({ clicksFail: "timeout", previous: null })

    const result = await collect()

    // Записать «неизвестно» в схему нечем (ctr NOT NULL default 0), поэтому
    // единственная защита — явная запись в errors.
    expect(spy.created[0]!.ctr).toBe(0)
    expect(result.errors).toHaveLength(1)
  })

  it("упавшее чтение снимков не обнуляет прирост подписчиков", async () => {
    const spy = install({
      snapshotsFail: "deadlock detected",
      previous: { ctr: 0.02, followerGain: 45 },
    })

    const result = await collect()

    expect(spy.created[0]!.followerGain).toBe(45)
    expect(result.errors[0]!.error).toContain("прирост подписчиков")
    // Переходы посчитались — их значение подменять прошлым нельзя.
    expect(spy.created[0]!.ctr).toBe(0)
  })

  it("на успешном сборе за прошлыми значениями в базу не ходит", async () => {
    const spy = install({
      clicks: 50,
      snapshots: [
        snapshot("2026-08-06T09:00:00.000Z", 1_180),
        snapshot("2026-08-01T09:00:00.000Z", 1_000),
      ],
    })

    const result = await collect()

    expect(result.errors).toHaveLength(0)
    expect(spy.previousLookups()).toBe(0)
    // Доли остаются долями: UI умножает их на сто (AnalyticsFormat.ts).
    expect(spy.created[0]!.ctr).toBeCloseTo(0.05, 6)
    expect(spy.created[0]!.ctr).toBeLessThanOrEqual(1)
    expect(spy.created[0]!.watchThrough).toBeLessThanOrEqual(1)
    expect(spy.created[0]!.followerGain).toBe(180)
  })

  it("считает прирост, когда скрапер подключили позже выхода ролика", async () => {
    // Снимка ДО публикации нет — типовой случай «аккаунт подключили потом».
    const spy = install({
      snapshots: [
        snapshot("2026-08-11T09:00:00.000Z", 1_090),
        snapshot("2026-08-10T09:00:00.000Z", 1_000),
      ],
    })

    await collect()

    expect(spy.created[0]!.followerGain).toBe(90)
    // История есть — в «не измерено» такой аккаунт записывать нельзя.
    const info = spy.logs.find(entry => entry.level === "info")
    expect(info?.meta.withoutFollowerHistory ?? 0).toBe(0)
  })

  it("два одинаковых снимка — это одна точка, а не история", async () => {
    const duplicate = snapshot("2026-08-06T09:00:00.000Z", 1_180)
    const spy = install({ snapshots: [duplicate, { ...duplicate }] })

    await collect()

    expect(spy.created[0]!.followerGain).toBe(0)
    // Старое поведение: строк две → «история есть» → ноль уходил как измеренный.
    const info = spy.logs.find(entry => entry.level === "info")
    expect(info?.meta.withoutFollowerHistory).toBe(1)
  })
})
