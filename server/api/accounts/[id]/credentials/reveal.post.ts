/**
 * POST /api/accounts/:id/credentials/reveal
 * Расшифровка одного credentials-поля аккаунта с обязательным audit-логом.
 */
import type { SecretEntityType } from "~~/server/utils/secret-access"

const ALLOWED_FIELDS = [
  "loginEmail",
  "loginPassword",
  "recoveryEmail",
  "recoveryPhone",
  "twoFASecret",
] as const
type AllowedField = (typeof ALLOWED_FIELDS)[number]

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "social-upload",
  })

  const id = Number(getRouterParam(event, "id"))
  if (!id || Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: "Неверный ID аккаунта" })
  }

  const body = await readBody<{ field?: string; reason?: string }>(event)
  const field = body?.field
  if (!field || !ALLOWED_FIELDS.includes(field as AllowedField)) {
    throw createError({
      statusCode: 400,
      message: `Поле 'field' допускает: ${ALLOWED_FIELDS.join(", ")}`,
    })
  }
  const reason = typeof body?.reason === "string" ? body.reason.trim() : ""
  if (reason.length < 10 || reason.length > 500) {
    throw createError({
      statusCode: 400,
      message: "Укажите причину доступа (минимум 10 символов)",
    })
  }

  const account = await prisma.socialAccount.findUnique({
    where: { id },
    select: {
      id: true,
      loginEmail: true,
      loginPassword: true,
      recoveryEmail: true,
      recoveryPhone: true,
      twoFASecret: true,
    },
  })
  if (!account) {
    throw createError({ statusCode: 404, message: "Аккаунт не найден" })
  }

  const ciphertext = account[field as AllowedField]
  if (!ciphertext) {
    throw createError({ statusCode: 404, message: "Значение не задано" })
  }

  const ctx = buildSecretAccessContext(event, user, reason)
  const entityType = `SocialAccount.${field}` as SecretEntityType

  const value = await readSecret(
    ciphertext,
    { entityType, entityId: account.id, action: "view" },
    ctx,
  )

  return { data: { value } }
})
