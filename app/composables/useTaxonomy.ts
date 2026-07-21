/**
 * Composable для работы с taxonomy items.
 * Обеспечивает загрузку, кеширование, поиск и CRUD.
 */

interface TaxonomyItem {
  id: number
  type: string
  slug: string
  name: string
  shortDescription: string
  fullExplanation: string | null
  category: string | null
  tags: string[]
  examples: string[]
  useCases: string[]
  isSystem: boolean
  isArchived: boolean
  createdById: number | null
  createdAt: string
  updatedAt: string
}

interface TaxonomyMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
  categories: string[]
}

interface TaxonomyCreateInput {
  type: string
  name: string
  shortDescription: string
  fullExplanation?: string
  category?: string
  tags?: string[]
  examples?: string[]
  useCases?: string[]
}

export function useTaxonomy(type: MaybeRefOrGetter<string>) {
  const items = ref<TaxonomyItem[]>([])
  const categories = ref<string[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const searchQuery = ref('')
  const selectedCategory = ref<string | null>(null)

  async function load() {
    loading.value = true
    error.value = null
    try {
      const params: Record<string, string> = {
        type: toValue(type),
        perPage: '200',
      }
      if (selectedCategory.value) {
        params.category = selectedCategory.value
      }
      if (searchQuery.value.trim()) {
        params.search = searchQuery.value.trim()
      }

      const res = await $fetch<{ data: TaxonomyItem[]; meta: TaxonomyMeta }>('/api/taxonomy', {
        params,
      })
      items.value = res.data
      categories.value = res.meta.categories
    } catch (e: any) {
      error.value = e?.data?.message || e?.message || 'Ошибка загрузки'
    } finally {
      loading.value = false
    }
  }

  async function create(input: TaxonomyCreateInput): Promise<TaxonomyItem | null> {
    try {
      const res = await $fetch<{ data: TaxonomyItem }>('/api/taxonomy', {
        method: 'POST',
        body: { ...input, type: toValue(type) },
      })
      await load()
      return res.data
    } catch (e: any) {
      error.value = e?.data?.message || 'Ошибка создания'
      return null
    }
  }

  async function update(id: number, input: Partial<TaxonomyCreateInput> & { isArchived?: boolean }): Promise<TaxonomyItem | null> {
    try {
      const res = await $fetch<{ data: TaxonomyItem }>(`/api/taxonomy/${id}`, {
        method: 'PUT',
        body: input,
      })
      await load()
      return res.data
    } catch (e: any) {
      error.value = e?.data?.message || 'Ошибка обновления'
      return null
    }
  }

  async function remove(id: number): Promise<boolean> {
    try {
      await $fetch(`/api/taxonomy/${id}`, { method: 'DELETE' })
      await load()
      return true
    } catch (e: any) {
      error.value = e?.data?.message || 'Ошибка удаления'
      return false
    }
  }

  // Фильтрованный список (клиентская фильтрация для мгновенного отклика)
  const filtered = computed(() => {
    let result = items.value
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.trim().toLowerCase()
      result = result.filter(item =>
        item.name.toLowerCase().includes(q)
        || item.shortDescription.toLowerCase().includes(q)
        || item.tags.some(t => t.includes(q)),
      )
    }
    if (selectedCategory.value) {
      result = result.filter(item => item.category === selectedCategory.value)
    }
    return result
  })

  // Получить item по slug
  function getBySlug(slug: string): TaxonomyItem | undefined {
    return items.value.find(item => item.slug === slug)
  }

  // Получить все slugs (для совместимости с allowedValues)
  const slugs = computed(() => items.value.map(item => item.slug))

  // Загружаем при инициализации
  load()

  // Перезагружаем при смене типа
  watch(() => toValue(type), () => {
    selectedCategory.value = null
    searchQuery.value = ''
    load()
  })

  return {
    items,
    filtered,
    categories,
    loading,
    error,
    searchQuery,
    selectedCategory,
    slugs,
    load,
    create,
    update,
    remove,
    getBySlug,
  }
}

export type { TaxonomyItem, TaxonomyCreateInput }
