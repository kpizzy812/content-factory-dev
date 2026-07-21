/**
 * POST /api/device-profiles/[id]/start-prepare
 *
 * R5a (Этап 2 миграции DuoPlus): client-side launcher prepare заглушён 501
 * `engine_not_implemented`. Старый флоу (getLauncherBase + getIndigoToken +
 * proxy-checker) опирался на Indigo desktop launcher, удаляемый в R5b. Под DuoPlus
 * (облачный Android) launcher-флоу не нужен — реализация Этап 3. RBAC-гейт сохранён.
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
