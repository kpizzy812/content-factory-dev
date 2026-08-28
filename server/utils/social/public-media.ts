import { createHmac, timingSafeEqual } from "node:crypto"
import { extname } from "node:path"

import { getStorageDriver } from "../storage"
import { assertSafeKey } from "../storage/prefix-guard"
import type { StorageDriver } from "../storage/types"

/**
 * Расширение файла -> тип содержимого для ПУБЛИЧНОЙ отдачи медиа.
 *
 * Живёт здесь, а не в маршруте `/api/public/media/:token`, потому что тип нужен
 * в двух местах сразу и они обязаны совпадать: маршрут ставит заголовок
 * `Content-Type` при отдаче через своё приложение, а `resolvePublicMediaUrl`
 * передаёт тот же тип в подписанную ссылку gcs (`responseContentType`).
 * Пока карта жила только в маршруте и знала одни видео, картинка библиотеки
 * фонов уезжала `application/octet-stream` и в `<img>` не показывалась.
 *
 * Список форматов — надмножество `ALLOWED_BACKGROUND_MIME`
 * (`server/utils/edit-plan/background-store.ts`); совпадение прибито тестом.
 */
export const PUBLIC_MEDIA_MIME_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".m4v": "video/x-m4v",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
}

/**
 * Тип содержимого по расширению пути или ключа хранилища.
 *
 * `null`, а не `application/octet-stream`: у вызывающего должна остаться
 * возможность отличить «формат известен» от «мы не знаем» — маршрут отдачи в
 * этом случае честно ставит octet-stream, а подписанная ссылка не навязывает
 * провайдеру выдуманный тип.
 */
export function publicMediaContentType(pathOrKey: string): string | null {
  return PUBLIC_MEDIA_MIME_TYPES[extname(pathOrKey).toLowerCase()] ?? null
}

export interface PublicMediaTokenPayload {
  source: "storage" | "legacy"
  path: string
  expiresAt: number
}

export interface PublicMediaInput {
  storageKey?: string | null
  filePath?: string | null
  fileUrl?: string | null
}

function requireSecret(secret: string): string {
  if (secret.length < 32) {
    throw new Error("Public media signing secret must contain at least 32 characters")
  }
  return secret
}

function sign(value: string, secret: string): Buffer {
  return createHmac("sha256", requireSecret(secret)).update(value).digest()
}

export function createPublicMediaToken(
  input: PublicMediaTokenPayload,
  secret: string,
): string {
  if (!input.path || !Number.isFinite(input.expiresAt)) {
    throw new Error("Invalid public media token payload")
  }
  if (input.source === "storage") assertSafeKey(input.path, "public media token")
  const encoded = Buffer.from(JSON.stringify(input), "utf8").toString("base64url")
  return `${encoded}.${sign(encoded, secret).toString("base64url")}`
}

export function verifyPublicMediaToken(
  token: string,
  secret: string,
  now = Date.now(),
): PublicMediaTokenPayload {
  const [encoded, providedRaw, extra] = token.split(".")
  if (!encoded || !providedRaw || extra) throw new Error("Invalid public media token")

  const provided = Buffer.from(providedRaw, "base64url")
  const expected = sign(encoded, secret)
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new Error("Invalid public media token signature")
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))
  } catch {
    throw new Error("Invalid public media token payload")
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid public media token payload")
  }
  const payload = parsed as Record<string, unknown>
  if (
    !["storage", "legacy"].includes(String(payload.source))
    || typeof payload.path !== "string"
    || payload.path.length === 0
    || !Number.isFinite(payload.expiresAt)
  ) {
    throw new Error("Invalid public media token payload")
  }
  if (Number(payload.expiresAt) < now) throw new Error("Public media link expired")
  if (payload.source === "storage") assertSafeKey(payload.path, "public media read")
  return payload as unknown as PublicMediaTokenPayload
}

function signingSecret(): string {
  const secret = process.env.PUBLIC_MEDIA_SIGNING_SECRET || process.env.NUXT_SESSION_PASSWORD || ""
  return requireSecret(secret)
}

function publicBaseUrl(): string {
  const raw = process.env.CONTENT_FACTORY_PUBLIC_URL
    || process.env.REPLICATE_WEBHOOK_BASE_URL
    || ""
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error("CONTENT_FACTORY_PUBLIC_URL must be a valid absolute URL")
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("CONTENT_FACTORY_PUBLIC_URL must use http or https")
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("CONTENT_FACTORY_PUBLIC_URL must use https in production")
  }
  url.pathname = "/"
  url.search = ""
  url.hash = ""
  return url.toString().replace(/\/$/, "")
}

function decodeApiFilePath(value: string): string | null {
  let candidate = value
  try {
    const url = new URL(value, "https://contentfactory.invalid")
    candidate = url.pathname
  } catch {
    // Relative path is handled below.
  }
  const marker = "/api/files/"
  const index = candidate.indexOf(marker)
  if (index < 0) return null
  let encoded = candidate.slice(index + marker.length)
  try {
    encoded = decodeURIComponent(encoded)
    if (/%2f/i.test(encoded)) encoded = decodeURIComponent(encoded)
  } catch {
    return null
  }
  return encoded.replace(/^\/+/, "") || null
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

export async function resolvePublicMediaUrl(
  input: PublicMediaInput,
  options: {
    driver?: StorageDriver
    baseUrl?: string
    secret?: string
    now?: number
    ttlSeconds?: number
    /**
     * Тип содержимого для подписанной ссылки провайдера. По умолчанию
     * `video/mp4` — ровно то, что механизм отдавал всегда (единственный
     * прежний потребитель — публикация ролика в Instagram). Библиотека фонов
     * держит ещё и картинки, и им нужен свой тип, иначе png уезжает объявленным
     * как видео и в `<img>` не показывается.
     */
    responseContentType?: string
  } = {},
): Promise<string> {
  const driver = options.driver ?? getStorageDriver()
  const ttlSeconds = Math.max(300, Math.min(options.ttlSeconds ?? 21_600, 86_400))
  const now = options.now ?? Date.now()
  const candidate = input.fileUrl || input.filePath || ""
  const storageKey = input.storageKey || decodeApiFilePath(candidate)

  if (storageKey) {
    assertSafeKey(storageKey, "resolve public media URL")
    if (driver.providerName === "gcs") {
      return driver.getSignedDownloadUrl(storageKey, {
        expiresInSec: ttlSeconds,
        responseContentType: options.responseContentType ?? "video/mp4",
      })
    }
    const token = createPublicMediaToken({
      source: "storage",
      path: storageKey,
      expiresAt: now + ttlSeconds * 1000,
    }, options.secret ?? signingSecret())
    return `${options.baseUrl ?? publicBaseUrl()}/api/public/media/${token}`
  }

  if (candidate && isAbsoluteHttpUrl(candidate)) return candidate
  if (!candidate) throw new Error("Video has no storage key or file path")

  const token = createPublicMediaToken({
    source: "legacy",
    path: candidate,
    expiresAt: now + ttlSeconds * 1000,
  }, options.secret ?? signingSecret())
  return `${options.baseUrl ?? publicBaseUrl()}/api/public/media/${token}`
}
