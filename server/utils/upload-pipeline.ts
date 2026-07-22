import type { DecryptedAccount } from "./social/types"
import { getSocialAdapter } from "./social/factory"
import { sendTelegramAlert } from "./telegram/alerts"
import { syncFactoryPublicationFromUpload } from "./factory-publication"

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
 */
async function updateUploadStatus(
  uploadId: number,
  status: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  await prisma.upload.update({
    where: { id: uploadId },
    data: { status: status as never, ...extra },
  })
  await syncFactoryPublicationFromUpload(uploadId)
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

/**
 * Оркестрация загрузки одного видео в одну соцсеть.
 * Запускается fire-and-forget, обновляет статусы в БД.
 */
export async function runUploadPipeline(uploadId: number): Promise<void> {
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

    if (!upload.video) {
      throw new Error(`Видео для Upload ${uploadId} не найдено`)
    }

    if (!upload.socialAccount) {
      throw new Error(`Аккаунт для Upload ${uploadId} не найден`)
    }

    if (!upload.video.filePath) {
      throw new Error(`Видео ${upload.video.id} не имеет файла для загрузки`)
    }

    if (upload.socialAccount.status !== "active") {
      throw new Error(
        `Аккаунт ${upload.socialAccount.displayName} неактивен (${upload.socialAccount.status})`,
      )
    }

    if (!upload.socialAccount.accessToken) {
      throw new Error(
        `Аккаунт ${upload.socialAccount.displayName} создан вручную (без OAuth). ` +
          `Публикация через OAuth API недоступна — используйте Indigo browser automation (PostingJob).`,
      )
    }

    // 2. Проверить env guard — без throw, с корректным статусом
    if (!isSocialPostingEnabled()) {
      await updateUploadStatus(uploadId, "blocked_by_env", {
        blockedByEnv: true,
        errorMessage: `Публикация отключена (ENABLE_SOCIAL_POSTING=false). Платформа: ${upload.socialAccount.platform}`,
      })
      return
    }

    // 3. Расшифровать токены
    const decrypted = decryptAccount(upload.socialAccount)

    // 4. Обновить статус -> uploading, инкрементировать attemptCount
    const newAttemptCount = upload.attemptCount + 1
    await updateUploadStatus(uploadId, "uploading", {
      attemptCount: newAttemptCount,
      lastAttemptAt: new Date(),
      blockedByEnv: false,
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
        filePath: upload.video.filePath,
        title: upload.title,
        description: upload.description || "",
        hashtags: upload.hashtags,
        isShort: isShortVideo(upload.video.format),
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
    }).catch(() => {})
  }
}
