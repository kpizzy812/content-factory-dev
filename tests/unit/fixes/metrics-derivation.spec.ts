/**
 * Регрессия на производные метрики поста.
 *
 * Дефекты, которые здесь закрыты:
 *  - watchThrough всегда был нулём: адаптеры не знали длительности ролика и не
 *    считали долю досмотра из среднего времени просмотра;
 *  - ctr и followerGain сборщик писал такими, какими их вернул адаптер, — то есть
 *    всегда нулями, хотя переходы и снимки подписчиков лежат в базе;
 *  - ноль «не измерено» был неотличим от нуля «измерено и получился ноль»;
 *  - прирост подписчиков всего аккаунта писался в каждую его публикацию, и
 *    дашборд, суммирующий это поле, множил его на число роликов.
 *
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from "vitest"

import { createInstagramAdapter } from "~~/server/utils/social/instagram"
import type { InstagramApiClient } from "~~/server/utils/social/instagram-api"
import { distributeFollowerGain } from "~~/server/utils/social/follower-attribution"
import { computeCtr, computeWatchThrough } from "~~/server/utils/social/metrics-context"
import type {
  DecryptedAccount,
  MetricsContext,
  MetricsResult,
} from "~~/server/utils/social/types"

const globals = globalThis as unknown as Record<string, unknown>

function account(): DecryptedAccount {
  return {
    id: 7,
    platform: "instagram",
    displayName: "Reforma IG",
    platformUserId: "17841400000000000",
    accessToken: "token",
    refreshToken: null,
    expiresAt: new Date(Date.now() + 86_400_000),
  }
}

describe("computeWatchThrough", () => {
  it("делит среднее время просмотра на длительность ролика", () => {
    expect(computeWatchThrough(15_000, 30)).toBeCloseTo(0.5, 6)
    expect(computeWatchThrough(12_000, 30)).toBeCloseTo(0.4, 6)
    expect(computeWatchThrough(30_000, 30)).toBeCloseTo(1, 6)
  })

  it("зажимает результат в 0…1: повторный просмотр не даёт 240 %", () => {
    expect(computeWatchThrough(72_000, 30)).toBe(1)
    expect(computeWatchThrough(1_000_000, 15)).toBe(1)
  })

  it("возвращает ноль, когда делить не на что", () => {
    expect(computeWatchThrough(15_000, null)).toBe(0)
    expect(computeWatchThrough(15_000, 0)).toBe(0)
    expect(computeWatchThrough(null, 30)).toBe(0)
    expect(computeWatchThrough(undefined, undefined)).toBe(0)
    expect(computeWatchThrough(-5_000, 30)).toBe(0)
    expect(computeWatchThrough(Number.NaN, 30)).toBe(0)
  })
})

describe("Instagram: доля досмотра", () => {
  function client(insights: Record<string, number>): InstagramApiClient {
    return {
      getPublishingLimit: vi.fn(),
      createReelContainer: vi.fn(),
      getContainerStatus: vi.fn(),
      publishContainer: vi.fn(),
      getMedia: vi.fn().mockResolvedValue({
        id: "media-1",
        permalink: "https://www.instagram.com/reel/example/",
        likeCount: 5,
        commentsCount: 1,
      }),
      getMediaInsights: vi.fn().mockResolvedValue(insights),
    } as unknown as InstagramApiClient
  }

  function adapterFor(insights: Record<string, number>) {
    return createInstagramAdapter({
      clientFactory: () => client(insights),
      getAccessToken: async () => "token",
    })
  }

  it("считает досматриваемость из среднего времени просмотра и длительности", async () => {
    const adapter = adapterFor({ views: 10_000, averageWatchTimeMs: 12_000 })

    const metrics = await adapter.getPostMetrics(account(), "media-1", { videoDurationSec: 30 })

    expect(metrics.watchThrough).toBeCloseTo(0.4, 6)
    // Метрика измерена — помечать её недоступной нельзя.
    expect(metrics.unsupported).toBeUndefined()
  })

  it("не выдаёт долю больше единицы, когда ролик пересматривают", async () => {
    const adapter = adapterFor({ views: 10_000, averageWatchTimeMs: 90_000 })

    const metrics = await adapter.getPostMetrics(account(), "media-1", { videoDurationSec: 30 })

    expect(metrics.watchThrough).toBe(1)
  })

  it("помечает досматриваемость неизмеренной без длительности ролика", async () => {
    const adapter = adapterFor({ views: 10_000, averageWatchTimeMs: 12_000 })

    const metrics = await adapter.getPostMetrics(account(), "media-1")

    expect(metrics.watchThrough).toBe(0)
    expect(metrics.unsupported).toContain("watchThrough")
  })

  it("помечает досматриваемость неизмеренной, если Instagram не отдал время просмотра", async () => {
    const adapter = adapterFor({ views: 10_000 })

    const metrics = await adapter.getPostMetrics(account(), "media-1", { videoDurationSec: 30 })

    expect(metrics.watchThrough).toBe(0)
    expect(metrics.unsupported).toContain("watchThrough")
  })
})

describe("computeCtr", () => {
  it("считает долю переходов от просмотров", () => {
    expect(computeCtr(50, 1_000)).toBeCloseTo(0.05, 6)
    expect(computeCtr(0, 1_000)).toBe(0)
  })

  it("не даёт доле выйти за единицу и не делит на ноль", () => {
    expect(computeCtr(1_200, 1_000)).toBe(1)
    expect(computeCtr(10, 0)).toBe(0)
    expect(computeCtr(Number.NaN, 1_000)).toBe(0)
  })
})

describe("distributeFollowerGain", () => {
  function snapshot(iso: string, followers: number | bigint | null) {
    return { fetchedAt: new Date(iso), followers }
  }

  function publication(uploadId: number, iso: string | null) {
    return { uploadId, publishedAt: iso ? new Date(iso) : null }
  }

  function total(shares: Map<number, number>): number {
    return [...shares.values()].reduce((sum, value) => sum + value, 0)
  }

  it("отдаёт весь прирост единственной публикации", () => {
    const shares = distributeFollowerGain(
      [snapshot("2026-08-01T09:00:00.000Z", 1_000), snapshot("2026-08-06T09:00:00.000Z", 1_180)],
      [publication(501, "2026-08-01T10:00:00.000Z")],
    )
    expect(shares.get(501)).toBe(180)
  })

  it("делит прирост аккаунта между его публикациями, а не множит на их число", () => {
    const shares = distributeFollowerGain(
      [snapshot("2026-08-01T09:00:00.000Z", 1_000), snapshot("2026-08-06T09:00:00.000Z", 1_200)],
      [
        publication(1, "2026-08-01T10:00:00.000Z"),
        publication(2, "2026-08-01T12:00:00.000Z"),
        publication(3, "2026-08-01T18:00:00.000Z"),
      ],
    )
    // Дефект, ради которого всё это: каждой публикации писалось по 200, и
    // дашборд показывал прирост 600 при фактических 200 у аккаунта.
    expect(total(shares)).toBe(200)
    expect([...shares.values()]).toEqual([67, 67, 66])
  })

  it("не начисляет ролику рост, случившийся до его выхода", () => {
    const shares = distributeFollowerGain(
      [
        snapshot("2026-08-01T00:00:00.000Z", 1_000),
        snapshot("2026-08-02T00:00:00.000Z", 1_100),
        snapshot("2026-08-04T00:00:00.000Z", 1_300),
      ],
      [
        publication(1, "2026-08-01T10:00:00.000Z"),
        publication(2, "2026-08-03T10:00:00.000Z"),
      ],
    )
    // Первые +100 заработал только ролик 1, следующие +200 поделены пополам.
    expect(shares.get(1)).toBe(200)
    expect(shares.get(2)).toBe(100)
    expect(total(shares)).toBe(300)
  })

  it("работает с bigint из базы и не пишет отписки в минус", () => {
    const shares = distributeFollowerGain(
      [
        snapshot("2026-08-01T00:00:00.000Z", 1_000n),
        snapshot("2026-08-02T00:00:00.000Z", 940n),
        snapshot("2026-08-03T00:00:00.000Z", 982n),
      ],
      [publication(1, "2026-07-30T00:00:00.000Z")],
    )
    expect(shares.get(1)).toBe(42)
  })

  it("ничего не начисляет, когда сравнивать не с чем", () => {
    const one = [snapshot("2026-08-05T10:00:00.000Z", 1_150)]
    const posts = [publication(1, "2026-08-01T10:00:00.000Z")]
    expect(distributeFollowerGain([], posts).size).toBe(0)
    expect(distributeFollowerGain(one, posts).size).toBe(0)
    // Два запроса вернули один и тот же снимок — это одна точка, а не две.
    expect(distributeFollowerGain([one[0]!, one[0]!], posts).size).toBe(0)
    // Публикация без даты — привязать рост не к чему.
    expect(
      distributeFollowerGain(
        [snapshot("2026-08-01T00:00:00.000Z", 1_000), snapshot("2026-08-02T00:00:00.000Z", 1_100)],
        [publication(1, null)],
      ).size,
    ).toBe(0)
  })
})

/**
 * Сборщик метрик целиком, но без базы: prisma, decrypt, logAgent и фабрика
 * адаптеров подменены глобалами (в server/** они приходят из auto-import Nuxt).
 */
describe("collectMetrics", () => {
  const saved = {
    prisma: globals.prisma,
    decrypt: globals.decrypt,
    logAgent: globals.logAgent,
    getSocialAdapter: globals.getSocialAdapter,
  }

  afterEach(() => {
    Object.assign(globals, saved)
  })

  interface Harness {
    uploads?: Array<Record<string, unknown>>
    clicks?: number
    snapshots?: { latest?: unknown; baseline?: unknown }
    metrics?: Partial<MetricsResult>
  }

  function install(harness: Harness = {}) {
    const created: Array<Record<string, any>> = []
    const contexts: Array<MetricsContext | undefined> = []
    const logs: Array<{ message: string; meta: Record<string, any> }> = []
    const attributionWhere: Array<Record<string, any>> = []

    const upload = {
      id: 501,
      status: "published",
      platformPostId: "media-1",
      updatedAt: new Date("2026-08-01T10:00:00.000Z"),
      socialAccount: {
        id: 7,
        platform: "instagram",
        displayName: "Reforma IG",
        platformUserId: "ig-1",
        accessToken: "enc:token",
        refreshToken: null,
        expiresAt: null,
      },
      video: { duration: 30 },
      factoryPublication: { id: "pub-1", publishedAt: new Date("2026-08-01T10:00:00.000Z") },
    }

    globals.prisma = {
      upload: { findMany: async () => harness.uploads ?? [upload] },
      postMetrics: {
        create: async ({ data }: { data: Record<string, any> }) => {
          created.push(data)
          return data
        },
      },
      attributionEvent: {
        count: async ({ where }: { where: Record<string, any> }) => {
          attributionWhere.push(where)
          return harness.clicks ?? 0
        },
      },
      accountMetricsSnapshot: {
        // Сборщик берёт историю по убыванию времени — отдаём в том же порядке.
        findMany: async () =>
          [harness.snapshots?.latest, harness.snapshots?.baseline].filter(Boolean),
      },
    }
    globals.decrypt = (value: string) => value.replace(/^enc:/, "")
    globals.logAgent = async (
      _agent: string,
      _level: string,
      message: string,
      meta: Record<string, any>,
    ) => {
      logs.push({ message, meta })
    }
    globals.getSocialAdapter = () => ({
      uploadVideo: async () => ({ platformPostId: "", platformPostUrl: "" }),
      getPostMetrics: async (
        _account: DecryptedAccount,
        _postId: string,
        context?: MetricsContext,
      ): Promise<MetricsResult> => {
        contexts.push(context)
        return {
          views: 1_000,
          likes: 10,
          comments: 2,
          shares: 1,
          watchThrough: 0.4,
          // Адаптеры платформ этих величин не знают и отдают нули —
          // считать их обязан сборщик.
          ctr: 0,
          followerGain: 0,
          ...harness.metrics,
        }
      },
    })

    return { created, contexts, logs, attributionWhere }
  }

  async function collect() {
    const { collectMetrics } = await import("~~/server/utils/metrics-collector")
    return collectMetrics()
  }

  it("передаёт адаптеру длительность ролика", async () => {
    const spy = install()

    await collect()

    expect(spy.contexts).toEqual([{ videoDurationSec: 30 }])
  })

  it("считает ctr из переходов в базе, а не берёт ноль у адаптера", async () => {
    const spy = install({ clicks: 42 })

    const result = await collect()

    expect(result.collected).toBe(1)
    expect(spy.created[0]!.ctr).toBeCloseTo(0.042, 6)
    expect(spy.attributionWhere[0]).toEqual({
      publicationId: "pub-1",
      type: "messenger_opened",
    })
  })

  it("считает прирост подписчиков по снимкам аккаунта", async () => {
    const spy = install({
      snapshots: {
        baseline: { fetchedAt: new Date("2026-08-01T09:00:00.000Z"), followers: 1_000 },
        latest: { fetchedAt: new Date("2026-08-06T09:00:00.000Z"), followers: 1_180 },
      },
    })

    await collect()

    expect(spy.created[0]!.followerGain).toBe(180)
  })

  it("не пишет прирост всего аккаунта в каждую его публикацию", async () => {
    const spy = install({
      snapshots: {
        baseline: { fetchedAt: new Date("2026-08-01T09:00:00.000Z"), followers: 1_000 },
        latest: { fetchedAt: new Date("2026-08-06T09:00:00.000Z"), followers: 1_200 },
      },
    })
    const socialAccount = {
      id: 7,
      platform: "instagram",
      displayName: "Reforma IG",
      platformUserId: "ig-1",
      accessToken: "enc:token",
      refreshToken: null,
      expiresAt: null,
    }
    ;(globals.prisma as any).upload.findMany = async () => [
      {
        id: 601,
        platformPostId: "media-1",
        updatedAt: new Date("2026-08-01T10:00:00.000Z"),
        socialAccount,
        video: { duration: 30 },
        factoryPublication: { id: "pub-1", publishedAt: new Date("2026-08-01T10:00:00.000Z") },
      },
      {
        id: 602,
        platformPostId: "media-2",
        updatedAt: new Date("2026-08-01T14:00:00.000Z"),
        socialAccount,
        video: { duration: 30 },
        factoryPublication: { id: "pub-2", publishedAt: new Date("2026-08-01T14:00:00.000Z") },
      },
    ]

    await collect()

    // Аккаунт вырос на 200. Раньше в обе строки писалось по 200, и дашборд,
    // который суммирует followerGain по загрузкам, показывал 400.
    const gains = spy.created.map(row => row.followerGain)
    expect(gains.reduce((sum: number, value: number) => sum + value, 0)).toBe(200)
    expect(gains).toEqual([100, 100])
  })

  it("не считает переходы у публикации без трекинг-ссылки", async () => {
    const spy = install({ clicks: 42 })
    ;(globals.prisma as any).upload.findMany = async () => [
      {
        id: 502,
        platformPostId: "media-2",
        updatedAt: new Date("2026-08-01T10:00:00.000Z"),
        socialAccount: {
          id: 7,
          platform: "instagram",
          displayName: "Reforma IG",
          platformUserId: "ig-1",
          accessToken: "enc:token",
          refreshToken: null,
          expiresAt: null,
        },
        video: { duration: 30 },
        factoryPublication: null,
      },
    ]

    await collect()

    expect(spy.attributionWhere).toHaveLength(0)
    expect(spy.created[0]!.ctr).toBe(0)
  })

  it("пишет в лог, чего измерить не удалось", async () => {
    const spy = install({ metrics: { watchThrough: 0, unsupported: ["watchThrough"] } })

    await collect()

    expect(spy.logs).toHaveLength(1)
    expect(spy.logs[0]!.meta.unsupported).toEqual({ watchThrough: 1 })
    // Ни трекинг-ссылка, ни история подписчиков в этом прогоне не пусты/пусты —
    // важно, что состояние попало в лог, а не растворилось в нулях.
    expect(spy.logs[0]!.meta.withoutFollowerHistory).toBe(1)
  })

  it("сохраняет сырые счётчики платформы как есть", async () => {
    const spy = install()

    await collect()

    expect(spy.created[0]).toMatchObject({
      uploadId: 501,
      views: 1_000,
      likes: 10,
      comments: 2,
      shares: 1,
      watchThrough: 0.4,
    })
  })
})
