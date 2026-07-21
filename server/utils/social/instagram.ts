import type { DecryptedAccount, MetricsResult, SocialPlatformAdapter, UploadParams, UploadResult } from "./types"

/**
 * Instagram Graph API адаптер.
 *
 * MVP-заглушка: Instagram интеграция требует Business/Creator аккаунт,
 * публичный URL для видео и одобрение Facebook App Review.
 * Полная реализация будет добавлена после прохождения ревью.
 */
export const instagramAdapter: SocialPlatformAdapter = {
  async uploadVideo(_account: DecryptedAccount, _params: UploadParams): Promise<UploadResult> {
    throw new Error(
      "Instagram интеграция в разработке. "
      + "Для публикации в Instagram необходим Business/Creator аккаунт "
      + "и одобрение Facebook App Review.",
    )
  },

  async getPostMetrics(_account: DecryptedAccount, _platformPostId: string): Promise<MetricsResult> {
    throw new Error(
      "Instagram аналитика в разработке. "
      + "Требуется одобрение Facebook App Review.",
    )
  },
}
