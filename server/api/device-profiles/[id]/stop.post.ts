/**
 * POST /api/device-profiles/:id/stop
 *
 * Этап 3 (P6): выключение облачного Android-устройства DuoPlus через
 * `cloudPhone/powerOff`. Заменяет R5a-заглушку 501.
 *
 * Выключение ОСТАНАВЛИВАЕТ тарификацию устройства — это «безопасная» операция,
 * её результат всегда применяется к БД (фиксируем конец сессии), даже если
 * powerOff частично не прошёл (recovery-pathway для рассинхрона БД↔DuoPlus).
 *
 * Контракт обёртки {data,error}: всегда 200. RBAC + ownership как у start.
 */
import { DuoplusApiError, getDuoplusClient } from "~~/server/utils/posting-provider/duoplus-client"
import { refreshDeviceStatusFromRemote } from "~~/server/utils/posting-provider/sync"
import { DUOPLUS_DEVICE_STATUS } from "~~/server/utils/posting-provider/duoplus-types"

/** Верификация выключения: поллим статус до OFF (раз панель DuoPlus операторам недоступна). */
const STOP_VERIFY_TIMEOUT_MS = 25_000
const STOP_VERIFY_POLL_MS = 4_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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
        message: "Устройство не привязано к DuoPlus (нет image_id).",
        phase: "validate",
        indigoStatus: 0,
        indigoBody: null,
        url: "",
        method: "stop",
      },
    }
  }

  // Фиксируем конец сессии в БД ВСЕГДА (даже при ошибке powerOff): оператор не
  // должен застрять с «running» в UI. powerOff — best-effort поверх этого.
  await prisma.deviceProfile.update({
    where: { id: profile.id },
    data: { lastSessionEndedAt: new Date(), lastSessionPort: null },
  })

  try {
    const client = getDuoplusClient()
    const result = await client.powerOff([imageId])

    if (!result.success.includes(imageId) && result.fail.includes(imageId)) {
      const reason = result.fail_reason?.[imageId] ?? "DuoPlus отклонил powerOff"
      return {
        data: null,
        error: {
          statusCode: 502,
          message: `Не удалось выключить устройство: ${reason}. БД-сессия закрыта.`,
          phase: "power_off",
          indigoStatus: 502,
          indigoBody: result as unknown,
          url: "/api/v1/cloudPhone/powerOff",
          method: "stop",
        },
      }
    }

    // Верификация + обновление UI-бейджа: powerOff на DuoPlus асинхронен
    // (устройство ON→…→OFF не мгновенно). Раз панель DuoPlus операторам недоступна,
    // наш UI обязан показать РЕАЛЬНОЕ выключение — поллим статус до OFF и обновляем
    // config.duoplus.deviceStatus, чтобы бейдж не висел старым «Включено».
    let deviceStatus: number | null = null
    const deadline = Date.now() + STOP_VERIFY_TIMEOUT_MS
    let first = true
    while (Date.now() < deadline) {
      if (!first) await sleep(STOP_VERIFY_POLL_MS)
      first = false
      try {
        deviceStatus = await refreshDeviceStatusFromRemote(profile.id, imageId)
      } catch {
        continue // транзиентный сбой list — повторим
      }
      // OFF(2) или устройства нет в списке(null) — выключение подтверждено.
      if (deviceStatus === DUOPLUS_DEVICE_STATUS.OFF || deviceStatus === null) break
    }

    return { data: { stopped: true, deviceStatus }, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const httpStatus = err instanceof DuoplusApiError ? err.httpStatus : 0
    return {
      data: null,
      error: {
        statusCode: 502,
        message: `Ошибка DuoPlus при выключении устройства: ${message}. БД-сессия закрыта.`,
        phase: "power_off",
        indigoStatus: httpStatus,
        indigoBody: null,
        url: "/api/v1/cloudPhone/powerOff",
        method: "stop",
      },
    }
  }
})
