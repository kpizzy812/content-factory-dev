<script setup lang="ts">
import {
  POSTING_JOB_STATUSES,
  POSTING_PLATFORMS,
  type PostingJobDto,
  type PostingJobStatus,
  type PostingPlatform,
} from "~~/shared/types/posting-job"

definePageMeta({
  layout: "default",
  middleware: "module-access",
  moduleSlug: "social-upload",
})
useHead({ title: "Очередь постинга" })

const filters = usePostingJobFiltersStore()

// URL → store sync: прямые ссылки вида /posting-jobs?socialAccountId=N
// (например, чип PostingJob с UploadCard) подхватывают фильтр.
// Однонаправленно: store → URL не зеркалим, чтобы не плодить лишний роутинг.
const route = useRoute()
const queryAccountId = computed(() => {
  const raw = route.query.socialAccountId
  if (typeof raw !== "string") return null
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

const {
  jobs,
  total,
  engine,
  pending,
  error,
  refresh,
  hasActiveJobs,
} = usePostingJobs()

const { data: statsData, refresh: refreshStats } = usePostingJobStats()

const stats = computed(() => statsData.value?.data ?? null)

// Modals refs
const cancelModalRef = ref<{ open: (job: PostingJobDto) => void }>()
const retryModalRef = ref<{ open: (job: PostingJobDto) => void }>()
const deleteModalRef = ref<{ open: (job: PostingJobDto) => void }>()
const logsModalRef = ref<{
  open: (jobOrId: string | PostingJobDto, label?: string) => void
}>()
const createModalRef = ref<{ open: () => void }>()
const bulkModalRef = ref<{ open: () => void }>()

// --- Bulk-выбор ---
const { can } = usePermissions()
const canDelete = computed(() => can("canDelete"))
const selectMode = ref(false)
const selectedIds = ref<string[]>([])

function toggleSelectMode() {
  selectMode.value = !selectMode.value
  if (!selectMode.value) selectedIds.value = []
}

function onToggleSelect(job: PostingJobDto) {
  const idx = selectedIds.value.indexOf(job.id)
  if (idx >= 0) selectedIds.value.splice(idx, 1)
  else selectedIds.value.push(job.id)
}

function clearSelection() {
  selectedIds.value = []
}

function isSelected(id: string): boolean {
  return selectedIds.value.includes(id)
}

async function onBulkDeleted() {
  selectedIds.value = []
  await reloadAll()
}

// SocialAccountId search input
const socialAccountInput = ref<string>(
  filters.socialAccountId ? String(filters.socialAccountId) : "",
)
let searchTimeout: ReturnType<typeof setTimeout> | null = null
watch(socialAccountInput, (val) => {
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    const n = Number(val)
    filters.socialAccountId = Number.isFinite(n) && n > 0 ? n : null
    filters.offset = 0
  }, 300)
})

// При URL-sync обновляем input, чтобы оператор видел в поле фильтра
// тот же ID, что в URL.
watch(
  () => filters.socialAccountId,
  (val) => {
    const s = val ? String(val) : ""
    if (socialAccountInput.value !== s) socialAccountInput.value = s
  },
)

const statusOptions: { value: PostingJobStatus; label: string }[] = [
  { value: "scheduled", label: "Запланирован" },
  { value: "queued", label: "В очереди" },
  { value: "preparing", label: "Подготовка" },
  { value: "uploading", label: "Загрузка" },
  { value: "published", label: "Опубликовано" },
  { value: "failed", label: "Ошибка" },
  { value: "retry_queued", label: "Retry" },
  { value: "cancelled", label: "Отменён" },
]

const platformOptions: { value: PostingPlatform | ""; label: string }[] = [
  { value: "", label: "Все платформы" },
  { value: "tiktok", label: "TikTok" },
  { value: "instagram", label: "Instagram" },
  { value: "youtube", label: "YouTube" },
]

function isStatusActive(s: PostingJobStatus): boolean {
  return filters.statuses.includes(s)
}

function toggleStatus(s: PostingJobStatus) {
  filters.toggleStatus(s)
}

function clearFilters() {
  filters.reset()
  socialAccountInput.value = ""
}

function onPlatformChange() {
  filters.offset = 0
}

// Действия
function onCancel(job: PostingJobDto) {
  cancelModalRef.value?.open(job)
}

function onRetry(job: PostingJobDto) {
  retryModalRef.value?.open(job)
}

function onDelete(job: PostingJobDto) {
  deleteModalRef.value?.open(job)
}

async function onDeleted() {
  // Удалённая карточка могла быть в bulk-выборе — подчищаем.
  await reloadAll()
}

function onLogs(job: PostingJobDto) {
  // Передаём весь job — PostingJobLogsModal использует platform+lastErrorPhase
  // для рендера PostingJobPhaseProgress (YouTube only).
  logsModalRef.value?.open(job, job.id.slice(0, 8))
}

async function reloadAll() {
  await Promise.all([refresh(), refreshStats()])
}

async function onCancelled() {
  await reloadAll()
}

async function onRetried() {
  await reloadAll()
}

function onCreateClick() {
  createModalRef.value?.open()
}

function onBulkClick() {
  bulkModalRef.value?.open()
}

async function onCreated() {
  await reloadAll()
}

async function onBulkCreated() {
  await reloadAll()
}

// Pagination
const currentPage = computed(() =>
  Math.floor(filters.offset / filters.limit) + 1,
)
const totalPages = computed(() =>
  Math.max(1, Math.ceil(total.value / filters.limit)),
)
const hasNext = computed(() => currentPage.value < totalPages.value)
const hasPrev = computed(() => currentPage.value > 1)

function nextPage() {
  if (!hasNext.value) return
  filters.offset = filters.offset + filters.limit
}

function prevPage() {
  if (!hasPrev.value) return
  filters.offset = Math.max(0, filters.offset - filters.limit)
}

// Сводка по статусам — берём из stats, чтобы видеть глобальный counts а не только текущую страницу
const statusSummary = computed(() => {
  if (!stats.value) return [] as Array<{ status: PostingJobStatus; count: number; label: string }>
  return POSTING_JOB_STATUSES.map((s) => ({
    status: s,
    count: stats.value!.byStatus[s] ?? 0,
    label: statusOptions.find((o) => o.value === s)?.label ?? s,
  })).filter((item) => item.count > 0)
})
</script>

<template>
  <div class="space-y-6">
    <!-- Заголовок -->
    <div class="flex items-center justify-between flex-wrap gap-3">
      <div>
        <h1 class="text-2xl font-bold text-base-content">
          Очередь постинга
        </h1>
        <p class="text-sm text-base-content/60 mt-1">
          Всего: {{ total }}
          <span v-if="hasActiveJobs" class="ml-2 text-warning">
            <span class="loading loading-dots loading-xs align-middle" />
            активные jobs обновляются каждые 5с
          </span>
        </p>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <button
          class="btn btn-sm btn-ghost gap-1"
          :disabled="pending"
          @click="reloadAll"
        >
          <span v-if="pending" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:refresh-3-line" />
          Обновить
        </button>
        <button
          v-if="canDelete"
          class="btn btn-sm gap-1"
          :class="selectMode ? 'btn-primary' : 'btn-ghost'"
          @click="toggleSelectMode"
        >
          <Icon name="mingcute:checkbox-line" />
          {{ selectMode ? "Выйти из выбора" : "Выбрать" }}
        </button>
        <button
          class="btn btn-sm gap-1"
          @click="onBulkClick"
        >
          <Icon name="mingcute:layers-line" />
          Создать массово
        </button>
        <button
          class="btn btn-sm btn-primary gap-1"
          @click="onCreateClick"
        >
          <Icon name="mingcute:add-line" />
          Создать задачу
        </button>
      </div>
    </div>

    <!-- Индикатор состояния DuoPlus-движка (гейт DUOPLUS_ENGINE_ENABLED).
         Браузерный постинг (browser_automation) идёт через DuoPlus-движок. -->
    <div
      v-if="engine"
      role="alert"
      class="alert alert-soft py-2.5 text-sm gap-2"
      :class="engine.duoplusEngineEnabled ? 'alert-success' : 'alert-warning'"
    >
      <Icon
        :name="engine.duoplusEngineEnabled ? 'mingcute:flash-line' : 'mingcute:snow-line'"
        class="text-base shrink-0"
      />
      <span v-if="engine.duoplusEngineEnabled">
        <b>DuoPlus-движок активен.</b> Браузерный постинг исполняется через
        облачные устройства DuoPlus.
      </span>
      <span v-else>
        <b>Постинг через DuoPlus в режиме freeze (движок выключен).</b>
        Браузерный постинг не исполняется, пока не включён гейт DUOPLUS_ENGINE_ENABLED.
      </span>
    </div>

    <!-- Stats summary (badges per status) -->
    <div
      v-if="stats && statusSummary.length > 0"
      class="flex items-center gap-2 flex-wrap"
    >
      <PostingJobStatusBadge
        v-for="item in statusSummary"
        :key="item.status"
        :status="item.status"
        size="md"
      />
    </div>

    <div
      v-if="stats"
      class="stats stats-vertical sm:stats-horizontal shadow-sm bg-base-100 w-full overflow-x-auto"
    >
      <div
        v-for="item in statusSummary"
        :key="`stat-${item.status}`"
        class="stat py-3 px-4"
      >
        <div class="stat-title text-xs">{{ item.label }}</div>
        <div class="stat-value text-2xl">{{ item.count }}</div>
      </div>
      <div v-if="statusSummary.length === 0" class="stat py-3 px-4">
        <div class="stat-title text-xs">Jobs</div>
        <div class="stat-value text-2xl">0</div>
        <div class="stat-desc">пусто</div>
      </div>
    </div>

    <!-- Фильтры -->
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body p-4 gap-3">
        <div class="flex flex-col gap-3">
          <!-- Status multi-select -->
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Статусы (множественный выбор)</legend>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="opt in statusOptions"
                :key="opt.value"
                type="button"
                class="btn btn-xs"
                :class="
                  isStatusActive(opt.value)
                    ? 'btn-primary'
                    : 'btn-ghost border border-base-300'
                "
                @click="toggleStatus(opt.value)"
              >
                <Icon
                  v-if="isStatusActive(opt.value)"
                  name="mingcute:check-line"
                  class="text-sm"
                />
                {{ opt.label }}
              </button>
            </div>
          </fieldset>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Платформа</legend>
              <select
                v-model="filters.platform"
                class="select select-sm w-full"
                @change="onPlatformChange"
              >
                <option
                  v-for="opt in platformOptions"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.label }}
                </option>
              </select>
            </fieldset>

            <fieldset class="fieldset">
              <legend class="fieldset-legend">ID соц-аккаунта</legend>
              <input
                v-model="socialAccountInput"
                type="number"
                class="input input-sm w-full"
                placeholder="например, 42"
                min="1"
              />
            </fieldset>

            <fieldset class="fieldset">
              <legend class="fieldset-legend">&nbsp;</legend>
              <button class="btn btn-sm btn-ghost" @click="clearFilters">
                <Icon name="mingcute:close-line" />
                Сбросить
              </button>
            </fieldset>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="pending && jobs.length === 0" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <!-- Error -->
    <div v-else-if="error" role="alert" class="alert alert-error alert-soft">
      <Icon name="mingcute:warning-line" />
      <span>Ошибка загрузки: {{ error.message }}</span>
    </div>

    <!-- Empty -->
    <SharedEmptyState
      v-else-if="jobs.length === 0"
      icon="mingcute:send-line"
      title="Очередь постинга пуста"
      description="Здесь появятся PostingJob после запуска автоматических публикаций через DuoPlus."
    />

    <!-- Список карточек -->
    <template v-else>
      <!-- Панель массовых действий (только в режиме выбора) -->
      <PostingJobBulkActionsBar
        v-if="selectMode"
        :selected-ids="selectedIds"
        @clear-selection="clearSelection"
        @done="onBulkDeleted"
      />

      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <PostingJobCard
          v-for="job in jobs"
          :key="job.id"
          :job="job"
          :selectable="selectMode"
          :selected="isSelected(job.id)"
          @cancel="onCancel"
          @retry="onRetry"
          @logs="onLogs"
          @delete="onDelete"
          @toggle-select="onToggleSelect"
        />
      </div>

      <!-- Пагинация -->
      <div
        v-if="totalPages > 1"
        class="flex items-center justify-between flex-wrap gap-2 pt-2"
      >
        <span class="text-xs text-base-content/60">
          Страница {{ currentPage }} из {{ totalPages }} · всего {{ total }}
        </span>
        <div class="join">
          <button
            class="btn btn-sm join-item"
            :disabled="!hasPrev"
            @click="prevPage"
          >
            <Icon name="mingcute:left-line" />
            Назад
          </button>
          <button
            class="btn btn-sm join-item"
            :disabled="!hasNext"
            @click="nextPage"
          >
            Вперёд
            <Icon name="mingcute:right-line" />
          </button>
        </div>
      </div>
    </template>

    <!-- Modals -->
    <PostingJobCancelModal ref="cancelModalRef" @cancelled="onCancelled" />
    <PostingJobRetryConfirm ref="retryModalRef" @retried="onRetried" />
    <PostingJobDeleteModal ref="deleteModalRef" @deleted="onDeleted" />
    <PostingJobLogsModal ref="logsModalRef" />
    <PostingJobCreateModal ref="createModalRef" @created="onCreated" />
    <PostingJobBulkCreateModal ref="bulkModalRef" @created="onBulkCreated" />
  </div>
</template>
