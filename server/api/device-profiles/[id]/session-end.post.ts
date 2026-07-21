/**
 * POST /api/device-profiles/[id]/session-end
 *
 * R5a (Этап 2 миграции DuoPlus): запись результата client-side стопа сессии
 * заглушена 501 `engine_not_implemented`. Часть удаляемого launcher-флоу
 * (stop-prepare → client fetch → session-end). Под DuoPlus — Этап 3.
 * RBAC-гейт сохранён.
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
