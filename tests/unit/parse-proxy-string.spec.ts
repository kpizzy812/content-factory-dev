/**
 * Unit-тесты smart-парсера прокси-строк (shared/types/proxy.ts).
 *
 * Покрывает три формата ввода (URL, colon, минимум host:port), извлечение
 * NodeMaven-style метаданных из username и формирование suggestedLabel.
 *
 * `now` принудительно фиксирован в `parseProxyString(input, now)` — даты в
 * suggestedLabel предсказуемы.
 */
import { describe, expect, it } from "vitest"
import { parseProxyString } from "../../shared/types/proxy"

const FIXED_NOW = new Date("2026-05-15T12:00:00Z")
const FIXED_DATE_SUFFIX = "15_05_26"

describe("parseProxyString — backward compat", () => {
  it("возвращает null для пустой строки", () => {
    expect(parseProxyString("")).toBeNull()
    expect(parseProxyString("   ")).toBeNull()
  })

  it("возвращает null для строки без host:port", () => {
    expect(parseProxyString("not-a-proxy")).toBeNull()
  })

  it("возвращает null если порт не число", () => {
    expect(parseProxyString("host:notaport")).toBeNull()
  })

  it("возвращает null если порт вне диапазона", () => {
    expect(parseProxyString("host:99999")).toBeNull()
    expect(parseProxyString("host:0")).toBeNull()
  })

  it("парсит минимальный host:port", () => {
    const r = parseProxyString("proxy.example.com:8080", FIXED_NOW)
    expect(r).toMatchObject({
      protocol: "http",
      host: "proxy.example.com",
      port: 8080,
      username: undefined,
      password: undefined,
    })
  })

  it("парсит host:port:user:pass", () => {
    const r = parseProxyString("proxy.example.com:8080:user:pass", FIXED_NOW)
    expect(r).toMatchObject({
      protocol: "http",
      host: "proxy.example.com",
      port: 8080,
      username: "user",
      password: "pass",
    })
  })
})

describe("parseProxyString — URL format", () => {
  it("парсит socks5://user:pass@host:port", () => {
    const r = parseProxyString("socks5://user:pass@gate.nodemaven.com:1080", FIXED_NOW)
    expect(r).toMatchObject({
      protocol: "socks5",
      host: "gate.nodemaven.com",
      port: 1080,
      username: "user",
      password: "pass",
      provider: "NodeMaven",
    })
  })

  it("парсит http:// URL", () => {
    const r = parseProxyString("http://u:p@host.example.com:8080", FIXED_NOW)
    expect(r).toMatchObject({
      protocol: "http",
      host: "host.example.com",
      port: 8080,
      username: "u",
      password: "p",
    })
  })

  it("парсит https:// URL", () => {
    const r = parseProxyString("https://u:p@host.example.com:8443", FIXED_NOW)
    expect(r).toMatchObject({
      protocol: "https",
      host: "host.example.com",
      port: 8443,
    })
  })

  it("декодирует URL-encoded creds", () => {
    const r = parseProxyString("http://user%40mail:p%26ss@host:8080", FIXED_NOW)
    expect(r?.username).toBe("user@mail")
    expect(r?.password).toBe("p&ss")
  })

  it("использует дефолтный порт если он не указан", () => {
    expect(parseProxyString("socks5://u:p@host", FIXED_NOW)?.port).toBe(1080)
    expect(parseProxyString("http://u:p@host", FIXED_NOW)?.port).toBe(8080)
    expect(parseProxyString("https://u:p@host", FIXED_NOW)?.port).toBe(8443)
  })

  it("возвращает null для невалидной URL-схемы", () => {
    expect(parseProxyString("ftp://u:p@host:21")).toBeNull()
  })
})

describe("parseProxyString — NodeMaven-style metadata", () => {
  it("извлекает country, region, ipv4-true, sid, filter; type=residential по умолчанию", () => {
    const r = parseProxyString(
      "gate.nodemaven.com:8080:user-country-us-region-california-ipv4-true-sid-abc123-filter-medium:pass",
      FIXED_NOW,
    )
    expect(r).toMatchObject({
      protocol: "http",
      host: "gate.nodemaven.com",
      port: 8080,
      username: "user-country-us-region-california-ipv4-true-sid-abc123-filter-medium",
      password: "pass",
      provider: "NodeMaven",
      type: "residential",
      expectedCountry: "US",
      expectedCity: "California",
      ipv4Only: true,
      sessionId: "abc123",
      filter: "medium",
    })
  })

  it("type-mobile перекрывает дефолт residential", () => {
    const r = parseProxyString(
      "gate.nodemaven.com:1080:user-country-us-region-california-type-mobile-ipv4-true-sid-xyz789-filter-medium:pass",
      FIXED_NOW,
    )
    expect(r).toMatchObject({
      protocol: "socks5",
      port: 1080,
      type: "mobile",
      expectedCountry: "US",
      expectedCity: "California",
    })
  })

  it("конвертирует region с underscore в человеческое имя", () => {
    const r = parseProxyString(
      "socks5://user-country-us-region-new_jersey-ipv4-true-sid-xxx-filter-medium:pass@gate.nodemaven.com:1080",
      FIXED_NOW,
    )
    expect(r).toMatchObject({
      protocol: "socks5",
      host: "gate.nodemaven.com",
      port: 1080,
      username: "user-country-us-region-new_jersey-ipv4-true-sid-xxx-filter-medium",
      password: "pass",
      expectedCity: "New Jersey",
      expectedCountry: "US",
    })
  })

  it("region с несколькими подчёркиваниями (los_angeles_west)", () => {
    const r = parseProxyString(
      "gate.nodemaven.com:8080:user-country-us-region-los_angeles_west-ipv4-true:pass",
      FIXED_NOW,
    )
    expect(r?.expectedCity).toBe("Los Angeles West")
  })

  it("ipv4-false корректно превращается в false", () => {
    const r = parseProxyString(
      "gate.nodemaven.com:8080:user-country-us-ipv4-false:pass",
      FIXED_NOW,
    )
    expect(r?.ipv4Only).toBe(false)
  })

  it("без NodeMaven-username метаданные не вытаскиваются", () => {
    const r = parseProxyString("gate.nodemaven.com:8080:plainuser:pass", FIXED_NOW)
    expect(r?.provider).toBe("NodeMaven")
    expect(r?.expectedCountry).toBeUndefined()
    expect(r?.type).toBeUndefined()
    expect(r?.ipv4Only).toBeUndefined()
  })

  it("распознаёт type-datacenter", () => {
    const r = parseProxyString(
      "gate.nodemaven.com:8080:user-country-de-type-datacenter:pass",
      FIXED_NOW,
    )
    expect(r?.type).toBe("datacenter")
    expect(r?.expectedCountry).toBe("DE")
  })
})

describe("parseProxyString — provider detection", () => {
  it("определяет NodeMaven по hostname", () => {
    const r = parseProxyString("gate.nodemaven.com:1080", FIXED_NOW)
    expect(r?.provider).toBe("NodeMaven")
  })

  it("определяет IPRoyal по hostname", () => {
    const r = parseProxyString("residential.iproyal.com:12321", FIXED_NOW)
    expect(r?.provider).toBe("IPRoyal")
  })

  it("неизвестный hostname → provider undefined", () => {
    const r = parseProxyString("custom-proxy.example.org:8080", FIXED_NOW)
    expect(r?.provider).toBeUndefined()
  })
})

describe("parseProxyString — suggestedLabel", () => {
  it("формирует label «Provider PROTO Type COUNTRY DD_MM_YY»", () => {
    const r = parseProxyString(
      "gate.nodemaven.com:1080:user-country-us-region-california-type-mobile-ipv4-true:pass",
      FIXED_NOW,
    )
    expect(r?.suggestedLabel).toBe(`NodeMaven SOCKS5 Mobile US ${FIXED_DATE_SUFFIX}`)
  })

  it("без metadata label содержит только то, что распознано + дата", () => {
    const r = parseProxyString("custom-host.example.com:8080", FIXED_NOW)
    expect(r?.suggestedLabel).toBe(`HTTP ${FIXED_DATE_SUFFIX}`)
  })

  it("residential дефолт попадает в label", () => {
    const r = parseProxyString(
      "gate.nodemaven.com:8080:user-country-de-region-berlin-ipv4-true:pass",
      FIXED_NOW,
    )
    expect(r?.suggestedLabel).toBe(`NodeMaven HTTP Residential DE ${FIXED_DATE_SUFFIX}`)
  })
})

describe("parseProxyString — protocol inference by port", () => {
  it("порт 1080 → socks5", () => {
    expect(parseProxyString("host:1080", FIXED_NOW)?.protocol).toBe("socks5")
  })
  it("порт 8443 → https", () => {
    expect(parseProxyString("host:8443", FIXED_NOW)?.protocol).toBe("https")
  })
  it("порт 8080 → http", () => {
    expect(parseProxyString("host:8080", FIXED_NOW)?.protocol).toBe("http")
  })
  it("порт 3128 → http (дефолт для unknown)", () => {
    expect(parseProxyString("host:3128", FIXED_NOW)?.protocol).toBe("http")
  })
})
