/**
 * Unit-тесты media-push (Этап 3) — заливка видео в устройство DuoPlus через
 * Cloud Drive (push-модель). Наш сервер уже скачал видео из GCS в локальный tmp;
 * media-push заливает готовый файл: signedUrl → PUT (OSS) → list → pushFiles →
 * ls-poll готовности на устройстве → media-scanner → delFiles cleanup.
 *
 * Покрывает:
 *  - последовательность Cloud Drive (signedUrl → PUT с байтами файла → list → pushFiles).
 *  - pushFiles целит в нужный dest_dir (/sdcard/DCIM/Camera) и image_id.
 *  - ls-poll готовности по стабилизации размера (растущий размер → ждём; стабильный → готово).
 *  - media-scanner broadcast (MEDIA_SCANNER_SCAN_FILE) ОБЯЗАТЕЛЬНО вызван после готовности.
 *  - delFiles cleanup Cloud Drive после успеха.
 *  - таймаут, если файл не появился на устройстве.
 *  - sanitizeDeviceFilename / parseLsSize.
 *
 * Перехват — recording-HTTP-сервер: маршрутизирует cloudDisk/* + cloudPhone/command
 * + принимает PUT на «OSS» (signedUrl указывает на него же). `ls -l` отдаётся из
 * настраиваемой очереди (растущий/стабильный размер по очереди вызовов).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createServer, type Server } from "node:http"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { resetDuoplusClient } from "../../server/utils/posting-provider/duoplus-client"
import {
  parseLsSize,
  pushVideoToDevice,
  removeDeviceVideo,
  sanitizeDeviceFilename,
} from "../../server/automation/automation-engine/media-push"

const API_KEY = "test-key-from-env"
const IMAGE_ID = "M2Hxh"
const CLOUD_FILE_ID = "FILEID1"

interface PostedRequest {
  url: string
  body: Record<string, unknown>
}

interface RecordingServer {
  server: Server
  baseUrl: string
  /** Все shell-команды, отправленные в /cloudPhone/command по порядку. */
  commands: string[]
  /** Все POST-запросы (url + тело) — для проверки последовательности/аргументов. */
  posted: PostedRequest[]
  /** PUT-заливки на «OSS» (имя файла + получено байт). */
  putReceived: Array<{ name: string; bytes: number }>
  /** Очередь stdout для `ls -l ...` — по одному на каждый ls-вызов. */
  lsQueue: string[]
  close: () => Promise<void>
}

async function startRecordingServer(): Promise<RecordingServer> {
  const commands: string[] = []
  const posted: PostedRequest[] = []
  const putReceived: Array<{ name: string; bytes: number }> = []
  const lsQueue: string[] = []
  let lsIdx = 0
  let baseUrl = ""

  const json = (res: import("node:http").ServerResponse, obj: unknown): void => {
    res.statusCode = 200
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify(obj))
  }

  const server = createServer((req, res) => {
    const url = req.url || ""

    // PUT на «OSS» (signedUrl указывает сюда) — считаем байты тела.
    if (req.method === "PUT" && url.startsWith("/oss-put/")) {
      let bytes = 0
      req.on("data", (c) => (bytes += c.length))
      req.on("end", () => {
        putReceived.push({ name: decodeURIComponent(url.slice("/oss-put/".length)), bytes })
        json(res, { Status: "OK" })
      })
      return
    }

    let body = ""
    req.setEncoding("utf-8")
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      let parsed: Record<string, unknown> = {}
      try { parsed = JSON.parse(body || "{}") } catch { parsed = {} }
      posted.push({ url, body: parsed })

      if (url === "/api/v1/cloudDisk/signedUrl") {
        const name = String(parsed.name ?? "")
        return json(res, {
          code: 200,
          data: {
            method: "PUT",
            signedUrl: `${baseUrl}/oss-put/${encodeURIComponent(name)}`,
            headers: { "x-oss-callback": "cb", "x-oss-callback-var": "var" },
            name,
            original_file_name: name,
          },
          message: "Success",
        })
      }

      if (url === "/api/v1/cloudDisk/list") {
        const keyword = String(parsed.keyword ?? "")
        const found = putReceived.some((p) => p.name === keyword)
        return json(res, {
          code: 200,
          data: {
            list: found
              ? [{ id: CLOUD_FILE_ID, name: keyword, original_file_name: keyword }]
              : [],
            total: found ? 1 : 0,
          },
          message: "Success",
        })
      }

      if (url === "/api/v1/cloudDisk/pushFiles") {
        const ids = Array.isArray(parsed.ids) ? (parsed.ids as string[]) : []
        const imageIds = Array.isArray(parsed.image_ids) ? (parsed.image_ids as string[]) : []
        return json(res, {
          code: 200,
          data: {
            message: "Success",
            success: imageIds.map((iid) => ({ image_id: iid, id: ids[0] })),
            fail: [],
          },
          message: "Success",
        })
      }

      if (url === "/api/v1/cloudDisk/delFiles") {
        return json(res, { code: 200, data: { message: "success" }, message: "Success" })
      }

      if (url === "/api/v1/cloudPhone/command") {
        const command = typeof parsed.command === "string" ? parsed.command : ""
        commands.push(command)
        let content = ""
        if (/^ls\b/.test(command.trim())) {
          content = lsQueue[Math.min(lsIdx, lsQueue.length - 1)] ?? ""
          lsIdx += 1
        } else if (/am\s+broadcast/.test(command)) {
          content = "Broadcast completed: result=0"
        }
        return json(res, {
          code: 200,
          data: { success: true, content, message: "" },
          message: "Success",
        })
      }

      // Неизвестный endpoint.
      json(res, { code: 200, data: {}, message: "Success" })
    })
  })

  const port = await new Promise<number>((resolve) => {
    server.listen(0, () => {
      const addr = server.address()
      resolve(typeof addr === "object" && addr ? addr.port : 0)
    })
  })
  baseUrl = `http://localhost:${port}`

  return {
    server,
    baseUrl,
    commands,
    posted,
    putReceived,
    lsQueue,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

function setEnv(baseUrl: string): void {
  process.env.DUOPLUS_MOCK_MODE = "true"
  process.env.DUOPLUS_MOCK_URL = baseUrl
  process.env.DUOPLUS_API_KEY = API_KEY
  resetDuoplusClient()
}

describe("media-push: pushVideoToDevice через Cloud Drive (mock)", () => {
  let rec: RecordingServer
  let tmpDir: string
  let localFile: string

  beforeEach(async () => {
    rec = await startRecordingServer()
    setEnv(rec.baseUrl)
    tmpDir = await mkdtemp(path.join(tmpdir(), "mp-test-"))
    localFile = path.join(tmpDir, "job-1.mp4")
    await writeFile(localFile, Buffer.alloc(2048, 7)) // 2KB фейковое видео
  })

  afterEach(async () => {
    resetDuoplusClient()
    delete process.env.DUOPLUS_MOCK_MODE
    delete process.env.DUOPLUS_MOCK_URL
    delete process.env.DUOPLUS_API_KEY
    await rec.close()
    await rm(tmpDir, { recursive: true, force: true })
  })

  const LS = (size: number): string =>
    `-rw-rw---- 1 u0_a123 media_rw ${size} 2026-06-12 12:00 job-1.mp4`

  it("заливает локальный файл через Cloud Drive (signedUrl→PUT→list→pushFiles), возвращает device-путь", async () => {
    rec.lsQueue.push(LS(5_242_880), LS(5_242_880))

    const result = await pushVideoToDevice(IMAGE_ID, localFile, "job-1.mp4", {
      pollIntervalMs: 1,
    })

    expect(result).toBe("/sdcard/DCIM/Camera/job-1.mp4")

    // Последовательность Cloud Drive вызвана.
    const urls = rec.posted.map((p) => p.url)
    expect(urls).toContain("/api/v1/cloudDisk/signedUrl")
    expect(urls).toContain("/api/v1/cloudDisk/list")
    expect(urls).toContain("/api/v1/cloudDisk/pushFiles")

    // PUT реально получил байты файла (2KB).
    expect(rec.putReceived.length).toBe(1)
    expect(rec.putReceived[0].bytes).toBe(2048)

    // pushFiles целит в DCIM нужным файлом и устройством.
    const push = rec.posted.find((p) => p.url === "/api/v1/cloudDisk/pushFiles")!
    expect(push.body.dest_dir).toBe("/sdcard/DCIM/Camera")
    expect(push.body.ids).toEqual([CLOUD_FILE_ID])
    expect(push.body.image_ids).toEqual([IMAGE_ID])
  })

  it("ls-poll ждёт стабилизации размера (растёт → ждём, стабильно → готово)", async () => {
    rec.lsQueue.push(LS(1_000_000), LS(3_000_000), LS(5_000_000), LS(5_000_000))

    await pushVideoToDevice(IMAGE_ID, localFile, "job-1.mp4", { pollIntervalMs: 1 })

    const lsCalls = rec.commands.filter((c) => c.startsWith("ls"))
    expect(lsCalls.length).toBeGreaterThanOrEqual(4)
    expect(lsCalls[0]).toContain("ls -l /sdcard/DCIM/Camera/job-1.mp4")
    expect(lsCalls[0]).toContain("2>/dev/null")
  })

  it("media-scanner broadcast вызван ПОСЛЕ готовности (обязателен)", async () => {
    rec.lsQueue.push(LS(5_242_880), LS(5_242_880))

    await pushVideoToDevice(IMAGE_ID, localFile, "job-1.mp4", { pollIntervalMs: 1 })

    const scanCmd = rec.commands.find((c) => /am\s+broadcast/.test(c))
    expect(scanCmd).toBeDefined()
    expect(scanCmd).toContain("android.intent.action.MEDIA_SCANNER_SCAN_FILE")
    expect(scanCmd).toContain("-d file:///sdcard/DCIM/Camera/job-1.mp4")

    const scanIdx = rec.commands.findIndex((c) => /am\s+broadcast/.test(c))
    const firstLsIdx = rec.commands.findIndex((c) => c.startsWith("ls"))
    expect(scanIdx).toBeGreaterThan(firstLsIdx)
  })

  it("delFiles cleanup Cloud Drive вызван после успеха", async () => {
    rec.lsQueue.push(LS(5_242_880), LS(5_242_880))

    await pushVideoToDevice(IMAGE_ID, localFile, "job-1.mp4", { pollIntervalMs: 1 })

    const del = rec.posted.find((p) => p.url === "/api/v1/cloudDisk/delFiles")
    expect(del).toBeDefined()
    expect(del!.body.ids).toEqual([CLOUD_FILE_ID])
  })

  it("файл не появился на устройстве → таймаут с ошибкой, без media-scanner", async () => {
    // ls всегда «No such file» → размер null навсегда (но в Cloud Drive файл есть).
    rec.lsQueue.push("ls: /sdcard/DCIM/Camera/job-1.mp4: No such file or directory")

    await expect(
      pushVideoToDevice(IMAGE_ID, localFile, "job-1.mp4", {
        pollIntervalMs: 1,
        readyTimeoutMs: 30,
      }),
    ).rejects.toThrow(/не появился|не стабилизировал/)

    expect(rec.commands.some((c) => /am\s+broadcast/.test(c))).toBe(false)
  })

  it("removeDeviceVideo best-effort вызывает rm -f", async () => {
    await removeDeviceVideo(IMAGE_ID, "/sdcard/DCIM/Camera/job-1.mp4")
    expect(rec.commands.some((c) => c.startsWith("rm -f /sdcard/DCIM/Camera/job-1.mp4"))).toBe(true)
  })
})

describe("media-push: чистые хелперы", () => {
  it("sanitizeDeviceFilename чистит небезопасные символы", () => {
    expect(sanitizeDeviceFilename("job-1.mp4")).toBe("job-1.mp4")
    expect(sanitizeDeviceFilename("a b;rm -rf/.mp4")).toBe("a_b_rm_-rf_.mp4")
    // Слэши → '_', ведущие точки срезаются (защита от обхода каталога).
    expect(sanitizeDeviceFilename("../../etc/passwd")).toBe("_.._etc_passwd")
    expect(sanitizeDeviceFilename("")).toBe("video.mp4")
  })

  it("parseLsSize извлекает размер из ls -l", () => {
    expect(parseLsSize("-rw-rw---- 1 u0_a123 media_rw 5242880 2026-06-12 12:00 job-1.mp4")).toBe(5_242_880)
    expect(parseLsSize("")).toBeNull()
    expect(parseLsSize("ls: job-1.mp4: No such file or directory")).toBeNull()
  })
})
