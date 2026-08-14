/**
 * Mock-обработчик fal.ai вызовов.
 *
 * Стратегия:
 * - falSubmit / falPollUntilDone в mock-режиме возвращают синтетические meta+result.
 * - URL'ы в результатах используют схему "mock://" чтобы downloadFile понял
 *   что нужно сгенерить placeholder вместо реальной загрузки.
 * - Placeholder'ы (MP4 / MP3 / PNG) генерируются через ffmpeg и кешируются
 *   в storage/uploads/_mock_cache/ — повторные запросы copy без re-encode.
 */

import { existsSync } from "node:fs"
import { copyFile, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { spawn } from "node:child_process"
import type { FalRequestMeta, FalRequestResult } from "../fal"
import { getMockCacheBase } from "../storage-paths"

const MOCK_PROTOCOL = "mock://"

export function isMockUrl(url: string): boolean {
  return typeof url === "string" && url.startsWith(MOCK_PROTOCOL)
}

interface FalEndpointKind {
  kind: "image" | "video" | "audio" | "transcript" | "unknown"
}

function classifyEndpoint(endpoint: string): FalEndpointKind {
  const e = endpoint.toLowerCase()
  if (e.includes("flux") || e.includes("image") || e.includes("imagen") || e.includes("ideogram")) {
    return { kind: "image" }
  }
  if (e.includes("kling-video") || e.includes("video") || e.includes("luma")) {
    return { kind: "video" }
  }
  if (e.includes("kokoro") || e.includes("playai") || e.includes("elevenlabs") || e.includes("tts")) {
    return { kind: "audio" }
  }
  if (e.includes("whisper") || e.includes("transcribe")) {
    return { kind: "transcript" }
  }
  if (e.includes("mubert") || e.includes("music")) {
    return { kind: "audio" }
  }
  return { kind: "unknown" }
}

function makeMockUrl(kind: FalEndpointKind["kind"], requestId: string): string {
  return `${MOCK_PROTOCOL}${kind}/${requestId}`
}

function makeRequestId(): string {
  return "mock-" + Math.random().toString(36).slice(2, 12)
}

export function mockFalSubmit(endpoint: string): FalRequestMeta {
  console.log(`[fal-mock] submit ${endpoint}`)
  return {
    requestId: makeRequestId(),
    endpoint,
    submittedAt: new Date(),
  }
}

export async function mockFalPollUntilDone<T>(
  endpoint: string,
  requestId: string,
): Promise<FalRequestResult<T>> {
  console.log(`[fal-mock] poll ${endpoint} ${requestId}`)
  await new Promise(r => setTimeout(r, 600))

  const { kind } = classifyEndpoint(endpoint)
  const url = makeMockUrl(kind, requestId)

  let data: unknown
  switch (kind) {
    case "image":
      data = { images: [{ url, content_type: "image/png", width: 1024, height: 1024 }] }
      break
    case "video":
      data = { video: { url, content_type: "video/mp4" } }
      break
    case "audio":
      data = { audio: { url, content_type: "audio/mpeg", duration: 5 } }
      break
    case "transcript":
      data = {
        text: "Mock transcript. First sentence. Second sentence.",
        chunks: [
          { start: 0, end: 2.5, text: "Mock transcript. First sentence." },
          { start: 2.5, end: 5, text: "Second sentence." },
        ],
      }
      break
    default:
      data = { mock: true, endpoint, note: "no specific mock data for this endpoint" }
  }

  return {
    data: data as T,
    meta: { requestId, endpoint, submittedAt: new Date() },
    completedAt: new Date(),
  }
}

/**
 * Генерирует placeholder для mock URL. Поддерживает:
 *   mock://video/{id} → 3-секундное чёрное видео H.264 1080x1920
 *   mock://audio/{id} → 1-секундный silent MP3
 *   mock://image/{id} → 1024x1024 чёрный PNG
 *   mock://transcript/{id} → пустой JSON-файл с текстом
 *
 * Использует кеш: повторные вызовы для одного kind → копия из кеша без ffmpeg.
 */
/**
 * Расширение файла кеша заглушки.
 *
 * Контейнер ffmpeg выбирает ПО РАСШИРЕНИЮ выходного файла. Кеш лежал в
 * `<kind>.bin`, и на холодном старте ffmpeg отвечал «Unable to choose an output
 * format for image.bin» с кодом Invalid argument — падал первый же вызов, а с
 * ним весь API-контур генерации кадров. На машине с прогретым кешем этого не
 * видно: файл уже есть, ffmpeg не зовётся.
 */
const CACHE_EXTENSIONS: Record<string, string> = {
  video: ".mp4",
  audio: ".mp3",
  image: ".png",
  transcript: ".json",
}

export async function generateMockPlaceholder(url: string, destPath: string): Promise<void> {
  if (!isMockUrl(url)) {
    throw new Error(`generateMockPlaceholder: ожидался mock:// URL, получен ${url}`)
  }
  const rest = url.slice(MOCK_PROTOCOL.length)
  const kind = rest.split("/")[0] ?? "unknown"

  const cacheDir = getMockCacheBase()
  await mkdir(cacheDir, { recursive: true })
  const cacheFile = join(cacheDir, `${kind}${CACHE_EXTENSIONS[kind] ?? ".json"}`)

  if (!existsSync(cacheFile)) {
    await buildPlaceholder(kind, cacheFile)
  }

  await copyFile(cacheFile, destPath)
  console.log(`[fal-mock] downloadFile mock: ${url} → ${destPath}`)
}

async function buildPlaceholder(kind: string, outPath: string): Promise<void> {
  switch (kind) {
    case "video":
      await runFfmpeg([
        "-y",
        "-f", "lavfi", "-i", "color=black:size=1080x1920:duration=3:rate=30",
        "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-shortest",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast",
        "-c:a", "aac", "-b:a", "96k",
        outPath,
      ])
      return
    case "audio":
      await runFfmpeg([
        "-y",
        "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-t", "1",
        "-c:a", "libmp3lame", "-b:a", "96k",
        outPath,
      ])
      return
    case "image":
      await runFfmpeg([
        "-y",
        "-f", "lavfi", "-i", "color=black:size=1024x1024:duration=0.04",
        "-frames:v", "1",
        outPath,
      ])
      return
    case "transcript":
      await writeFile(outPath, JSON.stringify({ text: "Mock transcript", chunks: [] }))
      return
    default:
      await writeFile(outPath, JSON.stringify({ mock: true, kind }))
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: "ignore" })
    proc.once("error", reject)
    proc.once("exit", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited with code ${code}`))
    })
  })
}
