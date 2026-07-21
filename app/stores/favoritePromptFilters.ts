import { defineStore } from 'pinia'
import type { FavoritePromptListQuery } from '~~/shared/types/favorite-prompt'

/**
 * Pinia store фильтров библиотеки избранных промтов.
 * appId может быть number | 'all' | 'null' (универсальные).
 */
export const useFavoritePromptFiltersStore = defineStore('favoritePromptFilters', () => {
  const appId = ref<number | 'all' | 'null'>('all')
  const tags = ref<string[]>([])
  const search = ref('')
  const page = ref(1)
  const perPage = ref(20)

  const query = computed<FavoritePromptListQuery>(() => {
    const q: FavoritePromptListQuery = {
      page: page.value,
      perPage: perPage.value,
    }
    if (appId.value !== 'all') q.appId = appId.value
    if (tags.value.length > 0) q.tags = tags.value.join(',')
    if (search.value.trim()) q.search = search.value.trim()
    return q
  })

  function resetPage() {
    page.value = 1
  }

  function setAppId(v: number | 'all' | 'null') {
    appId.value = v
    resetPage()
  }

  function setTags(v: string[]) {
    tags.value = v
    resetPage()
  }

  function setSearch(v: string) {
    search.value = v
    resetPage()
  }

  function setPage(v: number) {
    page.value = Math.max(1, v)
  }

  return {
    appId,
    tags,
    search,
    page,
    perPage,
    query,
    setAppId,
    setTags,
    setSearch,
    setPage,
  }
})
