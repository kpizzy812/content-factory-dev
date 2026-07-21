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
  <div class="card bg-base-100 border border-base-300 shadow-sm">
    <div class="card-body p-3 gap-2">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <fieldset class="fieldset">
          <legend class="fieldset-legend text-xs">Приложение</legend>
          <select
            v-model="appIdValue"
            class="select select-sm w-full"
          >
            <option value="all">Все</option>
            <option value="null">Универсальные</option>
            <option
              v-for="a in apps"
              :key="a.id"
              :value="String(a.id)"
            >
              {{ a.name }}
            </option>
          </select>
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend text-xs">Теги</legend>
          <SharedTagInput
            :model-value="filters.tags"
            placeholder="Enter чтобы добавить"
            @update:model-value="(v) => filters.setTags(v)"
          />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend text-xs">Поиск</legend>
          <input
            v-model="searchDebounced"
            type="text"
            class="input input-sm w-full"
            placeholder="В тексте и заметках"
          />
        </fieldset>
      </div>
    </div>
  </div>
</template>
