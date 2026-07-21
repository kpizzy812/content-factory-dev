/**
 * GET /api/admin/logs
 * Унифицированная лента журналов из 8 источников: agent, app_enrichment,
 * secret_access, telegram_command, trendwatcher_run, webhook, ai_audit,
 * posting_job. См. server/utils/admin-log-aggregator.ts.
 *
 * Query params:
 *   sources    — CSV из AdminLogSource (по умолчанию все)
 *   level      — info | warn | error
 *   resolved   — true | false (только agent имеет это поле)
 *   q          — текстовый поиск по message
 *   page, limit — пагинация (limit ≤ 100)
 */

import {
  ADMIN_LOG_SOURCES_ALL,
  type AdminLogLevel,
  type AdminLogSource,
} from "../../../shared/types/admin-log"
import { aggregateAdminLogs } from "../../utils/admin-log-aggregator"

const VALID_LEVELS: AdminLogLevel[] = ["info", "warn", "error"]

export default defineEventHandler(async (event) => {
  await requirePermission(event, "canRead")

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 30))

  const sources = parseSources(query.sources)
  const level = parseLevel(query.level)
  const resolvedFilter = parseResolved(query.resolved)
  const q = typeof query.q === "string" ? query.q : undefined

  return aggregateAdminLogs({
    sources,
    level,
    resolvedFilter,
    q,
    page,
    limit,
  })
})

function parseSources(raw: unknown): AdminLogSource[] {
  if (!raw) return ADMIN_LOG_SOURCES_ALL
  const list = typeof raw === "string" ? raw.split(",") : Array.isArray(raw) ? raw : []
  const valid = list
    .map((s) => String(s).trim())
    .filter((s): s is AdminLogSource =>
      ADMIN_LOG_SOURCES_ALL.includes(s as AdminLogSource),
    )
  return valid.length > 0 ? valid : ADMIN_LOG_SOURCES_ALL
}

function parseLevel(raw: unknown): AdminLogLevel | undefined {
  if (typeof raw !== "string") return undefined
  return VALID_LEVELS.includes(raw as AdminLogLevel) ? (raw as AdminLogLevel) : undefined
}

function parseResolved(raw: unknown): "all" | "true" | "false" {
  if (raw === "true" || raw === true) return "true"
  if (raw === "false" || raw === false) return "false"
  return "all"
}
