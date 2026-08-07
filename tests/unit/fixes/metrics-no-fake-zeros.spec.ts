/**
 * Регрессия: «нечем измерять» — это не измеренный ноль.
 *
 * Дефект: сборщик сам классифицировал два случая как «измерять нечем»
 * (публикация без FactoryPublication, то есть без трекинг-ссылки; меньше двух
 * снимков подписчиков), но по успешному пути писал в PostMetrics ноль. В
 * аналитике ролик с реальными переходами показывал CTR 0 %, и отличить «ноль
 * переходов» от «мы не смогли посчитать» было невозможно.
 *
 * Схему трогать нельзя (ctr/followerGain — NOT NULL default 0), пропуск поля в
 * create дал бы тот же ноль от дефолта, поэтому решение то же, что и для
 * упавшего запроса: переносим последнее измеренное значение и пишем причину в
 * лог и в отчёт сборщика.
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

/** Две различимые точки — прирост подписчиков измерим. */
const HISTORY = [
  snapshot("2026-08-06T09:00:00.000Z", 1_180),
  snapshot("2026-08-01T09:00:00.000Z", 1_000),
]

interface Harness {
  /** Есть ли у загрузки FactoryPublication (трекинг-ссылка). */
  tracked?: boolean
  clicks?: number
  /** Снимки по убыванию времени — сборщик читает их именно так. */
  snapshots?: Array<{ fetchedAt: Date; followers: number }>
  /** Последняя записанная строка PostMetrics. */
  previous?: { ctr: number; followerGain: number } | null
}

describe("collectMetrics: «нечем измерять» не превращается в ноль", () => {
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
    let clickQueries = 0

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
            factoryPublication: harness.tracked
              ? { id: "pub-1", publishedAt: new Date("2026-08-01T10:00:00.000Z") }
              : null,
          },
        ],
      },
      postMetrics: {
        create: async ({ data }: { data: Record<string, any> }) => {
          created.push(data)
          return data
        },
        findFirst: async () => harness.previous ?? null,
      },
      attributionEvent: {
        count: async () => {
          clickQueries++
          return harness.clicks ?? 0
        },
      },
      accountMetricsSnapshot: {
        findMany: async () => harness.snapshots ?? [],
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

    return { created, logs, clickQueries: () => clickQueries }
  }

  async function collect() {
    const { collectMetrics } = await import("~~/server/utils/metrics-collector")
    return collectMetrics()
  }

  it("публикация без трекинг-ссылки не обнуляет ctr", async () => {
    const spy = install({
      tracked: false,
      snapshots: HISTORY,
      previous: { ctr: 0.07, followerGain: 12 },
    })

    const result = await collect()

    // Старое поведение: переходы «посчитаны» как 0 → ctr 0 уезжал как измеренный.
    expect(spy.created[0]!.ctr).toBeCloseTo(0.07, 6)
    // Считать было нечего — в базу за переходами ходить незачем.
    expect(spy.clickQueries()).toBe(0)
    // Это не авария сбора: ручной пост не должен поднимать тревогу в errors.
    expect(result.errors).toHaveLength(0)
    expect(result.unmeasured).toEqual([
      {
        uploadId: 501,
        metric: "ctr",
        reason: "нет трекинг-ссылки: публикация не через фабрику",
        keptPrevious: true,
      },
    ])
    // Прирост подписчиков измерен — его прошлым значением подменять нельзя.
    expect(spy.created[0]!.followerGain).toBe(180)
  })

  it("меньше двух снимков подписчиков не обнуляет прирост", async () => {
    const spy = install({
      tracked: true,
      clicks: 30,
      snapshots: [snapshot("2026-08-06T09:00:00.000Z", 1_180)],
      previous: { ctr: 0.07, followerGain: 45 },
    })

    const result = await collect()

    // Старое поведение: shares пустой → followerGain 0 как измеренный.
    expect(spy.created[0]!.followerGain).toBe(45)
    expect(result.errors).toHaveLength(0)
    expect(result.unmeasured).toEqual([
      {
        uploadId: 501,
        metric: "followerGain",
        reason: "меньше двух снимков подписчиков",
        keptPrevious: true,
      },
    ])
    // Переходы посчитаны — доля остаётся долей (UI умножает её на сто).
    expect(spy.created[0]!.ctr).toBeCloseTo(0.03, 6)
    expect(spy.created[0]!.ctr).toBeLessThanOrEqual(1)
  })

  it("измеренный ноль остаётся нулём и не подменяется прошлым значением", async () => {
    const spy = install({
      tracked: true,
      clicks: 0,
      snapshots: HISTORY,
      previous: { ctr: 0.07, followerGain: 12 },
    })

    const result = await collect()

    // Переходов действительно ноль — это измерение, а не пробел в данных.
    expect(spy.created[0]!.ctr).toBe(0)
    expect(result.unmeasured).toHaveLength(0)
  })

  it("без прошлых измерений пишет ноль, но объявляет его непосчитанным", async () => {
    const spy = install({ tracked: false, previous: null })

    const result = await collect()

    // Записать «неизвестно» в схему нечем — защита только в отчёте и логе.
    expect(spy.created[0]!.ctr).toBe(0)
    expect(spy.created[0]!.followerGain).toBe(0)
    expect(result.unmeasured.map(item => ({ metric: item.metric, kept: item.keptPrevious }))).toEqual([
      { metric: "ctr", kept: false },
      { metric: "followerGain", kept: false },
    ])
  })

  it("причины «нечем измерять» попадают в агрегированный лог сборщика", async () => {
    const spy = install({ tracked: false, previous: { ctr: 0.07, followerGain: 12 } })

    await collect()

    const info = spy.logs.find(entry => entry.level === "info")
    expect(info).toBeDefined()
    expect(info!.meta.unmeasuredTotal).toBe(2)
    expect(info!.meta.unmeasured.map((item: any) => item.metric)).toEqual(["ctr", "followerGain"])
    expect(info!.meta.unmeasured[0]!.reason).toContain("трекинг-ссылк")
    // Упавшего запроса не было — уровень warn поднимать не за что.
    expect(spy.logs.some(entry => entry.level === "warn")).toBe(false)
  })
})
