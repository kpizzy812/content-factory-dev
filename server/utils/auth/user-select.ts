/**
 * Поля ZavodUser, которые можно отдавать наружу. Явный select, а не модель
 * целиком: passwordHash не должен попасть ни в один ответ API.
 */
export const PUBLIC_USER_SELECT = {
  id: true,
  externalId: true,
  email: true,
  name: true,
  surname: true,
  rolePreset: true,
  roleName: true,
  rolePresetName: true,
  canRead: true,
  canWrite: true,
  canCreate: true,
  canDelete: true,
  canApprove: true,
  canRunAgent: true,
  canApplyChanges: true,
  canAdmin: true,
  moduleAccess: true,
  telegramChatId: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const
