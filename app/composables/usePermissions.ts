/**
 * Composable для проверки RBAC-прав текущего пользователя.
 *
 * Источник прав зависит от AUTH_PROVIDER: при local они лежат в своей БД, при
 * marketingcamp их перезаписывает родительская платформа на каждом входе.
 * Для проверок это неважно — сюда они приезжают одним и тем же ответом.
 * Загружает права с сервера через /api/auth/permissions и предоставляет проверки.
 *
 * Философия (зеркалит MarketingCamp useCapabilities):
 *   - can(perm) НЕ имеет admin bypass — каждый из 8 флагов проверяется реально.
 *     Это позволяет в MC создать "админа без canRunAgent" и UI это правильно отразит.
 *   - canAccessModule / canAccessApp / canAccessAccount имеют admin bypass —
 *     админ всегда видит все модули и приложения для управления.
 *
 * Fail-open: пока данные не загружены — все проверки возвращают true. Реальная
 * защита идёт от серверных guards (requirePermission/requireScopedAccess).
 */
interface AppAssignmentDto {
  appId: number
  appName: string
  accessLevel: string
  accounts: string
  geos: string
  permissions: string
}

interface PermissionsDto {
  rolePreset?: string
  roleName?: string | null
  rolePresetName?: string | null
  isActive?: boolean
  canRead?: boolean
  canWrite?: boolean
  canCreate?: boolean
  canDelete?: boolean
  canApprove?: boolean
  canRunAgent?: boolean
  canApplyChanges?: boolean
  canAdmin?: boolean
  moduleAccess?: string[]
  apps?: AppAssignmentDto[]
}

export function usePermissions() {
  const { data, refresh } = useFetch<{ data: PermissionsDto }>('/api/auth/permissions', {
    key: 'user-permissions',
  })

  const isLoaded = computed(() => !!data.value?.data)
  const dto = computed<PermissionsDto | null>(() => data.value?.data ?? null)

  function can(permission: keyof PermissionsDto): boolean {
    if (!isLoaded.value) return true
    return dto.value?.[permission] === true
  }

  function canAccessModule(slug: string): boolean {
    if (!isLoaded.value) return true
    if (dto.value?.canAdmin) return true
    return dto.value?.moduleAccess?.includes(slug) ?? false
  }

  function canAccessApp(appId: number): boolean {
    if (!isLoaded.value) return true
    if (dto.value?.canAdmin) return true
    const apps = dto.value?.apps ?? []
    const assignment = apps.find((a) => a.appId === appId)
    return !!assignment && assignment.accessLevel !== 'none'
  }

  function canAccessAccount(appId: number, accountName: string): boolean {
    if (!isLoaded.value) return true
    if (dto.value?.canAdmin) return true
    const apps = dto.value?.apps ?? []
    const assignment = apps.find((a) => a.appId === appId)
    if (!assignment || assignment.accessLevel === 'none') return false
    const accountsField = assignment.accounts.trim()
    if (accountsField === 'all' || accountsField === '') return true
    const allowed = accountsField.split(',').map((s) => s.trim()).filter(Boolean)
    return allowed.includes(accountName)
  }

  function getAccessibleAppIds(): number[] | null {
    if (!isLoaded.value) return null
    if (dto.value?.canAdmin) return null
    return (dto.value?.apps ?? [])
      .filter((a) => a.accessLevel !== 'none')
      .map((a) => a.appId)
  }

  return {
    permissions: data,
    isLoaded,
    can,
    canAccessModule,
    canAccessApp,
    canAccessAccount,
    getAccessibleAppIds,
    refresh,
  }
}
