/**
 * Factory + публичный API модуля storage.
 *
 * Выбор driver'а:
 *   STORAGE_DRIVER = 'gcs' | 'local' | 'mock'    (default 'local' в dev, 'gcs' в prod)
 *
 * GCS-конфиг:
 *   GCS_PROJECT_ID, GCS_BUCKET_NAME — required
 *   GCS_CREDENTIALS_JSON — primary (минифицированный JSON одной строкой, Saturn UI)
 *   GOOGLE_APPLICATION_CREDENTIALS — fallback (путь к JSON-файлу, dev convenience)
 *
 * Локальный driver:
 *   STORAGE_LOCAL_ROOT — primary. Alias к существующему UPLOADS_STORAGE_PATH
 *   (legacy env из storage-paths.ts). Без них — './storage'.
 *
 * Credentials НИКОГДА не логируются. В debug ошибках — только success/failure
 * и название источника (env или file), без содержимого.
 */
import { readFileSync } from "node:fs"

import { GCSDriver } from "./gcs-driver"
import { LocalDriver } from "./local-driver"
import { MockDriver } from "./mock-driver"
import type { StorageDriver, StorageProvider } from "./types"

export * from "./types"
export * from "./prefix-guard"
export * from "./keys"
export { GCSDriver } from "./gcs-driver"
export { LocalDriver } from "./local-driver"
export { MockDriver } from "./mock-driver"

let cachedDriver: StorageDriver | null = null

function loadGcsCredentials(): { credentials: object; source: string } {
  // 1) GCS_CREDENTIALS_JSON_BASE64 — primary для PaaS UI вроде Saturn,
  //    которые мангалят escape sequences в plain JSON (\n внутри private_key
  //    превращается в literal n и JSON.parse падает). base64 транспортирует
  //    байты as-is, индустриальный стандарт.
  const b64 = process.env.GCS_CREDENTIALS_JSON_BASE64
  if (b64 && b64.trim().length > 0) {
    try {
      const decoded = Buffer.from(b64.trim(), "base64").toString("utf-8")
      return {
        credentials: JSON.parse(decoded),
        source: "GCS_CREDENTIALS_JSON_BASE64 env",
      }
    } catch (err) {
      throw new Error(
        `Failed to parse GCS_CREDENTIALS_JSON_BASE64: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      )
    }
  }

  // 2) GCS_CREDENTIALS_JSON — plain JSON env, работает если UI не ломает
  //    escape sequences. Saturn ломает, поэтому base64 выше.
  const json = process.env.GCS_CREDENTIALS_JSON
  if (json && json.trim().length > 0) {
    try {
      return { credentials: JSON.parse(json), source: "GCS_CREDENTIALS_JSON env" }
    } catch (err) {
      // Сообщение не содержит сам JSON — только класс ошибки JSON parser'а.
      throw new Error(
        `Failed to parse GCS_CREDENTIALS_JSON: ${err instanceof Error ? err.message : "unknown error"}`,
      )
    }
  }

  // 3) GOOGLE_APPLICATION_CREDENTIALS — путь к JSON-файлу, dev convenience.
  const filePath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (filePath && filePath.trim().length > 0) {
    try {
      const content = readFileSync(filePath, "utf-8")
      return {
        credentials: JSON.parse(content),
        source: `GOOGLE_APPLICATION_CREDENTIALS file (${filePath})`,
      }
    } catch (err) {
      throw new Error(
        `Failed to read GCS credentials from ${filePath}: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      )
    }
  }

  throw new Error(
    "GCS driver requires credentials: set GCS_CREDENTIALS_JSON_BASE64 (primary, base64-encoded JSON " +
      "for PaaS UI), GCS_CREDENTIALS_JSON (plain JSON if UI keeps escape sequences) or " +
      "GOOGLE_APPLICATION_CREDENTIALS (path to JSON file, dev fallback)",
  )
}

function resolveLocalRoot(): string {
  return (
    process.env.STORAGE_LOCAL_ROOT?.trim() ||
    process.env.UPLOADS_STORAGE_PATH?.trim() ||
    "./storage"
  )
}

function resolveDriverName(): StorageProvider {
  const explicit = process.env.STORAGE_DRIVER?.trim().toLowerCase()
  if (explicit === "gcs" || explicit === "local" || explicit === "mock") return explicit
  return process.env.NODE_ENV === "production" ? "gcs" : "local"
}

export function getStorageDriver(): StorageDriver {
  if (cachedDriver) return cachedDriver

  const driverName = resolveDriverName()

  if (driverName === "gcs") {
    const projectId = process.env.GCS_PROJECT_ID
    const bucketName = process.env.GCS_BUCKET_NAME
    if (!projectId || !bucketName) {
      throw new Error(
        "GCS driver requires GCS_PROJECT_ID and GCS_BUCKET_NAME env vars",
      )
    }
    const { credentials } = loadGcsCredentials()
    cachedDriver = new GCSDriver({ projectId, bucketName, credentials })
    return cachedDriver
  }

  if (driverName === "mock") {
    cachedDriver = new MockDriver()
    return cachedDriver
  }

  cachedDriver = new LocalDriver({ rootDir: resolveLocalRoot() })
  return cachedDriver
}

/** Сбрасывает singleton. Тесты и migration script — используют для switch. */
export function resetStorageDriver(): void {
  cachedDriver = null
}

/** Описание текущего driver'а без секретов — для логов и /admin/storage-health. */
export function describeStorageDriver(): {
  provider: StorageProvider
  bucketName?: string
  localRoot?: string
  credentialsSource?: string
} {
  const driver = getStorageDriver()
  if (driver.providerName === "gcs") {
    let credentialsSource: string | undefined
    try {
      credentialsSource = loadGcsCredentials().source
    } catch {
      credentialsSource = "unavailable"
    }
    return {
      provider: "gcs",
      bucketName: process.env.GCS_BUCKET_NAME,
      credentialsSource,
    }
  }
  if (driver.providerName === "local") {
    return { provider: "local", localRoot: resolveLocalRoot() }
  }
  return { provider: driver.providerName }
}
