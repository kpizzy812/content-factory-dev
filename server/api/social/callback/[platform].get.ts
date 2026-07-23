import {
  exchangeInstagramAuthorizationCode,
  fetchInstagramOAuthProfile,
  getInstagramOAuthConfig,
} from "../../../utils/social/instagram-oauth"
import { verifySocialOAuthState } from "../../../utils/social/oauth-state"

function oauthSigningSecret(): string {
  const secret = process.env.SOCIAL_OAUTH_STATE_SECRET
    || process.env.NUXT_SESSION_PASSWORD
    || ""
  if (secret.length < 32) {
    throw createError({ statusCode: 500, message: "OAuth state signing secret is not configured" })
  }
  return secret
}

export default defineEventHandler(async (event) => {
  const platform = getRouterParam(event, "platform")
  if (platform !== "instagram") {
    throw createError({ statusCode: 400, message: "Unsupported OAuth callback platform" })
  }
  const query = getQuery(event)
  if (typeof query.error === "string") {
    throw createError({
      statusCode: 400,
      message: "Instagram authorization was cancelled or denied",
    })
  }
  const code = typeof query.code === "string" ? query.code.trim() : ""
  const rawState = typeof query.state === "string" ? query.state.trim() : ""
  if (!code || !rawState) {
    throw createError({ statusCode: 400, message: "Instagram callback is missing code or state" })
  }

  let state
  try {
    state = verifySocialOAuthState(rawState, oauthSigningSecret())
  } catch (error) {
    throw createError({
      statusCode: 400,
      message: error instanceof Error ? error.message : "Invalid OAuth state",
    })
  }
  const user = await requireScopedAccess(event, {
    permissions: ["canCreate"],
    moduleSlug: "social-upload",
    appId: state.appId,
  })
  if (user.id !== state.userId) {
    throw createError({ statusCode: 403, message: "OAuth state belongs to another user" })
  }

  const config = getInstagramOAuthConfig()
  const token = await exchangeInstagramAuthorizationCode(code, config)
  const profile = await fetchInstagramOAuthProfile(token, config)
  const platformUserId = String(profile.user_id || profile.id || token.userId)
  if (!platformUserId) {
    throw createError({ statusCode: 502, message: "Instagram did not return an account id" })
  }
  const username = profile.username?.trim() || ""
  const displayName = profile.name?.trim() || (username ? `@${username}` : `Instagram ${platformUserId}`)
  const encryptedToken = encrypt(token.accessToken)
  const expiresAt = new Date(Date.now() + token.expiresIn * 1000)

  const existing = await prisma.socialAccount.findFirst({
    where: {
      appId: state.appId,
      platform: "instagram",
      platformUserId,
    },
    select: { id: true },
  })
  const data = {
    displayName,
    platformHandle: username ? (username.startsWith("@") ? username : `@${username}`) : null,
    platformUserId,
    accessToken: encryptedToken,
    refreshToken: null,
    expiresAt,
    status: "active" as const,
    postingMethod: "api" as const,
  }
  const account = existing
    ? await prisma.socialAccount.update({
        where: { id: existing.id },
        data,
        select: { id: true },
      })
    : await prisma.socialAccount.create({
        data: {
          appId: state.appId,
          platform: "instagram",
          ...data,
        },
        select: { id: true },
      })

  return sendRedirect(event, `/accounts?connected=instagram&accountId=${account.id}`, 302)
})
