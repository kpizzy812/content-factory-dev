import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { extname, isAbsolute, resolve, sep } from "node:path"

import { PUBLIC_MEDIA_MIME_TYPES, verifyPublicMediaToken } from "../../../utils/social/public-media"
import { getStorageDriver } from "../../../utils/storage"
import { StorageError } from "../../../utils/storage/types"
import { getUploadsBase } from "../../../utils/storage-paths"

function signingSecret(): string {
  const secret = process.env.PUBLIC_MEDIA_SIGNING_SECRET
    || process.env.NUXT_SESSION_PASSWORD
    || ""
  if (secret.length < 32) {
    throw createError({ statusCode: 500, message: "Public media signing secret is not configured" })
  }
  return secret
}

function parseRange(value: string | undefined, size: number): { start: number; end: number } | null {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match) throw createError({ statusCode: 416, message: "Invalid Range header" })
  const rawStart = match[1]!
  const rawEnd = match[2]!
  let start: number
  let end: number
  if (!rawStart) {
    const suffix = Number(rawEnd)
    if (!Number.isInteger(suffix) || suffix <= 0) {
      throw createError({ statusCode: 416, message: "Invalid Range header" })
    }
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd ? Number(rawEnd) : size - 1
  }
  if (
    !Number.isInteger(start)
    || !Number.isInteger(end)
    || start < 0
    || end < start
    || start >= size
  ) {
    throw createError({ statusCode: 416, message: "Requested range is not satisfiable" })
  }
  return { start, end: Math.min(end, size - 1) }
}

function applyHeaders(event: Parameters<typeof setResponseHeader>[0], input: {
  size: number
  contentType: string
  range: { start: number; end: number } | null
}): void {
  setResponseHeader(event, "Content-Type", input.contentType)
  setResponseHeader(event, "Accept-Ranges", "bytes")
  setResponseHeader(event, "Cache-Control", "private, no-store")
  if (input.range) {
    setResponseStatus(event, 206)
    setResponseHeader(
      event,
      "Content-Range",
      `bytes ${input.range.start}-${input.range.end}/${input.size}`,
    )
    setResponseHeader(event, "Content-Length", input.range.end - input.range.start + 1)
  } else {
    setResponseHeader(event, "Content-Length", input.size)
  }
}

export default defineEventHandler(async (event) => {
  const rawToken = getRouterParam(event, "token")
  if (!rawToken) throw createError({ statusCode: 404, message: "Media link not found" })

  let token
  try {
    token = verifyPublicMediaToken(rawToken, signingSecret())
  } catch (error) {
    throw createError({
      statusCode: 403,
      message: error instanceof Error ? error.message : "Invalid media link",
    })
  }

  if (token.source === "storage") {
    const driver = getStorageDriver()
    let buffer: Buffer
    try {
      buffer = await driver.downloadToBuffer(token.path)
    } catch (error) {
      if (error instanceof StorageError && error.code === "NOT_FOUND") {
        throw createError({ statusCode: 404, message: "Media not found" })
      }
      throw error
    }
    const range = parseRange(getHeader(event, "range"), buffer.length)
    applyHeaders(event, {
      size: buffer.length,
      contentType: PUBLIC_MEDIA_MIME_TYPES[extname(token.path).toLowerCase()] || "application/octet-stream",
      range,
    })
    if (event.method === "HEAD") return null
    return range ? buffer.subarray(range.start, range.end + 1) : buffer
  }

  const base = resolve(getUploadsBase())
  const filePath = isAbsolute(token.path) ? resolve(token.path) : resolve(base, token.path)
  if (!filePath.startsWith(base + sep) && filePath !== base) {
    throw createError({ statusCode: 403, message: "Media path is outside storage" })
  }
  let fileStat
  try {
    fileStat = await stat(filePath)
  } catch {
    throw createError({ statusCode: 404, message: "Media not found" })
  }
  if (!fileStat.isFile()) throw createError({ statusCode: 404, message: "Media not found" })
  const range = parseRange(getHeader(event, "range"), fileStat.size)
  applyHeaders(event, {
    size: fileStat.size,
    contentType: PUBLIC_MEDIA_MIME_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream",
    range,
  })
  if (event.method === "HEAD") return null
  return sendStream(event, createReadStream(filePath, range || undefined))
})
