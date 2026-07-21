/**
 * Test-only login для E2E через Playwright. Создаёт реальную zavod-session
 * cookie через setUserSession() в обход validateExternalUser → MarketingCamp.
 *
 * Гейт идентичный getAuthContext() в server/utils/rbac.ts:
 *   1. NODE_ENV !== "production"
 *   2. process.env.TEST_AUTH_BYPASS === "1"
 *   3. заголовок x-test-auth-token === process.env.TEST_AUTH_TOKEN
 *
 * Body: { email?: string, rolePreset?: string, canAdmin?: boolean }
 *   - если email задан и пользователь существует — переиспользуем,
 *     иначе создаём ZavodUser с дефолтами admin.
 *
 * Ответ: { user: { id, email, ... } }. Cookie zavod-session устанавливается
 * через setUserSession (под капотом nuxt-auth-utils).
 */
export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === "production") {
    throw createError({ statusCode: 404, message: "Not found" })
  }
  if (process.env.TEST_AUTH_BYPASS !== "1") {
    throw createError({ statusCode: 404, message: "Not found" })
  }
  const headerToken = getHeader(event, "x-test-auth-token")
  if (!headerToken || headerToken !== process.env.TEST_AUTH_TOKEN) {
    throw createError({ statusCode: 403, message: "Test bypass token mismatch" })
  }

  const body = await readBody<{
    email?: string
    rolePreset?: "admin" | "producer" | "operator" | "analyst" | "observer"
    canAdmin?: boolean
  }>(event)

  const email = body?.email?.trim().toLowerCase() ?? "e2e-admin@example.test"
  const rolePreset = body?.rolePreset ?? "admin"
  const canAdmin = body?.canAdmin ?? true

  let user = await prisma.zavodUser.findFirst({ where: { email } })
  if (!user) {
    const seed = Math.floor(Math.random() * 1_000_000_000)
    user = await prisma.zavodUser.create({
      data: {
        externalId: seed,
        email,
        rolePreset,
        canRead: true,
        canWrite: true,
        canCreate: true,
        canDelete: true,
        canApprove: true,
        canRunAgent: true,
        canApplyChanges: true,
        canAdmin,
        // Полный moduleAccess для test-юзера: e2e сценарии должны проходить module-checks
        // у не-админских ролей. Админы и так получают bypass на сервере.
        moduleAccess: ["trendwatcher", "script-generator", "video-generator", "social-upload", "analytics", "pipeline"],
        isActive: true,
      },
    })
  }

  await setUserSession(event, {
    user: {
      id: user.id,
      externalId: user.externalId,
      email: user.email,
      name: user.name,
      surname: user.surname,
      rolePreset: user.rolePreset,
    },
  })

  return {
    user: {
      id: user.id,
      email: user.email,
      rolePreset: user.rolePreset,
    },
  }
})
