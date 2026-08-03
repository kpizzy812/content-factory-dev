/**
 * Unit-тесты разведки аккаунтов ниши и коэффициента виральности.
 *
 * Фикстура instagram-accounts-sample.json повторяет форму реального ответа
 * apify/instagram-scraper в режиме searchType=user, resultsType=details.
 *
 * Смысл коэффициента: абсолютные просмотры не говорят, выстрелил ролик или
 * нет. 115 394 просмотра у аккаунта на 690 983 подписчика — провал (x0.17),
 * а 4 229 803 у аккаунта на 297 183 — вирус (x14.2).
 */
import { describe, it, expect } from "vitest"
import accounts from "./fixtures/apify/instagram-accounts-sample.json"
import {
  buildAccountSearchInput,
  calcVirality,
  extractFollowerCounts,
  pickTopAccounts,
} from "../../server/utils/apify-client"

describe("calcVirality", () => {
  it("считает отношение просмотров к аудитории", () => {
    expect(calcVirality(4229803, 297183)).toBeCloseTo(14.23, 2)
    expect(calcVirality(115394, 690983)).toBeCloseTo(0.17, 2)
  })

  it("возвращает null, когда аудитория неизвестна или пуста", () => {
    expect(calcVirality(1000, 0)).toBeNull()
    expect(calcVirality(1000, null)).toBeNull()
    expect(calcVirality(1000, undefined)).toBeNull()
  })

  it("возвращает null без просмотров — делить нечего", () => {
    expect(calcVirality(0, 10000)).toBeNull()
  })
})

describe("pickTopAccounts", () => {
  it("сортирует по аудитории и обрезает до лимита", () => {
    const top = pickTopAccounts(accounts, 3)

    expect(top.map((a) => a.username)).toEqual([
      "makeeva_olesya",
      "guarchibaolife",
      "asya.rosh",
    ])
    expect(top[0]!.followers).toBe(690983)
  })

  it("выбрасывает закрытые аккаунты — их ленту не собрать", () => {
    const top = pickTopAccounts(accounts, 10)

    expect(top.map((a) => a.username)).not.toContain("closed_nutri")
  })

  it("выбрасывает записи без числа подписчиков", () => {
    const top = pickTopAccounts(accounts, 10)

    expect(top.map((a) => a.username)).not.toContain("no_stats_nutri")
  })

  it("отдаёт готовое ключевое слово для профиля сбора", () => {
    const top = pickTopAccounts(accounts, 1)

    expect(top[0]!.keyword).toBe("@makeeva_olesya")
  })
})

describe("extractFollowerCounts", () => {
  it("собирает карту логин → подписчики", () => {
    const map = extractFollowerCounts(accounts)

    expect(map.get("makeeva_olesya")).toBe(690983)
    expect(map.get("asya.rosh")).toBe(297183)
  })

  it("не заводит записей для профилей без статистики", () => {
    const map = extractFollowerCounts(accounts)

    expect(map.has("no_stats_nutri")).toBe(false)
  })

  it("не зависит от регистра логина", () => {
    const map = extractFollowerCounts([
      { username: "Asya.Rosh", followersCount: 297183 },
    ])

    expect(map.get("asya.rosh")).toBe(297183)
  })
})

describe("buildAccountSearchInput", () => {
  it("просит у актора именно аккаунты с их статистикой", () => {
    const input = buildAccountSearchInput("нутрициолог", 20)

    expect(input.search).toBe("нутрициолог")
    expect(input.searchType).toBe("user")
    expect(input.searchLimit).toBe(20)
    expect(input.resultsType).toBe("details")
  })

  it("держит лимит в разумных границах", () => {
    expect(buildAccountSearchInput("тема", 0).searchLimit).toBe(1)
    expect(buildAccountSearchInput("тема", 999).searchLimit).toBe(50)
  })
})
