import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

export interface SocialOAuthStatePayload {
  platform: "instagram"
  appId: number
  userId: number
  expiresAt: number
  nonce: string
}

function requireSecret(secret: string): string {
  if (secret.length < 32) {
    throw new Error("OAuth state signing secret must contain at least 32 characters")
  }
  return secret
}

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", requireSecret(secret)).update(payload).digest()
}

export function createSocialOAuthState(
  input: Omit<SocialOAuthStatePayload, "nonce"> & { nonce?: string },
  secret: string,
): string {
  const payload: SocialOAuthStatePayload = {
    ...input,
    nonce: input.nonce ?? randomBytes(18).toString("base64url"),
  }
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  return `${encoded}.${signature(encoded, secret).toString("base64url")}`
}

export function verifySocialOAuthState(
  state: string,
  secret: string,
  now = Date.now(),
): SocialOAuthStatePayload {
  const [encoded, providedRaw, extra] = state.split(".")
  if (!encoded || !providedRaw || extra) {
    throw new Error("Invalid OAuth state format")
  }

  let provided: Buffer
  try {
    provided = Buffer.from(providedRaw, "base64url")
  } catch {
    throw new Error("Invalid OAuth state signature")
  }
  const expected = signature(encoded, secret)
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new Error("Invalid OAuth state signature")
  }

  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))
  } catch {
    throw new Error("Invalid OAuth state payload")
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid OAuth state payload")
  }

  const value = payload as Record<string, unknown>
  if (
    value.platform !== "instagram"
    || !Number.isInteger(value.appId)
    || Number(value.appId) <= 0
    || !Number.isInteger(value.userId)
    || Number(value.userId) <= 0
    || !Number.isFinite(value.expiresAt)
    || typeof value.nonce !== "string"
    || value.nonce.length < 4
  ) {
    throw new Error("Invalid OAuth state payload")
  }
  if (Number(value.expiresAt) < now) {
    throw new Error("OAuth state expired")
  }

  return value as unknown as SocialOAuthStatePayload
}
