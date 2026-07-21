/**
 * PATCH /api/posting-jobs/:id (P2, минимальный UPDATE)
 *
 * Редактирование scheduledAt + maxAttempts. ТОЛЬКО для status ∈ {scheduled, queued}.
 * contentSnapshot НЕ редактируется (гарантия идемпотентности retries).
 *
 * Body: { scheduledAt?: ISO|null, maxAttempts?: number(1..10) }.
 * Права: canWrite + social-upload.
 * Коды: 200 · 400 валидация · 404 not found · 409 not_editable (data.code).
 */
import { updatePostingJob } from "~~/server/utils/posting/job-service"
import type { PatchPostingJobRequest } from "~~/shared/types/posting-job"

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "social-upload",
  })

  const id = getRouterParam(event, "id")
  if (!id || typeof id !== "string" || !id.trim()) {
    throw createError({ statusCode: 400, message: "Неверный идентификатор job" })
  }

  const body = await readBody<PatchPostingJobRequest>(event)
  if (!body || typeof body !== "object") {
    throw createError({ statusCode: 400, message: "Тело запроса обязательно" })
  }

  const updated = await updatePostingJob(id, {
    scheduledAt: body.scheduledAt,
    maxAttempts: body.maxAttempts,
    updatedById: user.id,
  })

  return { data: updated }
})
