/**
 * SOCKS5 fetch через execFile('curl --socks5-hostname').
 *
 * Решает фундаментальную проблему Node v24: при любой попытке использовать
 * custom http.Agent (instance-property override, subclass `extends https.Agent`,
 * socks-proxy-agent@8/@10, agent-base@7/@9) внутри `https.request` для SOCKS5
 * Node игнорирует agent и делает direct tls.connect к target — что даёт server
 * IP leak. HttpsProxyAgent (HTTP-прокси через CONNECT) при этом работает, баг
 * специфичен для SOCKS5 path в Node v24. История диагностики — в git log
 * (Patterns A → B → C, 4 Saturn Diagnose итерации).
 *
 * curl с `--socks5-hostname` это guaranteed путь (curlBaseline в diagnostic.ts
 * стабильно отдаёт NodeMaven exit IP). Overhead — один spawn curl на каждую
 * проверку прокси, ~50ms сверху TCP+TLS+HTTP, что для probe (раз в минуту-другую)
 * приемлемо. Public API сохранён под старую signature — `probe.ts` и
 * `diagnostic.ts` не меняются.
 */

import * as childProcess from "node:child_process"
import type { ProxyCredentials } from "../../../shared/types/proxy"

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_TLS_HANDSHAKE_TIMEOUT_MS = 7_000
const DEFAULT_USER_AGENT = "ZavodCamp-ProxyChecker/1.0"
const MAX_RESPONSE_BYTES = 256 * 1024
const CURL_GRACE_MS = 5_000
const STATUS_MARKER = "\n__SOCKS_HTTP_STATUS__:"

export interface SocksHttpResponse {
  status: number
  body: string
  headers: Record<string, string>
}

export interface SocksHttpOptions {
  /** Общий таймаут (передаётся в curl --max-time + execFile timeout). По умолчанию 15 сек. */
  timeoutMs?: number
  /** Back-compat — игнорируется в curl-path (curl сам управляет TLS handshake). */
  tlsHandshakeTimeoutMs?: number
  /** User-Agent header. */
  userAgent?: string
}

export async function socksHttpsGet(
  creds: ProxyCredentials,
  targetUrl: string,
  optionsOrTimeout?: SocksHttpOptions | number,
): Promise<SocksHttpResponse> {
  return await curlSocks5Fetch(creds, targetUrl, optionsOrTimeout, "https")
}

export async function socksHttpGet(
  creds: ProxyCredentials,
  targetUrl: string,
  optionsOrTimeout?: SocksHttpOptions | number,
): Promise<SocksHttpResponse> {
  return await curlSocks5Fetch(creds, targetUrl, optionsOrTimeout, "http")
}

/**
 * Запуск curl --socks5-hostname с разбором output через STATUS_MARKER.
 * Exported для unit-тестов, прямые callers должны использовать socksHttpsGet/socksHttpGet.
 */
export async function curlSocks5Fetch(
  creds: ProxyCredentials,
  targetUrl: string,
  optionsOrTimeout: SocksHttpOptions | number | undefined,
  scheme: "https" | "http",
): Promise<SocksHttpResponse> {
  const options = normalizeOptions(optionsOrTimeout)
  const timeoutSec = Math.max(1, Math.ceil(options.timeoutMs / 1000))

  const args: string[] = [
    "--socks5-hostname",
    `${creds.host}:${creds.port}`,
  ]
  if (creds.username) {
    args.push("--proxy-user", `${creds.username}:${creds.password ?? ""}`)
  }
  args.push(
    "-s",
    "--max-time",
    String(timeoutSec),
    "-w",
    `${STATUS_MARKER}%{http_code}`,
    "-H",
    `User-Agent: ${options.userAgent}`,
    "-H",
    "Accept: application/json,text/plain,*/*",
    targetUrl,
  )

  let stdout: string
  try {
    const result = await runCurl(args, options.timeoutMs + CURL_GRACE_MS)
    stdout = result.stdout
  }
  catch (err) {
    const e = err as { code?: number | string; killed?: boolean; signal?: string; stderr?: string; message?: string }
    // curl exit codes (https://everything.curl.dev/usingcurl/returns.html):
    // 28 — operation timeout. killed/SIGTERM — execFile timer уронил процесс.
    if (e.code === 28 || e.killed === true || e.signal === "SIGTERM") {
      throw new Error(`socks-${scheme} timeout`)
    }
    if (typeof e.code === "number") {
      const stderrShort = (e.stderr ?? "").slice(0, 120).trim()
      throw new Error(`curl exit ${e.code}${stderrShort ? `: ${stderrShort}` : ""}`)
    }
    throw err instanceof Error ? err : new Error(String(err))
  }

  const markerIdx = stdout.lastIndexOf(STATUS_MARKER)
  if (markerIdx === -1) {
    throw new Error("curl output missing status marker — возможно процесс убит mid-response")
  }
  const body = stdout.substring(0, markerIdx)
  const statusStr = stdout.substring(markerIdx + STATUS_MARKER.length).trim()
  const status = Number.parseInt(statusStr, 10)
  if (Number.isNaN(status)) {
    throw new Error(`curl вернул невалидный status: "${statusStr.slice(0, 32)}"`)
  }

  // headers не парсим — callers (probe.ts/diagnostic.ts) их не используют для
  // socksHttpsGet/socksHttpGet path. Если когда-то потребуется — добавить
  // `-D /tmp/...` и распарсить response headers, но это сейчас оверкилл.
  return { status, body, headers: {} }
}

/**
 * Callback-style wrapper над execFile чтобы unit-тесты могли mock'ать через
 * vi.mock без promisify-magic. На ошибку прицепляет stdout/stderr к err для
 * диагностики.
 */
function runCurl(
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      "curl",
      args,
      {
        timeout: timeoutMs,
        maxBuffer: MAX_RESPONSE_BYTES + 1024,
        encoding: "utf8",
      },
      (err, stdoutRaw, stderrRaw) => {
        const stdout = typeof stdoutRaw === "string"
          ? stdoutRaw
          : (stdoutRaw as Buffer | undefined)?.toString("utf8") ?? ""
        const stderr = typeof stderrRaw === "string"
          ? stderrRaw
          : (stderrRaw as Buffer | undefined)?.toString("utf8") ?? ""
        if (err) {
          reject(Object.assign(err as Error, { stdout, stderr }))
        }
        else {
          resolve({ stdout, stderr })
        }
      },
    )
  })
}

function normalizeOptions(
  optionsOrTimeout?: SocksHttpOptions | number,
): Required<SocksHttpOptions> {
  if (typeof optionsOrTimeout === "number") {
    return {
      timeoutMs: optionsOrTimeout,
      tlsHandshakeTimeoutMs: DEFAULT_TLS_HANDSHAKE_TIMEOUT_MS,
      userAgent: DEFAULT_USER_AGENT,
    }
  }
  return {
    timeoutMs: optionsOrTimeout?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    tlsHandshakeTimeoutMs:
      optionsOrTimeout?.tlsHandshakeTimeoutMs ?? DEFAULT_TLS_HANDSHAKE_TIMEOUT_MS,
    userAgent: optionsOrTimeout?.userAgent ?? DEFAULT_USER_AGENT,
  }
}
