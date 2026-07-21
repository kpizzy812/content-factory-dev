/**
 * GET /api/admin/telegram/variables
 *
 * Возвращает canonical variable registry для template editor и validation.
 * Опционально фильтрует по scopes (query: ?scopes=pipeline,video).
 */

import { registryForApi, type VariableScope } from "~~/server/utils/telegram/variable-registry"

const VALID_SCOPES: VariableScope[] = [
  "pipeline", "trendwatcher", "scenario", "video", "upload", "idea", "error", "system",
]

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canAdmin"],
    moduleSlug: "telegram",
  })

  const query = getQuery(event)
  let scopes: VariableScope[] | undefined

  if (query.scopes && typeof query.scopes === "string") {
    scopes = query.scopes
      .split(",")
      .map(s => s.trim())
      .filter((s): s is VariableScope => VALID_SCOPES.includes(s as VariableScope))
  }

  return {
    data: registryForApi(scopes),
  }
})
