/**
 * Регрессия на честность статуса поста и неизмеренных метрик.
 *
 * Дефекты, которые здесь закрыты:
 *  - P1-23: YouTube-адаптер отдавал `shares: 0`, но не клал `shares` в
 *    `unsupported`. По контракту `social/types.ts` такой ноль читается как
 *    измеренная величина — дашборд врал «0 репостов» по всем YouTube-роликам;
 *  - P1-20: `Upload.postStatus` не писался никогда. Ответ площадки «такого
 *    поста нет» уходил в errors как авария сбора, а удалённый ролик в таблице
 *    оставался активным. При этом временный сбой API (таймаут, 5xx) не имеет
 *    права менять статус: иначе одна минута недоступности TikTok объявила бы
 *    удалёнными все ролики аккаунта;
 *  - P1-27: сообщение об отсутствии OAuth советовало «Indigo browser
 *    automation» — унаследованный контур, запрещённый в основном пути
 *    (PROJECT_CONTEXT §4). Этот текст видит заказчик в логе.
 *
 * Всё без сети и без БД: адаптеры получают фейковый fetch, сборщик — фейковый
 * prisma в globalThis.
 *
 * @vitest-environment node
 */
import { afterEach, describe, expect, it } from "vitest"

import { postUnavailableStatus } from "~~/server/utils/social/post-availability"
import { createTikTokAdapter, tiktokAdapter } from "~~/server/utils/social/tiktok"
import { youtubeAdapter } from "~~/server/utils/social/youtube"
import type { DecryptedAccount, MetricsContext, MetricsResult } from "~~/server/utils/social/types"

const globals = globalThis as unknown as Record<string, unknown>

function account(platform: string, withTokens = true): DecryptedAccount {
  return {
    id: 1,
    platform,
    displayName: `${platform} Test`,
    platformUserId: "u-1",
    accessToken: withTokens ? "token" : null,
    refreshToken: withTokens ? "refresh" : null,
    expiresAt: new Date(Date.now() + 3_600_000),
  }
}

describe("YouTube-адаптер: неизмеренные метрики и судьба поста", () => {
  const saved = { $fetch: globals.$fetch }

  afterEach(() => {
    globals.$fetch = saved.$fetch
  })

  function installYouTube(items: Array<Record<string, unknown>>) {
    const urls: string[] = []
    globals.$fetch = async (url: string) => {
      urls.push(url)
      return { items }
    }
    return urls
  }

  it("помечает shares неизмеренной: YouTube Data API их не отдаёт", async () => {
    installYouTube([
      { statistics: { viewCount: "1000", likeCount: "10", commentCount: "2", favoriteCount: "0" } },
    ])

    const metrics = await youtubeAdapter.getPostMetrics(account("youtube"), "yt-1")

    // Старое поведение: unsupported = ["watchThrough"], а shares: 0 уезжал в
    // PostMetrics как измеренный ноль.
    expect(metrics.shares).toBe(0)
    expect(metrics.unsupported).toContain("shares")
    expect(metrics.unsupported).toContain("watchThrough")
  })

  it("пустой ответ videos.list — это удалённый пост, а не ошибка сбора", async () => {
    installYouTube([])

    const error = await youtubeAdapter
      .getPostMetrics(account("youtube"), "yt-gone")
      .then(() => null, (reason: unknown) => reason)

    // Старое поведение: обычный Error «видео не найдено» → строка в errors,
    // postStatus не менялся.
    expect(postUnavailableStatus(error)).toBe("deleted")
  })

  it("отклонённый площадкой ролик помечается заблокированным, а не удалённым", async () => {
    installYouTube([
      {
        statistics: { viewCount: "5", likeCount: "0", commentCount: "0", favoriteCount: "0" },
        status: { uploadStatus: "rejected", rejectionReason: "copyright" },
      },
    ])

    const error = await youtubeAdapter
      .getPostMetrics(account("youtube"), "yt-blocked")
      .then(() => null, (reason: unknown) => reason)

    expect(postUnavailableStatus(error)).toBe("blocked")
    expect((error as Error).message).toContain("copyright")
  })

  it("запрашивает part=status: без него блокировка неотличима от нулей", async () => {
    const urls = installYouTube([
      { statistics: { viewCount: "1", likeCount: "0", commentCount: "0", favoriteCount: "0" } },
    ])

    await youtubeAdapter.getPostMetrics(account("youtube"), "yt-1")

    expect(urls[0]).toContain("part=statistics,status")
  })
})

describe("TikTok-адаптер: удаление отличается от нашей недоделки публикации", () => {
  function buildAdapter(videos: Array<Record<string, unknown>>) {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ data: { videos }, error: { code: "ok" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch
    return createTikTokAdapter({ fetchImpl, getAccessToken: async () => "token" })
  }

  it("настоящий id поста и пустой ответ — пост удалён", async () => {
    const adapter = buildAdapter([])

    const error = await adapter
      .getPostMetrics(account("tiktok"), "7301111222233334444")
      .then(() => null, (reason: unknown) => reason)

    expect(postUnavailableStatus(error)).toBe("deleted")
  })

  it("publish_id вместо id поста удалением не считается", async () => {
    const adapter = buildAdapter([])

    const error = await adapter
      .getPostMetrics(account("tiktok"), "v_pub_file~v2.1234")
      .then(() => null, (reason: unknown) => reason)

    // Публичный id просто не разрезолвился — ролик может быть жив, и объявлять
    // его удалённым нельзя.
    expect(postUnavailableStatus(error)).toBeNull()
    expect((error as Error).message).toContain("publish_id")
  })

  it("чужие id в ответе удалением не считаются", async () => {
    const adapter = buildAdapter([
      { id: "7309999", view_count: 1, like_count: 1, comment_count: 1, share_count: 1 },
    ])

    const error = await adapter
      .getPostMetrics(account("tiktok"), "7301111222233334444")
      .then(() => null, (reason: unknown) => reason)

    expect(postUnavailableStatus(error)).toBeNull()
  })
})

describe("Официальные адаптеры не отсылают к запрещённому контуру", () => {
  it("YouTube без OAuth зовёт переподключить аккаунт, а не Indigo", async () => {
    const error = await youtubeAdapter
      .getPostMetrics(account("youtube", false), "yt-1")
      .then(() => null, (reason: unknown) => reason as Error)

    expect(error!.message).not.toMatch(/indigo/i)
    expect(error!.message).not.toMatch(/browser automation/i)
    expect(error!.message).toContain("OAuth")
  })

  it("TikTok без OAuth зовёт переподключить аккаунт, а не Indigo", async () => {
    const error = await tiktokAdapter
      .getPostMetrics(account("tiktok", false), "7301111222233334444")
      .then(() => null, (reason: unknown) => reason as Error)

    expect(error!.message).not.toMatch(/indigo/i)
    expect(error!.message).not.toMatch(/browser automation/i)
    expect(error!.message).toContain("OAuth")
  })
})

interface CollectorHarness {
  /** Что бросает адаптер вместо метрик. */
  metricsError?: unknown
  /** Текущий статус поста в базе. */
  postStatus?: string
  /** Падение записи статуса — проверяем, что о нём узнают. */
  updateFail?: string
}

describe("collectMetrics: статус поста синхронизируется с площадкой", () => {
  const saved = {
    prisma: globals.prisma,
    decrypt: globals.decrypt,
    logAgent: globals.logAgent,
    getSocialAdapter: globals.getSocialAdapter,
  }

  afterEach(() => {
    Object.assign(globals, saved)
  })

  function install(harness: CollectorHarness = {}) {
    const created: Array<Record<string, unknown>> = []
    const updates: Array<{ where: { id: number }; data: Record<string, unknown> }> = []
    const logs: Array<{ level: string; message: string; meta: any }> = []

    globals.prisma = {
      upload: {
        findMany: async () => [
          {
            id: 501,
            status: "published",
            postStatus: harness.postStatus ?? "active",
            platformPostId: "post-1",
            updatedAt: new Date("2026-08-01T10:00:00.000Z"),
            socialAccount: {
              id: 7,
              platform: "youtube",
              displayName: "Reforma YT",
              platformUserId: "yt-1",
              accessToken: "enc:token",
              refreshToken: null,
              expiresAt: null,
            },
            video: { duration: 30 },
            factoryPublication: { id: "pub-1", publishedAt: new Date("2026-08-01T10:00:00.000Z") },
          },
        ],
        update: async (args: { where: { id: number }; data: Record<string, unknown> }) => {
          if (harness.updateFail) throw new Error(harness.updateFail)
          updates.push(args)
          return args.data
        },
      },
      postMetrics: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data)
          return data
        },
        findFirst: async () => null,
      },
      attributionEvent: { count: async () => 10 },
      accountMetricsSnapshot: {
        findMany: async () => [
          { fetchedAt: new Date("2026-08-06T09:00:00.000Z"), followers: 1_100 },
          { fetchedAt: new Date("2026-08-01T09:00:00.000Z"), followers: 1_000 },
        ],
      },
    }
    globals.decrypt = (value: string) => value.replace(/^enc:/, "")
    globals.logAgent = async (_agent: string, level: string, message: string, meta: unknown) => {
      logs.push({ level, message, meta })
    }
    globals.getSocialAdapter = () => ({
      uploadVideo: async () => ({ platformPostId: "", platformPostUrl: "" }),
      getPostMetrics: async (
        _acc: DecryptedAccount,
        _postId: string,
        _context?: MetricsContext,
      ): Promise<MetricsResult> => {
        if (harness.metricsError) throw harness.metricsError
        return {
          views: 1_000,
          likes: 10,
          comments: 2,
          shares: 0,
          watchThrough: 0,
          ctr: 0,
          followerGain: 0,
          unsupported: ["watchThrough", "shares"],
        }
      },
    })

    return { created, updates, logs }
  }

  async function collect() {
    const { collectMetrics } = await import("~~/server/utils/metrics-collector")
    return collectMetrics()
  }

  /** Ошибка ровно того вида, что бросают адаптеры при пропаже поста. */
  function gone(status: "deleted" | "blocked", message: string) {
    return Object.assign(new Error(message), { postUnavailable: true, postStatus: status })
  }

  it("удалённый на площадке пост переводит Upload.postStatus в deleted", async () => {
    const spy = install({ metricsError: gone("deleted", "видео отсутствует на площадке") })

    const result = await collect()

    // Старое поведение: update не вызывался вовсе, а ролик уезжал в errors.
    expect(spy.updates).toEqual([{ where: { id: 501 }, data: { postStatus: "deleted" } }])
    expect(result.statusChanged).toEqual([
      {
        uploadId: 501,
        from: "active",
        to: "deleted",
        reason: "видео отсутствует на площадке",
      },
    ])
    expect(result.errors).toHaveLength(0)
    // Счётчиков не было — выдумывать строку PostMetrics не из чего.
    expect(spy.created).toHaveLength(0)
  })

  it("заблокированный пост получает статус blocked", async () => {
    const spy = install({ metricsError: gone("blocked", "видео отклонено площадкой") })

    const result = await collect()

    expect(spy.updates[0]!.data).toEqual({ postStatus: "blocked" })
    expect(result.statusChanged[0]!.to).toBe("blocked")
  })

  it("транзиентная ошибка API статус НЕ меняет", async () => {
    const spy = install({ metricsError: new Error("fetch failed: ETIMEDOUT") })

    const result = await collect()

    // Одна минута недоступности площадки не должна хоронить публикации.
    expect(spy.updates).toHaveLength(0)
    expect(result.statusChanged).toHaveLength(0)
    expect(result.errors).toEqual([{ uploadId: 501, error: "fetch failed: ETIMEDOUT" }])
  })

  it("повторный сбор по уже удалённому посту лишний UPDATE не делает", async () => {
    // Важно не только ради нагрузки: у Upload стоит updatedAt @updatedAt, а по
    // нему сборщик оценивает дату публикации нефабричных загрузок.
    const spy = install({
      postStatus: "deleted",
      metricsError: gone("deleted", "видео отсутствует на площадке"),
    })

    const result = await collect()

    expect(spy.updates).toHaveLength(0)
    expect(result.statusChanged).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })

  it("вернувшийся пост снимает метку удалённого", async () => {
    const spy = install({ postStatus: "deleted" })

    const result = await collect()

    expect(spy.updates).toEqual([{ where: { id: 501 }, data: { postStatus: "active" } }])
    expect(result.statusChanged[0]).toMatchObject({ from: "deleted", to: "active" })
    expect(result.collected).toBe(1)
  })

  it("живой пост статус не переписывает", async () => {
    const spy = install()

    const result = await collect()

    expect(spy.updates).toHaveLength(0)
    expect(result.collected).toBe(1)
    expect(result.statusChanged).toHaveLength(0)
  })

  it("несостоявшаяся запись статуса — настоящая ошибка сбора", async () => {
    const spy = install({
      metricsError: gone("deleted", "видео отсутствует на площадке"),
      updateFail: "connection terminated",
    })

    const result = await collect()

    expect(spy.updates).toHaveLength(0)
    expect(result.statusChanged).toHaveLength(0)
    expect(result.errors[0]!.error).toContain("connection terminated")
  })

  it("рассказывает о смене статуса в логе", async () => {
    const spy = install({ metricsError: gone("deleted", "видео отсутствует на площадке") })

    await collect()

    const warn = spy.logs.find(entry => entry.message.includes("Статус публикаций"))
    expect(warn).toBeDefined()
    expect(warn!.level).toBe("warn")
    expect(warn!.meta.statusChanged).toHaveLength(1)
  })
})
