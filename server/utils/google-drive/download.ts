/**
 * Streaming download of a Google Drive file by fileId to a local path.
 *
 * Особенности:
 * - Контроль cap (default 500MB из runtimeConfig.googleDriveMaxDownloadBytes).
 *   Если Content-Length известен и > cap → 413 до начала чтения тела.
 *   Если bytesWritten превышает cap в процессе streaming — abort + unlink.
 * - AbortController для корректной отмены TCP-соединения при превышении cap.
 * - Mock-режим: baseUrl уже заменён в DriveClient.
 */
import { createWriteStream } from "node:fs"
import { mkdir, unlink } from "node:fs/promises"
import { dirname } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { DriveClient } from "./client"
import { classifyDriveError } from "./client"

export interface DownloadDriveFileOptions {
  driveFileId: string
  localPath: string
  maxBytes?: number
  accessToken: string
}

export interface DownloadDriveFileResult {
  localPath: string
  sizeBytes: bigint
  contentType: string | null
}

function resolveMaxBytes(explicit?: number): number {
  if (typeof explicit === "number" && explicit > 0) return explicit
  return Number(process.env.GOOGLE_DRIVE_MAX_DOWNLOAD_BYTES) || 524_288_000
}

export async function downloadDriveFile(
  client: DriveClient,
  options: DownloadDriveFileOptions,
): Promise<DownloadDriveFileResult> {
  const maxBytes = resolveMaxBytes(options.maxBytes)
  const url =
    `${client.baseUrl}/drive/v3/files/${encodeURIComponent(options.driveFileId)}?alt=media`

  await mkdir(dirname(options.localPath), { recursive: true })

  const controller = new AbortController()

  let response: Response
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${options.accessToken}` },
      signal: controller.signal,
    })
  } catch (err) {
    const classified = classifyDriveError(err)
    throw createError({
      statusCode: classified.statusCode,
      message: `Drive download: ${classified.message}`,
      data: { category: classified.category },
    })
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "")
    const classified = classifyDriveError({
      statusCode: response.status,
      message: bodyText.slice(0, 200) || `HTTP ${response.status}`,
    })
    throw createError({
      statusCode: classified.statusCode,
      message: `Drive download: ${classified.message}`,
      data: { category: classified.category },
    })
  }

  const contentLengthHeader = response.headers.get("content-length")
  const declaredLength = contentLengthHeader ? Number(contentLengthHeader) : null
  if (
    declaredLength !== null &&
    Number.isFinite(declaredLength) &&
    declaredLength > maxBytes
  ) {
    controller.abort()
    throw createError({
      statusCode: 413,
      message: `Файл превышает лимит ${maxBytes} байт (заявлено ${declaredLength})`,
    })
  }

  if (!response.body) {
    throw createError({
      statusCode: 502,
      message: "Drive download: пустое тело ответа",
    })
  }

  const contentType = response.headers.get("content-type")
  let bytesWritten = 0
  let aborted = false

  const ws = createWriteStream(options.localPath)
  const nodeStream = Readable.fromWeb(
    response.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>,
  )

  nodeStream.on("data", (chunk: Buffer | Uint8Array) => {
    bytesWritten += chunk.byteLength
    if (bytesWritten > maxBytes && !aborted) {
      aborted = true
      controller.abort()
      nodeStream.destroy(new Error(`Drive file exceeded maxBytes=${maxBytes}`))
    }
  })

  try {
    await pipeline(nodeStream, ws)
  } catch (err) {
    await unlink(options.localPath).catch(() => {})
    if (aborted) {
      throw createError({
        statusCode: 413,
        message: `Файл превышает лимит ${maxBytes} байт во время скачивания`,
      })
    }
    const classified = classifyDriveError(err)
    throw createError({
      statusCode: classified.statusCode,
      message: `Drive download: ${classified.message}`,
      data: { category: classified.category },
    })
  }

  return {
    localPath: options.localPath,
    sizeBytes: BigInt(bytesWritten),
    contentType,
  }
}
