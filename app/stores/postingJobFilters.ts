import type {
  PostingJobStatus,
  PostingPlatform,
} from "~~/shared/types/posting-job"

/**
 * Фильтры списка PostingJob: статусы (multi-select), платформа, аккаунт, пагинация.
 * Используются страницей /posting-jobs и composable usePostingJobs.
 */
export const usePostingJobFiltersStore = defineStore(
  "postingJobFilters",
  () => {
    const statuses = ref<PostingJobStatus[]>([])
    const platform = ref<PostingPlatform | "">("")
    const socialAccountId = ref<number | null>(null)
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
      if (platform.value) {
        q.platform = platform.value
      }
      if (socialAccountId.value && socialAccountId.value > 0) {
        q.socialAccountId = socialAccountId.value
      }
      return q
    })

    function toggleStatus(s: PostingJobStatus) {
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
      platform.value = ""
      socialAccountId.value = null
      offset.value = 0
    }

    return {
      statuses,
      platform,
      socialAccountId,
      limit,
      offset,
      query,
      toggleStatus,
      reset,
    }
  },
)
