<script setup lang="ts">
import type { ColumnDef } from '~/components/list/ListColumnsMenu.vue'
import type { FilterChip } from '~/components/list/ListFilterChips.vue'
import type { SystemView } from '~/composables/useSavedViews'
import type { EntityStatus } from '~~/shared/utils/entity-status'

/**
 * Список публикаций через официальные API по эталону `TrendListView`.
 *
 * Ошибка публикации показывается прямо в строке, а не только в карточке:
 * оператор разбирает очередь пачкой и не должен открывать каждую, чтобы
 * понять, что именно упало.
 */
const UPLOAD_STATUS_TO_ENTITY: Record<string, EntityStatus> = {
  pending: 'queued',
  scheduled: 'queued',
  uploading: 'running',
  published: 'done',
  failed: 'failed',
  canceled: 'cancelled',
  blocked_by_env: 'blocked',
}

const UPLOAD_STATUS_LABELS: Record<string, string> = {
  pending: 'Ожидает',
  scheduled: 'Запланирована',
  uploading: 'Загружается',
  published: 'Опубликована',
  failed: 'Ошибка',
  canceled: 'Отменена',
  blocked_by_env: 'Постинг выключен',
}

function uploadStatus(raw: string | null | undefined): EntityStatus {
  return UPLOAD_STATUS_TO_ENTITY[raw ?? ''] ?? 'draft'
}

const filters = useUploadFiltersStore()
const { canDelete } = usePermissions()
const toast = useToast()

const SYSTEM_VIEWS: SystemView[] = [
  { key: 'all', name: 'Все', query: {} },
  { key: 'queue', name: 'В очереди', query: { status: 'pending' } },
  { key: 'scheduled', name: 'Запланированы', query: { status: 'scheduled' } },
  { key: 'failed', name: 'Упавшие', query: { status: 'failed' } },
]

const COLUMNS: ColumnDef[] = [
  { key: 'video', label: 'Ролик', locked: true },
  { key: 'account', label: 'Аккаунт' },
  { key: 'status', label: 'Статус' },
  { key: 'scheduled', label: 'Запланирована' },
  { key: 'created', label: 'Создана' },
]

const WIDTHS: Record<string, string> = {
  video: 'minmax(220px,1fr)',
  account: 'minmax(180px,240px)',
  status: '168px',
  scheduled: '132px',
  created: '124px',
}

const visibleColumns = ref(COLUMNS.map(c => c.key))
const gridColumns = computed(() =>
  ['32px', ...visibleColumns.value.map(k => WIDTHS[k] ?? '100px'), '76px'].join(' '),
)
const minWidth = computed(() => `${380 + visibleColumns.value.length * 110}px`)

const views = useSavedViews('uploads', SYSTEM_VIEWS)

const selected = ref<number[]>([])
const drawerId = ref<number | null>(null)

const { data, pending, error, refresh } = useUploads(computed(() => filters.query))
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
  await views.create(name, { ...filters.query, page: undefined } as Record<string, unknown>, scope, visibleColumns.value)
  toast.success(scope === 'shared' ? 'Общее представление создано' : 'Представление сохранено')
}

watch(() => filters.query, () => { views.dirty.value = true }, { deep: true })

const chips = computed<FilterChip[]>(() => {
  const out: FilterChip[] = []
  if (filters.status) out.push({ key: 'status', label: 'Статус', value: UPLOAD_STATUS_LABELS[filters.status] ?? filters.status })
  if (filters.videoId) out.push({ key: 'videoId', label: 'Ролик', value: `#${filters.videoId}` })
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
    await Promise.all(ids.map(id => $fetch(`/api/uploads/${id}`, { method: 'DELETE' })))
    selected.value = []
    await refresh()
    toast.success(`Удалено загрузок: ${ids.length}`)
  }
  catch {
    toast.error('Не все загрузки удалось удалить')
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

function videoTitleOf(row: { video?: { scenario?: { variants?: Array<{ title: string }> } | null, id: number } | null, videoId: number }) {
  return row.video?.scenario?.variants?.[0]?.title ?? `Ролик ${row.videoId}`
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow',
  })
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-semibold">Загрузки</h1>
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
        class="w-56"
        :options="[
          { value: '', label: 'Любой статус' },
          ...Object.entries(UPLOAD_STATUS_LABELS).map(([value, label]) => ({ value, label })),
        ]"
      />
      <span class="flex-1" />
      <ListColumnsMenu v-model:visible="visibleColumns" :columns="COLUMNS" />
    </div>

    <ListFilterChips :chips="chips" @clear="clearChip" @clear-all="filters.resetFilters()" />

    <UiSkeleton v-if="pending && !rows.length" variant="table" :count="10" />

    <UiErrorState
      v-else-if="error"
      message="Не удалось загрузить список публикаций."
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
      title="Загрузок пока нет"
      description="Откройте готовый ролик и нажмите «Загрузить в соцсети»."
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
        <span v-for="key in visibleColumns" :key="key">
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
          <span v-if="key === 'video'" class="flex min-w-0 items-baseline gap-2">
            <NuxtLink :to="`/videos/${row.videoId}`" class="truncate text-sm text-fg hover:underline" @click.stop>
              {{ videoTitleOf(row) }}
            </NuxtLink>
            <span class="shrink-0 font-mono text-[11.5px] text-subtle">vid_{{ row.videoId }}</span>
          </span>

          <span v-else-if="key === 'account'" class="flex min-w-0 items-center gap-2">
            <UiPlatformBadge v-if="row.socialAccount" :platform="row.socialAccount.platform" />
            <span class="truncate text-sm text-muted">{{ row.socialAccount?.displayName ?? '—' }}</span>
          </span>

          <span v-else-if="key === 'status'" class="flex min-w-0 items-center gap-1.5">
            <UiStatusBadge :status="uploadStatus(row.status)" size="xs" dot />
            <UiTooltip v-if="row.errorMessage" :text="row.errorMessage">
              <Icon name="mingcute:alert-line" class="text-danger" />
            </UiTooltip>
          </span>

          <span v-else-if="key === 'scheduled'" class="tnum font-mono text-sm text-muted">
            {{ fmtDate(row.scheduledAt) ?? '—' }}
          </span>

          <span v-else-if="key === 'created'" class="tnum font-mono text-sm text-muted">
            {{ fmtDate(row.createdAt) }}
          </span>
        </template>

        <span class="flex justify-end opacity-0 transition-opacity group-hover:opacity-100" @click.stop>
          <UiActionMenu
            :items="[
              { key: 'video', label: 'Открыть ролик', icon: 'mingcute:external-link-line' },
              ...(canDelete ? [{ key: 'delete', label: 'Удалить', icon: 'mingcute:delete-2-line', danger: true }] : []),
            ]"
            @select="$event === 'video' ? navigateTo(`/videos/${row.videoId}`) : null"
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
      :title="drawerRow ? videoTitleOf(drawerRow) : ''"
      :subtitle="drawerRow ? `upload_${drawerRow.id}` : ''"
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
            { label: 'Аккаунт', value: drawerRow.socialAccount?.displayName ?? '—', mono: false },
            { label: 'Площадка', value: drawerRow.socialAccount?.platform ?? '—', mono: false },
            { label: 'Статус', value: UPLOAD_STATUS_LABELS[drawerRow.status] ?? drawerRow.status, mono: false },
            { label: 'Запланирована', value: fmtDate(drawerRow.scheduledAt) ?? '—' },
            { label: 'Создана', value: fmtDate(drawerRow.createdAt) },
          ]"
        />
        <p v-if="drawerRow.title" class="mt-3 text-sm">{{ drawerRow.title }}</p>
        <p
          v-if="drawerRow.errorMessage"
          class="mt-3 rounded-md border border-danger-border bg-danger-bg p-2.5 text-sm text-danger"
        >
          {{ drawerRow.errorMessage }}
        </p>
      </template>

      <template #footer>
        <UiButton variant="primary" @click="navigateTo(`/videos/${drawerRow?.videoId}`)">
          Открыть ролик
        </UiButton>
      </template>
    </UiDrawer>
  </div>
</template>
