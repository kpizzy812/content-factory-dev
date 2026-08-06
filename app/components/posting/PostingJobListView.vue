<script setup lang="ts">
import {
  POSTING_JOB_ACTIVE_STATUSES,
  POSTING_JOB_STATUSES,
  type PostingJobDto,
  type PostingJobStatus,
} from '~~/shared/types/posting-job'
import type { FilterChip } from '~/components/list/ListFilterChips.vue'
import { platformMeta } from '~/components/ui/platform-meta'
import { POSTING_STATUS_LABELS } from './PostingStatusMap'

/**
 * Очередь публикаций. Источник: разделы «Очередь публикаций» и «Список»
 * макета 06.
 *
 * Двух величин из макета здесь нет и быть не может: свободная ёмкость аккаунта
 * и время восстановления лимита приходят от платформы в момент отправки и
 * никуда не сохраняются. Показано то, что знает наша очередь.
 */
const emit = defineEmits<{
  create: []
  bulkCreate: []
  cancel: [job: PostingJobDto]
  retry: [job: PostingJobDto]
  logs: [job: PostingJobDto]
  remove: [job: PostingJobDto]
  bulkDone: []
}>()

const filters = usePostingJobFiltersStore()
const { can } = usePermissions()
const canDelete = computed(() => can('canDelete'))

const { jobs, total, engine, pending, error, refresh, hasActiveJobs } = usePostingJobs()
const { data: statsData, refresh: refreshStats } = usePostingJobStats()
const stats = computed(() => statsData.value?.data ?? null)

async function reload() {
  await Promise.all([refresh(), refreshStats()])
}

defineExpose({ reload })

// ── Вид: список или сетка по часам ─────────────────────────────────────
const mode = ref<'list' | 'calendar'>('list')
const calendarHours = ref(24)

// ── Фильтры ────────────────────────────────────────────────────────────
const accountInput = ref<string>(filters.socialAccountId ? String(filters.socialAccountId) : '')
let searchTimeout: ReturnType<typeof setTimeout> | null = null

watch(accountInput, (val) => {
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    const n = Number(val)
    filters.socialAccountId = Number.isFinite(n) && n > 0 ? n : null
    filters.offset = 0
  }, 300)
})

watch(() => filters.socialAccountId, (val) => {
  const s = val ? String(val) : ''
  if (accountInput.value !== s) accountInput.value = s
})

const chips = computed<FilterChip[]>(() => {
  const out: FilterChip[] = []
  for (const s of filters.statuses) {
    out.push({ key: `status:${s}`, label: 'Статус', value: POSTING_STATUS_LABELS[s] ?? s })
  }
  if (filters.platform) out.push({ key: 'platform', label: 'Платформа', value: platformMeta(filters.platform).label })
  if (filters.socialAccountId) out.push({ key: 'socialAccountId', label: 'Аккаунт', value: `#${filters.socialAccountId}` })
  return out
})

function clearChip(key: string) {
  if (key.startsWith('status:')) filters.toggleStatus(key.slice(7) as PostingJobStatus)
  else if (key === 'platform') filters.platform = ''
  else if (key === 'socialAccountId') filters.socialAccountId = null
}

function resetFilters() {
  filters.reset()
  accountInput.value = ''
}

// ── Массовый выбор ─────────────────────────────────────────────────────
const selectMode = ref(false)
const selectedIds = ref<string[]>([])

function toggleSelectMode() {
  selectMode.value = !selectMode.value
  if (!selectMode.value) selectedIds.value = []
}

function toggleRow(id: string) {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter(x => x !== id)
    : [...selectedIds.value, id]
}

const pageIds = computed(() => jobs.value.map(j => j.id))
const allOnPageSelected = computed(
  () => pageIds.value.length > 0 && pageIds.value.every(id => selectedIds.value.includes(id)),
)

function toggleAllOnPage() {
  selectedIds.value = allOnPageSelected.value
    ? selectedIds.value.filter(id => !pageIds.value.includes(id))
    : [...new Set([...selectedIds.value, ...pageIds.value])]
}

async function onBulkDone() {
  selectedIds.value = []
  emit('bulkDone')
  await reload()
}

// ── Панель деталей ─────────────────────────────────────────────────────
const drawerId = ref<string | null>(null)
const drawerIndex = computed(() => jobs.value.findIndex(j => j.id === drawerId.value))
const drawerJob = computed(() => (drawerIndex.value >= 0 ? jobs.value[drawerIndex.value] : null))

function step(delta: number) {
  const next = jobs.value[drawerIndex.value + delta]
  if (next) drawerId.value = next.id
}

// ── Пагинация ──────────────────────────────────────────────────────────
const page = computed(() => Math.floor(filters.offset / filters.limit) + 1)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / filters.limit)))

function goToPage(p: number) {
  filters.offset = Math.max(0, (p - 1) * filters.limit)
}

// ── Подача ─────────────────────────────────────────────────────────────
const statusSummary = computed(() => {
  if (!stats.value) return []
  return POSTING_JOB_STATUSES
    .map(s => ({ status: s, count: stats.value!.byStatus[s] ?? 0 }))
    .filter(item => item.count > 0)
})

function fmtTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function isActive(job: PostingJobDto) {
  return POSTING_JOB_ACTIVE_STATUSES.includes(job.status)
}

function menuItems(job: PostingJobDto) {
  return [
    { key: 'logs', label: 'Журнал задачи', icon: 'mingcute:list-check-line' },
    ...(isActive(job) ? [{ key: 'cancel', label: 'Снять из очереди', icon: 'mingcute:forbid-circle-line' }] : []),
    ...(job.status === 'failed' ? [{ key: 'retry', label: 'Повторить сейчас', icon: 'mingcute:refresh-3-line' }] : []),
    ...(job.platformPostUrl ? [{ key: 'open', label: 'Открыть публикацию', icon: 'mingcute:external-link-line' }] : []),
    ...(canDelete.value ? [{ key: 'remove', label: 'Удалить задачу', icon: 'mingcute:delete-2-line', danger: true }] : []),
  ]
}

function onMenu(key: string, job: PostingJobDto) {
  if (key === 'logs') emit('logs', job)
  else if (key === 'cancel') emit('cancel', job)
  else if (key === 'retry') emit('retry', job)
  else if (key === 'remove') emit('remove', job)
  else if (key === 'open' && job.platformPostUrl) window.open(job.platformPostUrl, '_blank', 'noopener')
}

const gridColumns = 'minmax(220px,1fr) 132px 88px 116px 132px 64px'
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-semibold">Очередь публикаций</h1>
      <span class="tnum text-sm text-subtle">{{ total }}</span>
      <span v-if="hasActiveJobs" class="flex items-center gap-1.5 text-micro text-subtle">
        <span class="size-1.5 shrink-0 rounded-full bg-info motion-safe:animate-pulse" />
        живые задачи обновляются каждые 5 секунд
      </span>
      <span class="flex-1" />

      <div class="flex overflow-hidden rounded-md border border-border">
        <button
          v-for="m in (['list', 'calendar'] as const)"
          :key="m"
          type="button"
          class="flex h-7 w-8 cursor-pointer items-center justify-center"
          :class="mode === m ? 'bg-accent text-on-accent' : 'bg-card text-muted hover:text-fg'"
          :title="m === 'list' ? 'Список' : 'Сетка по часам'"
          @click="mode = m"
        >
          <Icon :name="m === 'list' ? 'mingcute:list-check-line' : 'mingcute:calendar-line'" />
        </button>
      </div>

      <UiButton :loading="pending" @click="reload">
        <Icon v-if="!pending" name="mingcute:refresh-3-line" />
        Обновить
      </UiButton>
      <UiButton v-if="canDelete" :variant="selectMode ? 'primary' : 'secondary'" @click="toggleSelectMode">
        <Icon name="mingcute:checkbox-line" />
        {{ selectMode ? 'Выйти из выбора' : 'Выбрать' }}
      </UiButton>
      <UiButton @click="emit('bulkCreate')">
        <Icon name="mingcute:layers-line" />
        Распределить ролики
      </UiButton>
      <UiButton variant="primary" @click="emit('create')">
        <Icon name="mingcute:add-line" />
        Новая публикация
      </UiButton>
    </div>

    <p
      v-if="engine && !engine.duoplusEngineEnabled"
      class="flex gap-2 rounded-md border border-warning-border bg-warning-bg p-2.5 text-sm"
    >
      <Icon name="mingcute:snow-line" class="mt-0.5 shrink-0 text-warning" />
      <span>
        <b>Постинг через устройство заморожен.</b>
        Задачи с методом «через устройство» стоят в очереди и не исполняются, пока
        не включён гейт <span class="font-mono">DUOPLUS_ENGINE_ENABLED</span>.
        Публикация через официальный API работает как обычно.
      </span>
    </p>

    <div v-if="statusSummary.length" class="flex flex-wrap gap-2">
      <button
        v-for="item in statusSummary"
        :key="item.status"
        type="button"
        class="flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5"
        :class="filters.statuses.includes(item.status)
          ? 'border-accent bg-accent-bg'
          : 'border-border bg-card hover:border-accent-border'"
        @click="filters.toggleStatus(item.status)"
      >
        <PostingJobStatusBadge :status="item.status" size="xs" />
        <span class="tnum font-mono text-sm">{{ item.count }}</span>
      </button>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <UiSelect
        v-model="filters.platform"
        class="w-44"
        :options="[
          { value: '', label: 'Все платформы' },
          { value: 'tiktok', label: 'TikTok' },
          { value: 'instagram', label: 'Instagram' },
          { value: 'youtube', label: 'YouTube' },
        ]"
      />
      <UiInput v-model="accountInput" type="number" class="max-w-44" placeholder="ID аккаунта" />
      <UiButton variant="ghost" @click="resetFilters">Сбросить</UiButton>
      <span class="flex-1" />
      <div v-if="mode === 'calendar'" class="flex overflow-hidden rounded-md border border-border">
        <button
          v-for="h in [24, 48]"
          :key="h"
          type="button"
          class="h-7 cursor-pointer px-2.5 text-sm"
          :class="calendarHours === h ? 'bg-accent text-on-accent' : 'bg-card text-muted hover:text-fg'"
          @click="calendarHours = h"
        >
          {{ h }} ч
        </button>
      </div>
    </div>

    <ListFilterChips :chips="chips" @clear="clearChip" @clear-all="resetFilters" />

    <UiSkeleton v-if="pending && !jobs.length" variant="table" :count="8" />

    <UiErrorState
      v-else-if="error"
      message="Не удалось загрузить очередь."
      :details="error.message"
      @retry="reload"
    />

    <UiEmptyState
      v-else-if="!jobs.length && chips.length"
      variant="search"
      title="Ничего не найдено"
      :description="`Мешают активные фильтры: ${chips.map(c => c.label).join(', ')}.`"
    >
      <UiButton @click="resetFilters">Сбросить фильтры</UiButton>
    </UiEmptyState>

    <UiEmptyState
      v-else-if="!jobs.length"
      variant="first"
      icon="mingcute:send-line"
      title="Очередь пуста"
      description="Задачи появляются, когда конвейер доводит ролик до публикации или когда её ставят руками."
    >
      <UiButton variant="primary" @click="emit('create')">Поставить публикацию</UiButton>
    </UiEmptyState>

    <template v-else>
      <ClientOnly v-if="mode === 'calendar'">
        <PostingJobCalendar :jobs="jobs" :hours="calendarHours" @pick="drawerId = $event.id" />
        <template #fallback>
          <UiSkeleton variant="table" :count="5" density="media" />
        </template>
      </ClientOnly>

      <UiTable v-else :columns="gridColumns" min-width="860px">
        <UiTableHead>
          <span class="flex items-center gap-2">
            <input
              v-if="selectMode"
              type="checkbox"
              :checked="allOnPageSelected"
              class="size-3.5 cursor-pointer accent-(--color-accent)"
              @change="toggleAllOnPage"
            >
            Ролик и аккаунт
          </span>
          <span>Время</span>
          <span class="text-right">Попытки</span>
          <span>Платформа</span>
          <span>Статус</span>
          <span class="text-right">Действия</span>
        </UiTableHead>

        <UiTableRow
          v-for="job in jobs"
          :key="job.id"
          density="media"
          :selected="selectedIds.includes(job.id) || drawerId === job.id"
          @click="drawerId = job.id"
        >
          <span class="flex min-w-0 items-center gap-2.5">
            <input
              v-if="selectMode"
              type="checkbox"
              :checked="selectedIds.includes(job.id)"
              class="size-3.5 shrink-0 cursor-pointer accent-(--color-accent)"
              @click.stop
              @change="toggleRow(job.id)"
            >
            <span class="min-w-0">
              <span class="block truncate text-sm">
                {{ job.video?.id ? `Ролик ${job.video.id}` : `Задача ${job.id.slice(0, 8)}` }}
              </span>
              <span class="block truncate font-mono text-micro text-subtle">
                {{ job.socialAccount?.displayName ?? `аккаунт #${job.socialAccountId}` }}
              </span>
            </span>
          </span>

          <span class="tnum font-mono text-sm" :class="job.scheduledAt ? 'text-muted' : 'text-subtle'">
            {{ fmtTime(job.scheduledAt ?? job.createdAt) }}
          </span>

          <span
            class="tnum text-right font-mono text-sm"
            :class="job.attemptCount > 1 ? 'text-warning' : 'text-subtle'"
          >
            {{ job.attemptCount > 0 ? `${job.attemptCount} из ${job.maxAttempts}` : '—' }}
          </span>

          <span><UiPlatformBadge :platform="job.platform" /></span>

          <span><PostingJobStatusBadge :status="job.status" size="xs" /></span>

          <span class="flex justify-end opacity-0 transition-opacity group-hover:opacity-100" @click.stop>
            <UiActionMenu :items="menuItems(job)" @select="onMenu($event, job)" />
          </span>
        </UiTableRow>
      </UiTable>

      <PostingJobBulkActionsBar
        v-if="selectMode"
        :selected-ids="selectedIds"
        :total="total"
        @clear-selection="selectedIds = []"
        @done="onBulkDone"
      />

      <ListPagination
        v-if="mode === 'list'"
        :page="page"
        :total-pages="totalPages"
        :total="total"
        :per-page="filters.limit"
        @update:page="goToPage"
        @update:per-page="filters.limit = $event; filters.offset = 0"
      />
    </template>

    <UiDrawer
      :open="!!drawerJob"
      :title="drawerJob?.video?.id ? `Ролик ${drawerJob.video.id}` : `Задача ${drawerJob?.id.slice(0, 8) ?? ''}`"
      :subtitle="drawerJob?.id"
      :position="drawerIndex >= 0 ? `${drawerIndex + 1} из ${jobs.length}` : ''"
      :has-prev="drawerIndex > 0"
      :has-next="drawerIndex >= 0 && drawerIndex < jobs.length - 1"
      width="520px"
      @close="drawerId = null"
      @prev="step(-1)"
      @next="step(1)"
    >
      <PostingJobDrawerBody v-if="drawerJob" :job="drawerJob" />
      <template #footer>
        <UiButton variant="primary" @click="drawerJob && emit('logs', drawerJob)">Журнал</UiButton>
        <UiButton v-if="drawerJob && drawerJob.status === 'failed'" @click="emit('retry', drawerJob)">
          Повторить
        </UiButton>
        <UiButton v-else-if="drawerJob && isActive(drawerJob)" @click="emit('cancel', drawerJob)">
          Снять из очереди
        </UiButton>
      </template>
    </UiDrawer>
  </div>
</template>
