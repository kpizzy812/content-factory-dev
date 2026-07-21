/**
 * Mock Google Drive REST v3 API. Эмулирует token exchange + минимальный набор
 * endpoint'ов для интеграции Drive в ZC (Этап 1).
 *
 * Запуск: bun run mock:drive
 * Слушает: http://localhost:18889 по умолчанию (override: MOCK_DRIVE_PORT).
 *
 * Сценарии — через query "scenario" или X-Mock-Scenario header:
 *   happy_path        — всё работает (default)
 *   auth_invalid      — POST /token → 401 invalid_grant
 *   quota_exceeded    — Drive endpoints → 429 quotaExceeded
 *   not_found         — GET /drive/v3/files/:id → 404
 *   large_file        — GET /drive/v3/files/:id?alt=media → 600MB поток (тест 500MB cap)
 *
 * Стейт: in-memory набор фейковых папок и файлов. Сброс при рестарте.
 */

import { createReadStream, statSync } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { resolve } from "node:path"

const PORT = Number(process.env.MOCK_DRIVE_PORT ?? 18889)
const FIXTURE_PATH = resolve(__dirname, "..", "__fixtures__", "drive-mock.mp4")

const FOLDER_MIME = "application/vnd.google-apps.folder"

interface MockFolder {
  id: string
  name: string
  mimeType: string
  parents: string[]
  modifiedTime: string
  createdTime: string
  webViewLink: string
}

interface MockVideo {
  id: string
  name: string
  mimeType: string
  parents: string[]
  size: string
  modifiedTime: string
  createdTime: string
  webViewLink: string
  thumbnailLink: string
}

const folders: MockFolder[] = [
  {
    id: "mock-folder-1",
    name: "Креативы — апрель 2026",
    mimeType: FOLDER_MIME,
    parents: ["root"],
    modifiedTime: "2026-05-01T10:00:00.000Z",
    createdTime: "2026-04-15T08:00:00.000Z",
    webViewLink: "https://drive.google.com/drive/folders/mock-folder-1",
  },
  {
    id: "mock-folder-2",
    name: "Архив",
    mimeType: FOLDER_MIME,
    parents: ["root"],
    modifiedTime: "2026-04-01T12:00:00.000Z",
    createdTime: "2026-01-15T08:00:00.000Z",
    webViewLink: "https://drive.google.com/drive/folders/mock-folder-2",
  },
  {
    id: "mock-folder-3",
    name: "Q2 кампании",
    mimeType: FOLDER_MIME,
    parents: ["mock-folder-1"],
    modifiedTime: "2026-04-30T15:00:00.000Z",
    createdTime: "2026-04-20T08:00:00.000Z",
    webViewLink: "https://drive.google.com/drive/folders/mock-folder-3",
  },
]

const videos: MockVideo[] = [
  {
    id: "mock-video-1",
    name: "creative-001.mp4",
    mimeType: "video/mp4",
    parents: ["mock-folder-1"],
    size: "5000000",
    modifiedTime: "2026-05-01T11:00:00.000Z",
    createdTime: "2026-05-01T09:00:00.000Z",
    webViewLink: "https://drive.google.com/file/d/mock-video-1/view",
    thumbnailLink: "https://lh3.googleusercontent.com/mock-video-1=s220",
  },
  {
    id: "mock-video-2",
    name: "creative-002.mp4",
    mimeType: "video/mp4",
    parents: ["mock-folder-1"],
    size: "5000000",
    modifiedTime: "2026-05-02T11:00:00.000Z",
    createdTime: "2026-05-02T09:00:00.000Z",
    webViewLink: "https://drive.google.com/file/d/mock-video-2/view",
    thumbnailLink: "https://lh3.googleusercontent.com/mock-video-2=s220",
  },
  {
    id: "mock-video-3",
    name: "creative-003.mp4",
    mimeType: "video/mp4",
    parents: ["mock-folder-1"],
    size: "5000000",
    modifiedTime: "2026-05-03T11:00:00.000Z",
    createdTime: "2026-05-03T09:00:00.000Z",
    webViewLink: "https://drive.google.com/file/d/mock-video-3/view",
    thumbnailLink: "https://lh3.googleusercontent.com/mock-video-3=s220",
  },
  {
    id: "mock-video-4",
    name: "creative-004.mp4",
    mimeType: "video/mp4",
    parents: ["mock-folder-3"],
    size: "5000000",
    modifiedTime: "2026-05-04T11:00:00.000Z",
    createdTime: "2026-05-04T09:00:00.000Z",
    webViewLink: "https://drive.google.com/file/d/mock-video-4/view",
    thumbnailLink: "https://lh3.googleusercontent.com/mock-video-4=s220",
  },
  {
    id: "mock-video-5",
    name: "creative-005.mp4",
    mimeType: "video/mp4",
    parents: ["mock-folder-3"],
    size: "5000000",
    modifiedTime: "2026-05-05T11:00:00.000Z",
    createdTime: "2026-05-05T09:00:00.000Z",
    webViewLink: "https://drive.google.com/file/d/mock-video-5/view",
    thumbnailLink: "https://lh3.googleusercontent.com/mock-video-5=s220",
  },
]

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    let buf = ""
    req.setEncoding("utf-8")
    req.on("data", (chunk) => {
      buf += chunk
      if (buf.length > 1_000_000) {
        req.destroy()
        rejectBody(new Error("body too large"))
      }
    })
    req.on("end", () => resolveBody(buf))
    req.on("error", rejectBody)
  })
}

function pickScenario(req: IncomingMessage, url: URL): string {
  const fromQuery = url.searchParams.get("scenario")
  if (fromQuery) return fromQuery
  const fromHeader = req.headers["x-mock-scenario"]
  if (typeof fromHeader === "string") return fromHeader
  return "happy_path"
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader("Content-Type", "application/json; charset=utf-8")
  res.end(JSON.stringify(payload))
}

function quotaExceededResponse(res: ServerResponse): void {
  send(res, 429, {
    error: {
      code: 429,
      message: "Quota exceeded for the current project",
      errors: [{ reason: "quotaExceeded", domain: "usageLimits" }],
    },
  })
}

function isFolderQuery(q: string | null): boolean {
  if (!q) return false
  return q.includes(`mimeType='${FOLDER_MIME}'`) || q.includes("application/vnd.google-apps.folder")
}

function extractParentFromQuery(q: string | null): string | null {
  if (!q) return null
  const match = q.match(/'([\w-]+)'\s+in\s+parents/)
  return match ? (match[1] ?? null) : null
}

function listFolderItems(parent: string | null): MockFolder[] {
  const target = parent ?? "root"
  return folders.filter((f) => f.parents.includes(target))
}

function listVideoItems(parent: string | null): MockVideo[] {
  const target = parent ?? "root"
  return videos.filter((v) => v.parents.includes(target))
}

function streamFixture(res: ServerResponse): void {
  let stat
  try {
    stat = statSync(FIXTURE_PATH)
  } catch {
    res.statusCode = 500
    res.end("fixture missing")
    return
  }
  res.statusCode = 200
  res.setHeader("Content-Type", "video/mp4")
  res.setHeader("Content-Length", String(stat.size))
  const stream = createReadStream(FIXTURE_PATH)
  stream.pipe(res)
  stream.on("error", (err) => {
    console.error("[mock-drive] fixture stream error:", err)
    res.destroy()
  })
}

function streamLargeBlob(res: ServerResponse): void {
  // Эмулирует "большой файл" для теста 500MB cap. Заявляем 600MB Content-Length,
  // но в реальности отправляем chunks с задержкой — клиент должен сделать abort после 500MB.
  const declared = 600_000_000
  res.statusCode = 200
  res.setHeader("Content-Type", "video/mp4")
  res.setHeader("Content-Length", String(declared))

  const chunkSize = 1_048_576 // 1MB
  const chunk = Buffer.alloc(chunkSize, 0)
  let sent = 0

  function writeNext(): void {
    if (sent >= declared || res.writableEnded || res.destroyed) {
      res.end()
      return
    }
    const ok = res.write(chunk)
    sent += chunkSize
    if (!ok) {
      res.once("drain", writeNext)
    } else {
      // micro-yield чтобы клиент успел обработать abort
      setImmediate(writeNext)
    }
  }
  writeNext()
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`)
  const path = url.pathname
  const method = req.method ?? "GET"
  const scenario = pickScenario(req, url)

  console.log(`[mock-drive] ${method} ${path}${url.search} → scenario=${scenario}`)

  // POST /token — JWT exchange
  if (method === "POST" && path === "/token") {
    if (scenario === "auth_invalid") {
      return send(res, 401, { error: "invalid_grant", error_description: "Invalid JWT signature" })
    }
    await readBody(req).catch(() => "")
    return send(res, 200, {
      access_token: `mock-token-${Date.now()}`,
      expires_in: 3600,
      token_type: "Bearer",
    })
  }

  // GET /drive/v3/files — list (folders OR files)
  if (method === "GET" && path === "/drive/v3/files") {
    if (scenario === "quota_exceeded") return quotaExceededResponse(res)

    const q = url.searchParams.get("q")
    const parent = extractParentFromQuery(q)

    if (isFolderQuery(q)) {
      const items = listFolderItems(parent).map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        parents: f.parents,
        modifiedTime: f.modifiedTime,
        createdTime: f.createdTime,
        webViewLink: f.webViewLink,
        capabilities: { canAddChildren: true },
      }))
      return send(res, 200, { files: items, nextPageToken: null })
    }

    const items = listVideoItems(parent).map((v) => ({
      id: v.id,
      name: v.name,
      mimeType: v.mimeType,
      parents: v.parents,
      size: v.size,
      modifiedTime: v.modifiedTime,
      createdTime: v.createdTime,
      webViewLink: v.webViewLink,
      thumbnailLink: v.thumbnailLink,
    }))
    return send(res, 200, { files: items, nextPageToken: null })
  }

  // GET /drive/v3/files/:id  (metadata or media)
  if (method === "GET" && path.startsWith("/drive/v3/files/")) {
    if (scenario === "quota_exceeded") return quotaExceededResponse(res)

    const id = decodeURIComponent(path.replace("/drive/v3/files/", ""))
    const isMedia = url.searchParams.get("alt") === "media"

    if (scenario === "not_found") {
      return send(res, 404, {
        error: { code: 404, message: `File ${id} not found`, errors: [{ reason: "notFound" }] },
      })
    }

    if (isMedia) {
      if (scenario === "large_file") {
        return streamLargeBlob(res)
      }
      // По умолчанию любой id → fixture (чтобы download.post.ts мог скачать).
      return streamFixture(res)
    }

    // metadata
    const folder = folders.find((f) => f.id === id)
    if (folder) {
      return send(res, 200, {
        id: folder.id,
        name: folder.name,
        mimeType: folder.mimeType,
        parents: folder.parents,
        modifiedTime: folder.modifiedTime,
        createdTime: folder.createdTime,
        webViewLink: folder.webViewLink,
      })
    }
    const video = videos.find((v) => v.id === id)
    if (video) {
      return send(res, 200, {
        id: video.id,
        name: video.name,
        mimeType: video.mimeType,
        parents: video.parents,
        size: video.size,
        modifiedTime: video.modifiedTime,
        createdTime: video.createdTime,
        webViewLink: video.webViewLink,
        thumbnailLink: video.thumbnailLink,
      })
    }
    return send(res, 404, {
      error: { code: 404, message: `File ${id} not found`, errors: [{ reason: "notFound" }] },
    })
  }

  send(res, 404, { error: `Not implemented in mock: ${method} ${path}` })
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error("[mock-drive] handler error:", err)
    if (!res.headersSent) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: "mock handler failure" }))
    }
  })
})

server.listen(PORT, () => {
  console.log(`[mock-drive] listening on http://localhost:${PORT}`)
  console.log(`[mock-drive] scenarios: happy_path, auth_invalid, quota_exceeded, not_found, large_file`)
  console.log(`[mock-drive] usage: GOOGLE_DRIVE_MOCK_MODE=true GOOGLE_DRIVE_MOCK_URL=http://localhost:${PORT} bun run dev`)
  console.log(`[mock-drive] fixture: ${FIXTURE_PATH}`)
})

const shutdown = (): void => {
  console.log("[mock-drive] shutting down")
  server.close(() => process.exit(0))
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
