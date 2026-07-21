/**
 * PUT /api/device-profiles/:id
 *
 * R5a (Этап 2 миграции DuoPlus): обновляет local-поля в нашей БД. Remote-push в
 * провайдер (старый Indigo partial_update через buildIndigoCreateBody + client +
 * token-manager) удалён — он опирался на Indigo-слой, выпиливаемый в R5b. Push под
 * DuoPlus — Этап 3. Ответ — нейтральный DTO через toDeviceProfileDto.
 */
import type { DeviceProfileUpdateInput } from "~~/shared/types/device-profile"
import { DEVICE_PLATFORM_TYPES } from "~~/shared/types/device-profile"
import { toDeviceProfileDto } from "~~/server/utils/posting-provider/dto"
import {
  extractFingerprintFromConfig,
  parseDeviceFingerprint,
  withFingerprint,
} from "~~/shared/schemas/device-fingerprint"
import {
  findPresetById,
  withDevicePresetId,
} from "~~/shared/data/device-hardware-presets"

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "social-upload",
  })

  const id = getRouterParam(event, "id")
  // Tenant isolation: 400 / 404 / 403 (admin bypass для canAdmin). Возвращает профиль,
  // чтобы избежать повторного запроса в БД.
  const existing = await requireProfileOwnership(id, user)

  const body = await readBody<DeviceProfileUpdateInput>(event)
  if (!body || typeof body !== "object") {
    throw createError({ statusCode: 400, message: "Тело запроса обязательно" })
  }

  if (body.platformType && !DEVICE_PLATFORM_TYPES.includes(body.platformType)) {
    throw createError({
      statusCode: 400,
      message: `Поле 'platformType' должно быть одним из: ${DEVICE_PLATFORM_TYPES.join(", ")}`,
    })
  }

  if (body.proxyId !== undefined && body.proxyId !== null) {
    const proxy = await prisma.proxy.findUnique({
      where: { id: body.proxyId },
      select: { id: true },
    })
    if (!proxy) {
      throw createError({ statusCode: 404, message: "Прокси не найден" })
    }
  }

  if (body.socialAccountId && body.socialAccountId !== existing.socialAccountId) {
    const conflict = await prisma.deviceProfile.findUnique({
      where: { socialAccountId: body.socialAccountId },
    })
    if (conflict) {
      throw createError({
        statusCode: 409,
        message: `У этого аккаунта уже привязан профиль "${conflict.name}"`,
      })
    }
  }

  const updateData: Record<string, unknown> = {}
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 120) {
      throw createError({ statusCode: 400, message: "Неверный 'name'" })
    }
    updateData.name = body.name.trim()
  }
  if (body.platformType !== undefined) updateData.platformType = body.platformType
  if (body.os !== undefined) updateData.os = body.os?.trim() || null
  if (body.userAgent !== undefined) updateData.userAgent = body.userAgent?.trim() || null
  if (body.screenResolution !== undefined) updateData.screenResolution = body.screenResolution?.trim() || null
  if (body.language !== undefined) updateData.language = body.language?.trim() || null
  if (body.timezone !== undefined) updateData.timezone = body.timezone?.trim() || null
  if (body.proxyId !== undefined) updateData.proxyId = body.proxyId ?? null
  if (body.socialAccountId !== undefined) updateData.socialAccountId = body.socialAccountId ?? null
  if (body.notes !== undefined) updateData.notes = body.notes?.trim() || null
  if (body.tags !== undefined) {
    updateData.tags = Array.isArray(body.tags) ? body.tags.slice(0, 30) : []
  }

  // Fingerprint / devicePresetId update — мержим с existing config.
  // Обе ветки могут срабатывать в одном PUT (selector → autofill + fingerprint).
  let nextConfig: unknown = existing.config
  if (body.fingerprint !== undefined && body.fingerprint !== null) {
    const merged = parseDeviceFingerprint({
      ...extractFingerprintFromConfig(existing.config),
      ...body.fingerprint,
    })
    nextConfig = withFingerprint(nextConfig, merged)
  }
  if (body.devicePresetId !== undefined) {
    const validated = body.devicePresetId
      ? findPresetById(body.devicePresetId)?.id ?? null
      : null
    nextConfig = withDevicePresetId(nextConfig, validated)
  }
  if (nextConfig !== existing.config) {
    updateData.config = nextConfig
  }

  const updated = await prisma.deviceProfile.update({
    where: { id },
    data: updateData,
    include: {
      socialAccount: { include: { app: { select: { id: true, name: true } } } },
      proxy: { select: { id: true, label: true, status: true, type: true, expectedCountry: true } },
      accounts: {
        include: { socialAccount: { include: { app: { select: { id: true, name: true } } } } },
        orderBy: [{ isPrimary: "desc" }, { addedAt: "asc" }],
      },
    },
  })

  return { data: toDeviceProfileDto(updated) }
})
