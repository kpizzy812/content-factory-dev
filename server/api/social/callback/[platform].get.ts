/**
 * GET /api/social/callback/:platform
 *
 * OAuth callback отключён вместе с connect-endpoint'ом. Manual creation
 * (POST /api/accounts) — единственный путь добавления аккаунта.
 *
 * Endpoint оставлен для возможного будущего использования.
 */
export default defineEventHandler(() => {
  throw createError({
    statusCode: 410,
    message:
      "OAuth callback отключён. Используйте ручное создание аккаунта (Аккаунты → Добавить аккаунт).",
  })
})
