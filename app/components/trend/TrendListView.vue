<script setup lang="ts">
import type { ColumnDef } from '~/components/list/ListColumnsMenu.vue'
import type { FilterChip } from '~/components/list/ListFilterChips.vue'
import type { SystemView } from '~/composables/useSavedViews'
import { trendStatus, TREND_STATUS_LABELS } from './TrendStatusMap'

/**
 * Эталонный список сущностей на примере трендов.
 * Источник: design-preview/catalog/02-list-trends.dc.html
 *
 * По этому образцу строятся ~20 разделов. Всё, что специфично для трендов,
 * помечено ЗАМЕНЯЕМАЯ ЧАСТЬ — при переносе меняется только оно.
 */
const filters = useTrendFiltersStore()
const { canDelete } = usePermissions()
const toast = useToast()

// ── ЗАМЕНЯЕМАЯ ЧАСТЬ: системные представления раздела ──────────────────
const SYSTEM_VIEWS: SystemView[] = [
  { key: 'all', name: 'Все', query: {} },
  { key: 'fresh', name: 'Новые за 24 часа', query: { status: 'new', sort: '-importedAt' } },
  { key: 'viral', name: 'Высокая виральность', query: { sort: '-viralityScore' } },
  { key: 'inwork', name: 'Взято в работу', query: { status: 'in_work' } },
]

// ── ЗАМЕНЯЕМАЯ ЧАСТЬ: колонки ──────────────────────────────────────────
const COLUMNS: ColumnDef[] = [
  { key: 'title', label: 'Название', locked: true },
  { key: 'platform', label: 'Платформа' },
  { key: 'views', label: 'Просмотры' },
  { key: 'virality', label: 'Виральность' },
  { key: 'status', label: 'Статус' },
  { key: 'imported', label: 'Импортирован' },
]

const WIDTHS: Record<string, string> = {
  title: 'minmax(220px,1fr)',
  platform: '108px',
  views: '96px',
  virality: '116px',
  status: '128px',
  imported: '116px',
}

const visibleColumns = ref(COLUMNS.map(c => c.key))
const gridColumns = computed(() =>
  ['32px', '40px', ...visibleColumns.value.map(k => WIDTHS[k] ?? '100px'), '76px'].join(' '),
)
const minWidth = computed(() => `${420 + visibleColumns.value.length * 110}px`)

const views = useSavedViews('trends', SYSTEM_VIEWS)

const mode = ref<'table' | 'cards'>('table')
const selected = ref<number[]>([])
const drawerId = ref<number | null>(null)

const { data, pending, error, refresh } = useTrends(computed(() => filters.query))
const rows = computed(() => data.value?.data ?? [])
const meta = computed(() => data.value?.meta ?? { total: 0, page: 1, perPage: 25, totalPages: 1 })

// ── Представления ──────────────────────────────────────────────────────
function applyView(id: string | number) {
  const view = views.all.value.find(v => String(v.id) === String(id))
  if (!view) return
  views.select(id)
  filters.reset()
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

// Любая правка фильтра помечает вид как изменённый — оригинал не трогаем.
watch(() => filters.query, () => { views.dirty.value = true }, { deep: true })

// ── Фильтры чипами ─────────────────────────────────────────────────────
const chips = computed<FilterChip[]>(() => {
  const out: FilterChip[] = []
  if (filters.search) out.push({ key: 'search', label: 'Поиск', value: filters.search })
  if (filters.platform) out.push({ key: 'platform', label: 'Платформа', value: filters.platform })
  if (filters.status) out.push({ key: 'status', label: 'Статус', value: TREND_STATUS_LABELS[filters.status] ?? filters.status })
  if (filters.language) out.push({ key: 'language', label: 'Язык', value: filters.language })
  if (filters.viewCountMin) out.push({ key: 'viewCountMin', label: 'Просмотров от', value: filters.viewCountMin })
  return out
})

function clearChip(key: string) {
  ;(filters as unknown as Record<string, unknown>)[key] = ''
  filters.resetPage()
}

// ── Выделение и массовые действия ──────────────────────────────────────
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
    await Promise.all(ids.map(id => $fetch(`/api/trends/${id}`, { method: 'DELETE' })))
    selected.value = []
    await refresh()
    toast.success(`Удалено трендов: ${ids.length}`)
  }
  catch {
    toast.error('Не все тренды удалось удалить')
  }
  finally {
    bulkRunning.value = false
  }
}

// ── Панель деталей с навигацией по соседям ─────────────────────────────
const drawerIndex = computed(() => rows.value.findIndex(r => r.id === drawerId.value))
const drawerRow = computed(() => (drawerIndex.value >= 0 ? rows.value[drawerIndex.value] : null))

function step(delta: number) {
  const next = rows.value[drawerIndex.value + delta]
  if (next) drawerId.value = next.id
}

function fmt(n: number | null | undefined) {
  return (n ?? 0).toLocaleString('ru-RU')
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow',
  })
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Шапка раздела -->
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-semibold">Тренды</h1>
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

      <!-- ЗАМЕНЯЕМАЯ ЧАСТЬ: основное действие раздела -->
      <UiButton variant="primary" @click="refresh()">
        <Icon name="mingcute:download-2-line" />
        Импортировать тренды
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

    <!-- ЗАМЕНЯЕМАЯ ЧАСТЬ: набор фильтров раздела -->
    <div class="flex flex-wrap items-center gap-2">
      <UiInput v-model="filters.search" placeholder="Поиск по названию и автору" class="max-w-64" />
      <UiSelect
        v-model="filters.platform"
        class="w-40"
        placeholder="Платформа"
        :options="[
          { value: '', label: 'Все платформы' },
          { value: 'tiktok', label: 'TikTok' },
          { value: 'instagram', label: 'Instagram' },
          { value: 'youtube', label: 'YouTube' },
        ]"
      />
      <UiSelect
        v-model="filters.status"
        class="w-44"
        :options="[
          { value: '', label: 'Любой статус' },
          ...Object.entries(TREND_STATUS_LABELS).map(([value, label]) => ({ value, label })),
        ]"
      />
      <span class="flex-1" />
      <ListColumnsMenu v-if="mode === 'table'" v-model:visible="visibleColumns" :columns="COLUMNS" />
    </div>

    <ListFilterChips :chips="chips" @clear="clearChip" @clear-all="filters.reset()" />

    <!-- Состояния -->
    <UiSkeleton v-if="pending && !rows.length" variant="table" :count="10" />

    <UiErrorState
      v-else-if="error"
      message="Не удалось загрузить тренды."
      :details="error.message"
      @retry="refresh()"
    />

    <UiEmptyState
      v-else-if="!rows.length && chips.length"
      variant="search"
      title="Ничего не найдено"
      :description="`Мешают активные фильтры: ${chips.map(c => c.label).join(', ')}.`"
    >
      <UiButton @click="filters.reset()">Сбросить фильтры</UiButton>
    </UiEmptyState>

    <UiEmptyState
      v-else-if="!rows.length"
      variant="first"
      title="Трендов пока нет"
      description="Создайте профиль парсинга — тренды начнут приезжать автоматически."
    />

    <!-- Таблица -->
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
        <template v-for="key in visibleColumns" :key="key">
          <UiTableHeadCell
            :sort-key="key === 'views' ? 'viewCount' : key === 'virality' ? 'viralityScore' : key === 'imported' ? 'importedAt' : key"
            :sort="filters.sort"
            :align="['views', 'virality'].includes(key) ? 'right' : 'left'"
            @sort="filters.sort = $event"
          >
            {{ COLUMNS.find(c => c.key === key)?.label }}
          </UiTableHeadCell>
        </template>
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
            :alt="row.title"
            class="size-7 rounded-sm object-cover"
            referrerpolicy="no-referrer"
          >
          <span v-else class="block size-7 rounded-sm bg-neutral-bg" />
        </span>

        <template v-for="key in visibleColumns" :key="key">
          <span v-if="key === 'title'" class="flex min-w-0 items-baseline gap-2">
            <NuxtLink :to="`/trends/${row.id}`" class="truncate text-sm text-fg hover:underline" @click.stop>
              {{ row.title || 'Без названия' }}
            </NuxtLink>
            <span v-if="row.authorName" class="shrink-0 font-mono text-[11.5px] text-subtle">{{ row.authorName }}</span>
          </span>

          <span v-else-if="key === 'platform'"><UiPlatformBadge :platform="row.platform" /></span>

          <span v-else-if="key === 'views'" class="tnum text-right font-mono text-sm">{{ fmt(row.viewCount) }}</span>

          <span v-else-if="key === 'virality'" class="flex items-center justify-end gap-[7px]">
            <span class="h-[5px] w-11 overflow-hidden rounded-full bg-neutral-bg">
              <span class="block h-full bg-accent" :style="{ width: `${Math.min((row.viralityScore ?? 0) * 10, 100)}%` }" />
            </span>
            <span class="tnum w-7 text-right font-mono text-sm">{{ (row.viralityScore ?? 0).toFixed(1) }}</span>
          </span>

          <span v-else-if="key === 'status'"><UiStatusBadge :status="trendStatus(row.status)" size="xs" dot /></span>

          <span v-else-if="key === 'imported'" class="tnum font-mono text-sm text-muted">{{ fmtDate(row.importedAt) }}</span>
        </template>

        <span class="flex justify-end opacity-0 transition-opacity group-hover:opacity-100" @click.stop>
          <UiActionMenu
            :items="[
              { key: 'open', label: 'Открыть', icon: 'mingcute:external-link-line' },
              ...(canDelete ? [{ key: 'delete', label: 'Удалить', icon: 'mingcute:delete-2-line', danger: true }] : []),
            ]"
            @select="$event === 'open' ? navigateTo(`/trends/${row.id}`) : null"
          />
        </span>
      </UiTableRow>
    </UiTable>

    <!-- Карточки -->
    <div v-else class="grid gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
      <UiEntityCard
        v-for="row in rows"
        :key="row.id"
        selectable
        :title="row.title || 'Без названия'"
        :subtitle="row.authorName ?? undefined"
        :thumbnail="row.thumbnailUrl"
        :selected="selected.includes(row.id)"
        @update:selected="toggleRow(row.id)"
      >
        <template #badges>
          <UiStatusBadge :status="trendStatus(row.status)" size="xs" dot />
        </template>
        <template #meta>
          <span class="tnum font-mono text-micro text-muted">{{ fmt(row.viewCount) }} просмотров</span>
        </template>
        <template #actions>
          <UiButton variant="primary" @click="navigateTo(`/trends/${row.id}`)">Открыть</UiButton>
        </template>
      </UiEntityCard>
    </div>

    <UiBulkActionBar
      :selected="selected.length"
      :total="meta.total"
      :page-selected="allOnPageSelected"
      @clear="selected = []"
    >
      <UiButton :loading="bulkRunning">Взять в работу</UiButton>
      <UiButton :loading="bulkRunning">Отправить в конвейер</UiButton>
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

    <!-- Детали без ухода со списка -->
    <UiDrawer
      :open="!!drawerRow"
      :title="drawerRow?.title ?? ''"
      :subtitle="drawerRow ? `trend_${drawerRow.id}` : ''"
      :position="drawerIndex >= 0 ? `${drawerIndex + 1} из ${rows.length}` : ''"
      :has-prev="drawerIndex > 0"
      :has-next="drawerIndex >= 0 && drawerIndex < rows.length - 1"
      @close="drawerId = null"
      @prev="step(-1)"
      @next="step(1)"
    >
      <UiKeyValue
        v-if="drawerRow"
        :items="[
          { label: 'Платформа', value: drawerRow.platform, mono: false },
          { label: 'Автор', value: drawerRow.authorName },
          { label: 'Просмотры', value: fmt(drawerRow.viewCount) },
          { label: 'Лайки', value: fmt(drawerRow.likeCount) },
          { label: 'Виральность', value: (drawerRow.viralityScore ?? 0).toFixed(1) },
          { label: 'Импортирован', value: fmtDate(drawerRow.importedAt) },
        ]"
      />
      <template #footer>
        <UiButton variant="primary" @click="navigateTo(`/trends/${drawerId}`)">Открыть полностью</UiButton>
      </template>
    </UiDrawer>
  </div>
</template>
