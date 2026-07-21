/**
 * Pipeline executor: google_drive_scanner.
 *
 * Сканирует Drive folder через syncDriveFiles (Этап 1) и возвращает массив
 * driveFileIds (БД-id) для downstream video_analyzer ноды. Поддерживает
 * onlyUnlabeled (default true) — фильтр по hasGeneratedCaption=false.
 *
 * Если папка пуста или все видео уже размечены — возвращает _noData=true,
 * engine классифицирует step как `no_data`.
 */
import { prisma } from "./prisma"
import { syncDriveFiles } from "./google-drive/sync"
import { throwIfAborted } from "./pipeline-cancel-registry"

interface GoogleDriveScannerConfig {
  credentialId: number
  folderId: string
  onlyUnlabeled?: boolean
  batchSize?: number
}

const FOLDER_ID_PATTERN = /^[\w-]{10,}$/

function validateConfig(config: Record<string, unknown>): GoogleDriveScannerConfig {
  const credentialId = Number(config.credentialId ?? Number.NaN)
  if (!Number.isFinite(credentialId) || credentialId <= 0) {
    throw new Error("GoogleDriveScanner: credentialId обязателен и должен быть >0")
  }
  const folderId = String(config.folderId ?? "").trim()
  if (!folderId || !FOLDER_ID_PATTERN.test(folderId)) {
    throw new Error("GoogleDriveScanner: folderId обязателен (минимум 10 символов, только [A-Za-z0-9_-])")
  }
  const onlyUnlabeled = config.onlyUnlabeled === undefined ? true : Boolean(config.onlyUnlabeled)
  let batchSize = Number(config.batchSize ?? 10)
  if (!Number.isFinite(batchSize) || batchSize < 1) batchSize = 10
  if (batchSize > 100) batchSize = 100
  return { credentialId, folderId, onlyUnlabeled, batchSize }
}

/**
 * Pre-flight RBAC: проверяет что юзер имеет canRunAgent + module trendwatcher.
 * Engine не делает scoped check внутри executor'ов, поэтому защищаемся здесь.
 */
async function preflightRbac(userId: number): Promise<void> {
  const user = await prisma.zavodUser.findUnique({
    where: { id: userId },
    select: { canRunAgent: true, canAdmin: true, moduleAccess: true, isActive: true },
  })
  if (!user || !user.isActive) {
    throw new Error("GoogleDriveScanner: пользователь не найден или деактивирован")
  }
  // canRunAgent проверяется независимо от canAdmin — синхрон с философией MC
  // (см. server/utils/rbac.ts:requirePermission). Если в MC у админа canRunAgent=false,
  // то и pipeline scanner запустить нельзя, и это правильное поведение.
  if (!user.canRunAgent) {
    throw new Error("GoogleDriveScanner: нет разрешения canRunAgent")
  }
  // moduleAccess проверка пропускается для админов (как в requireModuleAccess) —
  // canAdmin даёт доступ ко всем модулям для управления, включая trendwatcher.
  if (!user.canAdmin && !user.moduleAccess.includes("trendwatcher")) {
    throw new Error("GoogleDriveScanner: нет доступа к модулю trendwatcher")
  }
}

export async function executeGoogleDriveScannerNode(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const cfg = validateConfig(config)

  // Resolve userId через WorkflowRun → Pipeline.userId
  const runId = Number(input._runId)
  if (!Number.isFinite(runId) || runId <= 0) {
    throw new Error("GoogleDriveScanner: _runId не передан в input")
  }
  const run = await prisma.workflowRun.findUnique({
    where: { id: runId },
    select: { pipeline: { select: { userId: true } } },
  })
  const userId = run?.pipeline?.userId
  if (!userId) {
    throw new Error("GoogleDriveScanner: запуск не имеет владельца (Pipeline.userId)")
  }

  await preflightRbac(userId)
  throwIfAborted(signal)

  // Запускаем sync — обновляет/создаёт DriveFile записи под этой credential.
  const syncResult = await syncDriveFiles({
    credentialId: cfg.credentialId,
    userId,
    folderId: cfg.folderId,
    onlyVideos: true,
    pageSize: 100,
  })

  throwIfAborted(signal)

  // Подбираем кандидатов в БД.
  const candidates = await prisma.driveFile.findMany({
    where: {
      credentialId: cfg.credentialId,
      userId,
      mimeType: { startsWith: "video/" },
      ...(cfg.onlyUnlabeled ? { hasGeneratedCaption: false } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: cfg.batchSize,
    select: {
      id: true,
      name: true,
      syncStatus: true,
      mimeType: true,
      driveFileId: true,
    },
  })

  if (candidates.length === 0) {
    return {
      driveFileIds: [],
      count: 0,
      scannedTotal: syncResult.scanned,
      _noData: true,
      _domainStatus: "no_data",
      _noDataReason: "Нет неразмеченных видео в Drive folder",
    }
  }

  return {
    driveFileIds: candidates.map((c) => c.id),
    count: candidates.length,
    scannedTotal: syncResult.scanned,
    syncCreated: syncResult.created,
    syncUpdated: syncResult.updated,
    syncErrors: syncResult.errors.length,
    files: candidates.map((c) => ({
      id: c.id,
      name: c.name,
      syncStatus: c.syncStatus,
      driveFileId: c.driveFileId,
    })),
  }
}
