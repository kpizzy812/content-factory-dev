/**
 * POST /api/device-profiles/[id]/stop-prepare
 *
 * R5a (Этап 2 миграции DuoPlus): client-side launcher stop-prepare заглушён 501
 * `engine_not_implemented`. Старый флоу опирался на Indigo desktop launcher,
 * удаляемый в R5b. Реализация под DuoPlus — Этап 3. RBAC-гейт сохранён.
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
