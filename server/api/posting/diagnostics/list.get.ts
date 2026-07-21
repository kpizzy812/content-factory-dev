/**
 * GET /api/posting/diagnostics/list?jobId=<id>
 *
 * Возвращает timeline всех diagnostic snapshot'ов (PNG + HTML + JSON) для
 * конкретного posting job'а. UI показывает оператору checkpoints — какие
 * состояния браузера были захвачены во время посt'а.
 *
 * Key pattern: zavodcamp/posting-errors/<jobId>-<phase>-<label>-<ts>.<ext>
 *
 * Permissions: requireScopedAccess({ permissions: ["canRead"], moduleSlug: "social-upload" })
 */

import { getStorageDriver } from "~~/server/utils/storage"

const SCREENSHOT_PREFIX = "zavodcamp/posting-errors/"
const MAX_RESULTS = 200

interface DiagnosticItem {
  key: string
  sizeBytes: number
  contentType: string | null
  createdAt: string | null
  /** Распарсенные части ключа. */
  parsed: {
    jobId: string | null
    phase: string | null
    label: string | null
    timestamp: string | null
    ext: string
  }
}

function sanitizeJobId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)
}

/**
 * Парсит key вида `zavodcamp/posting-errors/<jobId>-<phase>-<label>-<ts>.<ext>`.
 * label/timestamp могут содержать дефисы — берём timestamp как последний
 * сегмент перед расширением, остальное между jobId и timestamp = phase + label.
 */
function parseKey(key: string): DiagnosticItem["parsed"] {
  const ext = key.slice(key.lastIndexOf("."))
  const nameWithoutExt = key.slice(SCREENSHOT_PREFIX.length, key.lastIndexOf("."))

  // Timestamp всегда содержит "T" (ISO format). Ищем его справа.
  const tsMatch = nameWithoutExt.match(/-(\d{4}-\d{2}-\d{2}T[\d-]+Z)$/)
  if (!tsMatch) {
    return { jobId: null, phase: null, label: null, timestamp: null, ext }
  }
  const timestamp = tsMatch[1] ?? null
  const prefix = nameWithoutExt.slice(0, -tsMatch[0].length)

  // Структура prefix: <jobId>-<phase>-<label>. jobId — cuid (24 chars обычно),
  // но безопасно — последний дефис = разделитель label/timestamp уже отрезали.
  // Phase — фиксированный список (navigate_upload, file_upload, etc.) или
  // legacy без label (тогда label="error"). Парсим по первому дефису
  // (jobId не содержит дефисов после sanitize).
  const firstDash = prefix.indexOf("-")
  if (firstDash === -1) {
    return { jobId: prefix, phase: null, label: null, timestamp, ext }
  }
  const jobId = prefix.slice(0, firstDash)
  const rest = prefix.slice(firstDash + 1)
  // rest = phase-label или просто phase (legacy без label). Phase из known list.
  const KNOWN_PHASES = [
    "browser_leak_check", "ip_check", "login_check", "navigate_upload",
    "file_upload", "details", "altered_content", "made_for_kids", "visibility",
    "publish", "extract_url",
  ] as const
  for (const phase of KNOWN_PHASES) {
    if (rest === phase) {
      return { jobId, phase, label: null, timestamp, ext }
    }
    if (rest.startsWith(`${phase}-`)) {
      return { jobId, phase, label: rest.slice(phase.length + 1), timestamp, ext }
    }
  }
  return { jobId, phase: null, label: rest, timestamp, ext }
}

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "social-upload",
  })

  const query = getQuery(event)
  const rawJobId = String(query.jobId ?? "").trim()
  if (!rawJobId) {
    throw createError({ statusCode: 400, message: "jobId обязателен" })
  }
  const safeJobId = sanitizeJobId(rawJobId)

  const driver = getStorageDriver()
  const objects = await driver.list(`${SCREENSHOT_PREFIX}${safeJobId}-`, {
    maxResults: MAX_RESULTS,
  })

  const items: DiagnosticItem[] = objects.map((obj) => ({
    key: obj.key,
    sizeBytes: Number(obj.sizeBytes),
    contentType: obj.contentType ?? null,
    createdAt: obj.createdAt?.toISOString() ?? null,
    parsed: parseKey(obj.key),
  }))

  // Sort by timestamp DESC (latest first).
  items.sort((a, b) => {
    const ta = a.parsed.timestamp ?? ""
    const tb = b.parsed.timestamp ?? ""
    return tb.localeCompare(ta)
  })

  return {
    data: {
      jobId: safeJobId,
      count: items.length,
      items,
    },
  }
})
