import type { SceneStatus } from '~~/shared/types/scene'

export const useSceneFiltersStore = defineStore('sceneFilters', () => {
  const appId = ref<number | undefined>(undefined)
  const search = ref('')
  const status = ref<SceneStatus | ''>('')
  const showArchived = ref(false)

  const query = computed(() => ({
    ...(appId.value ? { appId: appId.value } : {}),
    ...(search.value.trim() ? { search: search.value.trim() } : {}),
    ...(status.value ? { status: status.value } : {}),
    ...(showArchived.value ? { archived: 1 } : {}),
  }))

  function reset() {
    search.value = ''
    status.value = ''
    showArchived.value = false
  }

  return { appId, search, status, showArchived, query, reset }
})
