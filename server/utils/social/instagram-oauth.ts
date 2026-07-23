import {
  DEFAULT_INSTAGRAM_API_VERSION,
  InstagramApiError,
  type InstagramFetch,
} from "./instagram-api"

export interface InstagramOAuthConfig {
  appId: string
  appSecret: string
  redirectUri: string
  apiVersion: string
}

export interface InstagramOAuthToken {
  accessToken: string
  userId: string
  expiresIn: number
}

export interface InstagramOAuthProfile {
  id?: string
  user_id?: string
  username?: string
  name?: string
  account_type?: string
}

interface MetaOAuthError {
  message?: string
  code?: number
  error_subcode?: number
}

function publicBaseUrl(): string {
  const raw = process.env.CONTENT_FACTORY_PUBLIC_URL
    || process.env.REPLICATE_WEBHOOK_BASE_URL
    || ""
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error("CONTENT_FACTORY_PUBLIC_URL must be a valid absolute URL")
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("CONTENT_FACTORY_PUBLIC_URL must use http or https")
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("CONTENT_FACTORY_PUBLIC_URL must use https in production")
  }
  url.pathname = "/"
  url.search = ""
  url.hash = ""
  return url.toString().replace(/\/$/, "")
}

export function getInstagramOAuthConfig(): InstagramOAuthConfig {
  const appId = process.env.INSTAGRAM_APP_ID?.trim() ?? ""
  const appSecret = process.env.INSTAGRAM_APP_SECRET?.trim() ?? ""
  if (!appId || !appSecret) {
    throw new Error("Instagram OAuth requires INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET")
  }
  const apiVersion = process.env.INSTAGRAM_GRAPH_API_VERSION
    || DEFAULT_INSTAGRAM_API_VERSION
  if (!/^v\d+\.\d+$/.test(apiVersion)) {
    throw new Error(`Invalid INSTAGRAM_GRAPH_API_VERSION: ${apiVersion}`)
  }
  return {
    appId,
    appSecret,
    apiVersion,
    redirectUri: `${publicBaseUrl()}/api/social/callback/instagram`,
  }
}

export function buildInstagramAuthorizationUrl(
  config: InstagramOAuthConfig,
  state: string,
): string {
  const url = new URL("https://www.instagram.com/oauth/authorize")
  url.searchParams.set("client_id", config.appId)
  url.searchParams.set("redirect_uri", config.redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("state", state)
  url.searchParams.set("force_reauth", "true")
  url.searchParams.set("scope", [
    "instagram_business_basic",
    "instagram_business_content_publish",
    "instagram_business_manage_insights",
  ].join(","))
  return url.toString()
}

async function jsonResponse<T>(
  response: Response,
  operation: string,
): Promise<T> {
  let payload: Record<string, unknown>
  try {
    payload = await response.json() as Record<string, unknown>
  } catch {
    throw new InstagramApiError(`${operation}: invalid JSON`, response.status)
  }
  const error = payload.error as MetaOAuthError | undefined
  if (!response.ok || error) {
    throw new InstagramApiError(
      `${operation}: ${error?.message || response.status}`,
      response.status,
      error?.code,
      error?.error_subcode,
    )
  }
  return payload as T
}

export async function exchangeInstagramAuthorizationCode(
  code: string,
  config: InstagramOAuthConfig,
  fetchImpl: InstagramFetch = fetch,
): Promise<InstagramOAuthToken> {
  const shortResponse = await fetchImpl("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.appId,
      client_secret: config.appSecret,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
      code,
    }).toString(),
  })
  const shortToken = await jsonResponse<{
    access_token?: string
    user_id?: string | number
  }>(shortResponse, "Instagram OAuth code exchange")
  if (!shortToken.access_token || !shortToken.user_id) {
    throw new Error("Instagram OAuth code exchange returned no token or user id")
  }

  const longUrl = new URL("https://graph.instagram.com/access_token")
  longUrl.searchParams.set("grant_type", "ig_exchange_token")
  longUrl.searchParams.set("client_secret", config.appSecret)
  longUrl.searchParams.set("access_token", shortToken.access_token)
  const longResponse = await fetchImpl(longUrl, { headers: { Accept: "application/json" } })
  const longToken = await jsonResponse<{
    access_token?: string
    expires_in?: number
  }>(longResponse, "Instagram long-lived token exchange")
  if (!longToken.access_token) {
    throw new Error("Instagram long-lived token exchange returned no access token")
  }

  return {
    accessToken: longToken.access_token,
    userId: String(shortToken.user_id),
    expiresIn: Number(longToken.expires_in) || 5_184_000,
  }
}

export async function fetchInstagramOAuthProfile(
  token: InstagramOAuthToken,
  config: InstagramOAuthConfig,
  fetchImpl: InstagramFetch = fetch,
): Promise<InstagramOAuthProfile> {
  const url = new URL(`https://graph.instagram.com/${config.apiVersion}/me`)
  url.searchParams.set("fields", "id,user_id,username,name,account_type")
  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      Accept: "application/json",
    },
  })
  return jsonResponse<InstagramOAuthProfile>(response, "Instagram profile lookup")
}
