import type { H3Event } from "h3"

/**
 * Guard for inter-service requests.
 * Checks Authorization: Bearer {ZAVOD_API_KEY} header.
 * Throws 403 if missing or invalid.
 */
export function requireZavodAuth(event: H3Event): void {
  const zavodApiKey = process.env.ZAVOD_API_KEY || ""

  if (!zavodApiKey) {
    throw createError({
      statusCode: 500,
      message: "ZAVOD_API_KEY not configured on server",
    })
  }

  const authorization = getHeader(event, "authorization")

  if (!authorization) {
    throw createError({
      statusCode: 403,
      message: "Missing Authorization header",
    })
  }

  const [scheme, token] = authorization.split(" ")

  if (scheme !== "Bearer" || !token || token !== zavodApiKey) {
    throw createError({
      statusCode: 403,
      message: "Invalid or missing Bearer token",
    })
  }
}
