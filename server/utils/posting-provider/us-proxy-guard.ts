/**
 * US-proxy guard (Цикл M.4). Device-нейтрален (R3).
 *
 * Правило: SocialAccount можно привязывать к device-профилю только если у профиля
 * proxy.expectedCountry === "US". Защита от банов: профили под не-US прокси
 * легко детектятся anti-fraud сервисами соцсетей.
 *
 * Где валидируется: server-side в POST /indigo/profiles/[id]/accounts (не доверяем UI).
 * Без bypass — оператор должен сначала пометить прокси как US через /proxies UI.
 *
 * Note: гард проверяет operator-declared expectedCountry, не реальный IP geo.
 * Реальный leak/wrong-IP ловится отдельным deep proxy check (Уровень C).
 */

import { createError } from "h3"
import type { DeviceProxyCountryGuard } from "../../../shared/types/device-profile"

export interface ProxySnapshot {
  id: string | null
  expectedCountry?: string | null
}

/**
 * Pure compute — определяет статус guard'а без exceptions.
 * Используется и DTO mapper'ом (для UI badge), и assertUsProxyGuard (для 412).
 */
export function computeUsProxyGuard(
  proxy: ProxySnapshot | null | undefined,
  platformType?: string | null,
): DeviceProxyCountryGuard {
  // DuoPlus (Android cloud phone): прокси настроен на стороне устройства (Decodo US
  // и т.п.) — US-проверка ZC-прокси избыточна, не блокируем привязку аккаунтов.
  if (platformType === "mobile_android") return "us_proxy_ok"
  if (!proxy) return "no_proxy"
  if (proxy.expectedCountry === "US") return "us_proxy_ok"
  if (proxy.expectedCountry === null || proxy.expectedCountry === undefined
    || proxy.expectedCountry === "") return "unknown"
  return "wrong_country"
}

/**
 * Кидает 412 PRECONDITION_FAILED если профиль не проходит US-guard.
 * Возвращает void при PASS.
 * data.code — machine-readable причина для UI (no_proxy/wrong_country/unknown).
 */
export function assertUsProxyGuard(args: {
  profileId: string
  proxy: ProxySnapshot | null | undefined
  platformType?: string | null
}): void {
  const guard = computeUsProxyGuard(args.proxy, args.platformType)
  if (guard === "us_proxy_ok") return

  const messages: Record<Exclude<DeviceProxyCountryGuard, "us_proxy_ok">, string> = {
    no_proxy:
      "У профиля не задан прокси. Аккаунты можно привязывать только к профилям с US-proxy.",
    wrong_country: `Прокси профиля помечен как ${args.proxy?.expectedCountry ?? "неизвестно"}. Привязывать аккаунты можно только к US-proxy (защита от банов).`,
    unknown:
      "У прокси не задан expectedCountry. Установите 'US' в /proxies перед привязкой аккаунтов.",
  }

  throw createError({
    statusCode: 412,
    message: messages[guard],
    data: {
      code: guard,
      profileId: args.profileId,
      proxyId: args.proxy?.id ?? null,
      actualCountry: args.proxy?.expectedCountry ?? null,
    },
  })
}
