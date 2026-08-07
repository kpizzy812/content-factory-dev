/**
 * Регрессия: прирост подписчиков в отчётах всегда был пуст.
 *
 * Дефекты, которые здесь закрыты (аудит `docs/audit/spec-conformance-2026-08-07.md`,
 * пункт P0-14 и риск №3):
 *  - снимки AccountMetricsSnapshot никто не снимал по расписанию, а их
 *    единственным источником был ручной обработчик через Apify-скрапер
 *    публичного профиля — это противоречит `docs/PROJECT_CONTEXT.md` §4
 *    («только белые инструменты»). Официальные API подписчиков отдают:
 *    Instagram — `followers_count`, YouTube — `statistics.subscriberCount`;
 *  - ролик, вышедший ПОСЛЕ последнего снимка, не попадал в карту долей, и
 *    сборщик писал ему `followerGain = 0` как ИЗМЕРЕННУЮ величину, хотя
 *    аккаунт с момента публикации ни разу не мерили.
 *
 * Всё без БД и сети: prisma/decrypt/logAgent/$fetch подменены глобалами
 * (в `server/**` они приходят из auto-import Nuxt), клиент площадки — двойником.
 *
 * @vitest-environment node
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"

import { createInstagramAdapter } from "~~/server/utils/social/instagram"
import type { InstagramApiClient } from "~~/server/utils/social/instagram-api"
import { youtubeAdapter } from "~~/server/utils/social/youtube"
import {
  describeFollowerGain,
  FOLLOWER_GAIN_UNMEASURED,
} from "~~/server/utils/social/follower-attribution"
import { asFollowerCountProvider } from "~~/server/utils/social/follower-count"
import type { DecryptedAccount, MetricsContext, MetricsResult } from "~~/server/utils/social/types"

const globals = globalThis as unknown as Record<string, unknown>

function account(platform: string): DecryptedAccount {
  return {
    id: 7,
    platform,
    displayName: `Reforma ${platform}`,
    platformUserId: "ig-1",
    accessToken: "token",
    refreshToken: "refresh",
    // Далеко в будущем: адаптеры не должны идти в refresh и трогать базу.
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
  }
}

function snapshot(iso: string, followers: number) {
  return { fetchedAt: new Date(iso), followers }
}

function publication(uploadId: number, iso: string | null) {
  return { uploadId, publishedAt: iso ? new Date(iso) : null }
}

describe("describeFollowerGain: пробел в наблюдениях отделён от измеренного нуля", () => {
  it("не приписывает ноль ролику, вышедшему после последнего снимка", () => {
    const result = describeFollowerGain(
      [snapshot("2026-08-01T00:00:00.000Z", 1_000), snapshot("2026-08-02T00:00:00.000Z", 1_100)],
      [publication(1, "2026-08-01T10:00:00.000Z"), publication(2, "2026-08-03T10:00:00.000Z")],
    )

    expect(result.shares.get(1)).toBe(100)
    // Ролик 2 вышел позже последнего замера: наблюдений о нём нет вообще.
    expect(result.shares.has(2)).toBe(false)
    expect(result.unmeasured.get(2)).toBe(FOLLOWER_GAIN_UNMEASURED.noSnapshotAfter)
  })

  it("измеренный ноль остаётся нулём: аккаунт мерили, роста не было", () => {
    const result = describeFollowerGain(
      [snapshot("2026-08-01T00:00:00.000Z", 1_000), snapshot("2026-08-05T00:00:00.000Z", 1_000)],
      [publication(1, "2026-08-02T10:00:00.000Z")],
    )

    expect(result.shares.get(1)).toBe(0)
    expect(result.unmeasured.has(1)).toBe(false)
  })

  it("называет причину, когда сравнивать не с чем", () => {
    const single = [snapshot("2026-08-05T10:00:00.000Z", 1_150)]
    expect(
      describeFollowerGain(single, [publication(1, "2026-08-01T10:00:00.000Z")]).unmeasured.get(1),
    ).toBe(FOLLOWER_GAIN_UNMEASURED.noHistory)
    expect(
      describeFollowerGain(
        [snapshot("2026-08-01T00:00:00.000Z", 1_000), snapshot("2026-08-02T00:00:00.000Z", 1_100)],
        [publication(1, null)],
      ).unmeasured.get(1),
    ).toBe(FOLLOWER_GAIN_UNMEASURED.noPublishedAt)
  })
})

describe("Instagram: подписчики берутся официальным Graph API", () => {
  function client(info: Record<string, unknown> | null) {
    const calls: string[] = []
    const double = {
      getPublishingLimit: async () => ({ quotaUsage: 0, quotaTotal: 50 }),
      createReelContainer: async () => "c-1",
      getContainerStatus: async () => ({ statusCode: "FINISHED" as const, status: null }),
      publishContainer: async () => "media-1",
      getMedia: async () => ({ id: "media-1", permalink: null, likeCount: 0, commentsCount: 0 }),
      getMediaInsights: async () => ({}),
      getAccountInfo: async (userId: string) => {
        calls.push(userId)
        if (!info) throw new Error("Instagram API: profile unavailable")
        return {
          followersCount: (info.followersCount ?? null) as number | null,
          followsCount: (info.followsCount ?? null) as number | null,
          mediaCount: (info.mediaCount ?? null) as number | null,
        }
      },
    } as unknown as InstagramApiClient
    return { double, calls }
  }

  function adapterFor(info: Record<string, unknown> | null) {
    const fake = client(info)
    return {
      adapter: createInstagramAdapter({
        clientFactory: () => fake.double,
        getAccessToken: async () => "token",
      }),
      calls: fake.calls,
    }
  }

  it("отдаёт followers_count профессионального аккаунта", async () => {
    const { adapter, calls } = adapterFor({ followersCount: 1_180, followsCount: 12, mediaCount: 34 })

    const result = await adapter.getFollowerCount(account("instagram"))

    expect(result).toEqual({ followers: 1_180, following: 12, postsCount: 34 })
    // Запрос идёт по id профессионального аккаунта, а не по чужому handle.
    expect(calls).toEqual(["ig-1"])
  })

  it("не выдаёт отсутствующий счётчик за ноль подписчиков", async () => {
    const { adapter } = adapterFor({ followersCount: null })

    await expect(adapter.getFollowerCount(account("instagram"))).rejects.toThrow(/followers_count/)
  })
})

describe("YouTube: подписчики берутся официальным Data API", () => {
  const savedFetch = globals.$fetch

  afterEach(() => {
    globals.$fetch = savedFetch
  })

  function install(statistics: Record<string, unknown> | null) {
    const urls: string[] = []
    globals.$fetch = async (url: string) => {
      urls.push(url)
      return { items: statistics ? [{ statistics }] : [] }
    }
    return urls
  }

  it("отдаёт subscriberCount канала владельца токена", async () => {
    const urls = install({ subscriberCount: "12300", videoCount: "48" })

    const result = await youtubeAdapter.getFollowerCount(account("youtube"))

    expect(result).toEqual({ followers: 12_300, postsCount: 48 })
    expect(urls[0]).toContain("channels?part=statistics&mine=true")
  })

  it("скрытый счётчик подписчиков — это не ноль подписчиков", async () => {
    install({ subscriberCount: "0", hiddenSubscriberCount: true })

    await expect(youtubeAdapter.getFollowerCount(account("youtube"))).rejects.toThrow(/скрыт/)
  })
})

describe("TikTok: подписчиков официально взять нечем", () => {
  it("адаптер не заявляет умения, которого у площадки нет", async () => {
    const { tiktokAdapter } = await import("~~/server/utils/social/tiktok")
    // Именно так сборщик и понимает, что по TikTok-аккаунту прирост «не
    // измерено»: заглушка с нулём подписчиков была бы выдуманным числом.
    expect(asFollowerCountProvider(tiktokAdapter)).toBeNull()
  })
})

describe("collectFollowerSnapshots: снимки по расписанию из официальных API", () => {
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
    accounts?: Array<Record<string, unknown>>
    followers?: number
    fail?: string
  }

  function install(harness: Harness = {}) {
    const created: Array<Record<string, any>> = []
    const logs: Array<{ level: string; message: string; meta: any }> = []

    globals.prisma = {
      socialAccount: {
        findMany: async () => harness.accounts ?? [
          {
            id: 7,
            platform: "instagram",
            displayName: "Reforma IG",
            platformUserId: "ig-1",
            accessToken: "enc:token",
            refreshToken: null,
            expiresAt: null,
          },
        ],
      },
      accountMetricsSnapshot: {
        create: async ({ data }: { data: Record<string, any> }) => {
          created.push(data)
          return data
        },
      },
    }
    globals.decrypt = (value: string) => value.replace(/^enc:/, "")
    globals.logAgent = async (_agent: string, level: string, message: string, meta: unknown) => {
      logs.push({ level, message, meta })
    }
    globals.getSocialAdapter = (platform: string) => {
      const base = {
        uploadVideo: async () => ({ platformPostId: "", platformPostUrl: "" }),
        getPostMetrics: async (): Promise<MetricsResult> => ({
          views: 0, likes: 0, comments: 0, shares: 0, watchThrough: 0, ctr: 0, followerGain: 0,
        }),
      }
      // TikTok-адаптер метода не имеет — ровно как в бою.
      if (platform === "tiktok") return base
      return {
        ...base,
        getFollowerCount: async () => {
          if (harness.fail) throw new Error(harness.fail)
          return { followers: harness.followers ?? 1_180, following: 12, postsCount: 34 }
        },
      }
    }

    return { created, logs }
  }

  async function run() {
    const { collectFollowerSnapshots } = await import("~~/server/utils/metrics-collector")
    return collectFollowerSnapshots()
  }

  it("пишет снимок подписчиков с пометкой официального источника", async () => {
    const spy = install({ followers: 1_180 })

    const result = await run()

    expect(result.collected).toBe(1)
    expect(spy.created).toHaveLength(1)
    expect(spy.created[0]!.socialAccountId).toBe(7)
    // BigInt-колонка: число подписчиков и есть смысл всей задачи.
    expect(spy.created[0]!.followers).toBe(1_180n)
    expect(spy.created[0]!.status).toBe("ok")
    // Источник обязан отличаться от строк, оставленных Apify-скрапером.
    expect(spy.created[0]!.rawData).toMatchObject({ source: "official_api" })
  })

  it("TikTok остаётся «не измерено», а не нулём подписчиков", async () => {
    const spy = install({
      accounts: [
        {
          id: 9,
          platform: "tiktok",
          displayName: "Reforma TT",
          platformUserId: "tt-1",
          accessToken: "enc:token",
          refreshToken: null,
          expiresAt: null,
        },
      ],
    })

    const result = await run()

    expect(result.collected).toBe(0)
    expect(spy.created).toHaveLength(0)
    expect(result.skipped).toEqual([
      {
        socialAccountId: 9,
        platform: "tiktok",
        reason: "официального API подписчиков для площадки нет",
      },
    ])
  })

  it("упавший замер не превращается в снимок с нулём", async () => {
    const spy = install({ fail: "Instagram API: token expired" })

    const result = await run()

    expect(result.collected).toBe(0)
    expect(spy.created).toHaveLength(0)
    expect(result.errors).toEqual([
      { socialAccountId: 7, error: "Instagram API: token expired" },
    ])
    expect(spy.logs.some(entry => entry.level === "warn")).toBe(true)
  })
})

describe("collectMetrics: ролик без снимка после публикации не получает ноль", () => {
  const saved = {
    prisma: globals.prisma,
    decrypt: globals.decrypt,
    logAgent: globals.logAgent,
    getSocialAdapter: globals.getSocialAdapter,
  }

  afterEach(() => {
    Object.assign(globals, saved)
  })

  function install(snapshots: Array<{ fetchedAt: Date; followers: number }>) {
    const created: Array<Record<string, any>> = []

    globals.prisma = {
      upload: {
        findMany: async () => [
          {
            id: 501,
            status: "published",
            platformPostId: "media-1",
            postStatus: "active",
            updatedAt: new Date("2026-08-05T10:00:00.000Z"),
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
            factoryPublication: { id: "pub-1", publishedAt: new Date("2026-08-05T10:00:00.000Z") },
          },
        ],
      },
      postMetrics: {
        create: async ({ data }: { data: Record<string, any> }) => {
          created.push(data)
          return data
        },
        findFirst: async () => ({ ctr: 0.07, followerGain: 42 }),
      },
      attributionEvent: { count: async () => 30 },
      accountMetricsSnapshot: { findMany: async () => snapshots },
    }
    globals.decrypt = (value: string) => value.replace(/^enc:/, "")
    globals.logAgent = async () => {}
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

    return created
  }

  async function collect() {
    const { collectMetrics } = await import("~~/server/utils/metrics-collector")
    return collectMetrics()
  }

  it("держит прошлое значение и объясняет, чего не хватает", async () => {
    // Два снимка есть, история «есть» — но оба сделаны ДО выхода ролика.
    const created = install([
      { fetchedAt: new Date("2026-08-04T09:00:00.000Z"), followers: 1_180 },
      { fetchedAt: new Date("2026-08-01T09:00:00.000Z"), followers: 1_000 },
    ])

    const result = await collect()

    // Старое поведение: shares не содержал загрузку → в базу уезжал ноль,
    // выданный за измеренный прирост.
    expect(created[0]!.followerGain).toBe(42)
    expect(result.unmeasured).toContainEqual({
      uploadId: 501,
      metric: "followerGain",
      reason: FOLLOWER_GAIN_UNMEASURED.noSnapshotAfter,
      keptPrevious: true,
    })
    expect(result.errors).toHaveLength(0)
  })
})

describe("планировщик снимает подписчиков по расписанию", () => {
  it("в scheduler.ts есть отдельная задача со своим интервалом", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../../server/plugins/scheduler.ts", import.meta.url)),
      "utf8",
    )

    // Ровно то, чего не хватало по аудиту: без задачи снимков прирост
    // подписчиков в отчётах пуст независимо от качества расчёта.
    expect(source).toContain("collectFollowerSnapshots")
    expect(source).toContain("account-followers")
    expect(source).toContain("SCHEDULER_FOLLOWERS_INTERVAL_MS")
  })
})
