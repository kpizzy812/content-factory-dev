/**
 * Unit-тесты socks-fetch — Pattern C (execFile('curl')).
 *
 * Pattern A (custom https.Agent через любую механику) и Pattern B
 * (socks-proxy-agent@8 + agent-base@7) оба не работают в Node v24: Saturn
 * Diagnose показал что Node v24 фундаментально игнорирует кастомный agent для
 * SOCKS5 path в https.request. curl --socks5-hostname это guaranteed путь
 * (curlBaseline в diagnostic.ts всегда отдаёт NodeMaven exit IP).
 *
 * Тесты проверяют:
 *   - curl вызывается с правильными аргументами (proxy host/port, credentials,
 *     User-Agent, target URL)
 *   - Парсинг status code из output (STATUS_MARKER)
 *   - Парсинг body
 *   - Обработка timeout (exit code 28 → "socks-... timeout")
 *   - Обработка connection errors (exit code !=0 → throw с stderr)
 *   - Backward-compat: timeoutMs как число
 */
import * as childProcess from "node:child_process"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ProxyCredentials } from "../../../shared/types/proxy"

// Mock node:child_process. socks-fetch.ts использует namespace import
// (`import * as childProcess from "node:child_process"` + `childProcess.execFile(...)`),
// поэтому замена через vi.mock корректно перехватывает вызовы. Простая фабрика
// без importOriginal — других экспортов из child_process нам не нужно.
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}))

import { curlSocks5Fetch, socksHttpGet, socksHttpsGet } from "../../../server/utils/proxy/socks-fetch"

const creds: ProxyCredentials = {
  protocol: "socks5",
  host: "gate.proxy.example",
  port: 1080,
  username: "u1",
  password: "p1",
}

type ExecFileCb = (
  err: NodeJS.ErrnoException | null,
  stdout: string,
  stderr: string,
) => void

interface CapturedCall {
  command: string
  args: string[]
  options: childProcess.ExecFileOptions | null
  cb: ExecFileCb
}

/**
 * Захватывает (command, args, options, cb) от vi.fn() execFile mock.
 */
function captureExecFile(): { calls: CapturedCall[] } {
  const calls: CapturedCall[] = []
  vi.mocked(childProcess.execFile).mockImplementation(((
    command: string,
    argsOrOptions?: readonly string[] | childProcess.ExecFileOptions | ExecFileCb,
    optionsOrCb?: childProcess.ExecFileOptions | ExecFileCb,
    cb?: ExecFileCb,
  ) => {
    let args: string[] = []
    let options: childProcess.ExecFileOptions | null = null
    let callback: ExecFileCb | undefined
    if (Array.isArray(argsOrOptions)) {
      args = [...argsOrOptions]
      if (typeof optionsOrCb === "function") {
        callback = optionsOrCb as ExecFileCb
      }
      else if (optionsOrCb) {
        options = optionsOrCb as childProcess.ExecFileOptions
        callback = cb
      }
    }
    else if (typeof argsOrOptions === "function") {
      callback = argsOrOptions as ExecFileCb
    }
    if (!callback) {
      throw new Error("execFile mock: callback missing")
    }
    calls.push({ command, args, options, cb: callback })
    return {} as childProcess.ChildProcess
  }) as typeof childProcess.execFile)
  return { calls }
}

afterEach(() => {
  vi.mocked(childProcess.execFile).mockReset()
})

describe("socksHttpsGet / socksHttpGet — curl args", () => {
  it("вызывает curl с --socks5-hostname host:port", async () => {
    const { calls } = captureExecFile()
    const promise = socksHttpsGet(creds, "https://ifconfig.me/all.json", { timeoutMs: 5000 })
    const call = calls[0]!
    call.cb(null, `BODY_HERE\n__SOCKS_HTTP_STATUS__:200`, "")
    await promise

    expect(call.command).toBe("curl")
    const socksIdx = call.args.indexOf("--socks5-hostname")
    expect(socksIdx).toBeGreaterThanOrEqual(0)
    expect(call.args[socksIdx + 1]).toBe("gate.proxy.example:1080")
  })

  it("передаёт credentials через --proxy-user", async () => {
    const { calls } = captureExecFile()
    const promise = socksHttpsGet(creds, "https://example.com/", { timeoutMs: 5000 })
    calls[0]!.cb(null, "X\n__SOCKS_HTTP_STATUS__:200", "")
    await promise

    const userIdx = calls[0]!.args.indexOf("--proxy-user")
    expect(userIdx).toBeGreaterThanOrEqual(0)
    expect(calls[0]!.args[userIdx + 1]).toBe("u1:p1")
  })

  it("НЕ добавляет --proxy-user если username пустой", async () => {
    const { calls } = captureExecFile()
    const noAuthCreds: ProxyCredentials = { ...creds, username: "", password: undefined }
    const promise = socksHttpsGet(noAuthCreds, "https://example.com/", { timeoutMs: 5000 })
    calls[0]!.cb(null, "X\n__SOCKS_HTTP_STATUS__:200", "")
    await promise

    expect(calls[0]!.args).not.toContain("--proxy-user")
  })

  it("передаёт --max-time в секундах и target URL последним аргументом", async () => {
    const { calls } = captureExecFile()
    const promise = socksHttpsGet(creds, "https://x.test/path?q=1", { timeoutMs: 12_000 })
    calls[0]!.cb(null, "X\n__SOCKS_HTTP_STATUS__:200", "")
    await promise

    const maxTimeIdx = calls[0]!.args.indexOf("--max-time")
    expect(maxTimeIdx).toBeGreaterThanOrEqual(0)
    expect(calls[0]!.args[maxTimeIdx + 1]).toBe("12")
    expect(calls[0]!.args[calls[0]!.args.length - 1]).toBe("https://x.test/path?q=1")
  })

  it("backward-compatible: timeout как число", async () => {
    const { calls } = captureExecFile()
    const promise = socksHttpsGet(creds, "https://x.test/", 7_000)
    calls[0]!.cb(null, "X\n__SOCKS_HTTP_STATUS__:200", "")
    await promise

    const maxTimeIdx = calls[0]!.args.indexOf("--max-time")
    expect(calls[0]!.args[maxTimeIdx + 1]).toBe("7")
  })

  it("включает User-Agent и Accept headers", async () => {
    const { calls } = captureExecFile()
    const promise = socksHttpsGet(creds, "https://x.test/", { timeoutMs: 5000 })
    calls[0]!.cb(null, "X\n__SOCKS_HTTP_STATUS__:200", "")
    await promise

    const headerArgs = calls[0]!.args.filter((a, i, arr) => arr[i - 1] === "-H")
    expect(headerArgs.some(h => h.startsWith("User-Agent:"))).toBe(true)
    expect(headerArgs.some(h => h.toLowerCase().includes("accept:"))).toBe(true)
  })
})

describe("socksHttpsGet / socksHttpGet — output parsing", () => {
  it("парсит status 200 и JSON body из stdout", async () => {
    const { calls } = captureExecFile()
    const bodyJson = `{"ip":"5.6.7.8","country":"US"}`
    const promise = socksHttpsGet(creds, "https://ifconfig.me/", { timeoutMs: 5000 })
    calls[0]!.cb(null, `${bodyJson}\n__SOCKS_HTTP_STATUS__:200`, "")

    const response = await promise
    expect(response.status).toBe(200)
    expect(response.body).toBe(bodyJson)
    expect(response.headers).toEqual({})
  })

  it("парсит status 407 без throw — caller сам решает что делать", async () => {
    const { calls } = captureExecFile()
    const promise = socksHttpGet(creds, "http://example.com/", { timeoutMs: 5000 })
    calls[0]!.cb(null, `auth required\n__SOCKS_HTTP_STATUS__:407`, "")

    const response = await promise
    expect(response.status).toBe(407)
    expect(response.body).toBe("auth required")
  })

  it("парсит большое body с переводами строк корректно", async () => {
    const { calls } = captureExecFile()
    const body = "{\n  \"a\": 1,\n  \"b\": 2\n}"
    const promise = socksHttpsGet(creds, "https://x.test/", { timeoutMs: 5000 })
    calls[0]!.cb(null, `${body}\n__SOCKS_HTTP_STATUS__:200`, "")

    const response = await promise
    expect(response.body).toBe(body)
    expect(response.status).toBe(200)
  })

  it("выбрасывает понятную ошибку если marker отсутствует в output", async () => {
    const { calls } = captureExecFile()
    const promise = socksHttpsGet(creds, "https://x.test/", { timeoutMs: 5000 })
    calls[0]!.cb(null, "incomplete output without status marker", "")

    await expect(promise).rejects.toThrow(/missing status marker/i)
  })
})

describe("socksHttpsGet / socksHttpGet — error handling", () => {
  it("curl exit code 28 (timeout) → throw 'socks-https timeout'", async () => {
    const { calls } = captureExecFile()
    const promise = socksHttpsGet(creds, "https://x.test/", { timeoutMs: 1000 })
    const err = Object.assign(new Error("timeout"), { code: 28 }) as NodeJS.ErrnoException
    calls[0]!.cb(err, "", "curl: (28) Operation timed out")

    await expect(promise).rejects.toThrow(/socks-https timeout/)
  })

  it("curl exit code 28 для HTTP target → 'socks-http timeout'", async () => {
    const { calls } = captureExecFile()
    const promise = socksHttpGet(creds, "http://x.test/", { timeoutMs: 1000 })
    const err = Object.assign(new Error("timeout"), { code: 28 }) as NodeJS.ErrnoException
    calls[0]!.cb(err, "", "curl: (28) Operation timed out")

    await expect(promise).rejects.toThrow(/socks-http timeout/)
  })

  it("killed=true → throw timeout (process killed by execFile timer)", async () => {
    const { calls } = captureExecFile()
    const promise = socksHttpsGet(creds, "https://x.test/", { timeoutMs: 1000 })
    const err = Object.assign(new Error("killed"), { killed: true, signal: "SIGTERM" }) as NodeJS.ErrnoException
    calls[0]!.cb(err, "", "")

    await expect(promise).rejects.toThrow(/timeout/)
  })

  it("curl exit code 7 (couldn't connect) → throw с exit code и stderr", async () => {
    const { calls } = captureExecFile()
    const promise = socksHttpsGet(creds, "https://x.test/", { timeoutMs: 5000 })
    const err = Object.assign(new Error("connect failed"), { code: 7 }) as NodeJS.ErrnoException
    calls[0]!.cb(err, "", "curl: (7) Failed to connect to gate.proxy.example port 1080")

    await expect(promise).rejects.toThrow(/curl exit 7/)
  })

  it("невалидный status string → throw понятную ошибку", async () => {
    const { calls } = captureExecFile()
    const promise = socksHttpsGet(creds, "https://x.test/", { timeoutMs: 5000 })
    calls[0]!.cb(null, "BODY\n__SOCKS_HTTP_STATUS__:not-a-number", "")

    await expect(promise).rejects.toThrow(/невалидный status/i)
  })
})

describe("curlSocks5Fetch — exported для интеграционных сценариев", () => {
  it("scheme='http' пробрасывается в timeout error", async () => {
    const { calls } = captureExecFile()
    const promise = curlSocks5Fetch(creds, "http://x.test/", { timeoutMs: 1000 }, "http")
    const err = Object.assign(new Error("timeout"), { code: 28 }) as NodeJS.ErrnoException
    calls[0]!.cb(err, "", "")

    await expect(promise).rejects.toThrow(/socks-http timeout/)
  })

  it("scheme='https' пробрасывается в timeout error", async () => {
    const { calls } = captureExecFile()
    const promise = curlSocks5Fetch(creds, "https://x.test/", { timeoutMs: 1000 }, "https")
    const err = Object.assign(new Error("timeout"), { code: 28 }) as NodeJS.ErrnoException
    calls[0]!.cb(err, "", "")

    await expect(promise).rejects.toThrow(/socks-https timeout/)
  })
})
