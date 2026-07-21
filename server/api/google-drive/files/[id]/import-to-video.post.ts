/**
 * POST /api/google-drive/files/[id]/import-to-video — создать Video из DriveFile.
 *
 * Permissions: canCreate (модуль trendwatcher).
 * Body: { scenarioId: number; applicationId?: number; format?: 'portrait' | 'landscape' | 'square' }
 *
 * scenarioId обязателен (Этап 1 contract). Реализация делегирована в helper
 * server/utils/google-drive/import.ts чтобы переиспользоваться в pipeline-нодах.
 */
import { importDriveFileToVideo } from "~~/server/utils/google-drive/import"

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ["canCreate"],
    moduleSlug: "trendwatcher",
  })

  const idRaw = getRouterParam(event, "id")
  const id = Number(idRaw)
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, message: "Некорректный ID файла" })
  }

  const body = await readBody<{
    scenarioId?: number
    applicationId?: number
    format?: string
  }>(event)

  const scenarioId = Number(body?.scenarioId ?? Number.NaN)
  if (!Number.isFinite(scenarioId) || scenarioId <= 0) {
    throw createError({ statusCode: 400, message: "Поле scenarioId обязательно" })
  }

  let applicationId: number | undefined
  if (body?.applicationId !== undefined && body.applicationId !== null) {
    const appId = Number(body.applicationId)
    if (!Number.isFinite(appId) || appId <= 0) {
      throw createError({ statusCode: 400, message: "Некорректный applicationId" })
    }
    applicationId = appId
  }

  let format: "portrait" | "landscape" | "square" = "portrait"
  const formatRaw = body?.format
  if (typeof formatRaw === "string" && formatRaw.length > 0) {
    if (formatRaw === "portrait" || formatRaw === "landscape" || formatRaw === "square") {
      format = formatRaw
    } else {
      throw createError({
        statusCode: 400,
        message: "Невалидный format. Допустимо: portrait | landscape | square",
      })
    }
  }

  // Ownership scenarioId проверяется через App access — не ZavodUser напрямую,
  // т.к. модель Scenario не имеет userId. Полагаемся на scoped permission.
  // Дополнительная защита: scenarioId должен существовать (helper проверит).
  const result = await importDriveFileToVideo({
    driveFileId: id,
    userId: user.id,
    scenarioId,
    applicationId,
    format,
  })

  return {
    data: {
      videoId: result.videoId,
      driveFileId: id,
    },
  }
})
