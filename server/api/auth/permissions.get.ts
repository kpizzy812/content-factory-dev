/**
 * GET /api/auth/permissions
 *
 * Возвращает полный RBAC-контекст текущего пользователя для клиента:
 * - rolePreset (для UI-бейджа)
 * - 8 boolean флагов (canRead/canWrite/...)
 * - moduleAccess (slugs модулей)
 * - apps (детальные UserAppAssignment записи: appId/appName/accessLevel/accounts/geos/permissions)
 *
 * Используется композаблом usePermissions для скрытия/disable UI элементов.
 */
export default defineEventHandler(async (event) => {
  const user = await getAuthContext(event)

  return {
    data: {
      rolePreset: user.rolePreset,
      roleName: user.roleName,
      rolePresetName: user.rolePresetName,
      isActive: user.isActive,
      canRead: user.canRead,
      canWrite: user.canWrite,
      canCreate: user.canCreate,
      canDelete: user.canDelete,
      canApprove: user.canApprove,
      canRunAgent: user.canRunAgent,
      canApplyChanges: user.canApplyChanges,
      canAdmin: user.canAdmin,
      moduleAccess: user.moduleAccess,
      apps: user.appAssignments.map((a) => ({
        appId: a.appId,
        appName: a.appName,
        accessLevel: a.accessLevel,
        accounts: a.accounts,
        geos: a.geos,
        permissions: a.permissions,
      })),
    },
  }
})
