/**
 * Минимальный Apify-mock на node:http для happy-path интеграционных тестов.
 *
 * Эмулирует только тот срез REST API, который вызывает fetchAccountMetrics:
 *   POST /v2/acts/:actorId/runs           → { data: { id, status: "READY" } }
 *   GET  /v2/actor-runs/:runId            → { data: { id, status: "SUCCEEDED" } }
 *   GET  /v2/actor-runs/:runId/dataset/items → массив items (фикстура)
 *
 * Используется через ENV `APIFY_BASE_URL=http://localhost:<port>`. На стороне
 * клиента (`server/utils/apify-client.ts → getApifyBaseUrl()`) URL подставляется
 * прозрачно — поэтому код production не отличает реальный Apify от mock'а.
 *
 * НЕ запускается отдельным процессом — это in-process helper, поднимается из
 * beforeAll() конкретного spec'а и убивается в afterAll().
 */
import { createServer, type Server } from "node:http"

export interface ApifyMockOptions {
  /** Порт для прослушки. Дефолт 18890. */
  port?: number
  /** Items, которые вернёт endpoint `/dataset/items`. */
  datasetItems: unknown[]
  /** Опционально: статус, который возвращать на GET run (default SUCCEEDED). */
  runStatus?: "SUCCEEDED" | "FAILED" | "RUNNING"
}

export interface ApifyMockHandle {
  port: number
  baseUrl: string
  close: () => Promise<void>
}

/**
 * Поднимает HTTP-сервер и возвращает handle с base URL и close().
 * Если порт занят — поднимает на следующем доступном (через retry +1).
 */
export async function startApifyMock(opts: ApifyMockOptions): Promise<ApifyMockHandle> {
  const desired = opts.port ?? 18890
  const status = opts.runStatus ?? "SUCCEEDED"

  const server: Server = createServer((req, res) => {
    const url = req.url ?? ""

    // POST /v2/acts/:actorId/runs
    if (req.method === "POST" && url.startsWith("/v2/acts/") && url.includes("/runs")) {
      // Сглатываем тело — content не интересует, mock одинаково реагирует
      const chunks: Buffer[] = []
      req.on("data", (c: Buffer) => chunks.push(c))
      req.on("end", () => {
        res.writeHead(201, { "content-type": "application/json" })
        res.end(JSON.stringify({ data: { id: "mock-run-id", status: "READY" } }))
      })
      return
    }

    // GET /v2/actor-runs/:runId  (без dataset/items)
    if (
      req.method === "GET"
      && url.startsWith("/v2/actor-runs/")
      && !url.includes("/dataset/items")
    ) {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ data: { id: "mock-run-id", status } }))
      return
    }

    // GET /v2/actor-runs/:runId/dataset/items
    if (
      req.method === "GET"
      && url.startsWith("/v2/actor-runs/")
      && url.includes("/dataset/items")
    ) {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify(opts.datasetItems))
      return
    }

    res.writeHead(404, { "content-type": "application/json" })
    res.end(JSON.stringify({ error: "not_found", url }))
  })

  const port = await new Promise<number>((resolve, reject) => {
    let attemptedPort = desired
    const tryListen = (): void => {
      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && attemptedPort < desired + 20) {
          attemptedPort += 1
          server.listen(attemptedPort)
        } else {
          reject(err)
        }
      })
      server.listen(attemptedPort, () => {
        const addr = server.address()
        if (addr && typeof addr === "object") resolve(addr.port)
        else reject(new Error("apify-mock: не удалось получить порт"))
      })
    }
    tryListen()
  })

  return {
    port,
    baseUrl: `http://localhost:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
