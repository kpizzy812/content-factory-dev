<script setup lang="ts">
import type { PostingJobDto } from '~~/shared/types/posting-job'

definePageMeta({
  layout: 'default',
  middleware: 'module-access',
  moduleSlug: 'social-upload',
})
useHead({ title: 'Очередь публикаций' })

/**
 * Очередь постинга относится к унаследованному контуру: при выключенной зоне её
 * API отдаёт 404, и это конфигурация, а не поломка. Говорим об этом прямо,
 * как на страницах прокси и устройств.
 *
 * Карта зон читается через `useFetch`, а не через `loadLegacyModules()`:
 * последний не ждёт ответа, поэтому сервер рисует страницу с выключенной зоной,
 * а клиент — с включённой, и Vue бросает поддерево при гидратации. Общее
 * состояние composable при этом заполняем — им пользуются модалки.
 */
import type { LegacyModuleMap } from '~~/shared/utils/legacy-modules'

const { legacyModules } = useLegacyModules()
const { data: modulesData } = await useFetch<{ data: LegacyModuleMap }>('/api/product-modules')
watchEffect(() => {
  if (modulesData.value?.data) legacyModules.value = modulesData.value.data
})
const zoneOff = computed(() => !modulesData.value?.data?.deviceAutomation)

const filters = usePostingJobFiltersStore()

// Прямая ссылка вида /posting-jobs?socialAccountId=N подхватывает фильтр —
// так из карточки аккаунта попадают в его очередь.
const route = useRoute()
const queryAccountId = computed(() => {
  const raw = route.query.socialAccountId
  if (typeof raw !== 'string') return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
})

onMounted(() => {
  if (queryAccountId.value !== null) {
    filters.socialAccountId = queryAccountId.value
    filters.offset = 0
  }
})

watch(queryAccountId, (n) => {
  if (n !== null && n !== filters.socialAccountId) {
    filters.socialAccountId = n
    filters.offset = 0
  }
})

const listRef = ref<{ reload: () => Promise<void> }>()

const cancelModalRef = ref<{ open: (job: PostingJobDto) => void }>()
const retryModalRef = ref<{ open: (job: PostingJobDto) => void }>()
const deleteModalRef = ref<{ open: (job: PostingJobDto) => void }>()
const logsModalRef = ref<{ open: (jobOrId: string | PostingJobDto, label?: string) => void }>()
const createModalRef = ref<{ open: () => void }>()
const bulkModalRef = ref<{ open: () => void }>()

async function reload() {
  await listRef.value?.reload()
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <template v-if="zoneOff">
      <div class="flex flex-wrap items-center gap-2">
        <h1 class="text-xl font-semibold">Очередь публикаций</h1>
      </div>
      <UiEmptyState
        variant="denied"
        title="Очередь постинга выключена"
        description="Зона относится к унаследованному контуру и включается флагом LEGACY_DEVICE_AUTOMATION_ENABLED в окружении."
      />
    </template>

    <template v-else>
      <PostingJobListView
        ref="listRef"
        @create="createModalRef?.open()"
        @bulk-create="bulkModalRef?.open()"
        @cancel="cancelModalRef?.open($event)"
        @retry="retryModalRef?.open($event)"
        @remove="deleteModalRef?.open($event)"
        @logs="logsModalRef?.open($event, $event.id.slice(0, 8))"
      />

      <PostingJobCancelModal ref="cancelModalRef" @cancelled="reload" />
      <PostingJobRetryConfirm ref="retryModalRef" @retried="reload" />
      <PostingJobDeleteModal ref="deleteModalRef" @deleted="reload" />
      <PostingJobLogsModal ref="logsModalRef" />
      <PostingJobCreateModal ref="createModalRef" @created="reload" />
      <PostingJobBulkCreateModal ref="bulkModalRef" @created="reload" />
    </template>
  </div>
</template>
