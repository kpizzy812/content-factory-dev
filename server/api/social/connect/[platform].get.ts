import { randomBytes } from "node:crypto"

import {
  buildInstagramAuthorizationUrl,
  getInstagramOAuthConfig,
} from "../../../utils/social/instagram-oauth"
import { createSocialOAuthState } from "../../../utils/social/oauth-state"

function oauthSigningSecret(): string {
  const secret = process.env.SOCIAL_OAUTH_STATE_SECRET
    || process.env.NUXT_SESSION_PASSWORD
    || ""
  if (secret.length < 32) {
    throw createError({
      statusCode: 500,
      message: "SOCIAL_OAUTH_STATE_SECRET or NUXT_SESSION_PASSWORD must contain at least 32 characters",
    })
  }
  return secret
}

export default defineEventHandler(async (event) => {
  const platform = getRouterParam(event, "platform")
  if (platform !== "instagram") {
    throw createError({
      statusCode: 501,
      message: `Official OAuth connection is not implemented for ${platform || "this platform"}`,
    })
  }
  const appId = Number(getQuery(event).appId)
  if (!Number.isInteger(appId) || appId <= 0) {
    throw createError({ statusCode: 400, message: "appId is required" })
  }
  const user = await requireScopedAccess(event, {
    permissions: ["canCreate"],
    moduleSlug: "social-upload",
    appId,
  })
  const config = getInstagramOAuthConfig()
  const state = createSocialOAuthState({
    platform: "instagram",
    appId,
    userId: user.id,
    expiresAt: Date.now() + 10 * 60_000,
    nonce: randomBytes(18).toString("base64url"),
  }, oauthSigningSecret())
  return sendRedirect(event, buildInstagramAuthorizationUrl(config, state), 302)
})
