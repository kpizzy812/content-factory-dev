import { createHash, timingSafeEqual } from 'node:crypto'

export interface DevAuthEnvironment {
  CONTENT_FACTORY_ENV?: string
  DEV_AUTH_ENABLED?: string
  DEV_AUTH_EMAIL?: string
  DEV_AUTH_PASSWORD?: string
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

export function isDevAuthConfigured(env: DevAuthEnvironment): boolean {
  return env.CONTENT_FACTORY_ENV === 'development'
    && env.DEV_AUTH_ENABLED === 'true'
    && Boolean(env.DEV_AUTH_EMAIL?.trim())
    && Boolean(env.DEV_AUTH_PASSWORD)
}

export function verifyDevAuth(email: string, password: string, env: DevAuthEnvironment): boolean {
  if (!isDevAuthConfigured(env)) return false
  const expectedEmail = env.DEV_AUTH_EMAIL!.trim().toLowerCase()
  const expectedPassword = env.DEV_AUTH_PASSWORD!
  return timingSafeEqual(digest(email.trim().toLowerCase()), digest(expectedEmail))
    && timingSafeEqual(digest(password), digest(expectedPassword))
}

export function devExternalId(email: string): number {
  const value = digest(email.trim().toLowerCase()).readUInt32BE(0) & 0x7fffffff
  return -(value || 1)
}