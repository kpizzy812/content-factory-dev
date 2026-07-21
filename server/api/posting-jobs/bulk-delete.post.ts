/**
 * POST /api/posting-jobs/bulk-delete
 *
 * Массовый hard-delete. 2 режима (взаимоисключающие):
 *   - { ids: string[] } — по списку (лимит 200).
 *   - { filter: { status?, platform?, socialAccountId?, olderThan? } } — массовая
 *     чистка завалов (лимит 500 кандидатов).
 * Доп.: { confirm?, force? }.
 *
 * Per-job guard B: нарушители (published без confirm, свежие in-flight без force/admin)
 * идут в skipped[] — НЕ роняем весь bulk (паттерн как bulk.post.ts).
 *
 * Права: canDelete + social-upload. force гейтится canAdmin (per-job skip если нет).
 * Ответ: { data: { deleted, deletedIds, skipped } }. 200, или 207 если есть skipped.
 */
import {
  bulkDeletePostingJobs,
  BULK_DELETE_IDS_LIMIT,
} from "~~/server/utils/posting/job-service"
import type {
  BulkDeleteRequest,
  BulkDeleteResponse,
} from "~~/shared/types/posting-job"

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ["canDelete"],
    moduleSlug: "social-upload",
  })

  const body = await readBody<BulkDeleteRequest>(event)
  if (!body || typeof body !== "object") {
    throw createError({ statusCode: 400, message: "Тело запроса обязательно" })
  }

  const hasIds = Array.isArray(body.ids) && body.ids.length > 0
  const hasFilter = body.filter && typeof body.filter === "object"

  if (!hasIds && !hasFilter) {
    throw createError({
      statusCode: 400,
      message: "Укажите 'ids' (непустой массив) ИЛИ 'filter'",
    })
  }
  if (hasIds && hasFilter) {
    throw createError({
      statusCode: 400,
      message: "'ids' и 'filter' взаимоисключающие — передайте только одно",
    })
  }

  if (hasIds) {
    if (body.ids!.some((x) => typeof x !== "string" || !x.trim())) {
      throw createError({ statusCode: 400, message: "Все 'ids' должны быть непустыми строками" })
    }
    if (body.ids!.length > BULK_DELETE_IDS_LIMIT) {
      throw createError({
        statusCode: 400,
        message: `Лимит ids на запрос: ${BULK_DELETE_IDS_LIMIT}. Передано: ${body.ids!.length}.`,
      })
    }
  }

  const result: BulkDeleteResponse = await bulkDeletePostingJobs({
    ids: hasIds ? body.ids : undefined,
    filter: hasFilter ? body.filter : undefined,
    confirm: body.confirm === true,
    force: body.force === true,
    isAdmin: user.canAdmin === true,
  })

  if (result.skipped.length > 0 && result.deleted > 0) {
    setResponseStatus(event, 207)
  }

  return { data: result }
})
