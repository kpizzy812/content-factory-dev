<script setup lang="ts">
import type { ColumnDef } from '~/components/list/ListColumnsMenu.vue'
import type { FilterChip } from '~/components/list/ListFilterChips.vue'
import type { SystemView } from '~/composables/useSavedViews'
import { scenarioStatus, variantStatus, SCENARIO_STATUS_LABELS } from './ScenarioStatusMap'

/**
 * Список сценариев по эталону `TrendListView`.
 *
 * Сортировки и поиска нет: `/api/scenarios` их не принимает — сортирует по
 * дате создания и фильтрует статусом, трендом, запуском и конвейером.
 * Рисовать стрелки сортировки, которые ничего не делают, хуже, чем не рисовать.
 */
const filters = useScenarioFiltersStore()
const { can } = usePermissions()
const canDelete = computed(() => can('canDelete'))
const toast = useToast()

const SYSTEM_VIEWS: SystemView[] = [
  { key: 'all', name: 'Все', query: {} },
  { key: 'review', name: 'Ждут выбора варианта', query: { status: 'generated' } },
  { key: 'rework', name: 'На доработку', query: { status: 'needs_rework' } },
  { key: 'selected', name: 'Вариант выбран', query: { status: 'selected' } },
]

const COLUMNS: ColumnDef[] = [
  { key: 'title', label: 'Название', locked: true },
  { key: 'trend', label: 'Тренд' },
  { key: 'variants', label: 'Варианты' },
  { key: 'status', label: 'Статус' },
  { key: 'created', label: 'Создан' },
]

const WIDTHS: Record<string, string> = {
  title: 'minmax(240px,1fr)',
  trend: 'minmax(160px,200px)',
  variants: '112px',
  status: '148px',
  created: '124px',
}

const visibleColumns = ref(COLUMNS.map(c => c.key))
const gridColumns = computed(() =>
  ['32px', ...visibleColumns.value.map(k => WIDTHS[k] ?? '100px'), '76px'].join(' '),
)
const minWidth = computed(() => `${380 + visibleColumns.value.length * 110}px`)

const views = useSavedViews('scenarios', SYSTEM_VIEWS)

const selected = ref<number[]>([])
const drawerId = ref<number | null>(null)

const query = computed(() => ({
  ...(filters.status ? { status: filters.status } : {}),
  ...(filters.trendId ? { trendId: filters.trendId } : {}),
  ...(filters.runId ? { runId: filters.runId } : {}),
  ...(filters.pipelineId ? { pipelineId: filters.pipelineId } : {}),
  page: filters.page,
  perPage: filters.perPage,
}))

const { data, pending, error, refresh } = useScenarios(query)
const rows = computed(() => data.value?.data ?? [])
const meta = computed(() => data.value?.meta ?? { total: 0, page: 1, perPage: 20, totalPages: 1 })

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
  await views.create(name, { ...query.value, page: undefined } as Record<string, unknown>, scope, visibleColumns.value)
  toast.success(scope === 'shared' ? 'Общее представление создано' : 'Представление сохранено')
}

watch(query, () => { views.dirty.value = true }, { deep: true })

const chips = computed<FilterChip[]>(() => {
  const out: FilterChip[] = []
  if (filters.status) out.push({ key: 'status', label: 'Статус', value: SCENARIO_STATUS_LABELS[filters.status] ?? filters.status })
  if (filters.trendId) out.push({ key: 'trendId', label: 'Тренд', value: `#${filters.trendId}` })
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
    await Promise.all(ids.map(id => $fetch(`/api/scenarios/${id}`, { method: 'DELETE' })))
    selected.value = []
    await refresh()
    toast.success(`Удалено сценариев: ${ids.length}`)
  }
  catch {
    toast.error('Не все сценарии удалось удалить')
  }
  finally {
    bulkRunning.value = false
  }
}

const drawerIndex = computed(() => rows.value.findIndex(r => r.id === drawerId.value))
const drawerRow = computed(() => (drawerIndex.value >= 0 ? rows.value[drawerIndex.value] : null))

function step(delta: number) {
  const next = rows.value[drawerIndex.value + delta]
  if (next) drawerId.value = next.id
}

/** Название сценария — заголовок принятого варианта, иначе первого. */
function titleOf(row: { variants?: Array<{ title: string, status: string }> }) {
  const accepted = row.variants?.find(v => v.status === 'accepted')
  return accepted?.title ?? row.variants?.[0]?.title ?? 'Без названия'
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
      <h1 class="text-xl font-semibold">Сценарии</h1>
      <span class="tnum text-sm text-subtle">{{ meta.total }}</span>
      <span class="flex-1" />
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
          ...Object.entries(SCENARIO_STATUS_LABELS).map(([value, label]) => ({ value, label })),
        ]"
      />
      <span class="flex-1" />
      <ListColumnsMenu v-model:visible="visibleColumns" :columns="COLUMNS" />
    </div>

    <ListFilterChips :chips="chips" @clear="clearChip" @clear-all="filters.resetFilters()" />

    <UiSkeleton v-if="pending && !rows.length" variant="table" :count="10" />

    <UiErrorState
      v-else-if="error"
      message="Не удалось загрузить сценарии."
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
      title="Сценариев пока нет"
      description="Откройте тренд и запустите генерацию — сценарии появятся здесь."
    />

    <UiTable v-else :columns="gridColumns" :min-width="minWidth">
      <UiTableHead>
        <span>
          <input
            type="checkbox"
            :checked="allOnPageSelected"
            class="size-3.5 cursor-pointer accent-(--color-accent)"
            @change="toggleAllOnPage"
          >
        </span>
        <span v-for="key in visibleColumns" :key="key" :class="key === 'variants' && 'text-right'">
          {{ COLUMNS.find(c => c.key === key)?.label }}
        </span>
        <span class="text-right">Действия</span>
      </UiTableHead>

      <UiTableRow
        v-for="row in rows"
        :key="row.id"
        :selected="selected.includes(row.id)"
        @click="drawerId = row.id"
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
            <NuxtLink :to="`/scenarios/${row.id}`" class="truncate text-sm text-fg hover:underline" @click.stop>
              {{ titleOf(row) }}
            </NuxtLink>
            <span class="shrink-0 font-mono text-[11.5px] text-subtle">scr_{{ row.id }}</span>
          </span>

          <span v-else-if="key === 'trend'" class="min-w-0">
            <NuxtLink
              v-if="row.trend"
              :to="`/trends/${row.trend.id}`"
              class="truncate text-sm text-muted hover:underline"
              @click.stop
            >
              {{ row.trend.title }}
            </NuxtLink>
            <span v-else class="text-sm text-subtle">без тренда</span>
          </span>

          <span v-else-if="key === 'variants'" class="tnum text-right font-mono text-sm">
            {{ row.variants?.length ?? 0 }}
          </span>

          <span v-else-if="key === 'status'">
            <UiStatusBadge :status="scenarioStatus(row.status)" size="xs" dot />
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
            @select="$event === 'open' ? navigateTo(`/scenarios/${row.id}`) : null"
          />
        </span>
      </UiTableRow>
    </UiTable>

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

    <UiDrawer
      :open="!!drawerRow"
      :title="drawerRow ? titleOf(drawerRow) : ''"
      :subtitle="drawerRow ? `scr_${drawerRow.id}` : ''"
      :position="drawerIndex >= 0 ? `${drawerIndex + 1} из ${rows.length}` : ''"
      :has-prev="drawerIndex > 0"
      :has-next="drawerIndex >= 0 && drawerIndex < rows.length - 1"
      @close="drawerId = null"
      @prev="step(-1)"
      @next="step(1)"
    >
      <template v-if="drawerRow">
        <UiKeyValue
          :items="[
            { label: 'Статус', value: SCENARIO_STATUS_LABELS[drawerRow.status] ?? drawerRow.status, mono: false },
            { label: 'Тренд', value: drawerRow.trend?.title ?? '—', mono: false },
            { label: 'Вариантов', value: drawerRow.variants?.length ?? 0 },
            { label: 'Создан', value: fmtDate(drawerRow.createdAt) },
          ]"
        />

        <div v-if="drawerRow.variants?.length" class="mt-3 flex flex-col gap-1.5">
          <h3 class="text-micro tracking-[.06em] text-subtle uppercase">Варианты</h3>
          <div
            v-for="v in drawerRow.variants"
            :key="v.id"
            class="flex items-start gap-2 rounded-md border border-border bg-card p-2"
          >
            <UiStatusBadge :status="variantStatus(v.status)" size="xs" dot icon-only />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm">{{ v.title }}</span>
              <span v-if="v.hook" class="block truncate text-micro text-subtle">{{ v.hook }}</span>
            </span>
          </div>
        </div>
      </template>

      <template #footer>
        <UiButton variant="primary" @click="navigateTo(`/scenarios/${drawerId}`)">Открыть полностью</UiButton>
      </template>
    </UiDrawer>
  </div>
</template>
