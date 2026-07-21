/**
 * Helper: importDriveFileToVideo — общий код для HTTP endpoint
 * (POST /api/google-drive/files/[id]/import-to-video) и pipeline executor
 * (executeVideoAnalyzerNode).
 *
 * Логика:
 *   1. Найти DriveFile + проверить ownership.
 *   2. Проверить syncStatus === 'downloaded' и отсутствие video.
 *   3. Resolve scenarioId — либо переданный (с ownership-check), либо
 *      "system" Scenario (находим/создаём по applicationId, имя `__system_drive_imports`).
 *   4. В транзакции: создать Video с isExternalCreative=true и привязать DriveFile.
 *
 * При невалидных данных бросает createError совместимый с h3 (statusCode/message).
 */
import type { VideoFormat } from "@prisma/client"
import { createError } from "h3"
import { prisma } from "../prisma"

const SYSTEM_SCENARIO_NAME = "__system_drive_imports"

export interface ImportDriveFileOptions {
  /** DriveFile.id (числовой PK) */
  driveFileId: number
  /** Текущий userId — для ownership-проверки */
  userId: number
  /**
   * Если передан — используется как scenarioId. Иначе создаётся/используется
   * system-scenario для applicationId.
   */
  scenarioId?: number
  /**
   * Application для Video. Опционально, но обязателен если scenarioId
   * не указан (нужен для resolve system scenario).
   */
  applicationId?: number
  /** portrait | landscape (square маппится в portrait). Default portrait. */
  format?: "portrait" | "landscape" | "square"
}

export interface ImportDriveFileResult {
  videoId: number
  /** Drive file ID (string из Google), не БД id */
  driveFileId: string
  /** Реально использованный scenarioId (либо переданный, либо system) */
  scenarioId: number
}

/**
 * Resolve scenarioId для импорта Drive-файла. Логика:
 * - Если передан scenarioId: проверяем что он существует.
 * - Иначе: ищем существующий "system" Scenario для applicationId
 *   (по operatorNotes маркеру). Если нет — создаём новый.
 *
 * applicationId обязателен если scenarioId не передан.
 */
async function resolveScenarioId(opts: {
  scenarioId?: number
  applicationId?: number
}): Promise<number> {
  if (opts.scenarioId !== undefined) {
    const sc = await prisma.scenario.findUnique({
      where: { id: opts.scenarioId },
      select: { id: true },
    })
    if (!sc) {
      throw createError({ statusCode: 404, message: `Scenario #${opts.scenarioId} не найден` })
    }
    return sc.id
  }

  if (opts.applicationId === undefined) {
    throw createError({
      statusCode: 400,
      message: "Не указано приложение для импорта (applicationId или scenarioId обязательны)",
    })
  }

  // Ищем существующий system-Scenario для этого app по operatorNotes-маркеру.
  const existing = await prisma.scenario.findFirst({
    where: {
      appId: opts.applicationId,
      operatorNotes: SYSTEM_SCENARIO_NAME,
      status: "archived",
    },
    select: { id: true },
  })
  if (existing) return existing.id

  // Нужен Trend для создания Scenario (FK обязательный).
  // Создаём system-Trend под app или используем первый существующий.
  // Простейший fallback: первый Trend в БД (для dev). В проде Drive импорт
  // ожидает что в системе уже есть хотя бы один Trend.
  const anyTrend = await prisma.trend.findFirst({ select: { id: true } })
  if (!anyTrend) {
    throw createError({
      statusCode: 409,
      message:
        "В системе нет ни одного Trend. Создайте хотя бы один Trend перед импортом Drive-файлов.",
    })
  }

  const created = await prisma.scenario.create({
    data: {
      trendId: anyTrend.id,
      appId: opts.applicationId,
      status: "archived",
      operatorNotes: SYSTEM_SCENARIO_NAME,
    },
    select: { id: true },
  })
  return created.id
}

export async function importDriveFileToVideo(
  opts: ImportDriveFileOptions,
): Promise<ImportDriveFileResult> {
  const file = await prisma.driveFile.findUnique({ where: { id: opts.driveFileId } })
  if (!file) {
    throw createError({ statusCode: 404, message: "DriveFile не найден" })
  }
  if (file.userId !== opts.userId) {
    throw createError({ statusCode: 403, message: "Нет доступа к этому файлу" })
  }
  if (file.syncStatus !== "downloaded") {
    throw createError({
      statusCode: 409,
      message: "Сначала скачайте файл (download) — текущий статус: " + file.syncStatus,
    })
  }
  if (!file.localPath) {
    throw createError({ statusCode: 409, message: "У файла отсутствует localPath" })
  }
  if (file.videoId !== null && file.videoId !== undefined) {
    // Idempotent: возвращаем существующий video, не падаем.
    return {
      videoId: file.videoId,
      driveFileId: file.driveFileId,
      scenarioId: 0, // не релевантно, video уже есть
    }
  }

  // Format resolution
  let format: VideoFormat = "portrait"
  if (opts.format === "landscape") format = "landscape"
  // square → portrait (VideoFormat enum поддерживает только два)

  const scenarioId = await resolveScenarioId({
    scenarioId: opts.scenarioId,
    applicationId: opts.applicationId,
  })

  const result = await prisma.$transaction(async (tx) => {
    const video = await tx.video.create({
      data: {
        scenarioId,
        applicationId: opts.applicationId ?? null,
        status: "completed",
        filePath: file.localPath,
        fileUrl: null,
        format,
        isExternalCreative: true,
        externalSource: "google_drive",
        externalSourceId: file.driveFileId,
      },
      select: { id: true },
    })

    await tx.driveFile.update({
      where: { id: file.id },
      data: { videoId: video.id, syncStatus: "imported_to_video" },
    })

    return video
  })

  return {
    videoId: result.id,
    driveFileId: file.driveFileId,
    scenarioId,
  }
}
