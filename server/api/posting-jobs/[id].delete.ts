/**
 * DELETE /api/posting-jobs/:id
 *
 * HARD-delete одной PostingJob (логи каскадятся). Освобождает idempotencyKey →
 * чистый перезапуск постинга той же пары без resume-наследия.
 *
 * Body (опционально): { confirm?: boolean, force?: boolean }
 *   - confirm: подтверждение удаления published (re-post риск).
 *   - force: принудительное удаление свежей in-flight (требует canAdmin).
 *
 * Права: canDelete + social-upload (canDelete независим от canAdmin, RBAC-философия).
 * Коды: 200 ok · 400 bad id · 403 force без admin · 404 not found ·
 *       409 published_needs_confirm | job_in_flight (data.code).
 */
import { deletePostingJob } from "~~/server/utils/posting/job-service"
import type { DeletePostingJobRequest } from "~~/shared/types/posting-job"

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ["canDelete"],
    moduleSlug: "social-upload",
  })

  const id = getRouterParam(event, "id")
  if (!id || typeof id !== "string" || !id.trim()) {
    throw createError({ statusCode: 400, message: "Неверный идентификатор job" })
  }

  // DELETE с телом поддерживается h3; тело опционально.
  const body = await readBody<DeletePostingJobRequest>(event).catch(() => null)

  const result = await deletePostingJob(id, {
    confirm: body?.confirm === true,
    force: body?.force === true,
    isAdmin: user.canAdmin === true,
  })

  return { data: result }
})
