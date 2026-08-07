<script setup lang="ts">
import type { ColumnDef } from '~/components/list/ListColumnsMenu.vue'
import type { FilterChip } from '~/components/list/ListFilterChips.vue'
import type { SystemView } from '~/composables/useSavedViews'
import {
  ideaStatus,
  ideaAnalysisStatus,
  IDEA_STATUS_LABELS,
  IDEA_SOURCE_LABELS,
  IDEA_SYNC_LABELS,
} from './IdeaStatusMap'

/**
 * Список идей по эталону `TrendListView`.
 *
 * Режим карточек здесь второй, а не основной: идея — это в первую очередь
 * текст, и в таблице за раз видно втрое больше, чем плитками.
 *
 * Сортировка по статусу и дате — на сервере; остальные колонки не кликабельны.
 */
const filters = useIdeaFiltersStore()

function onSort(value: string) {
  filters.sort = value
  filters.resetPage()
}

const { can } = usePermissions()
const canDelete = computed(() => can('canDelete'))
const toast = useToast()

const SYSTEM_VIEWS: SystemView[] = [
  { key: 'all', name: 'Все', query: {} },
  { key: 'ready', name: 'Разобраны, ждут работы', query: { status: 'ready' } },
  { key: 'inwork', name: 'В работе', query: { status: 'in_work' } },
  { key: 'failed', name: 'С ошибкой', query: { status: 'failed' } },
]

const COLUMNS: ColumnDef[] = [
  { key: 'title', label: 'Идея', locked: true },
  { key: 'source', label: 'Источник' },
  { key: 'analysis', label: 'Разбор' },
  { key: 'status', label: 'Статус' },
  { key: 'created', label: 'Добавлена' },
]


/**
 * Сортировка. Ключ колонки и поле сортировки — разные вещи: «Создан» это
 * колонка `created`, а сервер сортирует по `createdAt`. Колонки без поля не
 * кликабельны: заголовок, который ничего не меняет, хуже отсутствующего.
 */
const SORT_KEYS: Record<string, string | undefined> = {
  status: 'status',
  created: 'createdAt',
}

const WIDTHS: Record<string, string> = {
  title: 'minmax(260px,1fr)',
  source: '148px',
  analysis: '124px',
  status: '140px',
  created: '124px',
}

const visibleColumns = ref(COLUMNS.map(c => c.key))
const gridColumns = computed(() =>
  ['32px', '40px', ...visibleColumns.value.map(k => WIDTHS[k] ?? '100px'), '76px'].join(' '),
)
const minWidth = computed(() => `${420 + visibleColumns.value.length * 110}px`)

const views = useSavedViews('ideas', SYSTEM_VIEWS)

const mode = ref<'table' | 'cards'>('table')
const selected = ref<number[]>([])
const drawerId = ref<number | null>(null)

const { data, pending, error, refresh } = useIdeas(computed(() => filters.query))
const rows = computed(() => data.value?.data ?? [])
const meta = computed(() => data.value?.meta ?? { total: 0, page: 1, perPage: 20, totalPages: 1 })

defineExpose({ refresh })

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
  if (filters.status) out.push({ key: 'status', label: 'Статус', value: IDEA_STATUS_LABELS[filters.status] ?? filters.status })
  if (filters.source) out.push({ key: 'source', label: 'Источник', value: IDEA_SOURCE_LABELS[filters.source] ?? filters.source })
  if (filters.analysisStatus) out.push({ key: 'analysisStatus', label: 'Разбор', value: filters.analysisStatus })
  if (filters.syncStatus) out.push({ key: 'syncStatus', label: 'Синхронизация', value: IDEA_SYNC_LABELS[filters.syncStatus] ?? filters.syncStatus })
  if (filters.runId) out.push({ key: 'runId', label: 'Запуск', value: `#${filters.runId}` })
  if (filters.pipelineId) out.push({ key: 'pipelineId', label: 'Конвейер', value: `#${filters.pipelineId}` })
  return out
})

function clearChip(key: string) {
  const numeric = key === 'runId' || key === 'pipelineId' || key === 'appId'
  ;(filters as unknown as Record<string, unknown>)[key] = numeric ? undefined : ''
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
    await Promise.all(ids.map(id => $fetch(`/api/ideas/${id}`, { method: 'DELETE' })))
    selected.value = []
    await refresh()
    toast.success(`Удалено идей: ${ids.length}`)
  }
  catch {
    toast.error('Не все идеи удалось удалить')
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

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow',
  })
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-semibold">Идеи</h1>
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
        class="w-44"
        :options="[
          { value: '', label: 'Любой статус' },
          ...Object.entries(IDEA_STATUS_LABELS).map(([value, label]) => ({ value, label })),
        ]"
      />
      <UiSelect
        v-model="filters.source"
        class="w-44"
        :options="[
          { value: '', label: 'Любой источник' },
          ...Object.entries(IDEA_SOURCE_LABELS).map(([value, label]) => ({ value, label })),
        ]"
      />
      <span class="flex-1" />
      <ListColumnsMenu v-if="mode === 'table'" v-model:visible="visibleColumns" :columns="COLUMNS" />
    </div>

    <ListFilterChips :chips="chips" @clear="clearChip" @clear-all="filters.resetFilters()" />

    <UiSkeleton v-if="pending && !rows.length" :variant="mode === 'table' ? 'table' : 'cards'" :count="10" />

    <UiErrorState
      v-else-if="error"
      message="Не удалось загрузить идеи."
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
      title="Идей пока нет"
      description="Добавьте ссылку на ролик формой выше или пришлите её боту в Telegram."
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
        <span />
        <UiTableHeadCell
          v-for="key in visibleColumns"
          :key="key"
          :sort-key="SORT_KEYS[key]"
          :sort="filters.sort"
          
          @sort="onSort"
        >
          {{ COLUMNS.find(c => c.key === key)?.label }}
        </UiTableHeadCell>
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
        <span>
          <img
            v-if="row.thumbnailUrl"
            :src="row.thumbnailUrl"
            :alt="row.title ?? ''"
            class="size-7 rounded-sm object-cover"
            referrerpolicy="no-referrer"
          >
          <span v-else class="block size-7 rounded-sm bg-neutral-bg" />
        </span>

        <template v-for="key in visibleColumns" :key="key">
          <span v-if="key === 'title'" class="flex min-w-0 items-baseline gap-2">
            <NuxtLink :to="`/ideas/${row.id}`" class="truncate text-sm text-fg hover:underline" @click.stop>
              {{ row.title || row.sourceUrl || 'Без названия' }}
            </NuxtLink>
            <span v-if="row.platform" class="shrink-0 font-mono text-[11.5px] text-subtle">{{ row.platform }}</span>
          </span>

          <span v-else-if="key === 'source'" class="truncate text-sm text-muted">
            {{ IDEA_SOURCE_LABELS[row.source] ?? row.source }}
          </span>

          <span v-else-if="key === 'analysis'">
            <UiStatusBadge :status="ideaAnalysisStatus(row.analysisStatus)" size="xs" dot />
          </span>

          <span v-else-if="key === 'status'">
            <UiStatusBadge :status="ideaStatus(row.status)" size="xs" dot />
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
            @select="$event === 'open' ? navigateTo(`/ideas/${row.id}`) : null"
          />
        </span>
      </UiTableRow>
    </UiTable>

    <div v-else class="grid gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
      <UiEntityCard
        v-for="row in rows"
        :key="row.id"
        selectable
        :title="row.title || row.sourceUrl || 'Без названия'"
        :subtitle="IDEA_SOURCE_LABELS[row.source] ?? row.source"
        :thumbnail="row.thumbnailUrl"
        :selected="selected.includes(row.id)"
        @update:selected="toggleRow(row.id)"
      >
        <template #badges>
          <UiStatusBadge :status="ideaStatus(row.status)" size="xs" dot />
        </template>
        <template #actions>
          <UiButton variant="primary" @click="navigateTo(`/ideas/${row.id}`)">Открыть</UiButton>
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

    <UiDrawer
      :open="!!drawerRow"
      :title="drawerRow?.title || drawerRow?.sourceUrl || ''"
      :subtitle="drawerRow ? `idea_${drawerRow.id}` : ''"
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
            { label: 'Источник', value: IDEA_SOURCE_LABELS[drawerRow.source] ?? drawerRow.source, mono: false },
            { label: 'Площадка', value: drawerRow.platform, mono: false },
            { label: 'Статус', value: IDEA_STATUS_LABELS[drawerRow.status] ?? drawerRow.status, mono: false },
            { label: 'Разбор', value: drawerRow.analysisStatus, mono: false },
            { label: 'Добавлена', value: fmtDate(drawerRow.createdAt) },
          ]"
        />
        <p v-if="drawerRow.hook" class="mt-3 text-sm">
          <span class="block text-micro tracking-[.06em] text-subtle uppercase">Хук</span>
          {{ drawerRow.hook }}
        </p>
      </template>

      <template #footer>
        <UiButton variant="primary" @click="navigateTo(`/ideas/${drawerId}`)">Открыть полностью</UiButton>
      </template>
    </UiDrawer>
  </div>
</template>
