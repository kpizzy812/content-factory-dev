import { devExternalId } from "../dev-auth"

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Локальные учётки не приходят из внешней платформы, поэтому externalId выводится
 * из email детерминированно и всегда отрицательный — так он не может столкнуться
 * с положительными идентификаторами MarketingCamp.
 */
export function localExternalId(email: string): number {
  return devExternalId(normalizeEmail(email))
}
