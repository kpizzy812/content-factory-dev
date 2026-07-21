/**
 * POST /api/accounts
 *
 * Manual account creation (purchased accounts workflow):
 *   - accessToken опционален. Manual аккаунты постят через Indigo browser automation,
 *     не через platform OAuth API. accessToken=null для них — норма.
 *   - platformHandle (@username) опционален, но рекомендуется для Apify scraping и
 *     human reference.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ["canCreate"], moduleSlug: "social-upload" })

  const body = await readBody<{
    appId?: number
    platform?: string
    displayName?: string
    platformHandle?: string | null
    accessToken?: string | null
    refreshToken?: string | null
    expiresAt?: string | null
    platformUserId?: string | null
  }>(event)

  if (!body?.appId || typeof body.appId !== "number" || body.appId <= 0) {
    throw createError({
      statusCode: 400,
      message: "Поле 'appId' обязательно и должно быть числом > 0",
    })
  }

  const validPlatforms = ["youtube", "tiktok", "instagram"] as const
  if (!body.platform || !validPlatforms.includes(body.platform as (typeof validPlatforms)[number])) {
    throw createError({
      statusCode: 400,
      message: `Поле 'platform' обязательно. Допустимые: ${validPlatforms.join(", ")}`,
    })
  }

  if (!body.displayName || typeof body.displayName !== "string" || !body.displayName.trim()) {
    throw createError({
      statusCode: 400,
      message: "Поле 'displayName' обязательно",
    })
  }

  const app = await prisma.app.findUnique({ where: { id: body.appId } })
  if (!app) {
    throw createError({ statusCode: 404, message: "Приложение не найдено" })
  }

  const normalizedHandle = typeof body.platformHandle === "string" && body.platformHandle.trim()
    ? normalizeHandle(body.platformHandle.trim())
    : null

  const encryptedAccessToken = typeof body.accessToken === "string" && body.accessToken
    ? encrypt(body.accessToken)
    : null
  const encryptedRefreshToken = typeof body.refreshToken === "string" && body.refreshToken
    ? encrypt(body.refreshToken)
    : null

  // 1:1:1 guard здесь НЕ нужен: создание не принимает postingMethod/proxyId/
  // deviceProfileId — новый аккаунт по умолчанию api без прокси и без device-профиля.
  // Нарушить 1:1 на CREATE невозможно. Привязка прокси/профиля и переключение на
  // browser_automation идут отдельными мутациями (proxy.put / credentials.put), где
  // guard вызывается. См. server/utils/accounts/one-to-one-guard.ts.
  const account = await prisma.socialAccount.create({
    data: {
      appId: body.appId,
      platform: body.platform as "youtube" | "tiktok" | "instagram",
      displayName: body.displayName.trim(),
      platformUserId: body.platformUserId || null,
      platformHandle: normalizedHandle,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      status: "active",
    },
    select: {
      id: true,
      appId: true,
      platform: true,
      displayName: true,
      platformHandle: true,
      status: true,
      createdAt: true,
    },
  })

  return { data: account, error: null }
})

function normalizeHandle(raw: string): string {
  return raw.startsWith("@") ? raw : `@${raw}`
}
