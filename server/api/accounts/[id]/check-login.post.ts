/**
 * POST /api/accounts/:id/check-login
 *
 * ЗАГЛУШКА под Этап 3 (DuoPlus). Прежде запускал Indigo CDP/WebDriver-сессию,
 * открывал главную платформы и observe'ил логин (через browser-session +
 * cookies-restore + login-status). Весь web-DOM/CDP-слой выпилен в PR3 (DuoPlus =
 * облачный Android, у него нет браузерной login-проверки в текущем виде).
 *
 * Концепт login-check валиден и переедет на Этап 3 (проверка сессии приложения на
 * устройстве через ADB). До тех пор endpoint отвечает 501 engine_not_implemented —
 * осознанный feature-freeze браузерной автоматизации (api-постинг проверяет
 * сессию через OAuth refresh и этим endpoint'ом не пользуется).
 *
 * Permissions сохранены (canRead / social-upload) — гейт не ослабляется.
 */

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "social-upload",
  })

  const idRaw = getRouterParam(event, "id")
  const id = Number(idRaw)
  if (!idRaw || !Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, message: "Неверный ID аккаунта" })
  }

  throw createError({
    statusCode: 501,
    statusMessage: "engine_not_implemented",
    message:
      "Login-check через браузер заморожен на время миграции на DuoPlus (Этап 3). " +
      "Проверка сессии приложения на устройстве будет доступна после реализации " +
      "device-движка. Для api-аккаунтов сессия валидируется через OAuth refresh.",
    data: { code: "engine_not_implemented" },
  })
})
