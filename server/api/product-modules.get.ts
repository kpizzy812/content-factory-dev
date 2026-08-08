import { readLegacyModules } from "~~/shared/utils/legacy-modules"
import { resolveAuthProvider } from "~~/server/utils/auth/provider"

/**
 * Карта включённых унаследованных зон для клиента. Это не секрет, а конфигурация
 * поставки: интерфейс не должен предлагать то, что сервер отдаёт как 404.
 *
 * Здесь же провайдер авторизации. Он не зона и своим флагом не управляется, но
 * интерфейсу нужен по той же причине: пока установка живёт на AUTH_PROVIDER=local,
 * подписи вроде «права приходят из MarketingCamp» — неправда.
 */
export default defineEventHandler(() => {
  return {
    data: readLegacyModules(process.env),
    authProvider: resolveAuthProvider(process.env),
  }
})
