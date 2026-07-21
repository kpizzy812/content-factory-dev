export type ProxyType = "mobile" | "residential" | "datacenter"

export type ProxyProtocol = "http" | "https" | "socks5"

export const PROXY_PROTOCOLS: readonly ProxyProtocol[] = ["http", "https", "socks5"] as const

export type ProxyStatus = "unverified" | "healthy" | "degraded" | "dead" | "expired"

export type ProxyCheckTrigger = "manual" | "scheduled" | "pre_session"

export type ProxyCheckErrorCategory =
  | "timeout"
  | "connection_refused"
  | "auth_failed"
  | "leak"
  | "private_ip"
  | "unknown"

export interface ProxyCredentials {
  protocol: ProxyProtocol
  host: string
  port: number
  username?: string
  password?: string
}

export interface ProxyCheckResult {
  tcpConnectOk: boolean
  httpProbeOk: boolean
  detectedIp?: string
  detectedCountry?: string
  detectedCity?: string
  latencyMs?: number
  isLeaking?: boolean
  errorCategory?: ProxyCheckErrorCategory
  errorMessage?: string
  rawProbeData?: unknown
}

export type ProxyAlertReason =
  | "leak"
  | "consecutive_failures_3"
  | "auth_failed"
  | "expired"

export interface ProxyAlertSummary {
  reason: ProxyAlertReason
  lastAt: string
  count: number
  nextAllowedInMs: number
}

/**
 * Proxy DTO для API responses (без секретов).
 * host возвращается в маскированном виде через maskHost().
 */
export interface ProxyDto {
  id: string
  label: string
  provider: string | null
  type: ProxyType
  protocol: ProxyProtocol
  hostMasked: string
  port: number
  hasCredentials: boolean
  hasRotationUrl: boolean
  expectedCountry: string | null
  expectedCity: string | null
  ipv4Only: boolean
  status: ProxyStatus
  lastCheckedAt: string | null
  consecutiveFailures: number
  monthlyTrafficGB: number | null
  expiresAt: string | null
  notes: string | null
  attachedAccountsCount: number
  alertSummary: ProxyAlertSummary[]
  createdAt: string
  updatedAt: string
}

export interface ProxyHealthCheckDto {
  id: string
  proxyId: string
  checkedAt: string
  triggeredBy: ProxyCheckTrigger
  tcpConnectOk: boolean
  httpProbeOk: boolean
  detectedIp: string | null
  detectedCountry: string | null
  detectedCity: string | null
  latencyMs: number | null
  isLeaking: boolean | null
  errorCategory: string | null
  errorMessage: string | null
}

/**
 * Тело POST /api/proxies для создания прокси.
 */
export interface ProxyCreateInput {
  label: string
  provider?: string | null
  type: ProxyType
  protocol?: ProxyProtocol
  host: string
  port: number
  username?: string | null
  password?: string | null
  rotationUrl?: string | null
  expectedCountry?: string | null
  expectedCity?: string | null
  ipv4Only?: boolean
  monthlyTrafficGB?: number | null
  expiresAt?: string | null
  notes?: string | null
}

export type ProxyUpdateInput = Partial<ProxyCreateInput>

/**
 * Результат парсинга прокси-строки. Часть полей берётся из NodeMaven-style
 * username (`country-us-region-california-type-mobile-ipv4-true-sid-XXX-filter-medium`).
 *
 * Базовые поля (protocol/host/port/username/password) — обратная совместимость
 * с прежним парсером. Метаданные опциональны и заполняются, если их удалось
 * распознать.
 */
export interface ParsedProxy {
  protocol?: ProxyProtocol
  host: string
  port: number
  username?: string
  password?: string

  provider?: string
  type?: ProxyType
  expectedCountry?: string
  expectedCity?: string
  ipv4Only?: boolean
  sessionId?: string
  filter?: string

  suggestedLabel?: string
}

const SOCKS5_PORTS = new Set([1080, 1085, 4145])
const HTTPS_PORTS = new Set([8443, 443])

function inferProtocolFromPort(port: number): ProxyProtocol {
  if (SOCKS5_PORTS.has(port)) return "socks5"
  if (HTTPS_PORTS.has(port)) return "https"
  return "http"
}

function defaultPortForProtocol(protocol: ProxyProtocol): number {
  switch (protocol) {
    case "socks5":
      return 1080
    case "https":
      return 8443
    case "http":
      return 8080
  }
}

const PROVIDER_PATTERNS: Array<{ match: RegExp; name: string }> = [
  { match: /nodemaven\.com$/i, name: "NodeMaven" },
  { match: /iproyal\.com$/i, name: "IPRoyal" },
  { match: /proxyempire\.io$/i, name: "ProxyEmpire" },
  { match: /(brightdata\.com|luminati)/i, name: "BrightData" },
  { match: /mobileproxy\.space$/i, name: "Mobile Proxy Space" },
]

function detectProvider(host: string): string | undefined {
  const h = host.toLowerCase()
  for (const { match, name } of PROVIDER_PATTERNS) {
    if (match.test(h)) return name
  }
  return undefined
}

/**
 * Конвертирует "new_jersey" → "New Jersey", "los_angeles" → "Los Angeles".
 */
function humanizeRegion(raw: string): string {
  return raw
    .split("_")
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ")
}

/**
 * Парсит NodeMaven-style username и заполняет metadata-поля результата in place.
 *
 * Формат username (порядок сегментов не гарантирован, тэги опциональны):
 *   `USER-country-us-region-new_jersey-type-mobile-ipv4-true-sid-XXX-filter-medium`
 *
 * Все теги ищутся через позиционные lookahead-якоря, чтобы остановиться на
 * следующем известном теге или конце строки. Это устойчиво к произвольному
 * USER-префиксу с дефисами и тире.
 */
function enrichFromUsername(parsed: ParsedProxy): void {
  const u = parsed.username
  if (!u) return

  const STOP = "(?=-country-|-region-|-type-|-ipv4-|-sid-|-filter-|$)"

  const country = u.match(new RegExp(`-country-([a-z]{2})${STOP}`, "i"))
  if (country) parsed.expectedCountry = country[1]!.toUpperCase()

  const region = u.match(new RegExp(`-region-([a-z0-9_]+?)${STOP}`, "i"))
  if (region) parsed.expectedCity = humanizeRegion(region[1]!)

  const type = u.match(new RegExp(`-type-(mobile|residential|datacenter)${STOP}`, "i"))
  if (type) {
    parsed.type = type[1]!.toLowerCase() as ProxyType
  } else if (parsed.expectedCountry) {
    parsed.type = "residential"
  }

  const ipv4 = u.match(new RegExp(`-ipv4-(true|false)${STOP}`, "i"))
  if (ipv4) parsed.ipv4Only = ipv4[1]!.toLowerCase() === "true"

  const sid = u.match(new RegExp(`-sid-([a-z0-9]+?)${STOP}`, "i"))
  if (sid) parsed.sessionId = sid[1]!

  const filter = u.match(new RegExp(`-filter-([a-z0-9]+?)${STOP}`, "i"))
  if (filter) parsed.filter = filter[1]!.toLowerCase()
}

/**
 * "NodeMaven SOCKS5 Mobile US 15_05_26" — авто-подсказка label.
 * Дата формируется относительно `now` (передаётся для тестируемости).
 */
function buildSuggestedLabel(p: ParsedProxy, now: Date): string {
  const parts: string[] = []
  if (p.provider) parts.push(p.provider)
  if (p.protocol) parts.push(p.protocol.toUpperCase())
  if (p.type) parts.push(p.type.charAt(0).toUpperCase() + p.type.slice(1))
  if (p.expectedCountry) parts.push(p.expectedCountry)

  const dd = String(now.getDate()).padStart(2, "0")
  const mm = String(now.getMonth() + 1).padStart(2, "0")
  const yy = String(now.getFullYear()).slice(-2)
  parts.push(`${dd}_${mm}_${yy}`)

  return parts.join(" ")
}

function finalizeParsed(parsed: ParsedProxy, now: Date): ParsedProxy {
  parsed.provider = detectProvider(parsed.host)
  enrichFromUsername(parsed)
  parsed.suggestedLabel = buildSuggestedLabel(parsed, now)
  return parsed
}

function parseUrlFormat(input: string): Omit<ParsedProxy, "suggestedLabel" | "provider"> | null {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  const scheme = url.protocol.replace(":", "").toLowerCase()
  if (scheme !== "http" && scheme !== "https" && scheme !== "socks5") return null

  const protocol = scheme as ProxyProtocol
  const host = url.hostname
  if (!host) return null

  const portRaw = url.port ? Number.parseInt(url.port, 10) : defaultPortForProtocol(protocol)
  if (!Number.isFinite(portRaw) || portRaw < 1 || portRaw > 65535) return null

  return {
    protocol,
    host,
    port: portRaw,
    username: url.username ? safeDecode(url.username) : undefined,
    password: url.password ? safeDecode(url.password) : undefined,
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function parseColonFormat(input: string): Omit<ParsedProxy, "suggestedLabel" | "provider"> | null {
  // Формат: host:port[:user[:pass]].
  // NodeMaven username использует дефисы/подчёркивания, но не двоеточия,
  // поэтому split(":") достаточен.
  const parts = input.split(":")
  if (parts.length < 2 || parts.length > 4) return null

  const host = parts[0]!.trim()
  const portStr = parts[1]!.trim()
  if (!host) return null

  const port = Number.parseInt(portStr, 10)
  if (!Number.isFinite(port) || port < 1 || port > 65535) return null

  const username = parts.length >= 3 && parts[2] ? parts[2] : undefined
  const password = parts.length >= 4 && parts[3] ? parts[3] : undefined

  return {
    protocol: inferProtocolFromPort(port),
    host,
    port,
    username,
    password,
  }
}

/**
 * Парсер прокси-строки. Поддерживает три формата:
 *   1. URL: `socks5://user:pass@host:port`, `http://...`, `https://...`
 *   2. Двоеточия: `host:port:user:pass`, `host:port:user`, `host:port`
 *   3. Минимум: `host:port`
 *
 * Дополнительно извлекает метаданные из NodeMaven-style username
 * (country/region/type/ipv4/sid/filter), определяет provider по hostname и
 * формирует suggestedLabel.
 *
 * Возвращает `null` если строка не парсится. Для backward compat поля
 * protocol/host/port/username/password остаются на верхнем уровне.
 *
 * @param input строка из UI (raw paste от пользователя)
 * @param now   текущая дата (передаётся для тестируемости; по умолчанию new Date())
 */
export function parseProxyString(input: string, now: Date = new Date()): ParsedProxy | null {
  if (!input) return null
  const trimmed = input.trim()
  if (!trimmed) return null

  const isUrlForm = /^(https?|socks5):\/\//i.test(trimmed)
  const base = isUrlForm ? parseUrlFormat(trimmed) : parseColonFormat(trimmed)
  if (!base) return null

  const parsed: ParsedProxy = { ...base }
  return finalizeParsed(parsed, now)
}
