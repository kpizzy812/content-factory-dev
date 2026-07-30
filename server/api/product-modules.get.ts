import { readLegacyModules } from "~~/shared/utils/legacy-modules"

/**
 * Карта включённых унаследованных зон для клиента. Это не секрет, а конфигурация
 * поставки: интерфейс не должен предлагать то, что сервер отдаёт как 404.
 */
export default defineEventHandler(() => {
  return { data: readLegacyModules(process.env) }
})
