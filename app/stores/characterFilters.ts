export const useCharacterFiltersStore = defineStore('characterFilters', () => {
  const appId = ref<number | undefined>(undefined)
  const search = ref('')
  const showArchived = ref(false)

  const query = computed(() => ({
    ...(appId.value ? { appId: appId.value } : {}),
    ...(search.value.trim() ? { search: search.value.trim() } : {}),
    ...(showArchived.value ? { archived: 1 } : {}),
  }))

  function reset() {
    search.value = ''
    showArchived.value = false
  }

  return { appId, search, showArchived, query, reset }
})
