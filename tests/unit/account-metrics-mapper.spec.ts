/**
 * Unit-тесты mapper'а Apify profile-scrapers → AccountMetricsResult.
 *
 * Чистая логика mapping'а, без сети и БД. Фикстуры в fixtures/apify/*.json.
 */
import { describe, it, expect } from "vitest"
import tiktokSample from "./fixtures/apify/tiktok-profile-sample.json"
import instagramSample from "./fixtures/apify/instagram-profile-sample.json"
import youtubeSample from "./fixtures/apify/youtube-channel-sample.json"
import { mapApifyToAccountMetrics } from "../../server/utils/account-metrics-mapper"

// Утилита: подставить в фикстуру свежие даты, чтобы avgViewsPer30d попадал в окно
function withRecentTimestamps<T extends { createTime?: number; timestamp?: string; publishDate?: string }>(
  posts: T[],
): T[] {
  const now = Date.now()
  return posts.map((p, i) => {
    const date = new Date(now - i * 24 * 60 * 60 * 1000) // i дней назад
    const next: T = { ...p }
    if ("createTime" in p) next.createTime = Math.floor(date.getTime() / 1000)
    if ("timestamp" in p) next.timestamp = date.toISOString()
    if ("publishDate" in p) next.publishDate = date.toISOString()
    return next
  })
}

describe("mapApifyToAccountMetrics — TikTok happy path", () => {
  it("корректно мапит followers, postsCount, profile-метаданные", () => {
    const result = mapApifyToAccountMetrics(tiktokSample, "tiktok")
    expect(result.status).toBe("ok")
    expect(result.followers).toBe(15000n)
    expect(result.following).toBe(250n)
    expect(result.totalLikes).toBe(9000000n)
    expect(result.postsCount).toBe(120)
    expect(result.bio).toBe("Bio тестового пользователя")
    expect(result.avatarUrl).toBe("https://example.com/avatar.jpg")
    expect(result.isVerified).toBe(true)
    expect(result.sampleSize).toBe(3)
    expect(result.posts).toHaveLength(3)
    expect(result.posts[0]!.thumbnailUrl).toBe("https://example.com/cover-1.jpg")
    expect(result.posts[0]!.shareCount).toBe(2)
  })
})

describe("mapApifyToAccountMetrics — engagement формула", () => {
  it("(likes+comments)/views по выборке = 0.15 для views[100,200,300] likes[10,20,30] comments[5,10,15]", () => {
    const result = mapApifyToAccountMetrics(tiktokSample, "tiktok")
    // sumLikes=60, sumComments=30, sumViews=600 → (60+30)/600 = 0.15
    expect(result.engagementRate).toBeCloseTo(0.15, 10)
  })
})

describe("mapApifyToAccountMetrics — avgViewsPer30d фильтрация", () => {
  it("посты старше 30 дней игнорируются", () => {
    // Все 3 фикстуры из июня 2024 → старше 30 дней. avgViewsPer30d=null
    const result = mapApifyToAccountMetrics(tiktokSample, "tiktok")
    expect(result.avgViewsPer30d).toBeNull()
  })

  it("свежие посты корректно агрегируются", () => {
    const refreshed = withRecentTimestamps(tiktokSample as unknown as Array<Record<string, unknown>>)
    const result = mapApifyToAccountMetrics(refreshed, "tiktok")
    // Avg views: (100+200+300)/3 = 200
    expect(result.avgViewsPer30d).toBe(200n)
  })
})

describe("mapApifyToAccountMetrics — пустой input", () => {
  it("[] → status='error' и все метрики null", () => {
    const result = mapApifyToAccountMetrics([], "tiktok")
    expect(result.status).toBe("error")
    expect(result.followers).toBeNull()
    expect(result.posts).toHaveLength(0)
    expect(result.sampleSize).toBe(0)
    expect(result.errorMessage).toMatch(/пустой массив/)
  })
})

describe("mapApifyToAccountMetrics — нулевые просмотры", () => {
  it("sumViews=0 → engagementRate=null (не NaN/Infinity)", () => {
    const zeroViews = [
      {
        id: "x",
        webVideoUrl: "u",
        playCount: 0,
        diggCount: 5,
        commentCount: 3,
        shareCount: 0,
        createTime: 1717200000,
        authorMeta: { fans: 100 },
      },
    ]
    const result = mapApifyToAccountMetrics(zeroViews, "tiktok")
    expect(result.engagementRate).toBeNull()
    expect(Number.isFinite(result.engagementRate ?? 0)).toBe(true)
  })
})

describe("mapApifyToAccountMetrics — runtime guard на сломанных данных", () => {
  it("упавший mapper отдаёт status='error' с rawSample, а не unhandled throw", () => {
    // Создаём фикстуру, на которой mapper упадёт: posts.map бросает через геттер
    const broken = [
      {
        get authorMeta(): never {
          throw new Error("simulated apify shape mismatch")
        },
      },
    ] as unknown as Record<string, unknown>[]
    // Не оборачиваем в try — должно вернуть error-результат, а не выкинуть
    const result = mapApifyToAccountMetrics(broken, "tiktok")
    expect(result.status).toBe("error")
    expect(result.errorMessage).toMatch(/упал на платформе tiktok/)
    expect(result.rawSample).toBeDefined()
  })
})

describe("mapApifyToAccountMetrics — все 3 платформы не падают на фикстурах", () => {
  it("TikTok ok", () => {
    const r = mapApifyToAccountMetrics(tiktokSample, "tiktok")
    expect(r.status).toBe("ok")
  })

  it("Instagram ok с правильным postsCount и engagement", () => {
    const r = mapApifyToAccountMetrics(instagramSample, "instagram")
    expect(r.status).toBe("ok")
    expect(r.followers).toBe(25000n)
    expect(r.postsCount).toBe(87)
    expect(r.sampleSize).toBe(3)
    // sumViews=500+800+1200=2500, sumLikes=50+90+150=290, sumComments=5+10+20=35
    // (290+35)/2500 = 325/2500 = 0.13
    expect(r.engagementRate).toBeCloseTo(0.13, 10)
  })

  it("YouTube ok с subscriberCount и videos[]", () => {
    const r = mapApifyToAccountMetrics(youtubeSample, "youtube")
    expect(r.status).toBe("ok")
    expect(r.followers).toBe(120000n)
    expect(r.totalViews).toBe(5500000n)
    expect(r.following).toBeNull()
    expect(r.sampleSize).toBe(2)
  })
})
