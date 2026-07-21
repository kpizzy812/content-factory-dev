/**
 * POST /api/device-profiles/:id/test
 *
 * R5a (Этап 2 миграции DuoPlus): dry-run push в провайдер заглушён 501
 * `engine_not_implemented`. Старый флоу (buildIndigoCreateBody + client +
 * token-manager + credentials) опирался на Indigo /profile/create, удаляемый в
 * R5b. Под DuoPlus валидация профиля придёт через device REST API — Этап 3.
 * RBAC-гейт (canWrite + social-upload) сохранён.
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
