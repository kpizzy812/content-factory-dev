export interface UploadProgress {
  containerId?: string
  postId?: string
  postUrl?: string
}

/**
 * Параметры загрузки видео на платформу.
 */
export interface UploadParams {
  filePath: string
  fileUrl?: string | null
  storageKey?: string | null
  title: string
  description: string
  hashtags: string[]
  /** true для YouTube Shorts (видео 9:16) */
  isShort: boolean
  /** Настройки конкретных платформ, зафиксированные в Upload. */
  platformOptions?: Record<string, unknown> | null
  /** Состояние незавершённой внешней публикации для безопасного retry. */
  resume?: UploadProgress
  /** Сохраняет внешний container/post id сразу после каждого шага. */
  onProgress?: (progress: UploadProgress) => Promise<void>
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
 * accessToken nullable: адаптер официального API обязан падать с понятной
 * ошибкой и просить переподключить OAuth, если токена нет.
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
 *
 * `watchThrough` и `ctr` — доли в диапазоне 0…1, а не проценты: так их отдают
 * платформы и так они называются (доля досмотра, click-through *rate*).
 * Интерфейс умножает на сто сам — см. `app/components/analytics/AnalyticsFormat.ts`.
 */
export interface MetricsResult {
  views: number
  likes: number
  comments: number
  shares: number
  /** Доля досмотра, 0…1. */
  watchThrough: number
  /** Доля переходов, 0…1. */
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
