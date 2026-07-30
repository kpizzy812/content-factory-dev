export type AuthProvider = "local" | "marketingcamp"

const SUPPORTED: AuthProvider[] = ["local", "marketingcamp"]

/**
 * По умолчанию ContentFactory логинит сам. MarketingCamp — необязательный адаптер
 * для установок, где родительская платформа действительно есть.
 */
export function resolveAuthProvider(env: Record<string, string | undefined>): AuthProvider {
  const raw = (env.AUTH_PROVIDER ?? "").trim().toLowerCase()
  if (!raw) return "local"
  if (!SUPPORTED.includes(raw as AuthProvider)) {
    throw new Error(`AUTH_PROVIDER must be one of ${SUPPORTED.join(", ")}, got "${raw}"`)
  }
  return raw as AuthProvider
}
