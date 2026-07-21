import type { MetricsResult } from "./social/types"

/**
 * Собирает метрики для опубликованных загрузок.
 * Сбор метрик бесплатный — НЕ требует requirePaidApisEnabled.
 *
 * @param uploadIds — если указаны, собирает только для этих загрузок;
 *                    иначе — для всех опубликованных.
 */
export async function collectMetrics(uploadIds?: number[]): Promise<{
  collected: number
  errors: Array<{ uploadId: number; error: string }>
}> {
  const where: Record<string, unknown> = {
    status: "published",
    platformPostId: { not: null },
  }

  if (uploadIds && uploadIds.length > 0) {
    where.id = { in: uploadIds }
  }

  const uploads = await prisma.upload.findMany({
    where,
    include: {
      socialAccount: true,
    },
  })

  let collected = 0
  const errors: Array<{ uploadId: number; error: string }> = []

  for (const upload of uploads) {
    try {
      if (!upload.platformPostId) continue

      // Manual аккаунты не имеют OAuth API token — метрики через OAuth недоступны.
      // Сбор статистики для них идёт через Apify profile scraper (AccountMetricsSnapshot).
      if (!upload.socialAccount.accessToken) {
        continue
      }

      const adapter = getSocialAdapter(upload.socialAccount.platform)

      const decryptedAccount = {
        id: upload.socialAccount.id,
        platform: upload.socialAccount.platform,
        displayName: upload.socialAccount.displayName,
        platformUserId: upload.socialAccount.platformUserId,
        accessToken: decrypt(upload.socialAccount.accessToken),
        refreshToken: upload.socialAccount.refreshToken
          ? decrypt(upload.socialAccount.refreshToken)
          : null,
        expiresAt: upload.socialAccount.expiresAt,
      }

      const metrics: MetricsResult = await adapter.getPostMetrics(
        decryptedAccount,
        upload.platformPostId,
      )

      await prisma.postMetrics.create({
        data: {
          uploadId: upload.id,
          views: metrics.views,
          likes: metrics.likes,
          comments: metrics.comments,
          shares: metrics.shares,
          watchThrough: metrics.watchThrough,
          ctr: metrics.ctr,
          followerGain: metrics.followerGain,
        },
      })

      collected++
    } catch (err) {
      const message = err instanceof Error ? err.message : "Неизвестная ошибка"
      errors.push({ uploadId: upload.id, error: message })
    }
  }

  return { collected, errors }
}
