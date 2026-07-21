/**
 * POST /api/device-profiles/:id/start
 *
 * Этап 3 (P6): включение облачного Android-устройства DuoPlus через
 * `cloudPhone/powerOn`. Заменяет R5a-заглушку 501.
 *
 * ⚠️ ДЕНЬГИ: включённое устройство тарифицируется DuoPlus поминутно (running-время).
 * UI обязан показывать предупреждение «выключайте после использования».
 *
 * Семантика ответа (как у старого launcher-флоу): эндпоинт НЕ ждёт ~75с пока
 * устройство дойдёт до status=1 — это блокировало бы HTTP-запрос. Вместо этого
 * powerOn принимается (DuoPlus кладёт устройство в очередь старта), мы возвращаем
 * state:"started" сразу, а реальный last-known статус устройства UI читает из
 * config.duoplus.deviceStatus (наполняется device-sync). Оператор жмёт
 * «Синхронизация» чтобы увидеть переход 2→10→1.
 *
 * Контракт обёртки {data,error}: фронт (useDeviceActions/useDeviceStartFlow)
 * всегда получает 200 с {data} либо {error} — избегаем Cloudflare-интерсепта 5xx.
 * RBAC: canRunAgent + module social-upload. Ownership-гейт как у других device-эндпоинтов.
 */
import type { DeviceStartProfileResponse } from "~~/shared/types/device-profile"
import { DuoplusApiError, getDuoplusClient } from "~~/server/utils/posting-provider/duoplus-client"

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ["canRunAgent"],
    moduleSlug: "social-upload",
  })

  const id = getRouterParam(event, "id")
  const profile = await requireProfileOwnership(id, user)

  const imageId = profile.indigoId
  if (!imageId) {
    return {
      data: null,
      error: {
        statusCode: 400,
        message: "Устройство не привязано к DuoPlus (нет image_id). Сначала синхронизируйте парк устройств.",
        phase: "validate",
        indigoStatus: 0,
        indigoBody: null,
        url: "",
        method: "start",
      },
    }
  }

  try {
    const client = getDuoplusClient()
    const result = await client.powerOn([imageId])

    if (!result.success.includes(imageId)) {
      const reason = result.fail_reason?.[imageId] ?? "DuoPlus отклонил powerOn"
      return {
        data: null,
        error: {
          statusCode: 502,
          message: `Не удалось включить устройство: ${reason}`,
          phase: "power_on",
          indigoStatus: 502,
          indigoBody: result as unknown,
          url: "/api/v1/cloudPhone/powerOn",
          method: "start",
        },
      }
    }

    // Помечаем начало сессии (для sessionState/totalSessions в UI). Реальный
    // adb-порт у A1 (REST-only) не используется — оставляем null.
    await prisma.deviceProfile.update({
      where: { id: profile.id },
      data: {
        lastSessionStartedAt: new Date(),
        lastSessionPort: null,
        totalSessions: { increment: 1 },
      },
    })

    const response: DeviceStartProfileResponse = {
      state: "started",
      port: null,
      profileId: profile.id,
      indigoId: imageId,
      message: "Устройство включается (status 2→10→1). Нажмите «Синхронизация» для обновления статуса.",
    }
    return { data: response, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const httpStatus = err instanceof DuoplusApiError ? err.httpStatus : 0
    return {
      data: null,
      error: {
        statusCode: 502,
        message: `Ошибка DuoPlus при включении устройства: ${message}`,
        phase: "power_on",
        indigoStatus: httpStatus,
        indigoBody: null,
        url: "/api/v1/cloudPhone/powerOn",
        method: "start",
      },
    }
  }
})
