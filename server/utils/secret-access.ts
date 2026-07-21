import type { H3Event } from "h3"
import type { ZavodUser } from "../../app/generated/prisma/client"
import { decryptSecret } from "./crypto"
import { prisma } from "./prisma"

export type SecretEntityType =
  | "SocialAccount.loginPassword"
  | "SocialAccount.loginEmail"
  | "SocialAccount.recoveryEmail"
  | "SocialAccount.recoveryPhone"
  | "SocialAccount.twoFASecret"
  | "SocialAccount.accessToken"
  | "SocialAccount.refreshToken"
  | "Proxy.host"
  | "Proxy.username"
  | "Proxy.password"
  | "Proxy.rotationUrl"

export type SecretAccessAction = "view" | "use_in_session" | "export"

export interface SecretAccessContext {
  user: Pick<ZavodUser, "id">
  reason?: string
  clientIp?: string | null
  userAgent?: string | null
}

export interface SecretAccessMeta {
  entityType: SecretEntityType
  entityId: string | number
  action: SecretAccessAction
}

/**
 * Расшифровывает секрет С обязательным audit-логированием в SecretAccessLog.
 * Запись лога создаётся ДО расшифровки — даже если decrypt упадёт, попытка зафиксирована.
 *
 * Использовать ВЕЗДЕ, где UI/API/operator получает доступ к secret-полю.
 * Для внутренних автоматических операций (health checks, runner-сессии без UI)
 * допустим прямой decryptSecret() — но action='use_in_session' рекомендуется.
 */
export async function readSecret(
  ciphertext: string | null | undefined,
  meta: SecretAccessMeta,
  ctx: SecretAccessContext
): Promise<string | null> {
  if (!ciphertext) return null

  await prisma.secretAccessLog.create({
    data: {
      userId: ctx.user.id,
      entityType: meta.entityType,
      entityId: String(meta.entityId),
      action: meta.action,
      clientIp: ctx.clientIp ?? null,
      userAgent: ctx.userAgent ?? null,
      reason: ctx.reason ?? null,
    },
  })

  return decryptSecret(ciphertext)
}

const SENSITIVE_KEY_PATTERNS = [
  "password",
  "pwd",
  "pass",
  "secret",
  "token",
  "apikey",
  "api_key",
  "twofasecret",
  "two_fa_secret",
  "rotationurl",
  "rotation_url",
  "encryptionkey",
  "encryption_key",
] as const

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase()
  return SENSITIVE_KEY_PATTERNS.some((pattern) => lower.includes(pattern))
}

/**
 * Маскирует hostname для отдачи в API responses.
 * IPv4: 45.83.123.45 → 45.83.X.X
 * Hostname: proxy.iproyal.com → proxy.***.com
 */
export function maskHost(host: string): string {
  if (!host) return host
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (ipv4) {
    return `${ipv4[1]}.${ipv4[2]}.X.X`
  }
  const parts = host.split(".")
  if (parts.length >= 3) {
    return `${parts[0]}.***.${parts[parts.length - 1]}`
  }
  return "***"
}

/**
 * Рекурсивный sanitizer для логов, Telegram-уведомлений, error messages.
 * Маскирует ключи с паролями/токенами + строки с паттерном host:port:user:pass.
 *
 * Применять везде, где value может попасть в строку (Pino logger, console.error,
 * sendTelegramAlert, AgentLog.details).
 */
export function sanitizeForLog(value: unknown): unknown {
  if (value === null || value === undefined) return value

  if (typeof value === "string") {
    // host:port:user:pass или похожие — маскируем 2-3 последних сегмента
    return value.replace(/(:[^:\s]+){2,3}(?=\s|$|\b)/g, ":***:***:***")
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item))
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        result[key] = "[REDACTED]"
      } else {
        result[key] = sanitizeForLog(val)
      }
    }
    return result
  }

  return value
}

/**
 * Собирает SecretAccessContext из H3Event:
 * - userId из переданного user
 * - clientIp из X-Forwarded-For или socket
 * - userAgent из заголовка
 */
export function buildSecretAccessContext(
  event: H3Event,
  user: Pick<ZavodUser, "id">,
  reason?: string
): SecretAccessContext {
  const xff = getRequestHeader(event, "x-forwarded-for")
  const clientIp =
    (xff ? xff.split(",")[0]?.trim() : null) ??
    event.node.req.socket?.remoteAddress ??
    null
  const userAgent = getRequestHeader(event, "user-agent") ?? null
  return { user, reason, clientIp, userAgent }
}
