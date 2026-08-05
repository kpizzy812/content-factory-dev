import { pageGuides } from '~/utils/guides'

/**
 * Единственный источник структуры навигации.
 *
 * Его читают сайдбар, хлебные крошки в топбаре, командная палитра и кнопка «?».
 * Раньше список пунктов был захардкожен в layouts/default.vue и продублирован
 * на главной — они расходились при каждой правке.
 *
 * Пункт, недоступный по правам или выключенному модулю, не отдаётся вообще:
 * в интерфейсе его не должно быть даже серым.
 */
export interface NavItem {
  to: string
  label: string
  icon: string
  /** Ключ подсказки в app/utils/guides.ts, если она есть. */
  guide?: string
  /** Ключ счётчика в useNavCounters. */
  counter?: string
  /** Счётчик означает «требует решения» и подсвечивается предупреждением. */
  counterWarns?: boolean
}

export interface NavGroup {
  key: string
  label: string
  items: NavItem[]
}

export function useAppNavigation() {
  const { can, canAccessModule } = usePermissions()
  const { legacyModules } = useLegacyModules()

  /** Конвейер стоит отдельно от групп — это главный раздел. */
  const primary = computed<NavItem | null>(() =>
    canAccessModule('pipeline')
      ? { to: '/pipeline', label: 'Конвейер', icon: 'mingcute:git-branch-line', counter: 'activeRuns' }
      : null,
  )

  /**
   * Подпункты конвейера.
   *
   * Общего экрана запусков (`/pipeline/runs`) пока нет — история живёт внутри
   * конкретного конвейера по `/pipeline/[id]/runs`. Пункт появится здесь вместе
   * с монитором запусков в этапе 6; ссылка на несуществующий маршрут сейчас
   * попала бы в `pipeline/[id]` с id="runs".
   */
  const primaryChildren = computed<NavItem[]>(() => [])

  const groups = computed<NavGroup[]>(() => {
    const result: NavGroup[] = []

    const production: NavItem[] = []
    if (canAccessModule('trendwatcher')) {
      production.push({ to: '/trends', label: 'Тренды', icon: 'mingcute:fire-line', guide: 'trends', counter: 'trends' })
    }
    if (canAccessModule('script-generator')) {
      production.push(
        { to: '/ideas', label: 'Идеи', icon: 'mingcute:bulb-line', guide: 'ideas' },
        { to: '/scenarios', label: 'Сценарии', icon: 'mingcute:document-line', guide: 'scenarios', counter: 'scenariosOnReview', counterWarns: true },
        { to: '/characters', label: 'Персонажи', icon: 'mingcute:user-3-line' },
        { to: '/scenes', label: 'Композитор сцен', icon: 'mingcute:layers-line' },
      )
    }
    if (canAccessModule('trendwatcher')) {
      production.push({ to: '/creatives', label: 'Креативы', icon: 'mingcute:pic-line' })
      if (legacyModules.value.googleDrive) {
        production.push({ to: '/google-drive', label: 'Google Drive', icon: 'mingcute:cloud-line' })
      }
    }
    if (canAccessModule('script-generator')) {
      production.push({ to: '/prompts-library', label: 'Лучшие промты', icon: 'mingcute:star-line' })
    }
    if (production.length) result.push({ key: 'production', label: 'Производство', items: production })

    const media: NavItem[] = []
    if (canAccessModule('video-generator')) {
      media.push({ to: '/videos', label: 'Видео', icon: 'mingcute:video-line', guide: 'videos', counter: 'videosFailed', counterWarns: true })
    }
    if (canAccessModule('social-upload')) {
      media.push({ to: '/uploads', label: 'Загрузки', icon: 'mingcute:upload-3-line', guide: 'uploads' })
      if (legacyModules.value.deviceAutomation) {
        media.push({ to: '/posting-jobs', label: 'Постинг', icon: 'mingcute:send-line', counter: 'postingQueued' })
      }
      media.push({ to: '/accounts', label: 'Аккаунты', icon: 'mingcute:group-line', counter: 'accountsAttention', counterWarns: true })
      if (legacyModules.value.proxyPool) {
        media.push({ to: '/proxies', label: 'Прокси', icon: 'mingcute:wifi-line' })
      }
      if (legacyModules.value.deviceAutomation) {
        media.push({ to: '/devices', label: 'Устройства', icon: 'mingcute:cellphone-line' })
      }
    }
    if (media.length) result.push({ key: 'media', label: 'Медиа', items: media })

    const analytics: NavItem[] = []
    if (canAccessModule('analytics')) {
      analytics.push(
        { to: '/analytics', label: 'Аналитика', icon: 'mingcute:chart-bar-line', guide: 'analytics' },
        { to: '/references', label: 'Референсы', icon: 'mingcute:bookmark-line' },
      )
    }
    if (analytics.length) result.push({ key: 'analytics', label: 'Аналитика', items: analytics })

    const system: NavItem[] = [{ to: '/settings', label: 'Настройки', icon: 'mingcute:settings-3-line' }]
    if (can('canAdmin')) {
      system.push({ to: '/admin', label: 'Админ', icon: 'mingcute:shield-line' })
    }
    result.push({ key: 'system', label: 'Система', items: system })

    return result
  })

  /** Плоский список для палитры и крошек. */
  const allItems = computed<Array<NavItem & { group?: string }>>(() => {
    const flat: Array<NavItem & { group?: string }> = []
    if (primary.value) flat.push({ ...primary.value })
    for (const child of primaryChildren.value) flat.push({ ...child, group: 'Конвейер' })
    for (const group of groups.value) {
      for (const item of group.items) flat.push({ ...item, group: group.label })
    }
    return flat
  })

  /** Самое длинное совпадение пути — иначе /pipeline перебивает /pipeline/runs. */
  function matchItem(path: string) {
    return allItems.value
      .filter(i => path === i.to || path.startsWith(`${i.to}/`))
      .sort((a, b) => b.to.length - a.to.length)[0] ?? null
  }

  function guideFor(path: string) {
    const key = matchItem(path)?.guide
    return key ? pageGuides[key] ?? null : null
  }

  return { primary, primaryChildren, groups, allItems, matchItem, guideFor }
}
