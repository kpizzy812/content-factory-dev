/**
 * GET /api/social/connect/:platform
 *
 * OAuth flow отключён для manual-account workflow (покупные аккаунты).
 * Аккаунты создаются вручную через POST /api/accounts + AccountCreateModal,
 * публикация идёт через Indigo browser automation, а не через OAuth API.
 *
 * Endpoint оставлен для возможного будущего использования.
 */
export default defineEventHandler(() => {
  throw createError({
    statusCode: 410,
    message:
      "OAuth flow отключён. Используйте ручное создание аккаунта (Аккаунты → Добавить аккаунт).",
  })
})
