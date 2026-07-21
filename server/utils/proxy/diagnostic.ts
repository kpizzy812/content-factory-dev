import { execFile as execFileCb } from "node:child_process"
import * as http from "node:http"
import * as https from "node:https"
import * as net from "node:net"
import { promisify } from "node:util"
import { HttpsProxyAgent } from "https-proxy-agent"
import { SocksProxyAgent } from "socks-proxy-agent"
import type { ProxyCredentials } from "../../../shared/types/proxy"
import type { AgentTrace } from "./agent-tracer"
import { buildProxyUrl } from "./probe"
import { socksHttpsGet } from "./socks-fetch"

const execFile = promisify(execFileCb)

const HTTP_TIMEOUT_MS = 15_000
const CURL_TIMEOUT_S = 15
const CONTAINER_IP_TIMEOUT_MS = 10_000

interface ContainerIp {
  via_v4: string | null
  via_v6: string | null
  error: string | null
}

interface CurlBaseline {
  command: string
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
  detectedIp: string | null
  isLeakingViaCurl: boolean
}

interface NodeRequestResult {
  method: string
  detectedIp: string | null
  httpStatus: number | null
  durationMs: number
  error: string | null
  isLeaking: boolean | null
}

/**
 * Снимок trace SocksProxyAgent для diagnostic — что увидел traced `connect()`:
 * вызывался ли он вообще, к какому хосту открылся сокет (proxy IP vs target IP),
 * сколько занял SOCKS5 handshake. Главное поле — `socketRemoteAddress` в attempts.
 */
interface TracedNodeRequestResult extends NodeRequestResult {
  agentTrace: {
    proxyParsed: AgentTrace["proxyParsed"]
    totalAttempts: number
    attempts: Array<{
      targetHost: string
      targetPort: number
      socketRemoteAddress?: string
      socketRemotePort?: number
      durationMs?: number
      error?: string
    }>
  } | null
}

interface RawSocksLibResult {
  method: string
  detectedIp: string | null
  httpStatus: number | null
  durationMs: number
  error: string | null
  isLeaking: boolean | null
  /**
   * `skipped` true если протокол не socks5 — для http/https прокси socks lib
   * не применима.
   */
  skipped: boolean
}

interface NativeFetchResult extends NodeRequestResult {
  nodeVersion: string
  /**
   * Native fetch в Node 18+ игнорирует option `agent` (использует undici под капотом,
   * которому нужен `dispatcher`, а не `agent`). Поэтому этот тест ОЖИДАЕМО показывает
   * direct connect и leak — это документация поведения, не баг нашего кода.
   */
  expectedLeak: true
  notes: string
}

interface AgentDebug {
  type: "socks" | "https" | "http" | "unknown"
  proxyHost: string | null
  proxyPort: number | null
  socksType?: number
  hasUserId?: boolean
  hasPassword?: boolean
  userIdLength?: number
}

interface Verdict {
  proxyReallyWorks: boolean
  nodeRequestWorks: boolean
  fetchWorks: boolean
  socks5hHelpsAtAll: boolean
  suspectedRoot:
    | "nodemaven_broken"
    | "node_fetch_ignores_agent"
    | "fetchJson_fallback"
    | "whitelist_issue"
    | "socks5h_required"
    | "all_methods_work"
    | "unknown"
  recommendation: string
}

export interface ProxyDiagnostic {
  proxyHost: string
  proxyPort: number
  protocol: string
  timestamp: string
  containerIp: ContainerIp
  tcp: { connectMs: number | null; error: string | null }
  curlBaseline: CurlBaseline
  rawNodeRequest: TracedNodeRequestResult
  nativeFetch: NativeFetchResult
  socks5hVariant: NodeRequestResult
  rawSocksLib: RawSocksLibResult
  agentDebug: AgentDebug
  verdict: Verdict
}

/**
 * Снимает безопасный snapshot agent для diagnostic — чтобы в prod logs
 * было видно что SocksProxyAgent распарсил правильные креды (а не пустой
 * userId или обрезанный host). Пароль маскируется до boolean.
 */
function inspectAgent(
  agent: http.Agent | https.Agent,
  protocol: string,
): AgentDebug {
  const a = agent as unknown as {
    proxy?: {
      host?: string
      port?: number
      type?: number
      userId?: string
      password?: string
    }
  }
  if (protocol === "socks5") {
    const p = a.proxy
    return {
      type: "socks",
      proxyHost: p?.host ?? null,
      proxyPort: typeof p?.port === "number" ? p.port : null,
      socksType: p?.type,
      hasUserId: typeof p?.userId === "string" && p.userId.length > 0,
      hasPassword: typeof p?.password === "string" && p.password.length > 0,
      userIdLength: typeof p?.userId === "string" ? p.userId.length : 0,
    }
  }
  return {
    type: protocol === "https" ? "https" : protocol === "http" ? "http" : "unknown",
    proxyHost: null,
    proxyPort: null,
  }
}

function buildAgent(
  creds: ProxyCredentials,
  schemeOverride?: string,
): http.Agent | https.Agent {
  const url = buildProxyUrl(creds, schemeOverride)
  if (creds.protocol === "socks5" || schemeOverride === "socks5h") {
    return new SocksProxyAgent(url) as unknown as https.Agent
  }
  return new HttpsProxyAgent(url)
}

// IPv4 в "сыром" виде в начале строки: 1.2.3.4 (опционально с :port или /CIDR — игнорим хвост).
const IPV4_HEAD_RE = /^\d{1,3}(?:\.\d{1,3}){3}/
// IPv6: full form (8 hex groups separated by :) либо compressed (::).
// Принимает full "2a00:23ee:...:fdad", compressed "::1", "2a00::1", mapped "::ffff:1.2.3.4".
// Требуем хотя бы один ":" в начале строки чтобы не цеплять одиночный hex.
const IPV6_HEAD_RE =
  /^(?:::(?:[fF]{4}:)?\d{1,3}(?:\.\d{1,3}){3}|::(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,7})?|(?:[0-9a-fA-F]{1,4}:){1,7}(?::|[0-9a-fA-F]{1,4})(?::[0-9a-fA-F]{1,4}){0,6})/

function looksLikeIp(s: string): boolean {
  return IPV4_HEAD_RE.test(s) || IPV6_HEAD_RE.test(s)
}

function extractIpFromPlain(s: string): string | null {
  const v4 = s.match(IPV4_HEAD_RE)
  if (v4) return v4[0]
  const v6 = s.match(IPV6_HEAD_RE)
  if (v6) return v6[0]
  return null
}

function parseIpify(body: string): {
  ip: string | null
  family: "v4" | "v6" | null
  ok: boolean
} {
  const trimmed = body.trim()
  // ifconfig.me/all.json формат: { "ip_addr": "...", ... }
  // Также поддерживаем { "ip": "..." } (ipify, ipinfo) на случай fallback URL.
  try {
    const parsed = JSON.parse(trimmed) as { ip?: string; ip_addr?: string }
    const ip = parsed.ip_addr ?? parsed.ip ?? null
    if (typeof ip === "string" && looksLikeIp(ip)) {
      return { ip, family: ip.includes(":") ? "v6" : "v4", ok: true }
    }
  } catch {
    // не JSON — возможно plain text
  }
  const plainIp = extractIpFromPlain(trimmed)
  if (plainIp) {
    return { ip: plainIp, family: plainIp.includes(":") ? "v6" : "v4", ok: true }
  }
  return { ip: null, family: null, ok: false }
}

function compareWithContainerIp(
  detectedIp: string | null,
  containerIp: ContainerIp,
): boolean | null {
  if (!detectedIp) return null
  // Сравниваем с правильным семейством адресов. IPv4 и IPv6 — разные форматы,
  // их сравнение бессмысленно. Если baseline пустой для нужного семейства —
  // трафик пришёл оттуда, куда контейнер вообще не имеет direct route, значит
  // утечкой быть не может (false, а не null).
  if (detectedIp.includes(":")) {
    if (!containerIp.via_v6) return false
    return detectedIp === containerIp.via_v6
  }
  if (!containerIp.via_v4) return false
  return detectedIp === containerIp.via_v4
}

async function fetchContainerIp(): Promise<ContainerIp> {
  const result: ContainerIp = { via_v4: null, via_v6: null, error: null }

  try {
    const { stdout } = await execFile(
      "curl",
      ["-4", "-s", "--max-time", "10", "https://ifconfig.me"],
      { timeout: CONTAINER_IP_TIMEOUT_MS },
    )
    const trimmed = stdout.trim()
    if (/^\d+\.\d+\.\d+\.\d+$/.test(trimmed)) {
      result.via_v4 = trimmed
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
  }

  try {
    const { stdout } = await execFile(
      "curl",
      ["-6", "-s", "--max-time", "5", "https://ifconfig.me"],
      { timeout: 8000 },
    )
    const trimmed = stdout.trim()
    if (trimmed.includes(":")) {
      result.via_v6 = trimmed
    }
  } catch {
    // IPv6 может быть недоступен в контейнере — это норма.
  }

  return result
}

async function probeTcp(
  host: string,
  port: number,
): Promise<{ connectMs: number | null; error: string | null }> {
  const start = Date.now()
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port, timeout: 10_000 })
    let done = false
    const finish = (error: string | null) => {
      if (done) return
      done = true
      sock.destroy()
      resolve({
        connectMs: error ? null : Date.now() - start,
        error,
      })
    }
    sock.once("connect", () => finish(null))
    sock.once("error", (err) => finish(err.message))
    sock.once("timeout", () => finish("TCP timeout"))
  })
}

function buildCurlArgs(creds: ProxyCredentials): string[] {
  const args: string[] = []

  if (creds.protocol === "socks5") {
    args.push("--socks5-hostname", `${creds.host}:${creds.port}`)
  } else {
    const scheme = creds.protocol === "https" ? "https" : "http"
    args.push("--proxy", `${scheme}://${creds.host}:${creds.port}`)
  }

  if (creds.username) {
    args.push("--proxy-user", `${creds.username}:${creds.password ?? ""}`)
  }

  args.push(
    "-s",
    "--max-time",
    String(CURL_TIMEOUT_S),
    "-w",
    "\nHTTP_CODE:%{http_code}",
    "https://ifconfig.me",
  )

  return args
}

async function runCurlBaseline(
  creds: ProxyCredentials,
  containerIp: ContainerIp,
): Promise<CurlBaseline> {
  const args = buildCurlArgs(creds)
  // Маскируем username/password в command для логов / response.
  const maskedArgs = args.map((a) =>
    a.includes(":") && a.includes(creds.username ?? "__none__")
      ? "***:***"
      : a,
  )
  const result: CurlBaseline = {
    command: `curl ${maskedArgs.join(" ")}`,
    exitCode: -1,
    stdout: "",
    stderr: "",
    durationMs: 0,
    detectedIp: null,
    isLeakingViaCurl: false,
  }

  const start = Date.now()
  try {
    const { stdout, stderr } = await execFile("curl", args, {
      timeout: (CURL_TIMEOUT_S + 5) * 1000,
    })
    result.exitCode = 0
    result.stdout = stdout
    result.stderr = stderr

    // ifconfig.me возвращает IPv4 ИЛИ IPv6 plain text в первой строке (до HTTP_CODE).
    // NodeMaven с IPv6 exit'ом → ответ типа "2a00:23ee:...". Раньше regex был
    // IPv4-only → detectedIp=null → verdict ошибочно говорил "nodemaven_broken".
    const ipPart = stdout.split("\nHTTP_CODE:")[0]?.trim() ?? ""
    const detected = extractIpFromPlain(ipPart)
    if (detected) {
      result.detectedIp = detected
      const leak = compareWithContainerIp(detected, containerIp)
      result.isLeakingViaCurl = leak === true
    }
  } catch (err) {
    const e = err as { code?: number; stderr?: string; message?: string }
    result.exitCode = typeof e.code === "number" ? e.code : -1
    result.stderr = e.stderr ?? e.message ?? String(err)
  }
  result.durationMs = Date.now() - start

  return result
}

interface NodeRequestOutcome {
  body: string
  status: number
}

function runHttpsRequestWithAgent(
  agent: http.Agent | https.Agent,
): Promise<NodeRequestOutcome> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        // hostname (НЕ host) + explicit port + protocol — best practice, гарантирует
        // что agent применяется правильно и Node не делает direct connect.
        protocol: "https:",
        hostname: "ifconfig.me",
        port: 443,
        path: "/all.json",
        method: "GET",
        agent,
        timeout: HTTP_TIMEOUT_MS,
        headers: {
          Host: "ifconfig.me",
          "User-Agent": "ZavodCamp-ProxyDiagnostic/1.0",
          Accept: "application/json",
        },
      },
      (res) => {
        let body = ""
        res.setEncoding("utf8")
        res.on("data", (chunk: string) => {
          body += chunk
          if (body.length > 65_536) {
            req.destroy(new Error("response too large"))
          }
        })
        res.on("end", () =>
          resolve({ body, status: res.statusCode ?? 0 }),
        )
      },
    )
    req.once("error", reject)
    req.once("timeout", () => {
      req.destroy(new Error("node-request timeout"))
    })
    req.end()
  })
}

async function runRawNodeRequest(
  creds: ProxyCredentials,
  containerIp: ContainerIp,
): Promise<TracedNodeRequestResult> {
  const result: TracedNodeRequestResult = {
    method:
      creds.protocol === "socks5"
        ? "socks lib via probe.ts (production path — bypasses SocksProxyAgent)"
        : "https.request via HttpsProxyAgent (production path)",
    detectedIp: null,
    httpStatus: null,
    durationMs: 0,
    error: null,
    isLeaking: null,
    agentTrace: null,
  }
  const start = Date.now()

  try {
    if (creds.protocol === "socks5") {
      // Production path: socks lib + manual TLS, минуя SocksProxyAgent.
      // Это тот же путь, что используется в fetchJsonViaProxy в probe.ts.
      const response = await socksHttpsGet(
        creds,
        "https://ifconfig.me/all.json",
        HTTP_TIMEOUT_MS,
      )
      result.httpStatus = response.status
      const parsed = parseIpify(response.body)
      result.detectedIp = parsed.ip
      result.isLeaking = compareWithContainerIp(parsed.ip, containerIp)
    } else {
      const agent = buildAgent(creds)
      const outcome = await runHttpsRequestWithAgent(agent)
      result.httpStatus = outcome.status
      const parsed = parseIpify(outcome.body)
      result.detectedIp = parsed.ip
      result.isLeaking = compareWithContainerIp(parsed.ip, containerIp)
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
  }
  result.durationMs = Date.now() - start
  return result
}

/**
 * Альтернативный путь: SOCKS5 туннель через `socks` lib + ручной TLS + raw HTTP GET.
 * Полностью обходит SocksProxyAgent. Если этот метод даёт корректный IP а
 * `runRawNodeRequest` — leak, значит проблема в socks-proxy-agent на Node v22+.
 */
async function runRawSocksTest(
  creds: ProxyCredentials,
  containerIp: ContainerIp,
): Promise<RawSocksLibResult> {
  const result: RawSocksLibResult = {
    method: "socks lib + manual TLS + raw HTTP (bypasses SocksProxyAgent)",
    detectedIp: null,
    httpStatus: null,
    durationMs: 0,
    error: null,
    isLeaking: null,
    skipped: false,
  }

  if (creds.protocol !== "socks5") {
    result.skipped = true
    result.error = "skipped: socks lib applies only to socks5 proxy"
    return result
  }

  const start = Date.now()
  try {
    const response = await socksHttpsGet(
      creds,
      "https://ifconfig.me/all.json",
      HTTP_TIMEOUT_MS,
    )
    result.httpStatus = response.status
    const parsed = parseIpify(response.body)
    result.detectedIp = parsed.ip
    result.isLeaking = compareWithContainerIp(parsed.ip, containerIp)
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
  }
  result.durationMs = Date.now() - start
  return result
}

async function runNativeFetch(
  creds: ProxyCredentials,
  containerIp: ContainerIp,
): Promise<NativeFetchResult> {
  const result: NativeFetchResult = {
    method: "fetch with agent option (EXPECTED to leak — undici ignores agent)",
    detectedIp: null,
    httpStatus: null,
    durationMs: 0,
    error: null,
    isLeaking: null,
    nodeVersion: process.version,
    expectedLeak: true,
    notes:
      "Native fetch в Node 18+ использует undici под капотом, который игнорирует option `agent` " +
      "(нужен `dispatcher`). Этот тест существует чтобы продемонстрировать: код, использующий " +
      "fetch(url, { agent }) — это путь утечки. Используйте https.request(options, cb) с agent.",
  }
  const start = Date.now()
  try {
    const agent = buildAgent(creds)
    const response = await fetch("https://ifconfig.me/all.json", {
      // @ts-expect-error — fetch typing has no agent, but Node/undici may pick it up via dispatcher polyfill
      agent,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
    result.httpStatus = response.status
    const text = await response.text()
    const parsed = parseIpify(text)
    result.detectedIp = parsed.ip
    result.isLeaking = compareWithContainerIp(parsed.ip, containerIp)
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
  }
  result.durationMs = Date.now() - start
  return result
}

async function runSocks5hVariant(
  creds: ProxyCredentials,
  containerIp: ContainerIp,
): Promise<NodeRequestResult> {
  const result: NodeRequestResult = {
    method: "socks5h:// (DNS through proxy) via https.request",
    detectedIp: null,
    httpStatus: null,
    durationMs: 0,
    error: null,
    isLeaking: null,
  }

  // socks5h имеет смысл только для socks5 прокси. Для http/https этот тест skip.
  if (creds.protocol !== "socks5") {
    result.error = "skipped: socks5h applies only to socks5 proxy"
    return result
  }

  const start = Date.now()
  try {
    const agent = buildAgent(creds, "socks5h")
    const outcome = await runHttpsRequestWithAgent(agent)
    result.httpStatus = outcome.status
    const parsed = parseIpify(outcome.body)
    result.detectedIp = parsed.ip
    result.isLeaking = compareWithContainerIp(parsed.ip, containerIp)
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
  }
  result.durationMs = Date.now() - start
  return result
}

function determineVerdict(d: ProxyDiagnostic): Verdict {
  const verdict: Verdict = {
    proxyReallyWorks: false,
    nodeRequestWorks: false,
    fetchWorks: false,
    socks5hHelpsAtAll: false,
    suspectedRoot: "unknown",
    recommendation: "",
  }

  verdict.proxyReallyWorks =
    d.curlBaseline.detectedIp !== null && !d.curlBaseline.isLeakingViaCurl

  verdict.nodeRequestWorks =
    d.rawNodeRequest.detectedIp !== null && d.rawNodeRequest.isLeaking === false

  verdict.fetchWorks =
    d.nativeFetch.detectedIp !== null && d.nativeFetch.isLeaking === false

  verdict.socks5hHelpsAtAll =
    d.socks5hVariant.detectedIp !== null &&
    d.socks5hVariant.isLeaking === false &&
    !verdict.nodeRequestWorks

  // Корень проблемы — приоритетная цепочка проверок.
  if (d.containerIp.via_v4 === null && d.containerIp.via_v6 === null) {
    verdict.suspectedRoot = "unknown"
    verdict.recommendation =
      "Не удалось определить container IP (curl ifconfig.me не сработал ни по v4, ни по v6). " +
      "Leak detection невозможна без baseline IP. Проверьте сеть и curl в контейнере."
    return verdict
  }

  if (d.curlBaseline.detectedIp === null) {
    verdict.suspectedRoot = "nodemaven_broken"
    verdict.recommendation =
      `Curl не получил ответ через прокси (exitCode=${d.curlBaseline.exitCode}, ` +
      `stderr="${d.curlBaseline.stderr.slice(0, 200)}"). ` +
      `TCP к ${d.proxyHost}:${d.proxyPort} ${d.tcp.error ? "не прошёл: " + d.tcp.error : "прошёл за " + d.tcp.connectMs + "мс"}. ` +
      `Проверьте: правильный ли протокол, не блокирует ли firewall, корректны ли login/password.`
    return verdict
  }

  if (!verdict.proxyReallyWorks) {
    // Какой именно container IP совпал с detectedIp — для понятного recommendation.
    const matched = d.curlBaseline.detectedIp.includes(":")
      ? d.containerIp.via_v6
      : d.containerIp.via_v4
    verdict.suspectedRoot = "nodemaven_broken"
    verdict.recommendation =
      `Прокси НЕ работает: curl показывает detectedIp=${d.curlBaseline.detectedIp} ` +
      `= container IP (${matched ?? "n/a"}). Это значит трафик идёт мимо прокси ` +
      `(whitelist по IP контейнера не работает) ИЛИ прокси transparent. ` +
      `Проверьте на стороне провайдера: 1) текущий whitelist (${matched ?? d.containerIp.via_v4 ?? d.containerIp.via_v6}), ` +
      `2) включены ли login/password (некоторые провайдеры требуют их даже при whitelist), ` +
      `3) IP-pool не overlapping с Hetzner/Cloudflare/AWS.`
    return verdict
  }

  if (verdict.proxyReallyWorks && verdict.nodeRequestWorks) {
    // nativeFetch здесь expected_leak — undici игнорирует agent option, это
    // не баг. Главное что production path (socks lib для SOCKS5,
    // HttpsProxyAgent для HTTP/HTTPS) работает.
    verdict.suspectedRoot = "all_methods_work"
    verdict.recommendation =
      `Прокси работает корректно через Node код (${d.protocol === "socks5" ? "socks lib + manual TLS" : "https.request + HttpsProxyAgent"}). ` +
      `nativeFetch.isLeaking=${d.nativeFetch.isLeaking} — это EXPECTED ` +
      `(undici в Node 18+ игнорирует option \`agent\`). Используйте fetchJsonViaProxy в probe.ts, ` +
      `не native fetch. Если в UI всё ещё видна leak в /admin/proxies — проверьте кеш serverIp ` +
      `(5 мин TTL) или multi-source consensus в getServerIp().`
    return verdict
  }

  if (verdict.proxyReallyWorks && !verdict.nodeRequestWorks) {
    verdict.suspectedRoot = "fetchJson_fallback"
    verdict.recommendation =
      d.protocol === "socks5"
        ? `Curl работает но production path (socks lib) показывает leak/ошибку: ` +
          `${d.rawNodeRequest.error ?? "isLeaking=true"}. ` +
          `Проверьте SOCKS5 handshake, TLS upgrade и состояние socks lib в socks-fetch.ts.`
        : `Curl работает но https.request через HttpsProxyAgent показывает leak: ` +
          `${d.rawNodeRequest.error ?? "isLeaking=true"}. Проверьте версию https-proxy-agent.`
    return verdict
  }

  if (verdict.socks5hHelpsAtAll) {
    verdict.suspectedRoot = "socks5h_required"
    verdict.recommendation =
      `socks5h:// даёт корректный IP, а socks5:// — leak. Меняем buildProxyUrl() ` +
      `в probe.ts:271 чтобы для socks5 прокси использовать socks5h:// схему. ` +
      `Это закроет DNS leak.`
    return verdict
  }

  verdict.suspectedRoot = "unknown"
  verdict.recommendation =
    `Состояние неоднозначное: proxyReallyWorks=${verdict.proxyReallyWorks}, ` +
    `nodeRequestWorks=${verdict.nodeRequestWorks}, fetchWorks=${verdict.fetchWorks}. ` +
    `Нужен ручной анализ raw полей в этом JSON.`
  return verdict
}

/**
 * Полная диагностика прокси через 4 разных метода + curl baseline.
 *
 * Запускается из admin endpoint и НЕ кешируется. Все секреты (auth) маскируются
 * в curlBaseline.command — оригинальные значения в response не попадают.
 *
 * Возвращает ProxyDiagnostic — большой объект с показаниями всех методов и
 * auto-determined verdict. После прогона smoke-теста этот JSON используется
 * чтобы написать точечный fix.
 */
export async function diagnoseProxy(
  creds: ProxyCredentials,
): Promise<ProxyDiagnostic> {
  const containerIp = await fetchContainerIp()
  const tcp = await probeTcp(creds.host, creds.port)

  // Параллельно — три independent теста через прокси. curl первым (отдельно) —
  // baseline должен быть до Node-методов чтобы было что сравнивать в verdict.
  const curlBaseline = await runCurlBaseline(creds, containerIp)

  const [rawNodeRequest, nativeFetch, socks5hVariant, rawSocksLib] =
    await Promise.all([
      runRawNodeRequest(creds, containerIp),
      runNativeFetch(creds, containerIp),
      runSocks5hVariant(creds, containerIp),
      runRawSocksTest(creds, containerIp),
    ])

  // Снимок parsed agent — пишется в response и в prod logs. Помогает увидеть
  // если SocksProxyAgent распарсил пустой userId / обрезанный host (root cause
  // некоторых silent bypass сценариев).
  let agentDebug: AgentDebug
  try {
    const agent = buildAgent(creds)
    agentDebug = inspectAgent(agent, creds.protocol)
  } catch (err) {
    agentDebug = {
      type: "unknown",
      proxyHost: null,
      proxyPort: null,
    }
    console.warn("[diagnostic] inspectAgent failed", err)
  }
  console.log("[diagnostic] proxy agent snapshot", {
    proxyHost: creds.host,
    protocol: creds.protocol,
    agentDebug,
  })

  const diagnostic: ProxyDiagnostic = {
    proxyHost: creds.host,
    proxyPort: creds.port,
    protocol: creds.protocol,
    timestamp: new Date().toISOString(),
    containerIp,
    tcp,
    curlBaseline,
    rawNodeRequest,
    nativeFetch,
    socks5hVariant,
    rawSocksLib,
    agentDebug,
    verdict: {
      proxyReallyWorks: false,
      nodeRequestWorks: false,
      fetchWorks: false,
      socks5hHelpsAtAll: false,
      suspectedRoot: "unknown",
      recommendation: "",
    },
  }

  diagnostic.verdict = determineVerdict(diagnostic)

  return diagnostic
}
