/**
 * POST /api/device-profiles/[id]/session-record
 *
 * R5a (Этап 2 миграции DuoPlus): запись результата client-side старта сессии
 * заглушена 501 `engine_not_implemented`. Этот endpoint — часть удаляемого
 * launcher-флоу (start-prepare → client fetch → session-record). Под DuoPlus
 * учёт сессий придёт из device REST API — реализация Этап 3. RBAC-гейт сохранён.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRunAgent"],
    moduleSlug: "social-upload",
  })

  throw createError({
    statusCode: 501,
    statusMessage: "engine_not_implemented",
    data: { code: "engine_not_implemented" },
  })
})
