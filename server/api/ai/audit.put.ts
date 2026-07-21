/**
 * PUT /api/ai/audit
 * Обновить статус AI audit записи (applied/partial/dismissed).
 */

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRunAgent'],
    moduleSlug: 'pipeline',
  })

  const body = await readBody<{
    auditId: number
    status: 'applied' | 'partial' | 'dismissed'
    appliedFields?: Record<string, unknown>
  }>(event)

  if (!body?.auditId || !body.status) {
    throw createError({ statusCode: 400, message: 'auditId и status обязательны' })
  }

  if (!['applied', 'partial', 'dismissed'].includes(body.status)) {
    throw createError({ statusCode: 400, message: 'Недопустимый статус' })
  }

  await updateAiAuditStatus(body.auditId, body.status, body.appliedFields)

  return { ok: true }
})
