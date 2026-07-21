/**
 * PUT /api/device-profiles/:id/accounts/:accountId/primary
 *
 * DISABLED (410 Gone): при 1:1:1 модели у профиля всегда максимум один аккаунт,
 * который автоматически является primary. Endpoint оставлен физически чтобы
 * клиенты, кэширующие URL, получали понятный gone-статус (не 404), и для
 * возможности отката если решение 1:1:1 будет пересмотрено.
 *
 * Permissions: canWrite (для единообразия с другими mutating endpoints).
 */

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "social-upload",
  })

  throw createError({
    statusCode: 410,
    statusMessage: "endpoint_disabled",
    data: {
      code: "primary_endpoint_disabled",
      message:
        "Эндпойнт отключён: в 1:1:1 модели у профиля всегда один аккаунт, который автоматически primary.",
      suggestion:
        "Используйте DELETE /accounts/:accountId + POST /accounts для смены привязки.",
    },
  })
})
