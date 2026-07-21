/**
 * Параметры загрузки видео на платформу.
 */
export interface UploadParams {
  filePath: string
  title: string
  description: string
  hashtags: string[]
  /** true для YouTube Shorts (видео 9:16) */
  isShort: boolean
}

/**
 * Результат успешной загрузки видео.
 */
export interface UploadResult {
  platformPostId: string
  platformPostUrl: string
}

/**
 * Расшифрованный аккаунт соцсети для передачи адаптеру.
 * accessToken nullable: manual аккаунты публикуются через Indigo browser automation,
 * без OAuth API. Адаптеры обязаны падать с понятной ошибкой, если null.
 */
export interface DecryptedAccount {
  id: number
  platform: string
  displayName: string
  platformUserId: string | null
  accessToken: string | null
  refreshToken: string | null
  expiresAt: Date | null
}

/**
 * Результат сбора метрик поста с платформы.
 */
export interface MetricsResult {
  views: number
  likes: number
  comments: number
  shares: number
  watchThrough: number
  ctr: number
  followerGain: number
}

/**
 * Общий интерфейс адаптера социальной платформы.
 * Каждая платформа (YouTube, TikTok, Instagram) реализует этот интерфейс.
 */
export interface SocialPlatformAdapter {
  uploadVideo(account: DecryptedAccount, params: UploadParams): Promise<UploadResult>
  getPostMetrics(account: DecryptedAccount, platformPostId: string): Promise<MetricsResult>
}
