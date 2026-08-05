<script setup lang="ts">
/**
 * Фильтры библиотеки: приложение (все / универсальные / конкретное),
 * теги (TagInput), поиск по тексту/заметкам.
 */
const filters = useFavoritePromptFiltersStore()

const { data: appsData } = useFetch<{ data: Array<{ id: number, name: string }> }>(
  '/api/apps',
  { default: () => ({ data: [] }) },
)

const apps = computed(() => appsData.value?.data ?? [])

const appIdValue = computed({
  get: () => {
    if (filters.appId === 'all') return 'all'
    if (filters.appId === 'null') return 'null'
    return String(filters.appId)
  },
  set: (v: string) => {
    if (v === 'all') filters.setAppId('all')
    else if (v === 'null') filters.setAppId('null')
    else {
      const n = Number(v)
      if (Number.isFinite(n) && n > 0) filters.setAppId(n)
    }
  },
})

const searchDebounced = ref(filters.search)
let searchTimer: ReturnType<typeof setTimeout> | null = null

watch(searchDebounced, (v) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    filters.setSearch(v)
  }, 300)
})
</script>

<template>
  <div class="grid gap-2 sm:grid-cols-3">
    <UiField label="Приложение">
      <UiSelect
        v-model="appIdValue"
        :options="[
          { value: 'all', label: 'Все' },
          { value: 'null', label: 'Универсальные' },
          ...apps.map(a => ({ value: String(a.id), label: a.name })),
        ]"
      />
    </UiField>

    <UiField label="Теги">
      <SharedTagInput
        :model-value="filters.tags"
        placeholder="Enter чтобы добавить"
        @update:model-value="(v) => filters.setTags(v)"
      />
    </UiField>

    <UiField label="Поиск">
      <UiInput v-model="searchDebounced" placeholder="В тексте и заметках" />
    </UiField>
  </div>
</template>
