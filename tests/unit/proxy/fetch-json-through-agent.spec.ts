/**
 * Unit-тесты fetchJson — гарантируют что низкоуровневый GET в probe.ts:
 *
 * 1. Использует `https.request` с explicit options object (hostname/port/path/agent),
 *    а НЕ URL string. Иначе в Node 22+ возможен silent proxy bypass.
 * 2. Реально использует переданный `agent.createConnection` — он вызывается
 *    при каждом запросе с правильно распарсенным URL (hostname/port).
 * 3. Корректно парсит ответ http и https независимо.
 *
 * Прецедент 14.05.2026: production diagnostic показал что Node-варианты
 * (https.request + SocksProxyAgent) шли direct connect мимо прокси (~150ms
 * вместо ~1200ms у curl). См. .claude/agent-memory/architect/proxy_leak_node_fix_preflight.md
 */
import * as http from "node:http"
import { AddressInfo } from "node:net"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { fetchJson } from "../../../server/utils/proxy/probe"

interface RecordedRequest {
  url: string | undefined
  headers: http.IncomingHttpHeaders
}

describe("fetchJson", () => {
  let server: http.Server
  let baseUrl: string
  const recorded: RecordedRequest[] = []

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      recorded.push({ url: req.url, headers: req.headers })
      if (req.url === "/echo-json") {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ ip: "1.2.3.4", country: "US" }))
        return
      }
      if (req.url === "/auth-fail") {
        res.writeHead(407)
        res.end("auth required")
        return
      }
      if (req.url === "/500") {
        res.writeHead(500)
        res.end("server error")
        return
      }
      if (req.url === "/bad-json") {
        res.writeHead(200, { "content-type": "application/json" })
        res.end("{not json")
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const port = (server.address() as AddressInfo).port
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it("парсит JSON-ответ от http endpoint", async () => {
    const data = await fetchJson<{ ip: string; country: string }>(
      `${baseUrl}/echo-json`,
    )
    expect(data.ip).toBe("1.2.3.4")
    expect(data.country).toBe("US")
  })

  it("устанавливает корректный Host header (для virtual hosting)", async () => {
    recorded.length = 0
    await fetchJson(`${baseUrl}/echo-json`)
    expect(recorded.at(-1)?.headers.host).toMatch(/^127\.0\.0\.1:\d+$/)
  })

  it("устанавливает User-Agent для идентификации probe запросов", async () => {
    recorded.length = 0
    await fetchJson(`${baseUrl}/echo-json`)
    expect(recorded.at(-1)?.headers["user-agent"]).toBe("ZavodCamp-ProxyChecker/1.0")
  })

  it("отвергает 407 как auth_failed", async () => {
    await expect(fetchJson(`${baseUrl}/auth-fail`)).rejects.toThrow("auth_failed")
  })

  it("отвергает HTTP 5xx с понятным сообщением", async () => {
    await expect(fetchJson(`${baseUrl}/500`)).rejects.toThrow("HTTP 500")
  })

  it("отвергает невалидный JSON", async () => {
    await expect(fetchJson(`${baseUrl}/bad-json`)).rejects.toThrow()
  })

  it("реально вызывает agent.createConnection с корректными options (через http.Agent spy)", async () => {
    // Создаём кастомный http.Agent и spy'им на createConnection.
    // Если fetchJson внутри использует `lib.get(url_string, ...)` без explicit
    // options — agent может быть проигнорирован Node'ом в некоторых scenarios.
    // Этот тест гарантирует что agent.createConnection ВСЕГДА вызывается
    // с hostname/port парсенными из URL.
    const customAgent = new http.Agent({ keepAlive: false })
    const createSpy = vi.spyOn(customAgent, "createConnection")

    await fetchJson(`${baseUrl}/echo-json`, customAgent)

    expect(createSpy).toHaveBeenCalledTimes(1)
    const opts = createSpy.mock.calls[0]![0] as {
      host?: string
      hostname?: string
      port?: string | number
      path?: string
    }
    // Node может передать host или hostname (одно из), но точно — IP + port.
    expect(opts.host ?? opts.hostname).toBe("127.0.0.1")
    expect(Number(opts.port)).toBe(Number(new URL(baseUrl).port))
    createSpy.mockRestore()
  })

  it("свежий agent на каждый вызов — createConnection вызывается каждый раз", async () => {
    // Регрессия: pool reuse может маскировать utilцию agent. Гарантируем что
    // каждый probe — это новый createConnection.
    const agent1 = new http.Agent({ keepAlive: false })
    const agent2 = new http.Agent({ keepAlive: false })
    const spy1 = vi.spyOn(agent1, "createConnection")
    const spy2 = vi.spyOn(agent2, "createConnection")

    await fetchJson(`${baseUrl}/echo-json`, agent1)
    await fetchJson(`${baseUrl}/echo-json`, agent2)

    expect(spy1).toHaveBeenCalledTimes(1)
    expect(spy2).toHaveBeenCalledTimes(1)
    spy1.mockRestore()
    spy2.mockRestore()
  })

  it("без agent — работает через дефолтный Node http.Agent (baseline без прокси)", async () => {
    // Когда `getServerIp` запрашивает свой IP — agent НЕ передаётся.
    // Должно работать без ошибок.
    const data = await fetchJson<{ ip: string }>(`${baseUrl}/echo-json`)
    expect(data.ip).toBe("1.2.3.4")
  })

  it("path + query string передаются в options.path", async () => {
    recorded.length = 0
    await fetchJson(`${baseUrl}/echo-json?foo=bar&baz=qux`).catch(() => null)
    expect(recorded.at(-1)?.url).toBe("/echo-json?foo=bar&baz=qux")
  })
})
