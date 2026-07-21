/**
 * PUT /api/accounts/:id/credentials
 * Обновление шифрованных login-полей и нечувствительной мета-информации аккаунта.
 */
import type { Prisma } from "~~/app/generated/prisma/client"
import { assertOneToOneForBrowserAutomation } from "~~/server/utils/accounts/one-to-one-guard"

const VALID_REGISTRATION_SOURCES = ["self", "purchased", "transferred"] as const
const VALID_WARMUP_STATUSES = ["new", "warming", "ready", "cold"] as const
const VALID_POSTING_METHODS = ["api", "browser_automation"] as const

type EncryptedField =
  | "loginEmail"
  | "loginPassword"
  | "recoveryEmail"
  | "recoveryPhone"
  | "twoFASecret"

const ENCRYPTED_FIELDS: EncryptedField[] = [
  "loginEmail",
  "loginPassword",
  "recoveryEmail",
  "recoveryPhone",
  "twoFASecret",
]

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "social-upload",
  })

  const id = Number(getRouterParam(event, "id"))
  if (!id || Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: "Неверный ID аккаунта" })
  }

  const account = await prisma.socialAccount.findUnique({
    where: { id },
    select: { id: true, proxyId: true, deviceProfileId: true },
  })
  if (!account) {
    throw createError({ statusCode: 404, message: "Аккаунт не найден" })
  }

  const body = await readBody<{
    loginEmail?: string | null
    loginPassword?: string | null
    recoveryEmail?: string | null
    recoveryPhone?: string | null
    twoFASecret?: string | null
    notes?: string | null
    birthDate?: string | null
    registrationSource?: string | null
    warmupStatus?: string | null
    postingMethod?: string | null
  }>(event)

  if (!body || typeof body !== "object") {
    throw createError({ statusCode: 400, message: "Тело запроса обязательно" })
  }

  const data: Prisma.SocialAccountUpdateInput = {}

  for (const field of ENCRYPTED_FIELDS) {
    if (field in body) {
      const raw = body[field]
      if (raw === null || raw === undefined || raw === "") {
        data[field] = null
      } else if (typeof raw !== "string") {
        throw createError({
          statusCode: 400,
          message: `Поле '${field}' должно быть строкой`,
        })
      } else {
        data[field] = encryptSecret(raw)
      }
    }
  }

  if ("notes" in body) {
    if (body.notes === null || body.notes === undefined || body.notes === "") {
      data.notes = null
    } else if (typeof body.notes !== "string") {
      throw createError({ statusCode: 400, message: "Поле 'notes' должно быть строкой" })
    } else {
      data.notes = body.notes
    }
  }

  if ("birthDate" in body) {
    if (!body.birthDate) {
      data.birthDate = null
    } else {
      const d = new Date(body.birthDate)
      if (Number.isNaN(d.getTime())) {
        throw createError({ statusCode: 400, message: "Поле 'birthDate' имеет неверный формат" })
      }
      if (d.getTime() > Date.now()) {
        throw createError({
          statusCode: 400,
          message: "Поле 'birthDate' не может быть в будущем",
        })
      }
      data.birthDate = d
    }
  }

  if ("registrationSource" in body) {
    if (!body.registrationSource) {
      data.registrationSource = null
    } else if (
      !VALID_REGISTRATION_SOURCES.includes(
        body.registrationSource as (typeof VALID_REGISTRATION_SOURCES)[number],
      )
    ) {
      throw createError({
        statusCode: 400,
        message: `Поле 'registrationSource' допускает: ${VALID_REGISTRATION_SOURCES.join(", ")}`,
      })
    } else {
      data.registrationSource =
        body.registrationSource as (typeof VALID_REGISTRATION_SOURCES)[number]
    }
  }

  if ("postingMethod" in body) {
    if (!body.postingMethod) {
      throw createError({
        statusCode: 400,
        message: `Поле 'postingMethod' не может быть пустым`,
      })
    }
    if (
      !VALID_POSTING_METHODS.includes(
        body.postingMethod as (typeof VALID_POSTING_METHODS)[number],
      )
    ) {
      throw createError({
        statusCode: 400,
        message: `Поле 'postingMethod' допускает: ${VALID_POSTING_METHODS.join(", ")}`,
      })
    }
    data.postingMethod = body.postingMethod as (typeof VALID_POSTING_METHODS)[number]

    // 1:1:1: при переключении на browser_automation существующие прокси/indigo-профиль
    // аккаунта не должны быть заняты другим browser_automation-аккаунтом.
    // (api-аккаунты не ограничены — guard вызывается только для browser_automation.)
    if (data.postingMethod === "browser_automation") {
      await assertOneToOneForBrowserAutomation(id, {
        proxyId: account.proxyId,
        deviceProfileId: account.deviceProfileId,
      })
    }
  }

  if ("warmupStatus" in body) {
    if (!body.warmupStatus) {
      throw createError({
        statusCode: 400,
        message: `Поле 'warmupStatus' не может быть пустым`,
      })
    }
    if (
      !VALID_WARMUP_STATUSES.includes(
        body.warmupStatus as (typeof VALID_WARMUP_STATUSES)[number],
      )
    ) {
      throw createError({
        statusCode: 400,
        message: `Поле 'warmupStatus' допускает: ${VALID_WARMUP_STATUSES.join(", ")}`,
      })
    }
    data.warmupStatus = body.warmupStatus as (typeof VALID_WARMUP_STATUSES)[number]
  }

  await prisma.socialAccount.update({ where: { id }, data })

  return { data: { id } }
})
