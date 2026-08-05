<script setup lang="ts">
import type { ColumnDef } from '~/components/list/ListColumnsMenu.vue'
import type { FilterChip } from '~/components/list/ListFilterChips.vue'
import type { SystemView } from '~/composables/useSavedViews'
import { videoStatus } from './VideoStatusMap'

/**
 * Список роликов по эталону `TrendListView`.
 *
 * Стоимость в таблице показывается фактическая, а оценка — только пока факта
 * нет: две цифры рядом в каждой строке читаются как ошибка, а не как прогноз.
 *
 * Сортировки нет — `/api/videos` её не принимает.
 */
const VIDEO_STATUS_LABELS: Record<string, string> = {
  pending: 'В очереди',
  configuring: 'Настраивается',
  generating_prompts: 'Промты',
  generating_images: 'Кадры',
  generating_clips: 'Клипы',
  generating_voiceover: 'Озвучка',
  generating_music: 'Музыка',
  assembling: 'Сборка',
  completed: 'Готово',
  failed: 'Ошибка',
  timeout: 'Таймаут',
  canceled: 'Отменено',
}

const filters = useVideoFiltersStore()
const { canDelete } = usePermissions()
const toast = useToast()

const SYSTEM_VIEWS: SystemView[] = [
  { key: 'all', name: 'Все', query: {} },
  { key: 'active', name: 'В работе', query: { status: 'generating_clips' } },
  { key: 'done', name: 'Готовые', query: { status: 'completed' } },
  { key: 'failed', name: 'Упавшие', query: { status: 'failed' } },
]

const COLUMNS: ColumnDef[] = [
  { key: 'title', label: 'Ролик', locked: true },
  { key: 'format', label: 'Формат' },
  { key: 'duration', label: 'Длительность' },
  { key: 'cost', label: 'Стоимость' },
  { key: 'status', label: 'Статус' },
  { key: 'created', label: 'Создан' },
]

const WIDTHS: Record<string, string> = {
  title: 'minmax(240px,1fr)',
  format: '96px',
  duration: '116px',
  cost: '112px',
  status: '148px',
  created: '124px',
}

const visibleColumns = ref(COLUMNS.map(c => c.key))
const gridColumns = computed(() =>
  ['32px', ...visibleColumns.value.map(k => WIDTHS[k] ?? '100px'), '76px'].join(' '),
)
const minWidth = computed(() => `${380 + visibleColumns.value.length * 110}px`)

const views = useSavedViews('videos', SYSTEM_VIEWS)

const mode = ref<'table' | 'cards'>('table')
const selected = ref<number[]>([])

const { data, pending, error, refresh } = useVideos(computed(() => filters.query))
const rows = computed(() => data.value?.data ?? [])
const meta = computed(() => data.value?.meta ?? { total: 0, page: 1, perPage: 12, totalPages: 1 })

function applyView(id: string | number) {
  const view = views.all.value.find(v => String(v.id) === String(id))
  if (!view) return
  views.select(id)
  filters.resetFilters()
  for (const [key, value] of Object.entries(view.query)) {
    if (key in filters) (filters as unknown as Record<string, unknown>)[key] = value
  }
  if (view.columns?.length) visibleColumns.value = view.columns
  selected.value = []
}

async function saveView(scope: 'shared' | 'personal', name: string) {
  await views.create(name, { ...filters.query, page: undefined } as Record<string, unknown>, scope, visibleColumns.value)
  toast.success(scope === 'shared' ? 'Общее представление создано' : 'Представление сохранено')
}

watch(() => filters.query, () => { views.dirty.value = true }, { deep: true })

const chips = computed<FilterChip[]>(() => {
  const out: FilterChip[] = []
  if (filters.status) out.push({ key: 'status', label: 'Статус', value: VIDEO_STATUS_LABELS[filters.status] ?? filters.status })
  if (filters.scenarioId) out.push({ key: 'scenarioId', label: 'Сценарий', value: `#${filters.scenarioId}` })
  if (filters.runId) out.push({ key: 'runId', label: 'Запуск', value: `#${filters.runId}` })
  if (filters.pipelineId) out.push({ key: 'pipelineId', label: 'Конвейер', value: `#${filters.pipelineId}` })
  return out
})

function clearChip(key: string) {
  ;(filters as unknown as Record<string, unknown>)[key] = key === 'status' ? '' : undefined
  filters.resetPage()
}

const pageIds = computed(() => rows.value.map(r => r.id))
const allOnPageSelected = computed(() => pageIds.value.length > 0 && pageIds.value.every(id => selected.value.includes(id)))

function toggleAllOnPage() {
  selected.value = allOnPageSelected.value
    ? selected.value.filter(id => !pageIds.value.includes(id))
    : [...new Set([...selected.value, ...pageIds.value])]
}

function toggleRow(id: number) {
  selected.value = selected.value.includes(id)
    ? selected.value.filter(x => x !== id)
    : [...selected.value, id]
}

const bulkRunning = ref(false)

async function bulkDelete() {
  bulkRunning.value = true
  const ids = [...selected.value]
  try {
    await Promise.all(ids.map(id => $fetch(`/api/videos/${id}`, { method: 'DELETE' })))
    selected.value = []
    await refresh()
    toast.success(`Удалено роликов: ${ids.length}`)
  }
  catch {
    toast.error('Не все ролики удалось удалить')
  }
  finally {
    bulkRunning.value = false
  }
}

function titleOf(row: { scenario?: { variants?: Array<{ title: string }> } | null, id: number }) {
  return row.scenario?.variants?.[0]?.title ?? `Ролик ${row.id}`
}

function costOf(row: { totalCostActual?: number | null, totalCostEstimate?: number | null }) {
  const actual = row.totalCostActual
  if (actual != null) return { value: `${actual.toFixed(2)} ₽`, estimated: false }
  const est = row.totalCostEstimate
  if (est != null) return { value: `~${est.toFixed(2)} ₽`, estimated: true }
  return null
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow',
  })
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-semibold">Видео</h1>
      <span class="tnum text-sm text-subtle">{{ meta.total }}</span>
      <span class="flex-1" />

      <div class="flex overflow-hidden rounded-md border border-border">
        <button
          v-for="m in (['table', 'cards'] as const)"
          :key="m"
          type="button"
          class="flex h-7 w-8 cursor-pointer items-center justify-center"
          :class="mode === m ? 'bg-accent text-on-accent' : 'bg-card text-muted hover:text-fg'"
          :title="m === 'table' ? 'Таблица' : 'Карточки'"
          @click="mode = m"
        >
          <Icon :name="m === 'table' ? 'mingcute:list-check-line' : 'mingcute:grid-line'" />
        </button>
      </div>

      <UiButton @click="refresh()">
        <Icon name="mingcute:refresh-2-line" />
        Обновить
      </UiButton>
    </div>

    <ListSavedViews
      :views="views.all.value"
      :active-id="views.activeId.value"
      :dirty="views.dirty.value"
      :can-manage-shared="views.canManageShared.value"
      @select="applyView"
      @save="(scope) => saveView(scope, 'Мой вид')"
      @revert="applyView(views.activeId.value)"
      @save-as-own="saveView('personal', 'Мой вид')"
      @pin="views.pinDefault"
      @remove="views.remove"
    />

    <div class="flex flex-wrap items-center gap-2">
      <UiSelect
        v-model="filters.status"
        class="w-52"
        :options="[
          { value: '', label: 'Любой статус' },
          ...Object.entries(VIDEO_STATUS_LABELS).map(([value, label]) => ({ value, label })),
        ]"
      />
      <span class="flex-1" />
      <ListColumnsMenu v-if="mode === 'table'" v-model:visible="visibleColumns" :columns="COLUMNS" />
    </div>

    <ListFilterChips :chips="chips" @clear="clearChip" @clear-all="filters.resetFilters()" />

    <UiSkeleton v-if="pending && !rows.length" :variant="mode === 'table' ? 'table' : 'cards'" :count="10" />

    <UiErrorState
      v-else-if="error"
      message="Не удалось загрузить ролики."
      :details="error.message"
      @retry="refresh()"
    />

    <UiEmptyState
      v-else-if="!rows.length && chips.length"
      variant="search"
      title="Ничего не найдено"
      :description="`Мешают активные фильтры: ${chips.map(c => c.label).join(', ')}.`"
    >
      <UiButton @click="filters.resetFilters()">Сбросить фильтры</UiButton>
    </UiEmptyState>

    <UiEmptyState
      v-else-if="!rows.length"
      variant="first"
      title="Роликов пока нет"
      description="Откройте сценарий и запустите генерацию — ролик появится здесь."
    />

    <UiTable v-else-if="mode === 'table'" :columns="gridColumns" :min-width="minWidth">
      <UiTableHead>
        <span>
          <input
            type="checkbox"
            :checked="allOnPageSelected"
            class="size-3.5 cursor-pointer accent-(--color-accent)"
            @change="toggleAllOnPage"
          >
        </span>
        <span
          v-for="key in visibleColumns"
          :key="key"
          :class="['duration', 'cost'].includes(key) && 'text-right'"
        >
          {{ COLUMNS.find(c => c.key === key)?.label }}
        </span>
        <span class="text-right">Действия</span>
      </UiTableHead>

      <UiTableRow
        v-for="row in rows"
        :key="row.id"
        :selected="selected.includes(row.id)"
        @click="navigateTo(`/videos/${row.id}`)"
      >
        <span @click.stop>
          <input
            type="checkbox"
            :checked="selected.includes(row.id)"
            class="size-3.5 cursor-pointer accent-(--color-accent)"
            @change="toggleRow(row.id)"
          >
        </span>

        <template v-for="key in visibleColumns" :key="key">
          <span v-if="key === 'title'" class="flex min-w-0 items-baseline gap-2">
            <NuxtLink :to="`/videos/${row.id}`" class="truncate text-sm text-fg hover:underline" @click.stop>
              {{ titleOf(row) }}
            </NuxtLink>
            <span class="shrink-0 font-mono text-[11.5px] text-subtle">vid_{{ row.id }}</span>
          </span>

          <span v-else-if="key === 'format'" class="font-mono text-sm text-muted">
            {{ row.format === 'portrait' ? '9:16' : '16:9' }}
          </span>

          <span v-else-if="key === 'duration'" class="tnum text-right font-mono text-sm text-muted">
            {{ row.duration ? `${row.duration} с` : '—' }}
          </span>

          <span v-else-if="key === 'cost'" class="tnum text-right font-mono text-sm">
            <template v-if="costOf(row)">
              <span :class="costOf(row)!.estimated && 'text-subtle'">{{ costOf(row)!.value }}</span>
            </template>
            <span v-else class="text-subtle">—</span>
          </span>

          <span v-else-if="key === 'status'">
            <UiStatusBadge :status="videoStatus(row.status)" size="xs" dot />
          </span>

          <span v-else-if="key === 'created'" class="tnum font-mono text-sm text-muted">
            {{ fmtDate(row.createdAt) }}
          </span>
        </template>

        <span class="flex justify-end opacity-0 transition-opacity group-hover:opacity-100" @click.stop>
          <UiActionMenu
            :items="[
              { key: 'open', label: 'Открыть', icon: 'mingcute:external-link-line' },
              ...(canDelete ? [{ key: 'delete', label: 'Удалить', icon: 'mingcute:delete-2-line', danger: true }] : []),
            ]"
            @select="$event === 'open' ? navigateTo(`/videos/${row.id}`) : null"
          />
        </span>
      </UiTableRow>
    </UiTable>

    <div v-else class="grid gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
      <UiEntityCard
        v-for="row in rows"
        :key="row.id"
        selectable
        :title="titleOf(row)"
        :subtitle="`vid_${row.id}`"
        :selected="selected.includes(row.id)"
        @update:selected="toggleRow(row.id)"
      >
        <template #badges>
          <UiStatusBadge :status="videoStatus(row.status)" size="xs" dot />
        </template>
        <template #meta>
          <span v-if="costOf(row)" class="tnum font-mono text-micro text-muted">{{ costOf(row)!.value }}</span>
        </template>
        <template #actions>
          <UiButton variant="primary" @click="navigateTo(`/videos/${row.id}`)">Открыть</UiButton>
        </template>
      </UiEntityCard>
    </div>

    <UiBulkActionBar
      :selected="selected.length"
      :total="meta.total"
      :page-selected="allOnPageSelected"
      @clear="selected = []"
    >
      <UiButton v-if="canDelete" variant="danger" :loading="bulkRunning" @click="bulkDelete">Удалить</UiButton>
    </UiBulkActionBar>

    <ListPagination
      v-if="rows.length"
      :page="meta.page"
      :total-pages="meta.totalPages"
      :total="meta.total"
      :per-page="meta.perPage"
      @update:page="filters.page = $event"
      @update:per-page="filters.perPage = $event; filters.resetPage()"
    />
  </div>
</template>
