/**
 * POST /api/device-profiles/:id/resync
 *
 * R5a (Этап 2 миграции DuoPlus): re-push локального состояния в провайдер
 * заглушён 501 `engine_not_implemented`. Старый флоу (buildIndigoCreateBody +
 * client.create/update + token-manager + credentials) опирался на Indigo API,
 * удаляемый в R5b. Под DuoPlus push в облако — Этап 3. RBAC-гейт сохранён.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "social-upload",
  })

  throw createError({
    statusCode: 501,
    statusMessage: "engine_not_implemented",
    data: { code: "engine_not_implemented" },
  })
})
