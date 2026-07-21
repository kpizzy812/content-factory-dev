/**
 * Pipeline executor: google_drive_uploader.
 *
 * Sink-нода, которая берёт `input.videos` из upstream (после executeVideoNode)
 * и заливает каждый mp4 в указанный Google Drive folder через Service Account
 * (multipart upload). Сохраняет driveFileId/driveCredentialId в Video для
 * идемпотентности — повторный запуск на тех же видео при skipIfAlreadyUploaded
 * пропускает уже залитые.
 *
 * 403 от Drive интерпретируется как "нет прав writer на папку" — failure
 * содержит client_email сервис-аккаунта чтобы юзер расшарил папку.
 */
import { readFile, stat as fsStat } from "node:fs/promises"
import { isAbsolute, join, resolve, sep } from "node:path"
import { prisma } from "./prisma"
import { throwIfAborted } from "./pipeline-cancel-registry"
import { getUploadsBase } from "./storage-paths"
import {
  exchangeServiceAccountForToken,
  multipartUploadRequest,
  classifyDriveError,
  type ServiceAccountJson,
} from "./google-drive/client"
import { decryptDriveServiceAccount } from "./google-drive/credential"

const FOLDER_ID_PATTERN = /^[\w-]{10,}$/
const FILENAME_BAD_CHARS = /[\x00-\x1f<>:"/\\|?*]/g
const MAX_FILENAME_LEN = 255
const MAX_TEMPLATE_LEN = 200
const SOFT_SIZE_WARN_BYTES = 150 * 1024 * 1024
const DRIVE_UPLOAD_SCOPES = ["https://www.googleapis.com/auth/drive.file"]

interface GoogleDriveUploaderConfig {
  credentialId: number
  folderId: string
  nameTemplate: string
  skipIfAlreadyUploaded: boolean
}

interface VideoInput {
  id: number
  title?: string | null
}

interface UploadFailure {
  videoId: number
  reason: string
}

const DEFAULT_TEMPLATE = '{video.title || "video-" + video.id}.mp4'

function validateConfig(config: Record<string, unknown>): GoogleDriveUploaderConfig {
  const credentialId = Number(config.credentialId ?? Number.NaN)
  if (!Number.isFinite(credentialId) || credentialId <= 0) {
    throw new Error("GoogleDriveUploader: credentialId обязателен и должен быть >0")
  }
  const folderId = String(config.folderId ?? "").trim()
  if (!folderId || !FOLDER_ID_PATTERN.test(folderId)) {
    throw new Error("GoogleDriveUploader: folderId обязателен (минимум 10 символов, только [A-Za-z0-9_-])")
  }
  let nameTemplate = typeof config.nameTemplate === "string" && config.nameTemplate.trim().length > 0
    ? config.nameTemplate.trim()
    : DEFAULT_TEMPLATE
  if (nameTemplate.length > MAX_TEMPLATE_LEN) {
    nameTemplate = nameTemplate.slice(0, MAX_TEMPLATE_LEN)
  }
  const skipIfAlreadyUploaded = config.skipIfAlreadyUploaded === undefined
    ? true
    : Boolean(config.skipIfAlreadyUploaded)
  return { credentialId, folderId, nameTemplate, skipIfAlreadyUploaded }
}

async function preflightRbac(userId: number): Promise<void> {
  const user = await prisma.zavodUser.findUnique({
    where: { id: userId },
    select: { canRunAgent: true, canAdmin: true, moduleAccess: true, isActive: true },
  })
  if (!user || !user.isActive) {
    throw new Error("GoogleDriveUploader: пользователь не найден или деактивирован")
  }
  if (!user.canRunAgent) {
    throw new Error("GoogleDriveUploader: нет разрешения canRunAgent")
  }
  if (!user.canAdmin && !user.moduleAccess.includes("trendwatcher")) {
    throw new Error("GoogleDriveUploader: нет доступа к модулю trendwatcher")
  }
}

/**
 * Простая шаблонизация: поддерживает выражения {video.title}, {video.id}
 * и единственный fallback-оператор `||`. Не парсит произвольные JS-выражения.
 */
function applyNameTemplate(template: string, video: VideoInput): string {
  return template.replace(/\{([^}]+)\}/g, (_, expr: string) => {
    const trimmed = expr.trim()
    // Поддержка a || b || c — берём первое непустое после resolve
    const parts = trimmed.split("||").map((p) => p.trim())
    for (const part of parts) {
      const value = resolveTemplatePart(part, video)
      if (value !== undefined && value !== null && String(value).length > 0) {
        return String(value)
      }
    }
    return ""
  })
}

function resolveTemplatePart(part: string, video: VideoInput): unknown {
  // Строковый литерал в кавычках
  if (
    (part.startsWith('"') && part.endsWith('"')) ||
    (part.startsWith("'") && part.endsWith("'"))
  ) {
    return part.slice(1, -1)
  }
  // video.title или video.id
  if (part === "video.title") return video.title ?? ""
  if (part === "video.id") return String(video.id)
  // Выражение со склейкой через `+`
  if (part.includes("+")) {
    const segments = part.split("+").map((s) => s.trim())
    return segments.map((s) => resolveTemplatePart(s, video) ?? "").join("")
  }
  return undefined
}

function sanitizeFilename(raw: string, fallbackId: number): string {
  let name = raw.replace(FILENAME_BAD_CHARS, "").trim()
  if (name.length === 0) name = `video-${fallbackId}.mp4`
  if (name.length > MAX_FILENAME_LEN) name = name.slice(0, MAX_FILENAME_LEN)
  return name
}

function resolveAbsolutePath(filePath: string): string | null {
  const storageBase = getUploadsBase()
  const candidate = isAbsolute(filePath) ? filePath : join(storageBase, filePath)
  const resolved = resolve(candidate)
  if (resolved !== storageBase && !resolved.startsWith(storageBase + sep)) {
    return null
  }
  return resolved
}

function uploaderFailure(videoId: number, reason: string): UploadFailure {
  return { videoId, reason }
}

interface UploaderResult {
  videos: unknown[]
  driveFileIds: string[]
  uploadedCount: number
  skippedCount: number
  failedCount: number
  failures: UploadFailure[]
  _noData?: boolean
  _domainStatus?: string
  _noDataReason?: string
}

export async function executeGoogleDriveUploaderNode(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const cfg = validateConfig(config)

  const runId = Number(input._runId)
  if (!Number.isFinite(runId) || runId <= 0) {
    throw new Error("GoogleDriveUploader: _runId не передан в input")
  }
  const run = await prisma.workflowRun.findUnique({
    where: { id: runId },
    select: { pipeline: { select: { userId: true } } },
  })
  const userId = run?.pipeline?.userId
  if (!userId) {
    throw new Error("GoogleDriveUploader: запуск не имеет владельца (Pipeline.userId)")
  }

  await preflightRbac(userId)
  throwIfAborted(signal)

  const rawVideos = Array.isArray(input.videos) ? (input.videos as unknown[]) : []
  if (rawVideos.length === 0) {
    return {
      videos: [],
      driveFileIds: [],
      uploadedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      failures: [],
      _noData: true,
      _domainStatus: "no_data",
      _noDataReason: "Нет видео на входе",
    } satisfies UploaderResult as Record<string, unknown>
  }

  // Decrypt SA + получить токен с drive.file scope
  const { serviceAccount } = await decryptDriveServiceAccount(cfg.credentialId, userId)
  let accessToken: string
  try {
    const tokenResp = await exchangeServiceAccountForToken(serviceAccount, DRIVE_UPLOAD_SCOPES)
    accessToken = tokenResp.accessToken
  } catch (err) {
    const classified = classifyDriveError(err)
    throw new Error(`GoogleDriveUploader: не удалось получить access_token (${classified.message})`)
  }

  const driveFileIds: string[] = []
  const failures: UploadFailure[] = []
  let uploadedCount = 0
  let skippedCount = 0
  let failedCount = 0

  for (const rawVideo of rawVideos) {
    throwIfAborted(signal)

    const videoIdRaw = (rawVideo as { id?: unknown })?.id
    const videoId = Number(videoIdRaw)
    if (!Number.isFinite(videoId) || videoId <= 0) {
      failures.push(uploaderFailure(0, "Видео без id во входных данных"))
      failedCount += 1
      continue
    }

    const dbVideo = await prisma.video.findUnique({
      where: { id: videoId },
      select: {
        id: true,
        filePath: true,
        driveFileId: true,
        driveCredentialId: true,
        scenario: {
          select: {
            selectedVariantId: true,
            variants: {
              select: { id: true, title: true, variantIndex: true },
              orderBy: { variantIndex: "asc" },
            },
          },
        },
      },
    })
    if (!dbVideo) {
      failures.push(uploaderFailure(videoId, "Видео не найдено в БД"))
      failedCount += 1
      continue
    }
    const selectedVariant = dbVideo.scenario.variants.find(
      (v) => v.id === dbVideo.scenario.selectedVariantId,
    ) ?? dbVideo.scenario.variants[0] ?? null
    const titleForTemplate = selectedVariant?.title ?? null

    if (cfg.skipIfAlreadyUploaded && dbVideo.driveFileId) {
      skippedCount += 1
      driveFileIds.push(dbVideo.driveFileId)
      continue
    }

    if (!dbVideo.filePath) {
      failures.push(uploaderFailure(videoId, "Видео без filePath"))
      failedCount += 1
      continue
    }

    const absPath = resolveAbsolutePath(dbVideo.filePath)
    if (!absPath) {
      failures.push(uploaderFailure(videoId, "Недопустимый путь файла"))
      failedCount += 1
      continue
    }

    let fileSize: number
    try {
      const stats = await fsStat(absPath)
      if (!stats.isFile()) {
        failures.push(uploaderFailure(videoId, "Путь указывает не на файл"))
        failedCount += 1
        continue
      }
      fileSize = stats.size
    } catch {
      failures.push(uploaderFailure(videoId, "Файл не найден на диске"))
      failedCount += 1
      continue
    }

    if (fileSize > SOFT_SIZE_WARN_BYTES) {
      console.warn(
        `[GoogleDriveUploader] видео ${videoId} превышает 150 МБ (${fileSize} байт) — multipart может быть медленным/ненадёжным`,
      )
    }

    let fileBuffer: Buffer
    try {
      fileBuffer = await readFile(absPath)
    } catch {
      failures.push(uploaderFailure(videoId, "Не удалось прочитать файл"))
      failedCount += 1
      continue
    }

    const rawName = applyNameTemplate(cfg.nameTemplate, {
      id: dbVideo.id,
      title: titleForTemplate,
    })
    const sanitizedName = sanitizeFilename(rawName, dbVideo.id)

    try {
      const response = await multipartUploadRequest<{ id: string; name?: string }>(
        accessToken,
        "/upload/drive/v3/files?uploadType=multipart",
        {
          name: sanitizedName,
          parents: [cfg.folderId],
          mimeType: "video/mp4",
        },
        fileBuffer,
        "video/mp4",
      )

      if (!response?.id) {
        failures.push(uploaderFailure(videoId, "Drive вернул пустой id файла"))
        failedCount += 1
        continue
      }

      await prisma.video.update({
        where: { id: videoId },
        data: {
          driveFileId: response.id,
          driveCredentialId: cfg.credentialId,
        },
      })
      driveFileIds.push(response.id)
      uploadedCount += 1
    } catch (err) {
      const classified = classifyDriveError(err)
      let reason: string
      if (classified.statusCode === 403) {
        const email = pickClientEmail(serviceAccount)
        reason = `Нет прав writer на папку. Расшарьте папку на ${email} с ролью Editor.`
      } else {
        reason = classified.message
      }
      failures.push(uploaderFailure(videoId, reason))
      failedCount += 1
    }
  }

  return {
    videos: rawVideos,
    driveFileIds,
    uploadedCount,
    skippedCount,
    failedCount,
    failures,
  }
}

function pickClientEmail(sa: ServiceAccountJson): string {
  return sa.client_email || "service-account"
}
