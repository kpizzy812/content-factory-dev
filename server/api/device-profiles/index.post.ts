/**
 * POST /api/device-profiles
 *
 * R5a (Этап 2 миграции DuoPlus): создаёт DeviceProfile в нашей БД local-only.
 * Push в облако (старый Indigo /profile/create через buildIndigoCreateBody +
 * client + token-manager + credentials) удалён — он опирался на Indigo-слой,
 * выпиливаемый в R5b. Push под DuoPlus REST API — Этап 3. Профиль создаётся со
 * syncStatus='local_only'; ответ — нейтральный DTO через toDeviceProfileDto.
 */
import type { DeviceProfileCreateInput } from "~~/shared/types/device-profile"
import { DEVICE_PLATFORM_TYPES } from "~~/shared/types/device-profile"
import { toDeviceProfileDto } from "~~/server/utils/posting-provider/dto"
import {
  parseDeviceFingerprint,
  withFingerprint,
  DEVICE_FINGERPRINT_DEFAULTS,
} from "~~/shared/schemas/device-fingerprint"
import {
  findPresetById,
  withDevicePresetId,
} from "~~/shared/data/device-hardware-presets"

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ["canCreate"],
    moduleSlug: "social-upload",
  })

  const body = await readBody<DeviceProfileCreateInput>(event)

  if (!body || typeof body !== "object") {
    throw createError({ statusCode: 400, message: "Тело запроса обязательно" })
  }

  if (
    typeof body.name !== "string"
    || !body.name.trim()
    || body.name.length > 120
  ) {
    throw createError({
      statusCode: 400,
      message: "Поле 'name' обязательно (строка до 120 символов)",
    })
  }

  const platformType = body.platformType ?? "desktop"
  if (!DEVICE_PLATFORM_TYPES.includes(platformType)) {
    throw createError({
      statusCode: 400,
      message: `Поле 'platformType' должно быть одним из: ${DEVICE_PLATFORM_TYPES.join(", ")}`,
    })
  }

  // Validate proxy и socialAccount если переданы
  if (body.proxyId) {
    const proxy = await prisma.proxy.findUnique({
      where: { id: body.proxyId },
      select: { id: true },
    })
    if (!proxy) {
      throw createError({ statusCode: 404, message: "Прокси не найден" })
    }
  }
  if (body.socialAccountId !== undefined && body.socialAccountId !== null) {
    const account = await prisma.socialAccount.findUnique({
      where: { id: body.socialAccountId },
    })
    if (!account) {
      throw createError({ statusCode: 404, message: "Социальный аккаунт не найден" })
    }
    // Проверка 1:1 — если у аккаунта уже есть профиль
    const existingForAccount = await prisma.deviceProfile.findUnique({
      where: { socialAccountId: body.socialAccountId },
    })
    if (existingForAccount) {
      throw createError({
        statusCode: 409,
        message: `У аккаунта уже привязан профиль "${existingForAccount.name}"`,
      })
    }
  }

  // Нормализуем fingerprint (input может быть partial)
  const fingerprint = parseDeviceFingerprint({
    ...DEVICE_FINGERPRINT_DEFAULTS,
    ...(body.fingerprint ?? {}),
  })
  // Валидируем devicePresetId — если id неизвестен, сохраняем как null (Custom).
  // Это защищает от хранения stale id в config (preset удалён из таблицы).
  const validatedPresetId = body.devicePresetId
    ? findPresetById(body.devicePresetId)?.id ?? null
    : null
  const configToStore = withDevicePresetId(
    withFingerprint(null, fingerprint),
    validatedPresetId,
  )

  // R5a: создаём local-only. indigoId/indigoFolderId остаются null до облачного
  // push (DuoPlus, Этап 3). syncStatus='local_only' — UI показывает «локальный».
  const created = await prisma.deviceProfile.create({
    data: {
      indigoId: null,
      indigoFolderId: null,
      name: body.name.trim(),
      platformType,
      os: body.os?.trim() || null,
      userAgent: body.userAgent?.trim() || null,
      screenResolution: body.screenResolution?.trim() || null,
      language: body.language?.trim() || null,
      timezone: body.timezone?.trim() || null,
      proxyId: body.proxyId ?? null,
      socialAccountId: body.socialAccountId ?? null,
      notes: body.notes?.trim() || null,
      tags: Array.isArray(body.tags) ? body.tags.slice(0, 30) : [],
      config: configToStore as object,
      syncStatus: "local_only",
      lastSyncedAt: null,
      lastSyncError: null,
      createdById: user.id,
    },
    include: {
      socialAccount: { include: { app: { select: { id: true, name: true } } } },
      proxy: { select: { id: true, label: true, status: true, type: true, expectedCountry: true } },
      accounts: {
        include: { socialAccount: { include: { app: { select: { id: true, name: true } } } } },
        orderBy: [{ isPrimary: "desc" }, { addedAt: "asc" }],
      },
    },
  })

  setResponseStatus(event, 201)
  return { data: toDeviceProfileDto(created) }
})
