import * as http from "node:http"
import * as https from "node:https"
import * as net from "node:net"
import { HttpProxyAgent } from "http-proxy-agent"
import { HttpsProxyAgent } from "https-proxy-agent"
import type {
  ProxyCheckResult,
  ProxyCredentials,
  ProxyProtocol,
} from "../../../shared/types/proxy"
import { getProxyMockUrl, isProxyMockMode } from "../mock/mode"
import { socksHttpGet, socksHttpsGet } from "./socks-fetch"

const TIMEOUT_MS = 10_000
// 5 минут — баланс между rate-limit внешних IP-сервисов и актуальностью IP сервера.
// 1 час давал stale значения когда контейнер перезапускался с новым внешним IP, и
// все следующие проверки прокси выдавали ложный leak.
const SERVER_IP_TTL_MS = 5 * 60 * 1000

interface ServerIpCacheEntry {
  ip: string | null
  expiresAt: number
  // Диагностика: какие источники отдали какой IP — видно в rawProbeData
  sources?: Array<{ url: string; ip: string | null; error?: string }>
}

const SERVER_IP_CACHE: ServerIpCacheEntry = {
  ip: null,
  expiresAt: 0,
}

/**
 * Несколько публичных IP-сервисов для multi-source consensus. Если один из них
 * вернёт неверный IP (например, кеш Cloudflare с другой ноды), консенсус по
 * двум остальным даст правильный. Ранее единственный ipify иногда отвечал
 * IP edge-CDN-узла, что давало ложный leak в дальнейшем.
 */
const SERVER_IP_PROBE_URLS = [
  "https://api.ipify.org?format=json",
  "https://ipinfo.io/json",
  "https://api.myip.com",
] as const

/**
 * URL для leak-detection в mock-режиме.
 */
function getMockServerIpProbeUrl(): string {
  return `${getProxyMockUrl()}/json?scenario=server_ip`
}

/**
 * URL для проверки самого прокси через CONNECT-туннель (https probe).
 */
function getHttpsProbeUrl(): string {
  if (isProxyMockMode()) {
    return `${getProxyMockUrl()}/json`
  }
  return "https://ipinfo.io/json"
}

/**
 * URL для fallback-probe через forward HTTP-прокси (без CONNECT).
 */
function getHttpProbeUrl(): string {
  if (isProxyMockMode()) {
    return `${getProxyMockUrl()}/json`
  }
  return "http://api.ipify.org/?format=json"
}

/**
 * URL для header-probe: возвращает origin IP + заголовки, которые сервер увидел.
 * Используется чтобы отличить "трафик прошёл мимо прокси" (наш баг агента или
 * whitelist) от "прокси работал, но IP совпал" (transparent/overlapping pool).
 * httpbin.org — primary, postman-echo.com — fallback.
 */
const HEADER_PROBE_URLS_HTTPS = [
  "https://httpbin.org/get",
  "https://postman-echo.com/get",
] as const

const HEADER_PROBE_URLS_HTTP = [
  "http://httpbin.org/get",
  "http://postman-echo.com/get",
] as const

interface ProbeResponse {
  ip?: string
  country?: string
  city?: string
}

interface HeaderProbeResponse {
  // httpbin.org/get → { origin, headers, url }
  // postman-echo.com/get → { url, headers, args }
  origin?: string
  headers?: Record<string, string>
  url?: string
}

/**
 * Получает внешний IP сервера ZavodCamp (без прокси) для leak detection.
 *
 * Multi-source consensus: запрашиваем 3 независимых сервиса параллельно и
 * берём mode (наиболее частое значение). Это устраняет ложный leak когда один
 * из IP-сервисов отвечает stale-значением или IP edge-CDN-узла.
 *
 * Кешируется на 5 минут (сокращено с 1 часа — при смене внешнего IP сервера
 * leak detection быстрее восстановится).
 */
export async function getServerIp(): Promise<string | null> {
  if (SERVER_IP_CACHE.ip && SERVER_IP_CACHE.expiresAt > Date.now()) {
    return SERVER_IP_CACHE.ip
  }

  if (isProxyMockMode()) {
    try {
      const data = await fetchJson(getMockServerIpProbeUrl(), undefined, 5000)
      if (data && typeof data.ip === "string") {
        SERVER_IP_CACHE.ip = data.ip
        SERVER_IP_CACHE.expiresAt = Date.now() + SERVER_IP_TTL_MS
        SERVER_IP_CACHE.sources = [{ url: 'mock', ip: data.ip }]
        return data.ip
      }
    }
    catch {
      // mock fail — return null
    }
    return null
  }

  const sources: ServerIpCacheEntry['sources'] = []
  const ips: string[] = []

  await Promise.all(
    SERVER_IP_PROBE_URLS.map(async (url) => {
      try {
        const data = await fetchJson(url, undefined, 5000)
        const ip = typeof data.ip === 'string' && data.ip.length > 0 ? data.ip : null
        sources.push({ url, ip })
        if (ip) ips.push(ip)
      }
      catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        sources.push({ url, ip: null, error: message.slice(0, 120) })
      }
    }),
  )

  SERVER_IP_CACHE.sources = sources

  if (ips.length === 0) {
    return null
  }

  // Mode (наиболее частое значение). При равенстве выигрывает первый.
  const counts: Record<string, number> = {}
  for (const ip of ips) counts[ip] = (counts[ip] ?? 0) + 1
  const consensus = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![0]

  SERVER_IP_CACHE.ip = consensus
  SERVER_IP_CACHE.expiresAt = Date.now() + SERVER_IP_TTL_MS
  return consensus
}

/**
 * Возвращает диагностические данные multi-source serverIp probe — какие
 * источники что вернули. Используется для отладки ложных leak detection.
 */
export function getServerIpSources(): ServerIpCacheEntry['sources'] | undefined {
  return SERVER_IP_CACHE.sources
}

/**
 * Извлекает прокси-индикаторы из заголовков, которые увидел сервер. Если хоть
 * один присутствует — трафик ТОЧНО прошёл через прокси (даже если detectedIp
 * совпал с serverIp — это overlapping IP-pool, не наш баг агента).
 */
function extractProxyHeaders(probe: HeaderProbeResponse): Record<string, string> {
  const result: Record<string, string> = {}
  if (!probe.headers || typeof probe.headers !== 'object') return result

  const interesting = ['Via', 'X-Forwarded-For', 'X-Forwarded-Proto', 'Forwarded', 'X-Real-IP', 'X-Proxy-Id']
  // Заголовки case-insensitive: проверяем lowercase ключи.
  const lowerMap: Record<string, string> = {}
  for (const [k, v] of Object.entries(probe.headers)) {
    if (typeof v === 'string') lowerMap[k.toLowerCase()] = v
  }

  for (const name of interesting) {
    const v = lowerMap[name.toLowerCase()]
    if (typeof v === 'string' && v.length > 0) {
      result[name] = v.slice(0, 200)
    }
  }
  return result
}

/**
 * TCP connect к host:port с таймаутом.
 */
export function tcpConnect(host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port, timeout: TIMEOUT_MS })
    socket.once("connect", () => {
      socket.destroy()
      resolve()
    })
    socket.once("error", (err) => {
      socket.destroy()
      reject(err)
    })
    socket.once("timeout", () => {
      socket.destroy()
      reject(new Error("TCP timeout"))
    })
  })
}

/**
 * Низкоуровневый GET с поддержкой http/https + опциональным agent.
 *
 * ВАЖНО: используем https.request с explicit options object (hostname, port,
 * path), а НЕ url string. Это гарантирует что Node правильно мерджит agent
 * c parsed URL и не делает direct connect мимо прокси. Раньше fetchJson
 * принимал URL string как 1-й аргумент — в Node 22+ это давало интермиттентный
 * proxy bypass (~150ms direct connect вместо ~1200ms через SocksProxyAgent).
 *
 * Каждый вызов получает свой agent — pool reuse выключен на уровне probe.ts.
 */
export function fetchJson<T = ProbeResponse>(
  url: string,
  agent?: http.Agent | https.Agent,
  timeoutMs = TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const isHttps = u.protocol === "https:"
    const lib = isHttps ? https : http
    const port = u.port ? Number(u.port) : isHttps ? 443 : 80
    const path = `${u.pathname}${u.search}` || "/"
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port,
        path,
        method: "GET",
        agent,
        timeout: timeoutMs,
        headers: {
          Host: u.host,
          Accept: "application/json,text/plain,*/*",
          "User-Agent": "ZavodCamp-ProxyChecker/1.0",
        },
      },
      (res) => {
        if (res.statusCode === 407) {
          reject(new Error("auth_failed"))
          res.resume()
          return
        }
        if (!res.statusCode || res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`))
          res.resume()
          return
        }
        let data = ""
        res.setEncoding("utf8")
        res.on("data", (chunk) => {
          data += chunk
          // 64KB достаточно для httpbin.org/get с полным набором заголовков.
          if (data.length > 65_536) {
            req.destroy(new Error("response too large"))
          }
        })
        res.on("end", () => {
          try {
            resolve(JSON.parse(data) as T)
          } catch (err) {
            reject(err instanceof Error ? err : new Error("invalid JSON"))
          }
        })
      },
    )
    req.on("error", (err) => reject(err))
    req.on("timeout", () => {
      req.destroy(new Error("HTTP timeout"))
    })
    req.end()
  })
}

/**
 * Строит URL прокси с auth. schemeOverride позволяет принудительно задать
 * схему (например, "socks5h" для DNS-through-proxy варианта в diagnostic).
 * Экспортирован чтобы diagnostic.ts использовал ту же функцию — единый
 * источник правды для credentials encoding.
 */
export function buildProxyUrl(
  creds: ProxyCredentials,
  schemeOverride?: string,
): string {
  const auth = creds.username
    ? `${encodeURIComponent(creds.username)}:${encodeURIComponent(creds.password ?? "")}@`
    : ""
  const scheme =
    schemeOverride ??
    (creds.protocol === "https"
      ? "https"
      : creds.protocol === "socks5"
        ? "socks5"
        : "http")
  return `${scheme}://${auth}${creds.host}:${creds.port}`
}

/**
 * Agent для https-probe ЧЕРЕЗ HTTP/HTTPS прокси (CONNECT туннель).
 * Для SOCKS5 НЕ используется — там идём через socks lib напрямую (см.
 * fetchJsonViaProxy). Причина: agent-base@9 + Node v24+ имеют известный баг,
 * при котором SocksProxyAgent игнорируется https.request, что даёт silent
 * direct-connect (proxy bypass).
 */
function buildHttpsAgent(creds: ProxyCredentials): https.Agent {
  return new HttpsProxyAgent(buildProxyUrl(creds))
}

/**
 * Agent для http-probe ЧЕРЕЗ HTTP/HTTPS прокси (forward, без CONNECT).
 * Для SOCKS5 НЕ используется — см. комментарий выше.
 */
function buildHttpAgent(creds: ProxyCredentials): http.Agent {
  return new HttpProxyAgent(buildProxyUrl(creds))
}

/**
 * GET через прокси с авто-выбором транспорта по протоколу прокси.
 *
 * - SOCKS5: использует `socksHttpsGet` / `socksHttpGet` (socks lib напрямую,
 *   обходит SocksProxyAgent). Это рабочий путь в Node v24+ — известный баг
 *   agent-base@9 ломает SocksProxyAgent под https.request.
 * - HTTP/HTTPS прокси: использует `fetchJson` с HttpProxyAgent /
 *   HttpsProxyAgent. Этот путь не сломан.
 *
 * Выбор HTTP vs HTTPS делается по схеме `url`.
 */
async function fetchJsonViaProxy<T = unknown>(
  url: string,
  creds: ProxyCredentials,
  timeoutMs = TIMEOUT_MS,
): Promise<T> {
  const parsed = new URL(url)
  const isHttps = parsed.protocol === "https:"

  if (creds.protocol === "socks5") {
    const response = isHttps
      ? await socksHttpsGet(creds, url, { timeoutMs })
      : await socksHttpGet(creds, url, { timeoutMs })

    if (response.status === 407) {
      throw new Error("auth_failed")
    }
    if (response.status >= 400) {
      throw new Error(`HTTP ${response.status}`)
    }
    try {
      return JSON.parse(response.body) as T
    } catch (err) {
      throw err instanceof Error ? err : new Error("invalid JSON")
    }
  }

  const agent = isHttps ? buildHttpsAgent(creds) : buildHttpAgent(creds)
  return await fetchJson<T>(url, agent, timeoutMs)
}

function classifyProbeError(err: unknown): {
  category: ProxyCheckResult["errorCategory"]
  message: string
} {
  const raw = err instanceof Error ? err.message : String(err)
  const msg = raw.toLowerCase()

  if (raw === "auth_failed" || msg.includes("407")) {
    return { category: "auth_failed", message: "Прокси отклонил авторизацию (407)" }
  }
  if (msg.includes("timeout")) {
    return { category: "timeout", message: "Превышен таймаут при работе через прокси" }
  }
  if (msg.includes("ended before receiving connect")) {
    return {
      category: "connection_refused",
      message:
        "Прокси разорвал соединение до ответа на CONNECT. Проверь: правильный ли протокол (http/https/socks5), есть ли наш IP в whitelist, корректны ли login/password.",
    }
  }
  if (msg.includes("socks") && msg.includes("auth")) {
    return { category: "auth_failed", message: "SOCKS5 авторизация не прошла" }
  }
  if (
    msg.includes("eproto") ||
    msg.includes("wrong version number") ||
    msg.includes("ssl routines")
  ) {
    return {
      category: "unknown",
      message:
        "TLS handshake не прошёл (EPROTO / wrong version number). Скорее всего выбран неверный протокол: прокси отвечает не TLS-данными. Если порт 8080/3128 — попробуй HTTP вместо SOCKS5; если 1080 — наоборот SOCKS5.",
    }
  }
  if (msg.includes("econnrefused")) {
    return { category: "connection_refused", message: "Прокси отказал в соединении" }
  }
  return { category: "unknown", message: raw.slice(0, 200) }
}

function isPrivateIp(ip: string): boolean {
  return /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.)/.test(ip)
}

interface ProbeOutcome {
  probe: ProbeResponse
  latencyMs: number
}

async function probeHttps(creds: ProxyCredentials): Promise<ProbeOutcome> {
  const startedAt = Date.now()
  const probe = await fetchJsonViaProxy<ProbeResponse>(getHttpsProbeUrl(), creds)
  return { probe, latencyMs: Date.now() - startedAt }
}

async function probeHttp(creds: ProxyCredentials): Promise<ProbeOutcome> {
  const startedAt = Date.now()
  // ipify по http не редиректит и не требует TLS — работает через plain HTTP forward proxy.
  const probe = await fetchJsonViaProxy<ProbeResponse>(getHttpProbeUrl(), creds)
  return { probe, latencyMs: Date.now() - startedAt }
}

/**
 * Header-probe: запрашивает endpoint, который возвращает заголовки запроса,
 * увиденные сервером. Нужен только для leak-диагностики — отделить случай
 * "трафик идёт мимо прокси" (наш баг или whitelist) от "прокси работал, но IP
 * совпал" (transparent / overlapping pool). Перебирает несколько endpoint'ов
 * для устойчивости к downtime httpbin.org.
 */
async function probeHeaders(
  creds: ProxyCredentials,
  via: 'https' | 'http',
): Promise<HeaderProbeResponse | null> {
  const urls = via === 'https' ? HEADER_PROBE_URLS_HTTPS : HEADER_PROBE_URLS_HTTP

  for (const url of urls) {
    try {
      const data = await fetchJsonViaProxy<HeaderProbeResponse>(url, creds, TIMEOUT_MS)
      if (data && typeof data === 'object') return data
    }
    catch {
      // следующий endpoint
    }
  }
  return null
}

/**
 * Возможные сценарии для mock-проверки прокси. Совпадают с keys в proxy-server.ts.
 */
const MOCK_PROXY_SCENARIOS = [
  "happy_path", "happy_ru", "slow", "timeout",
  "auth_failed", "leak", "private_ip", "conn_refused",
] as const

/**
 * Парсит сценарий из host прокси. Принимаем форматы:
 *   - "mock-happy_path"            (host начинается с "mock-")
 *   - "mock-leak.example.com"      (subdomain)
 *   - любой другой host → happy_path
 *
 * Это позволяет оператору создавать prokси с осмысленными labels вроде
 * "mock-leak" и сразу видеть как UI обрабатывает leak detection без реального
 * прокси-сервера.
 */
function parseMockScenario(host: string): typeof MOCK_PROXY_SCENARIOS[number] {
  const cleaned = host.toLowerCase().replace(/^mock-/, "").split(".")[0] ?? ""
  if ((MOCK_PROXY_SCENARIOS as readonly string[]).includes(cleaned)) {
    return cleaned as typeof MOCK_PROXY_SCENARIOS[number]
  }
  return "happy_path"
}

/**
 * Mock-вариант checkProxy: возвращает синтетический результат на основе сценария
 * из host прокси. Никаких сетевых вызовов — ни TCP, ни HTTP, ни через agent.
 *
 * Используется когда PROXY_MOCK_MODE=true. Гарантирует что dev/CI не зависит
 * от реальных прокси и внешних IP-info сервисов.
 */
async function mockCheckProxy(creds: ProxyCredentials): Promise<ProxyCheckResult> {
  const scenario = parseMockScenario(creds.host)
  const startedAt = Date.now()

  if (scenario === "timeout" || scenario === "conn_refused") {
    // Эмулируем небольшую задержку, чтобы UI увидел loading state.
    await new Promise(r => setTimeout(r, 200))
  }

  switch (scenario) {
    case "happy_path":
      return {
        tcpConnectOk: true, httpProbeOk: true, isLeaking: false,
        detectedIp: "188.166.55.42", detectedCountry: "NL", detectedCity: "Amsterdam",
        latencyMs: Date.now() - startedAt + 120,
        rawProbeData: { mockScenario: scenario },
      }
    case "happy_ru":
      return {
        tcpConnectOk: true, httpProbeOk: true, isLeaking: false,
        detectedIp: "95.181.234.111", detectedCountry: "RU", detectedCity: "Moscow",
        latencyMs: Date.now() - startedAt + 180,
        rawProbeData: { mockScenario: scenario },
      }
    case "slow":
      await new Promise(r => setTimeout(r, 1500))
      return {
        tcpConnectOk: true, httpProbeOk: true, isLeaking: false,
        detectedIp: "188.166.55.42", detectedCountry: "NL",
        latencyMs: Date.now() - startedAt,
        rawProbeData: { mockScenario: scenario },
      }
    case "auth_failed":
      return {
        tcpConnectOk: true, httpProbeOk: false,
        errorCategory: "auth_failed",
        errorMessage: "Прокси отклонил авторизацию (407) [mock]",
      }
    case "leak":
      return {
        tcpConnectOk: true, httpProbeOk: false, isLeaking: true,
        detectedIp: "203.0.113.42",
        errorCategory: "leak",
        errorMessage: "Прокси не передаёт через себя - detectedIp равен IP сервера [mock]",
        rawProbeData: { mockScenario: scenario },
      }
    case "private_ip":
      return {
        tcpConnectOk: true, httpProbeOk: false, isLeaking: true,
        detectedIp: "10.0.0.1",
        errorCategory: "private_ip",
        errorMessage: "Detected IP - приватный (10.0.0.1) [mock]",
        rawProbeData: { mockScenario: scenario },
      }
    case "timeout":
      return {
        tcpConnectOk: false, httpProbeOk: false,
        errorCategory: "timeout",
        errorMessage: "Превышен таймаут при работе через прокси [mock]",
      }
    case "conn_refused":
      return {
        tcpConnectOk: false, httpProbeOk: false,
        errorCategory: "connection_refused",
        errorMessage: "Прокси отказал в соединении (ECONNREFUSED) [mock]",
      }
  }
}

/**
 * Полная проверка прокси:
 * 1. TCP connect.
 * 2. Probe https://ipinfo.io (CONNECT туннель). При успехе — geo заполняется.
 * 3. При неудаче — fallback probe http://api.ipify.org (forward, без CONNECT).
 *    Это покрывает HTTP-only forward proxy (NodeMaven и т.п. на портах без CONNECT).
 * 4. Сравнение detectedIp с server external IP — leak detection.
 * 5. Проверка приватного IP.
 */
export async function checkProxy(creds: ProxyCredentials): Promise<ProxyCheckResult> {
  // Mock-режим: возвращаем синтетический результат по host (mock-{scenario}).
  if (isProxyMockMode()) {
    return mockCheckProxy(creds)
  }

  const result: ProxyCheckResult = { tcpConnectOk: false, httpProbeOk: false }

  // Step 1: TCP connect
  try {
    await tcpConnect(creds.host, creds.port)
    result.tcpConnectOk = true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    result.errorCategory = msg.toLowerCase().includes("timeout") ? "timeout" : "connection_refused"
    result.errorMessage = msg.slice(0, 200)
    return result
  }

  // Step 2: HTTPS probe (главный путь — даёт geo).
  let outcome: ProbeOutcome | null = null
  let usedFallback = false
  let firstError: { category: ProxyCheckResult["errorCategory"]; message: string } | null = null

  try {
    outcome = await probeHttps(creds)
  } catch (err) {
    firstError = classifyProbeError(err)
    // Step 3: HTTP fallback. Не пробуем при auth_failed — там и https-fallback не поможет,
    // и так понятно что креды кривые.
    if (firstError.category !== "auth_failed") {
      try {
        outcome = await probeHttp(creds)
        usedFallback = true
      } catch {
        // оба упали — возвращаем сообщение первой попытки, оно информативнее.
      }
    }
  }

  if (!outcome) {
    if (firstError) {
      result.errorCategory = firstError.category
      result.errorMessage = firstError.message
    } else {
      result.errorCategory = "unknown"
      result.errorMessage = "Probe не удался"
    }
    return result
  }

  const probe = outcome.probe
  if (!probe || typeof probe.ip !== "string") {
    result.errorCategory = "unknown"
    result.errorMessage = "Probe service вернул некорректный ответ"
    return result
  }

  result.detectedIp = probe.ip
  result.detectedCountry = probe.country ?? undefined
  result.detectedCity = probe.city ?? undefined
  result.latencyMs = outcome.latencyMs

  // Step 4: Leak detection с дифференцированным диагнозом.
  //
  // detectedIp == serverIp может означать одно из трёх:
  //   1. Трафик идёт МИМО прокси (баг агента / whitelist / прокси упал и
  //      запрос пошёл напрямую). Чинится у нас.
  //   2. Прокси transparent: пропускает трафик но не подменяет IP. Чинится
  //      сменой провайдера.
  //   3. Overlapping IP-pool: прокси-провайдер разместил ноду на той же AS,
  //      что и наш сервер. Редко, но бывает у Hetzner/Cloudflare/AWS.
  //
  // Header-probe (httpbin/postman-echo) показывает request headers, увиденные
  // сервером. Если в них есть Via/X-Forwarded-* — прокси ТОЧНО участвовал в
  // передаче (случаи 2/3). Если headers чисты — трафик прошёл напрямую (1).
  const serverIp = await getServerIp()
  const serverIpSources = getServerIpSources()

  result.rawProbeData = {
    ...probe,
    fallbackMode: usedFallback ? "http" : "https",
    serverIp,
    serverIpSources,
  }

  if (serverIp && probe.ip === serverIp) {
    // Делаем дополнительный header-probe чтобы отличить direct-connect от
    // transparent/overlapping. Не блокирует основной result если упадёт.
    const headerData = await probeHeaders(creds, usedFallback ? 'http' : 'https').catch(() => null)
    const proxyHeaders = headerData ? extractProxyHeaders(headerData) : null
    const proxyHeadersFound = proxyHeaders && Object.keys(proxyHeaders).length > 0
    const headerProbeOrigin = headerData?.origin?.split(',')[0]?.trim() ?? null

    // Diagnostic logging — НЕ меняет поведение, помогает дальше дебажить.
    // Если в логах продакшна часто видим этот варн — запускаем
    // POST /api/proxies/:id/diagnose для root cause analysis.
    console.warn('[probe] LEAK DETECTED', {
      proxyHost: creds.host,
      proxyProtocol: creds.protocol,
      detectedIp: probe.ip,
      serverIp,
      httpProbeOk: result.httpProbeOk,
      probeMethod: usedFallback ? 'http-forward' : 'https-connect',
      hadHeaderProbe: !!headerData,
      proxyHeadersFound,
      headerProbeOrigin,
      hint: 'POST /api/proxies/:id/diagnose for deep analysis',
    })

    result.isLeaking = true
    result.errorCategory = "leak"
    result.rawProbeData = {
      ...(result.rawProbeData as Record<string, unknown>),
      headerProbe: headerData
        ? { origin: headerProbeOrigin, proxyHeaders: proxyHeaders ?? {}, hadResponse: true }
        : { hadResponse: false },
    }

    if (proxyHeadersFound) {
      // Прокси РАБОТАЛ (есть Via/Forwarded), но IP совпадает — transparent или
      // overlapping. Не наш баг.
      const headersList = Object.keys(proxyHeaders!).join(', ')
      result.errorMessage = `detectedIp равен IP сервера (${serverIp}), но прокси добавил заголовки ${headersList} - вероятно transparent proxy или overlapping IP-pool у провайдера. Смените прокси.`
    }
    else if (headerData) {
      // Header probe прошёл, заголовков прокси нет — трафик идёт напрямую.
      result.errorMessage = `detectedIp равен IP сервера (${serverIp}) и прокси-заголовки (Via/Forwarded) отсутствуют - трафик идёт мимо прокси. Проверьте whitelist по IP сервера на стороне провайдера прокси и корректность login/password.`
    }
    else {
      // Header probe тоже не дошёл — точную причину не определить.
      result.errorMessage = `detectedIp равен IP сервера (${serverIp}). Трафик может идти мимо прокси либо прокси transparent. Header-probe не дошёл, точную причину определить не удалось.`
    }
    return result
  }

  // Step 5: Private IP check
  if (isPrivateIp(probe.ip)) {
    result.isLeaking = true
    result.errorCategory = "private_ip"
    result.errorMessage = `Detected IP - приватный (${probe.ip}). Прокси не работает корректно.`
    return result
  }

  result.httpProbeOk = true
  result.isLeaking = false
  return result
}

export type { ProxyProtocol }
