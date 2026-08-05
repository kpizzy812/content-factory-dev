import type { SavedViewDto } from '~~/shared/types/saved-view'

/**
 * Сохранённые представления списка.
 *
 * Три класса, у каждого своя роль:
 *   system   — задаются разделом в коде, неизменяемы, идут первыми
 *   shared   — рабочие очереди команды; обычный пользователь их не правит,
 *              а сохраняет копию себе через «Сохранить как свой»
 *   personal — ежедневный инструмент оператора
 *
 * Закрепление вида по умолчанию — личная настройка и живёт в localStorage:
 * трендвотчер и оператор публикации заходят в один раздел за разным, а
 * отдельная таблица ради одной строки на человека не нужна.
 */
export interface SystemView {
  key: string
  name: string
  query: Record<string, unknown>
  columns?: string[]
}

export function useSavedViews(section: string, systemViews: SystemView[]) {
  const { can } = usePermissions()
  const toast = useToast()

  const canManageShared = computed(() => can('canAdmin'))

  const { data, pending, refresh } = useFetch<{ data: SavedViewDto[] }>('/api/saved-views', {
    query: { section },
    key: `saved-views-${section}`,
    default: () => ({ data: [] }),
  })

  const system = computed<SavedViewDto[]>(() =>
    systemViews.map(v => ({
      id: `system:${v.key}`,
      section,
      name: v.name,
      scope: 'system' as const,
      query: v.query,
      columns: v.columns ?? null,
      ownerId: null,
      ownerName: null,
      updatedAt: null,
    })),
  )

  const shared = computed(() => data.value?.data.filter(v => v.scope === 'shared') ?? [])
  const personal = computed(() => data.value?.data.filter(v => v.scope === 'personal') ?? [])
  const all = computed(() => [...system.value, ...shared.value, ...personal.value])

  const defaultKey = `saved-view-default-${section}`
  const activeId = ref<string | number>(system.value[0]?.id ?? '')
  /** Фильтры отличаются от сохранённых — показываем «вид изменён». */
  const dirty = ref(false)

  const active = computed(() => all.value.find(v => String(v.id) === String(activeId.value)) ?? null)

  onMounted(() => {
    const saved = localStorage.getItem(defaultKey)
    if (saved) activeId.value = saved
  })

  function select(id: string | number) {
    activeId.value = id
    dirty.value = false
  }

  function pinDefault(id: string | number) {
    localStorage.setItem(defaultKey, String(id))
    toast.success('Представление открывается по умолчанию')
  }

  async function create(name: string, query: Record<string, unknown>, scope: 'shared' | 'personal', columns?: string[] | null) {
    const res = await $fetch<{ data: SavedViewDto }>('/api/saved-views', {
      method: 'POST',
      body: { section, name, scope, query, columns },
    })
    await refresh()
    activeId.value = res.data.id
    dirty.value = false
    return res.data
  }

  async function update(id: number, patch: { name?: string, query?: Record<string, unknown>, columns?: string[] | null }) {
    await $fetch(`/api/saved-views/${id}`, { method: 'PUT', body: patch })
    await refresh()
    dirty.value = false
  }

  async function remove(id: number) {
    await $fetch(`/api/saved-views/${id}`, { method: 'DELETE' })
    if (String(activeId.value) === String(id)) select(system.value[0]?.id ?? '')
    await refresh()
  }

  return {
    system, shared, personal, all,
    pending, refresh,
    active, activeId, dirty,
    canManageShared,
    select, pinDefault, create, update, remove,
  }
}
