/**
 * Google Drive REST v3 client factory.
 *
 * Поддерживает только Service Account flow (RS256 JWT-assertion → access_token).
 * Используется raw HTTP без зависимости от googleapis SDK. Bun runtime поддерживает
 * node:crypto.createSign('RSA-SHA256') 1:1 как Node.js.
 *
 * Mock-режим: при isGoogleDriveMockMode() заменяет Google OAuth2 token endpoint
 * и Drive API baseUrl на standalone mock server (server/__mocks__/google-drive-server.ts).
 */
import { createSign } from "node:crypto"
import { getGoogleDriveMockUrl, isGoogleDriveMockMode } from "../mock/mode"

const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token"
const DEFAULT_API_BASE = "https://www.googleapis.com"
const DEFAULT_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

export interface ServiceAccountJson {
  type: "service_account"
  project_id: string
  private_key_id: string
  private_key: string
  client_email: string
  client_id: string
  auth_uri?: string
  token_uri?: string
  auth_provider_x509_cert_url?: string
  client_x509_cert_url?: string
  universe_domain?: string
}

export interface DriveAccessToken {
  accessToken: string
  expiresAt: number
}

export interface DriveRequestInit {
  method?: string
  query?: Record<string, string | number | boolean | undefined | null>
  body?: unknown
  headers?: Record<string, string>
}

export interface DriveClient {
  baseUrl: string
  request: <T>(path: string, init?: DriveRequestInit) => Promise<T>
}

export type DriveErrorCategory =
  | "auth"
  | "quota"
  | "not_found"
  | "permission"
  | "network"
  | "other"

export interface ClassifiedDriveError {
  category: DriveErrorCategory
  statusCode: number
  message: string
}

function base64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

function buildJwtAssertion(sa: ServiceAccountJson, scopes: string[], tokenUri: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: sa.private_key_id }))
  const claims = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: scopes.join(" "),
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    }),
  )
  const signatureInput = `${header}.${claims}`
  const signer = createSign("RSA-SHA256")
  signer.update(signatureInput)
  const signature = base64url(signer.sign(sa.private_key))
  return `${signatureInput}.${signature}`
}

export async function exchangeServiceAccountForToken(
  sa: ServiceAccountJson,
  scopes: string[] = DEFAULT_SCOPES,
): Promise<DriveAccessToken> {
  if (!sa.client_email || !sa.private_key) {
    throw createError({
      statusCode: 400,
      message: "Невалидный service account JSON: отсутствуют client_email или private_key",
    })
  }

  const tokenUri = isGoogleDriveMockMode()
    ? `${getGoogleDriveMockUrl()}/token`
    : sa.token_uri || DEFAULT_TOKEN_URI

  const assertion = buildJwtAssertion(sa, scopes, tokenUri)

  try {
    const response = await $fetch<{
      access_token: string
      expires_in: number
      token_type?: string
    }>(tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
    })

    if (!response?.access_token) {
      throw createError({
        statusCode: 502,
        message: "Drive OAuth2: token endpoint вернул пустой access_token",
      })
    }

    const expiresIn = typeof response.expires_in === "number" ? response.expires_in : 3600
    return {
      accessToken: response.access_token,
      expiresAt: Date.now() + expiresIn * 1000,
    }
  } catch (err) {
    const classified = classifyDriveError(err)
    throw createError({
      statusCode: classified.statusCode,
      message: `Drive OAuth2: ${classified.message}`,
      data: { category: classified.category },
    })
  }
}

export function createDriveClient(accessToken: string): DriveClient {
  const baseUrl = isGoogleDriveMockMode() ? getGoogleDriveMockUrl() : DEFAULT_API_BASE

  return {
    baseUrl,
    async request<T>(path: string, init: DriveRequestInit = {}): Promise<T> {
      const url = path.startsWith("http") ? path : `${baseUrl}${path}`
      const cleanQuery: Record<string, string> = {}
      if (init.query) {
        for (const [key, value] of Object.entries(init.query)) {
          if (value === undefined || value === null) continue
          cleanQuery[key] = String(value)
        }
      }
      try {
        return await $fetch<T>(url, {
          method: (init.method ?? "GET") as
            | "GET"
            | "POST"
            | "PUT"
            | "PATCH"
            | "DELETE",
          query: Object.keys(cleanQuery).length > 0 ? cleanQuery : undefined,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(init.body ? { "Content-Type": "application/json" } : {}),
            ...init.headers,
          },
          body: init.body as Record<string, unknown> | undefined,
        })
      } catch (err) {
        const classified = classifyDriveError(err)
        throw createError({
          statusCode: classified.statusCode,
          message: `Drive API: ${classified.message}`,
          data: { category: classified.category },
        })
      }
    },
  }
}

/**
 * Multipart upload (RFC 2387 multipart/related) для Drive v3 files endpoint.
 *
 * Используется sink-нодой `google_drive_uploader`. Не использует $fetch потому
 * что ofetch принудительно ставит Content-Type: application/json и не даёт
 * передать boundary. Native fetch поддерживает binary body как Buffer.
 *
 * `accessToken` принимается параметром, а не из closure DriveClient — scopes
 * для upload (drive.file) другие, чем у scanner'а (drive.readonly), поэтому
 * вызывающий обменивает SA на отдельный токен через exchangeServiceAccountForToken.
 */
export async function multipartUploadRequest<T>(
  accessToken: string,
  path: string,
  metadata: Record<string, unknown>,
  fileBuffer: Buffer,
  fileMimeType: string,
): Promise<T> {
  const baseUrl = isGoogleDriveMockMode() ? getGoogleDriveMockUrl() : DEFAULT_API_BASE
  const url = path.startsWith("http") ? path : `${baseUrl}${path}`

  const boundary = `----dauploader${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`
  const metadataJson = JSON.stringify(metadata)

  const head = Buffer.from(
    `--${boundary}\r\n` +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      `${metadataJson}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${fileMimeType}\r\n\r\n`,
    "utf8",
  )
  const tail = Buffer.from(`\r\n--${boundary}--`, "utf8")
  const body = Buffer.concat([head, fileBuffer, tail])

  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": String(body.byteLength),
      },
      body: body as unknown as BodyInit,
    })
  } catch (err) {
    const classified = classifyDriveError(err)
    throw createError({
      statusCode: classified.statusCode,
      message: `Drive Upload: ${classified.message}`,
      data: { category: classified.category },
    })
  }

  if (!response.ok) {
    let errBody: unknown
    try {
      errBody = await response.json()
    } catch {
      try {
        errBody = await response.text()
      } catch {
        errBody = null
      }
    }
    const classified = classifyDriveError({
      statusCode: response.status,
      data: errBody,
      message: typeof errBody === "object" && errBody && "error" in errBody
        ? ((errBody as { error?: { message?: string } }).error?.message ?? response.statusText)
        : response.statusText,
    })
    throw createError({
      statusCode: classified.statusCode,
      message: `Drive Upload: ${classified.message}`,
      data: { category: classified.category },
    })
  }

  return (await response.json()) as T
}

function extractStatusFromUnknown(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null
  const candidate = err as {
    statusCode?: unknown
    status?: unknown
    response?: { status?: unknown }
  }
  const direct = candidate.statusCode ?? candidate.status
  if (typeof direct === "number") return direct
  const responseStatus = candidate.response?.status
  if (typeof responseStatus === "number") return responseStatus
  return null
}

function extractMessageFromUnknown(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  if (typeof err === "object" && err !== null) {
    const candidate = err as {
      message?: unknown
      statusMessage?: unknown
      data?: { error?: { message?: unknown } }
    }
    if (typeof candidate.statusMessage === "string") return candidate.statusMessage
    if (typeof candidate.message === "string") return candidate.message
    const nested = candidate.data?.error?.message
    if (typeof nested === "string") return nested
  }
  return "Неизвестная ошибка"
}

export function classifyDriveError(err: unknown): ClassifiedDriveError {
  const status = extractStatusFromUnknown(err)
  const message = extractMessageFromUnknown(err)
  const lowerMessage = message.toLowerCase()

  if (status === 401) {
    return { category: "auth", statusCode: 401, message }
  }
  if (status === 429 || lowerMessage.includes("quota") || lowerMessage.includes("rate limit")) {
    return { category: "quota", statusCode: 429, message }
  }
  if (status === 404) {
    return { category: "not_found", statusCode: 404, message }
  }
  if (status === 403) {
    if (lowerMessage.includes("quotaexceeded") || lowerMessage.includes("rate")) {
      return { category: "quota", statusCode: 429, message }
    }
    return { category: "permission", statusCode: 403, message }
  }
  if (
    lowerMessage.includes("timeout") ||
    lowerMessage.includes("aborted") ||
    lowerMessage.includes("network") ||
    lowerMessage.includes("econnrefused") ||
    lowerMessage.includes("enotfound")
  ) {
    return { category: "network", statusCode: 502, message }
  }
  return { category: "other", statusCode: status ?? 502, message }
}
