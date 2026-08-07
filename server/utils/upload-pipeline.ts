import type { DecryptedAccount, UploadProgress } from "./social/types"
import type { UploadRunTrigger } from "./upload-rerun-guard"
import { getSocialAdapter } from "./social/factory"
import { sendTelegramAlert } from "./telegram/alerts"
import { syncFactoryPublicationFromUpload } from "./factory-publication"
import { checkUploadRerun, planFailedUploadAttemptPatch } from "./upload-rerun-guard"
import { MAX_UPLOAD_ATTEMPTS, isPermanentUploadError } from "./upload-retry-policy"

/**
 * Расшифровывает токены аккаунта.
 */
function decryptAccount(account: {
  id: number
  platform: string
  displayName: string
  platformUserId: string | null
  accessToken: string | null
  refreshToken: string | null
  expiresAt: Date | null
}): DecryptedAccount {
  return {
    id: account.id,
    platform: account.platform,
    displayName: account.displayName,
    platformUserId: account.platformUserId,
    accessToken: account.accessToken ? decrypt(account.accessToken) : null,
    refreshToken: account.refreshToken ? decrypt(account.refreshToken) : null,
    expiresAt: account.expiresAt,
  }
}

/**
 * Обновляет статус загрузки в БД.
 *
 * @param onPersisted вызывается сразу после успешной записи строки, до
 * синхронизации публикации фабрики. Нужен вызывающему, чтобы отличить «в БД не
 * записалось» от «записалось, но упал следующий шаг».
 */
async function updateUploadStatus(
  uploadId: number,
  status: string,
  extra?: Record<string, unknown>,
  onPersisted?: () => void,
): Promise<void> {
  await prisma.upload.update({
    where: { id: uploadId },
    data: { status: status as never, ...extra },
  })
  // Строка уже обновлена, и записанный attemptCount никуда не денется, даже
  // если синхронизация ниже упадёт. Поэтому сообщаем о попытке здесь, а не
  // после возврата из функции: иначе обработчик ошибки посчитал бы её второй
  // раз и один реальный заход съедал бы две из трёх автопопыток.
  onPersisted?.()
  await syncFactoryPublicationFromUpload(uploadId)
}

async function saveUploadProgress(
  uploadId: number,
  progress: UploadProgress,
): Promise<void> {
  const data: Record<string, unknown> = {}
  if (progress.containerId) data.platformContainerId = progress.containerId
  if (progress.postId) data.platformPostId = progress.postId
  if (progress.postUrl) data.platformPostUrl = progress.postUrl
  if (Object.keys(data).length === 0) return
  await prisma.upload.update({
    where: { id: uploadId },
    data: data as never,
  })
}

function objectOptions(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/**
 * Определяет, является ли видео вертикальным (Shorts/Reels).
 */
function isShortVideo(format: string): boolean {
  return format === "portrait"
}

/**
 * Проверяет, включены ли социальные публикации.
 * Возвращает boolean вместо throw.
 */
function isSocialPostingEnabled(): boolean {
  return process.env.ENABLE_SOCIAL_POSTING === "true"
}

/**
 * Создаёт запись попытки загрузки.
 */
async function createUploadAttempt(
  uploadId: number,
  attemptNumber: number,
  requestSnapshot?: Record<string, unknown>,
) {
  return prisma.socialUploadAttempt.create({
    data: {
      uploadId,
      attemptNumber,
      status: "running",
      requestSnapshot: (requestSnapshot || undefined) as never,
      startedAt: new Date(),
    },
  })
}

/**
 * Обновляет запись попытки загрузки.
 */
async function updateUploadAttempt(
  attemptId: number,
  data: Record<string, unknown>,
) {
  await prisma.socialUploadAttempt.update({
    where: { id: attemptId },
    data: data as never,
  })
}

export interface RunUploadPipelineOptions {
  /**
   * Кто запустил прогон. По умолчанию "auto": планировщик и оркестратор зовут
   * пайплайн без аргументов, и безопасный режим должен быть у них, а не у
   * человека. "manual" ставят только обработчики, за которыми стоит клик
   * оператора.
   */
  trigger?: UploadRunTrigger
}

/**
 * Оркестрация загрузки одного видео в одну соцсеть.
 * Запускается fire-and-forget, обновляет статусы в БД.
 */
export async function runUploadPipeline(
  uploadId: number,
  options: RunUploadPipelineOptions = {},
): Promise<void> {
  const trigger: UploadRunTrigger = options.trigger ?? "auto"
  // Ранние падения (нет токена, аккаунт выключен, нет файла) происходят до
  // шага 4, где попытка учитывается. Без этого флага такие загрузки уходили в
  // failed с attemptCount=0 и пустым lastAttemptAt — автоповтор крутил бы их
  // без пауз и без лимита.
  let attemptCounted = false
  // Каким станет attemptCount после этого прогона. Нужен в catch, чтобы
  // терминальную ошибку вывести из выборки планировщика, не занизив счётчик.
  let attemptCountAfterRun = 0
  try {
    // 1. Загрузить Upload + Video + SocialAccount из БД
    const upload = await prisma.upload.findUnique({
      where: { id: uploadId },
      include: {
        video: true,
        socialAccount: true,
      },
    })

    if (!upload) {
      throw new Error(`Upload ${uploadId} не найден`)
    }

    attemptCountAfterRun = upload.attemptCount + 1

    if (!upload.video) {
      throw new Error(`Видео для Upload ${uploadId} не найдено`)
    }

    if (!upload.socialAccount) {
      throw new Error(`Аккаунт для Upload ${uploadId} не найден`)
    }

    if (!upload.video.filePath && !upload.video.fileUrl && !upload.video.storageKey) {
      throw new Error(`Видео ${upload.video.id} не имеет сохранённого файла для загрузки`)
    }

    if (upload.socialAccount.status !== "active") {
      throw new Error(
        `Аккаунт ${upload.socialAccount.displayName} неактивен (${upload.socialAccount.status})`,
      )
    }

    if (!upload.socialAccount.accessToken) {
      throw new Error(
        `Аккаунт ${upload.socialAccount.displayName} не подключён через официальный OAuth. ` +
          `Переподключите аккаунт на странице аккаунтов.`,
      )
    }

    // 2. Проверить env guard — без throw, с корректным статусом.
    // Обещание в тексте держит upload-scheduler: он поднимает blocked_by_env
    // обратно в очередь, как только флаг включат.
    if (!isSocialPostingEnabled()) {
      await updateUploadStatus(uploadId, "blocked_by_env", {
        blockedByEnv: true,
        errorMessage:
          `Публикация отключена (ENABLE_SOCIAL_POSTING=false). Платформа: ${upload.socialAccount.platform}. `
          + `Загрузка вернётся в очередь автоматически, как только флаг включат.`,
      })
      return
    }

    // 2.5. Защита от дубля поста на площадках без идемпотентного resume.
    // Повтор после потерянного ответа платформы заливает второй ролик на канал
    // клиента, и удалять его придётся руками, поэтому автоматический прогон
    // здесь останавливаем и оставляем решение человеку.
    const rerun = checkUploadRerun({
      platform: upload.socialAccount.platform,
      attemptCount: upload.attemptCount,
      trigger,
    })
    if (!rerun.allowed) {
      await updateUploadStatus(uploadId, "failed", {
        errorMessage: rerun.reason.slice(0, 1000),
        // Дотягиваем счётчик до лимита: иначе планировщик будет забирать эту
        // запись каждые пять минут и держать место в пачке до скончания века.
        attemptCount: MAX_UPLOAD_ATTEMPTS,
        lastAttemptAt: new Date(),
        blockedByEnv: false,
      })
      await sendTelegramAlert(
        "critical_error",
        `Автоповтор публикации остановлен: ${upload.title}`,
        rerun.reason,
      ).catch(() => {})
      return
    }

    // 3. Расшифровать токены
    const decrypted = decryptAccount(upload.socialAccount)

    // 4. Обновить статус -> uploading, инкрементировать attemptCount.
    // Флаг ставим колбэком изнутри, а не после await: между записью строки и
    // возвратом из функции есть ещё один шаг (синхронизация публикации
    // фабрики), и его падение не должно приводить к повторному инкременту.
    const newAttemptCount = attemptCountAfterRun
    await updateUploadStatus(uploadId, "uploading", {
      attemptCount: newAttemptCount,
      lastAttemptAt: new Date(),
      blockedByEnv: false,
    }, () => {
      attemptCounted = true
    })

    // 5. Создать запись попытки
    const attempt = await createUploadAttempt(uploadId, newAttemptCount, {
      platform: upload.socialAccount.platform,
      accountId: upload.socialAccount.id,
      accountName: upload.socialAccount.displayName,
      videoId: upload.video.id,
      title: upload.title,
    })

    // 6. Получить адаптер и загрузить
    const adapter = getSocialAdapter(upload.socialAccount.platform)

    try {
      const result = await adapter.uploadVideo(decrypted, {
        filePath: upload.video.filePath || "",
        fileUrl: upload.video.fileUrl,
        storageKey: upload.video.storageKey,
        title: upload.title,
        description: upload.description || "",
        hashtags: upload.hashtags,
        isShort: isShortVideo(upload.video.format),
        platformOptions: objectOptions(upload.platformOptions),
        resume: {
          containerId: upload.platformContainerId ?? undefined,
          postId: upload.platformPostId ?? undefined,
          postUrl: upload.platformPostUrl ?? undefined,
        },
        onProgress: progress => saveUploadProgress(uploadId, progress),
      })

      // 7. Успех: обновить Upload и attempt
      await updateUploadStatus(uploadId, "published", {
        platformPostId: result.platformPostId,
        platformPostUrl: result.platformPostUrl,
      })

      await updateUploadAttempt(attempt.id, {
        status: "published",
        finishedAt: new Date(),
        externalPostId: result.platformPostId,
        responseSnapshot: {
          platformPostUrl: result.platformPostUrl,
          resumed: Boolean(upload.platformContainerId || upload.platformPostId),
        },
      })

      await sendTelegramAlert(
        "upload_success",
        `Видео загружено в ${upload.socialAccount.platform}: ${upload.title}`,
        result.platformPostUrl || undefined,
      )
    } catch (uploadError) {
      // Ошибка на уровне платформы
      const msg = uploadError instanceof Error ? uploadError.message : "Неизвестная ошибка загрузки"

      await updateUploadAttempt(attempt.id, {
        status: "failed",
        finishedAt: new Date(),
        errorMessage: msg.slice(0, 1000),
      })

      throw uploadError
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Неизвестная ошибка"

    await updateUploadStatus(uploadId, "failed", {
      errorMessage: message.slice(0, 1000),
      // Точка отсчёта backoff-а для автоповтора должна стоять всегда.
      lastAttemptAt: new Date(),
      // Терминальную ошибку выводим из выборки планировщика прямо в БД —
      // почему именно так, расписано в planFailedUploadAttemptPatch.
      ...planFailedUploadAttemptPatch({
        permanent: isPermanentUploadError(message),
        attemptCounted,
        attemptCountAfterRun,
      }),
    }).catch(() => {})
  }
}
