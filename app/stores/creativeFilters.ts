export const useCreativeFiltersStore = defineStore('creativeFilters', () => {
  const type = ref<string>('all')
  const status = ref<string>('')
  const appId = ref<number | undefined>(undefined)
  const page = ref<number>(1)
  const perPage = ref<number>(20)

  const query = computed(() => ({
    ...(type.value && type.value !== 'all' ? { type: type.value } : {}),
    ...(status.value ? { status: status.value } : {}),
    ...(appId.value ? { appId: appId.value } : {}),
    page: page.value,
    perPage: perPage.value,
  }))

  function resetPage() {
    page.value = 1
  }

  function resetFilters() {
    type.value = 'all'
    status.value = ''
    appId.value = undefined
    page.value = 1
  }

  return { type, status, appId, page, perPage, query, resetPage, resetFilters }
})
