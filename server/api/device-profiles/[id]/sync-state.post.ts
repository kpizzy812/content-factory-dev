/**
 * POST /api/device-profiles/:id/sync-state
 *
 * R5a (Этап 2 миграции DuoPlus): runtime-state reconciliation заглушена 501
 * `engine_not_implemented`. Старый флоу (client.syncProfileState) опирался на
 * Indigo probe-эндпоинты, удаляемые в R5b. Под DuoPlus runtime-state придёт из
 * device REST API — реализация Этап 3. RBAC-гейт сохранён.
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
