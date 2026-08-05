/**
 * Проверка доступа к модулю без выброса ошибки.
 *
 * `requireModuleAccess` из rbac.ts отвечает на вопрос «пускать ли на страницу»
 * и кидает 403. Агрегирующим эндпоинтам нужно другое: пройти по нескольким
 * разделам и молча пропустить те, которых человек не видит. Возврат 403 там
 * означал бы, что оператор без доступа к постингу вообще не получит сводку.
 *
 * Правило bypass повторяет rbac.ts: у модулей администратор видит всё, потому
 * что он ими управляет. Логика вынесена сюда, чтобы не расходиться между
 * /api/dashboard/summary и /api/search.
 */
export interface ModuleGateUser {
  canAdmin?: boolean
  moduleAccess?: string[] | null
}

export function moduleGate(user: ModuleGateUser | null | undefined) {
  const allowed = new Set(user?.moduleAccess ?? [])
  const isAdmin = user?.canAdmin === true

  return function has(slug: string): boolean {
    if (isAdmin) return true
    return allowed.has(slug)
  }
}
