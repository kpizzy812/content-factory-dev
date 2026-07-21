/**
 * Предохранитель от случайных публикаций в соцсети.
 *
 * По умолчанию загрузка видео в соцсети ЗАБЛОКИРОВАНА.
 * Для включения -- установить ENABLE_SOCIAL_POSTING=true в .env
 */
export function requireSocialPostingEnabled(platform: string): void {
  if (process.env.ENABLE_SOCIAL_POSTING !== "true") {
    throw createError({
      statusCode: 403,
      message: `Публикация в соцсети отключена. Платформа "${platform}" заблокирована. Установите ENABLE_SOCIAL_POSTING=true в .env для включения.`,
    })
  }
}
