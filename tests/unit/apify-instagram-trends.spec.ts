/**
 * Unit-тесты Instagram-режима Apify-трендов.
 *
 * Фикстура instagram-posts-sample.json снята с реального ответа
 * apify/instagram-scraper (actor shu8hvrXbJbY3Eb9W, resultsType=posts):
 * поля и их имена не выдуманы, а зафиксированы по факту.
 *
 * Проверяем две вещи:
 *   1) input для актора строится в его формате (directUrls), а не в формате
 *      TikTok-скрапера (searchQueries) — иначе актор вернёт пустой dataset;
 *   2) mapApifyToTrend читает instagram-поля и при этом не ломает TikTok.
 */
import { describe, it, expect } from "vitest"
import instagramPosts from "./fixtures/apify/instagram-posts-sample.json"
import {
  buildKeywordSearchInput,
  isImportableApifyItem,
  isInstagramScraperActor,
  mapApifyToTrend,
} from "../../server/utils/apify-client"

const IG_PROFILE = {
  appId: 1,
  keywords: ["humansofny"],
  platforms: ["instagram"],
  language: "en",
  geo: "US",
}

describe("isInstagramScraperActor", () => {
  it("распознаёт актор и по slug, и по внутреннему id", () => {
    expect(isInstagramScraperActor("apify/instagram-scraper")).toBe(true)
    expect(isInstagramScraperActor("apify~instagram-scraper")).toBe(true)
    expect(isInstagramScraperActor("shu8hvrXbJbY3Eb9W")).toBe(true)
  })

  it("не путает его с TikTok-скрапером", () => {
    expect(isInstagramScraperActor("clockworks/tiktok-scraper")).toBe(false)
    expect(isInstagramScraperActor("GdWCkxBtKWOsKjdch")).toBe(false)
  })
})

describe("buildKeywordSearchInput", () => {
  it("для TikTok-актора отдаёт searchQueries", () => {
    const input = buildKeywordSearchInput("clockworks/tiktok-scraper", {
      keywords: ["fitness", "gym"],
      maxItems: 20,
    })

    expect(input.searchQueries).toEqual(["fitness", "gym"])
    expect(input.maxItems).toBe(20)
  })

  // Проверено на живом акторе: без resultsPerPage запрос из двух слов
  // вернул 2 видео вместо 20 — актор берёт лимит именно отсюда.
  it("делит лимит между запросами через resultsPerPage", () => {
    const input = buildKeywordSearchInput("clockworks/tiktok-scraper", {
      keywords: ["fitness", "gym"],
      maxItems: 20,
    })

    expect(input.resultsPerPage).toBe(10)
  })

  it("держит resultsPerPage не меньше единицы", () => {
    const input = buildKeywordSearchInput("clockworks/tiktok-scraper", {
      keywords: ["a", "b", "c"],
      maxItems: 2,
    })

    expect(input.resultsPerPage).toBe(1)
  })

  it("для Instagram-актора отдаёт directUrls, а не searchQueries", () => {
    const input = buildKeywordSearchInput("apify/instagram-scraper", {
      keywords: ["fitness"],
      maxItems: 25,
    })

    expect(input.searchQueries).toBeUndefined()
    expect(input.resultsLimit).toBe(25)
    expect(input.directUrls).toEqual([
      "https://www.instagram.com/explore/tags/fitness/",
    ])
  })

  it("различает аккаунт, хэштег и готовый URL", () => {
    const input = buildKeywordSearchInput("apify/instagram-scraper", {
      keywords: [
        "@humansofny",
        "#fitness",
        "https://www.instagram.com/humansofny/",
        "две слова",
      ],
      maxItems: 10,
    })

    expect(input.directUrls).toEqual([
      "https://www.instagram.com/humansofny/",
      "https://www.instagram.com/explore/tags/fitness/",
      "https://www.instagram.com/humansofny/",
      "https://www.instagram.com/explore/tags/двеслова/",
    ])
  })
})

describe("mapApifyToTrend — Instagram", () => {
  it("читает метрики, автора и дату из instagram-полей", () => {
    const trend = mapApifyToTrend(instagramPosts[0]!, IG_PROFILE)

    expect(trend.platform).toBe("instagram")
    expect(trend.sourceUrl).toBe("https://www.instagram.com/p/DbiTJJvomA1/")
    expect(trend.viewCount).toBe(2292302) // videoPlayCount, а не videoViewCount
    expect(trend.likeCount).toBe(107413)
    expect(trend.commentCount).toBe(960)
    expect(trend.authorName).toBe("Humans of New York")
    expect(trend.thumbnailUrl).toBe(
      "https://scontent.cdninstagram.com/v/t51.82787-15/thumb.jpg",
    )
    expect(trend.videoUrl).toBe(
      "https://scontent.cdninstagram.com/v/t50.12441-16/video.mp4",
    )
    expect(trend.hashtags).toEqual(["newyork", "story"])
    expect(trend.publishedAt).toEqual(new Date("2026-07-29T15:02:11.000Z"))
  })

  it("не падает на посте без видео — просмотры нулевые, остальное на месте", () => {
    const trend = mapApifyToTrend(instagramPosts[1]!, IG_PROFILE)

    expect(trend.viewCount).toBe(0)
    expect(trend.likeCount).toBe(256987)
    expect(trend.commentCount).toBe(3966)
    expect(trend.videoUrl).toBeNull()
  })

  it("забирает username, когда полного имени нет", () => {
    const anonymous = { ...instagramPosts[2]!, ownerFullName: "" }
    const trend = mapApifyToTrend(anonymous, IG_PROFILE)

    expect(trend.authorName).toBe("jacopo19949")
  })
})

describe("просмотры Reels", () => {
  // У Reels videoViewCount приходит бессмысленно маленьким (13 просмотров при
  // 949 лайках), реальные показы лежат в videoPlayCount. Проверено на живом
  // акторе, resultsType=reels.
  it("берёт videoPlayCount, а не videoViewCount", () => {
    const reel = {
      url: "https://www.instagram.com/reel/DZzjJ0QCM_U/",
      type: "Video",
      caption: "This is what awakening looks like",
      videoPlayCount: 14030,
      videoViewCount: 13,
      likesCount: 949,
      commentsCount: 12,
      videoDuration: 13.071,
      ownerUsername: "victoria.tropacheva",
      timestamp: "2026-07-20T10:00:00.000Z",
    }

    const trend = mapApifyToTrend(reel, IG_PROFILE)

    expect(trend.viewCount).toBe(14030)
  })

  it("не теряет просмотры, когда есть только videoViewCount", () => {
    const post = { ...instagramPosts[0]!, videoPlayCount: undefined }
    const trend = mapApifyToTrend(post, IG_PROFILE)

    expect(trend.viewCount).toBe(1026795)
  })
})

describe("формат выдачи Instagram", () => {
  it("по умолчанию просит Reels — фабрика делает вертикальные видео", () => {
    const input = buildKeywordSearchInput("apify/instagram-scraper", {
      keywords: ["@somebody"],
      maxItems: 10,
    })

    expect(input.resultsType).toBe("reels")
  })

  it("умеет переключиться на обычные посты", () => {
    const input = buildKeywordSearchInput("apify/instagram-scraper", {
      keywords: ["@somebody"],
      maxItems: 10,
      contentFormat: "posts",
    })

    expect(input.resultsType).toBe("posts")
  })

  it("формат не влияет на TikTok-актор", () => {
    const input = buildKeywordSearchInput("clockworks/tiktok-scraper", {
      keywords: ["fitness"],
      maxItems: 10,
      contentFormat: "posts",
    })

    expect(input.resultsType).toBeUndefined()
    expect(input.searchQueries).toEqual(["fitness"])
  })
})

describe("скрытые лайки", () => {
  // Instagram отдаёт -1 вместо количества, когда автор скрыл лайки.
  // В базе это превращалось в тренд с likeCount = -1 и ломало сортировку.
  it("превращает -1 в ноль, а не тащит минус в базу", () => {
    const hidden = {
      ...instagramPosts[0]!,
      likesCount: -1,
      videoPlayCount: -1,
      videoViewCount: -1,
    }
    const trend = mapApifyToTrend(hidden, IG_PROFILE)

    expect(trend.likeCount).toBe(0)
    expect(trend.viewCount).toBe(0)
  })
})

describe("isImportableApifyItem", () => {
  // Пустой прогон возвращает не пустой массив, а один элемент-заглушку.
  it("отбрасывает служебный элемент об отсутствии данных", () => {
    expect(
      isImportableApifyItem({
        error: "no_items",
        errorDescription: "Empty or private data for provided input",
      }),
    ).toBe(false)
  })

  it("отбрасывает элемент без ссылки на публикацию", () => {
    expect(isImportableApifyItem({ caption: "текст без ссылки" })).toBe(false)
    expect(isImportableApifyItem({})).toBe(false)
  })

  it("пропускает нормальные посты обеих платформ", () => {
    expect(isImportableApifyItem(instagramPosts[0]!)).toBe(true)
    expect(
      isImportableApifyItem({ webVideoUrl: "https://www.tiktok.com/@a/video/1" }),
    ).toBe(true)
  })
})

describe("mapApifyToTrend — TikTok не сломан", () => {
  it("по-прежнему читает playCount/diggCount/authorMeta", () => {
    const tiktokItem = {
      text: "Weights & that",
      webVideoUrl: "https://www.tiktok.com/@lucas.kth/video/7551",
      authorMeta: { name: "lucas.kth" },
      playCount: 792600,
      diggCount: 71800,
      commentCount: 230,
      shareCount: 12,
      hashtags: [{ name: "motivation" }, { name: "fitness" }],
      createTime: 1785000000,
      videoMeta: { coverUrl: "https://p16.tiktokcdn.com/cover.jpg" },
    }

    const trend = mapApifyToTrend(tiktokItem, {
      ...IG_PROFILE,
      platforms: ["tiktok"],
    })

    expect(trend.platform).toBe("tiktok")
    expect(trend.viewCount).toBe(792600)
    expect(trend.likeCount).toBe(71800)
    expect(trend.commentCount).toBe(230)
    expect(trend.authorName).toBe("lucas.kth")
    expect(trend.hashtags).toEqual(["motivation", "fitness"])
    expect(trend.thumbnailUrl).toBe("https://p16.tiktokcdn.com/cover.jpg")
  })
})
