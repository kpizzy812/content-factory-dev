import type { RolePreset } from "../../app/generated/prisma/client"

interface PresetValues {
  canRead: boolean
  canWrite: boolean
  canCreate: boolean
  canDelete: boolean
  canApprove: boolean
  canRunAgent: boolean
  canApplyChanges: boolean
  canAdmin: boolean
}

// Список модулей, которые знает ZavodCamp. Используется только для UI-справочника
// (отображение в админке, выбор модулей при создании прав в MC). Реальный moduleAccess
// пользователя приходит из MarketingCamp при логине.
export const ALL_MODULES = [
  "trendwatcher",
  "script-generator",
  "video-generator",
  "social-upload",
  "analytics",
  "pipeline",
] as const

export const ALL_MODULES_LIST: string[] = [...ALL_MODULES]

// ROLE_PRESETS — справочник для UI: показать пользователю "что значит роль X" в виде
// набора флагов. Реальные флаги пользователя приходят из MC напрямую через permissions
// блок и НЕ маппятся через этот справочник (один и тот же presetName в MC может иметь
// кастомные флаги, например "Админ Gregulas" с canAdmin=true но canRunAgent=false).
export const ROLE_PRESETS: Record<RolePreset, PresetValues> = {
  admin: {
    canRead: true,
    canWrite: true,
    canCreate: true,
    canDelete: true,
    canApprove: true,
    canRunAgent: true,
    canApplyChanges: true,
    canAdmin: true,
  },
  producer: {
    canRead: true,
    canWrite: true,
    canCreate: true,
    canDelete: false,
    canApprove: false,
    canRunAgent: true,
    canApplyChanges: false,
    canAdmin: false,
  },
  operator: {
    canRead: true,
    canWrite: true,
    canCreate: true,
    canDelete: false,
    canApprove: false,
    canRunAgent: false,
    canApplyChanges: false,
    canAdmin: false,
  },
  analyst: {
    canRead: true,
    canWrite: false,
    canCreate: false,
    canDelete: false,
    canApprove: false,
    canRunAgent: false,
    canApplyChanges: false,
    canAdmin: false,
  },
  observer: {
    canRead: true,
    canWrite: false,
    canCreate: false,
    canDelete: false,
    canApprove: false,
    canRunAgent: false,
    canApplyChanges: false,
    canAdmin: false,
  },
}

const VALID_PRESETS = new Set<string>(["admin", "producer", "operator", "analyst", "observer"])

// Подбирает rolePreset для UI badge на основе MC presetName и фактических permissions.
// Если MC отдал валидный presetName (admin/producer/operator/analyst/observer) — используем
// напрямую. Иначе кастомная роль ("Админ Gregulas", "Полный доступ" и т.п.) — подбираем
// ближайший по флагам для отображения. Реальные права берутся из permissions, а не из
// rolePreset — этот пресет нужен только для UI display в навбаре и фильтрах.
export function derivePresetFromPermissions(
  presetName: string | null | undefined,
  permissions: {
    canAdmin: boolean
    canDelete: boolean
    canApprove: boolean
    canCreate: boolean
    canWrite: boolean
    canRead: boolean
  },
): RolePreset {
  if (presetName && VALID_PRESETS.has(presetName)) {
    return presetName as RolePreset
  }
  if (permissions.canAdmin) return "admin"
  if (permissions.canDelete && permissions.canApprove) return "producer"
  if (permissions.canCreate || permissions.canWrite) return "operator"
  if (permissions.canRead) return "analyst"
  return "observer"
}
