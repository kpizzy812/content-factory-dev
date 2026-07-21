/**
 * Конфигурация RBAC: метки, модули, пресеты.
 * Переиспользуется в компонентах админки.
 */
export function useRbacConfig() {
  const presetLabels: Record<string, string> = {
    admin: 'Администратор',
    producer: 'Продюсер',
    operator: 'Оператор',
    analyst: 'Аналитик',
    observer: 'Наблюдатель',
  }

  const allModules = [
    { slug: 'pipeline', label: 'Конвейер' },
    { slug: 'trendwatcher', label: 'Трендвотчер' },
    { slug: 'script-generator', label: 'Генератор сценариев' },
    { slug: 'video-generator', label: 'Генератор видео' },
    { slug: 'social-upload', label: 'Загрузка в соцсети' },
    { slug: 'analytics', label: 'Аналитика' },
  ]

  const permissionLabels: Record<string, string> = {
    canRead: 'Чтение',
    canWrite: 'Запись',
    canCreate: 'Создание',
    canDelete: 'Удаление',
    canApprove: 'Утверждение',
    canRunAgent: 'Запуск агентов',
    canApplyChanges: 'Применение изменений',
    canAdmin: 'Администрирование',
  }

  const allModuleSlugs = allModules.map(m => m.slug)

  const presetValues: Record<string, { permissions: Record<string, boolean>; modules: string[] }> = {
    admin: {
      permissions: { canRead: true, canWrite: true, canCreate: true, canDelete: true, canApprove: true, canRunAgent: true, canApplyChanges: true, canAdmin: true },
      modules: allModuleSlugs,
    },
    producer: {
      permissions: { canRead: true, canWrite: true, canCreate: true, canDelete: false, canApprove: false, canRunAgent: true, canApplyChanges: false, canAdmin: false },
      modules: allModuleSlugs,
    },
    operator: {
      permissions: { canRead: true, canWrite: true, canCreate: true, canDelete: false, canApprove: false, canRunAgent: false, canApplyChanges: false, canAdmin: false },
      modules: allModuleSlugs,
    },
    analyst: {
      permissions: { canRead: true, canWrite: false, canCreate: false, canDelete: false, canApprove: false, canRunAgent: false, canApplyChanges: false, canAdmin: false },
      modules: ['trendwatcher', 'analytics'],
    },
    observer: {
      permissions: { canRead: true, canWrite: false, canCreate: false, canDelete: false, canApprove: false, canRunAgent: false, canApplyChanges: false, canAdmin: false },
      modules: ['trendwatcher'],
    },
  }

  return { presetLabels, allModules, permissionLabels, presetValues }
}
