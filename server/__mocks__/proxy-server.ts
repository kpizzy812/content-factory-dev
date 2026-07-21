/**
 * Mock IP-info HTTP сервер для тестирования proxy-checker'а без реального прокси.
 *
 * Запуск: bun run mock:proxy   (или npm run mock:proxy)
 * Слушает: http://localhost:18888 по умолчанию (override: MOCK_PROXY_PORT)
 *
 * Сценарии задаются через query param "scenario":
 *   GET /json?scenario=happy_path     → 200, валидный IP + страна
 *   GET /json?scenario=happy_ru       → 200, российский IP
 *   GET /json?scenario=slow           → 200 после 6с задержки (медленный прокси)
 *   GET /json?scenario=timeout        → 200 после 30с (превышает probe timeout)
 *   GET /json?scenario=auth_failed    → 407 Proxy Authentication Required
 *   GET /json?scenario=leak           → 200, IP сервера (триггерит leak detection)
 *   GET /json?scenario=private_ip     → 200, приватный IP
 *   GET /json?scenario=conn_refused   → 502
 *
 * В mock-режиме probe.ts роутит ipinfo.io / api.ipify.org → этот сервер,
 * передавая scenario через PROXY_MOCK_SCENARIO env (либо берётся happy_path по умолчанию).
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

const PORT = Number(process.env.MOCK_PROXY_PORT ?? 18888)
const SERVER_IP_PLACEHOLDER = process.env.MOCK_PROXY_SERVER_IP ?? "203.0.113.42"

interface ProxyScenario {
  delayMs?: number
  status: number
  detectedIp: string
  detectedCountry?: string
  detectedCity?: string
}

const SCENARIOS: Record<string, ProxyScenario> = {
  happy_path: { status: 200, detectedIp: "188.166.55.42", detectedCountry: "NL", detectedCity: "Amsterdam" },
  happy_ru: { status: 200, detectedIp: "95.181.234.111", detectedCountry: "RU", detectedCity: "Moscow" },
  slow: { delayMs: 6_000, status: 200, detectedIp: "188.166.55.42", detectedCountry: "NL" },
  timeout: { delayMs: 30_000, status: 200, detectedIp: "188.166.55.42" },
  auth_failed: { status: 407, detectedIp: "" },
  leak: { status: 200, detectedIp: SERVER_IP_PLACEHOLDER },
  private_ip: { status: 200, detectedIp: "10.0.0.1" },
  conn_refused: { status: 502, detectedIp: "" },
}

function pickScenarioKey(req: IncomingMessage): string {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`)
  const fromQuery = url.searchParams.get("scenario")
  if (fromQuery && SCENARIOS[fromQuery]) return fromQuery
  const fromHeader = req.headers["x-mock-scenario"]
  if (typeof fromHeader === "string" && SCENARIOS[fromHeader]) return fromHeader
  return "happy_path"
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const key = pickScenarioKey(req)
  const scenario = SCENARIOS[key]!

  console.log(`[mock-proxy] ${req.method} ${req.url} → scenario=${key}`)

  if (scenario.delayMs) {
    await new Promise(r => setTimeout(r, scenario.delayMs))
  }

  res.statusCode = scenario.status
  res.setHeader("Content-Type", "application/json; charset=utf-8")

  if (scenario.status === 200) {
    res.end(JSON.stringify({
      ip: scenario.detectedIp,
      country: scenario.detectedCountry,
      city: scenario.detectedCity,
      mockScenario: key,
    }))
    return
  }

  res.end(JSON.stringify({
    error: `mock-proxy scenario "${key}" returned status ${scenario.status}`,
    mockScenario: key,
  }))
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error("[mock-proxy] handler error:", err)
    if (!res.headersSent) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: "mock handler failure" }))
    }
  })
})

server.listen(PORT, () => {
  console.log(`[mock-proxy] listening on http://localhost:${PORT}`)
  console.log(`[mock-proxy] scenarios: ${Object.keys(SCENARIOS).join(", ")}`)
  console.log(`[mock-proxy] usage: PROXY_MOCK_MODE=true PROXY_MOCK_URL=http://localhost:${PORT} npm run dev`)
})

const shutdown = (): void => {
  console.log("[mock-proxy] shutting down")
  server.close(() => process.exit(0))
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
