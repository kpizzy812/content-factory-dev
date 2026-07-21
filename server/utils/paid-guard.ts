/**
 * Предохранитель от случайных вызовов платных API.
 *
 * По умолчанию все платные сервисы ЗАБЛОКИРОВАНЫ.
 * Для включения — установить ENABLE_PAID_APIS=true в .env
 *
 * Платные сервисы:
 * - Anthropic Claude API (генерация сценариев, промпты для изображений)
 * - fal.ai (генерация изображений и видеоклипов)
 * - Mubert (генерация музыки)
 */

export function requirePaidApisEnabled(serviceName: string): void {
  if (process.env.ENABLE_PAID_APIS !== "true") {
    throw createError({
      statusCode: 403,
      message: `Платные API отключены. Сервис "${serviceName}" заблокирован. Установите ENABLE_PAID_APIS=true в .env для включения.`,
    })
  }
}
