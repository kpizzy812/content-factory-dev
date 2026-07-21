import type { WarmupSessionStatus } from "~~/shared/types/warmup"

/**
 * Фильтры списка WarmupSession: статусы (multi-select), accountId, диапазон дат, пагинация.
 * Используется страницей /warmup (если будет) и composable useWarmupSessions.
 */
export const useWarmupFiltersStore = defineStore("warmupFilters", () => {
  const statuses = ref<WarmupSessionStatus[]>([])
  const accountId = ref<number | null>(null)
  const from = ref<string>("")
  const to = ref<string>("")
  const limit = ref<number>(50)
  const offset = ref<number>(0)

  const query = computed<Record<string, string | number>>(() => {
    const q: Record<string, string | number> = {
      limit: limit.value,
      offset: offset.value,
    }
    if (statuses.value.length > 0) {
      q.status = statuses.value.join(",")
    }
    if (accountId.value && accountId.value > 0) {
      q.accountId = accountId.value
    }
    if (from.value) q.from = from.value
    if (to.value) q.to = to.value
    return q
  })

  function toggleStatus(s: WarmupSessionStatus) {
    const idx = statuses.value.indexOf(s)
    if (idx >= 0) {
      statuses.value.splice(idx, 1)
    } else {
      statuses.value.push(s)
    }
    offset.value = 0
  }

  function reset() {
    statuses.value = []
    accountId.value = null
    from.value = ""
    to.value = ""
    offset.value = 0
  }

  return {
    statuses,
    accountId,
    from,
    to,
    limit,
    offset,
    query,
    toggleStatus,
    reset,
  }
})
