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
import type { MediaCapability } from "../media-provider/types"
import { getMockCacheBase } from "../storage-paths"

const MOCK_PROTOCOL = "mock://"

export function isMockUrl(url: string): boolean {
  return typeof url === "string" && url.startsWith(MOCK_PROTOCOL)
}

/** Чем является файл заглушки. Провайдер, который его отдал, здесь не важен. */
const MOCK_MEDIA_KINDS = ["image", "video", "audio", "transcript", "unknown"] as const
export type MockMediaKind = (typeof MOCK_MEDIA_KINDS)[number]

interface FalEndpointKind {
  kind: MockMediaKind
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

function makeMockUrl(kind: MockMediaKind, requestId: string): string {
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
 * Расширение файла кеша заглушки.
 *
 * Контейнер ffmpeg выбирает ПО РАСШИРЕНИЮ выходного файла. Кеш лежал в
 * `<kind>.bin`, и на холодном старте ffmpeg отвечал «Unable to choose an output
 * format for image.bin» с кодом Invalid argument — падал первый же вызов, а с
 * ним весь API-контур генерации кадров. На машине с прогретым кешем этого не
 * видно: файл уже есть, ffmpeg не зовётся.
 */
const CACHE_EXTENSIONS: Record<MockMediaKind, string> = {
  video: ".mp4",
  audio: ".mp3",
  image: ".png",
  transcript: ".json",
  unknown: ".json",
}

/**
 * Вид результата по СПОСОБНОСТИ медиаконтура.
 *
 * Раньше вид выводился из первого сегмента mock-URL, и это работало только для
 * fal (`mock://video/{id}`). Replicate строит ссылку иначе —
 * `mock://replicate/{способность}/{id}.{ext}` — и попадал в ветку «неизвестно»:
 * вместо клипа заглушка писала JSON под именем `.mp4`, который ffmpeg не
 * склеит. Значит, весь маршрут через Replicate (lip-sync прежде всего) в
 * тестах не исполнялся вовсе.
 *
 * Ключ — способность, а не подстрока имени модели и не имя провайдера: у
 * следующего провайдера будет своя ссылка `mock://<он>/<та же способность>/…`,
 * и добавлять сюда ничего не придётся. `Record<MediaCapability, …>` держит
 * таблицу полной: новая способность не скомпилируется, пока её вид не назван.
 */
const KIND_BY_CAPABILITY: Record<MediaCapability, MockMediaKind> = {
  lip_sync: "video",
  text_to_video: "video",
  image_to_video: "video",
  speech_to_video: "video",
  text_to_image: "image",
  image_to_image: "image",
  text_to_speech: "audio",
  transcription: "transcript",
}

/** Длина видео-заглушки, когда заказчик её не назвал. */
const DEFAULT_VIDEO_PLACEHOLDER_SEC = 3

export interface MockPlaceholderRequest {
  kind: MockMediaKind
  /**
   * Заказанная длительность медиа в секундах. `null` — заказчик её не знает, и
   * заглушка берёт свою длину по умолчанию.
   */
  durationSec: number | null
  /**
   * Способность из ссылки формы провайдера (`mock://<провайдер>/<способность>/…`).
   * `undefined` — ссылка формы fal (`mock://<вид>/<id>`), где способность в
   * URL не едет вовсе.
   *
   * Нужна затем, что `text_to_image` и `image_to_image` вместе дают один вид
   * "image": без разбора по способности их заглушки — БАЙТ В БАЙТ один и тот
   * же чёрный кадр, и sha1-дедup кадров персонажа (`characterId_sha1`) молча
   * склеивает вариацию с исходным портретом — см. `buildPlaceholder`.
   */
  capability?: string
}

function isMockMediaKind(value: string): value is MockMediaKind {
  return (MOCK_MEDIA_KINDS as readonly string[]).includes(value)
}

/**
 * Разбор mock-URL: какой файл просят и какой длины.
 *
 * Грамматика ровно из двух форм, обе уже существуют в коде:
 *   `mock://<вид>/<id>`                       — вид назван прямо (мок fal);
 *   `mock://<провайдер>/<способность>/<файл>` — вид выводит способность.
 * Длительность едет query-параметром `?duration=<секунды>` и необязательна.
 *
 * Чистая функция: разбор ссылки видно тестом без запуска ffmpeg.
 */
export function parseMockPlaceholderUrl(url: string): MockPlaceholderRequest {
  const rest = url.startsWith(MOCK_PROTOCOL) ? url.slice(MOCK_PROTOCOL.length) : url
  const queryAt = rest.indexOf("?")
  const path = queryAt >= 0 ? rest.slice(0, queryAt) : rest
  const query = queryAt >= 0 ? rest.slice(queryAt + 1) : ""
  const segments = path.split("/").filter(segment => segment.length > 0)

  const { kind, capability } = resolveMockMediaKind(segments)
  return { kind, durationSec: readDurationParam(query), capability }
}

function resolveMockMediaKind(
  segments: readonly string[],
): { kind: MockMediaKind, capability?: string } {
  const first = segments[0]
  if (first && isMockMediaKind(first)) return { kind: first }
  // Форма провайдера. Ровно три сегмента: под схемой `mock://` ходят и ссылки,
  // которые медиа не отдают вовсе, — подписанная ссылка мок-хранилища
  // (`mock://gcs/<ключ объекта>`) и вход Replicate (`mock://replicate-input/<хэш>`).
  // Первая длиннее трёх сегментов, вторая короче, и заглушку по ним не строят.
  const capability = segments.length === 3 ? segments[1] : undefined
  if (capability && Object.prototype.hasOwnProperty.call(KIND_BY_CAPABILITY, capability)) {
    return { kind: KIND_BY_CAPABILITY[capability as MediaCapability], capability }
  }
  return { kind: "unknown" }
}

function readDurationParam(query: string): number | null {
  if (!query) return null
  const raw = new URLSearchParams(query).get("duration")
  if (raw === null) return null
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * Генерирует placeholder для mock URL. Поддерживает:
 *   видео → чёрное видео H.264 1080x1920 заказанной длины (по умолчанию 3 с)
 *   аудио → 1-секундный silent MP3
 *   картинка → 1024x1024 чёрный PNG
 *   транскрипт → JSON-файл с текстом
 *
 * Использует кеш: повторные вызовы за тем же файлом → копия из кеша без ffmpeg.
 * Длительность входит в имя кеша: заглушка на 2 с и заглушка на 5 с — разные
 * файлы, и общее имя отдало бы вызывающему чужую длину.
 */
export async function generateMockPlaceholder(url: string, destPath: string): Promise<void> {
  if (!isMockUrl(url)) {
    throw new Error(`generateMockPlaceholder: ожидался mock:// URL, получен ${url}`)
  }
  const { kind, durationSec, capability } = parseMockPlaceholderUrl(url)
  // Умолчание применяется РОВНО ЗДЕСЬ: от этого числа зависят и имя файла в
  // кеше, и его содержимое, а второй источник умолчания развёл бы их между собой.
  const videoDurationSec = durationSec ?? DEFAULT_VIDEO_PLACEHOLDER_SEC

  const cacheDir = getMockCacheBase()
  await mkdir(cacheDir, { recursive: true })
  // Длина есть только у видео: остальным видам её никто не заказывает, и
  // подмешивать её в имя кеша значило бы плодить копии одного и того же файла.
  // Способность подмешивается только картинке: `text_to_image` и
  // `image_to_image` делят один вид "image", и без этого их заглушки были бы
  // одним и тем же файлом — см. docstring `MockPlaceholderRequest.capability`.
  const cacheFile = join(
    cacheDir,
    buildCacheFileName(kind, kind === "video" ? videoDurationSec : null, kind === "image" ? capability : undefined),
  )

  if (!existsSync(cacheFile)) {
    await buildPlaceholder(kind, cacheFile, videoDurationSec, capability)
  }

  await copyFile(cacheFile, destPath)
  console.log(`[fal-mock] downloadFile mock: ${url} → ${destPath}`)
}

function buildCacheFileName(
  kind: MockMediaKind,
  durationSec: number | null,
  capability: string | undefined,
): string {
  const extension = CACHE_EXTENSIONS[kind]
  const suffix = capability ? `-${capability}` : ""
  if (durationSec === null) return `${kind}${suffix}${extension}`
  return `${kind}${suffix}-${durationSec.toFixed(3)}${extension}`
}

/**
 * Цвет картинки-заглушки по способности.
 *
 * Способности не назвали (ссылка формы fal, `mock://image/<id>`) — прежний
 * чёрный по умолчанию: на нём стоит тест "второй вызов берёт кеш и отдаёт тот
 * же файл", который сравнивает БАЙТЫ двух заглушек этой формы.
 *
 * Способность известна (ссылка формы провайдера) — детерминированный цвет по
 * её имени: одна и та же способность всегда даёт один и тот же цвет (кеш
 * работает), а разные способности — разные цвета почти наверняка (djb2 по
 * короткой строке из восьми вариантов `MediaCapability`), и sha1 их заглушек
 * не совпадёт. Ключ — по-прежнему способность, а не имя провайдера или
 * подстрока модели, тем же принципом, что и `KIND_BY_CAPABILITY`.
 */
function colorForCapability(capability: string | undefined): string {
  if (!capability) return "black"
  let hash = 5381
  for (let i = 0; i < capability.length; i += 1) {
    hash = ((hash << 5) + hash + capability.charCodeAt(i)) | 0
  }
  return `0x${(hash >>> 0).toString(16).padStart(6, "0").slice(-6)}`
}

async function buildPlaceholder(
  kind: MockMediaKind,
  outPath: string,
  videoDurationSec: number,
  capability: string | undefined,
): Promise<void> {
  switch (kind) {
    case "video":
      await runFfmpeg([
        "-y",
        "-f", "lavfi", "-i",
        `color=black:size=1080x1920:duration=${videoDurationSec.toFixed(3)}:rate=30`,
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
        "-f", "lavfi", "-i", `color=${colorForCapability(capability)}:size=1024x1024:duration=0.04`,
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
