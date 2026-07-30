import { isLegacyPathBlocked, readLegacyModules } from "~~/shared/utils/legacy-modules"

/**
 * Гасит унаследованный контур на входе. 404, а не 403: наличие запрещённого
 * ТЗ device/proxy-пути не должно быть видно снаружи.
 */
export default defineEventHandler((event) => {
  const path = event.path || ""
  if (!path.startsWith("/api/")) return

  const modules = readLegacyModules(process.env)
  if (!isLegacyPathBlocked(path, modules)) return

  throw createError({ statusCode: 404, message: "Not Found" })
})
