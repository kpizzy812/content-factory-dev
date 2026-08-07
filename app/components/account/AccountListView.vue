<script setup lang="ts">
import type { ColumnDef } from '~/components/list/ListColumnsMenu.vue'
import type { FilterChip } from '~/components/list/ListFilterChips.vue'
import { platformMeta } from '~/components/ui/platform-meta'
import { ACCOUNT_STATUS_LABELS, POSTING_METHOD_LABELS } from './AccountStatusMap'
import { needsAttention } from './AccountReadinessMap'
import { quotaLabel, quotaTitle, quotaTone } from './AccountQuotaMap'
import type { AccountRow } from './account-row'

/**
 * Список аккаунтов. Источник: design-preview/catalog/06-accounts-queue.dc.html.
 *
 * Отличия от макета записаны в implementation-spec.md, раздел 8. Колонка лимита
 * вернулась вместе с полем в API: площадка отдаёт его в момент публикации, мы
 * сохраняем снимок и показываем его возраст. Колонок недельных публикаций и
 * просмотров по-прежнему нет — этих величин нет ни в одном endpoint.
 */
const props = defineProps<{
  accounts: AccountRow[]
  apps: Array<{ id: number, name: string }>
  pending: boolean
  error?: { message: string } | null
}>()

const emit = defineEmits<{
  refresh: []
  connect: []
  create: []
  edit: [account: AccountRow]
  style: [account: AccountRow]
  disconnect: [account: AccountRow]
  'update:appId': [value: number | undefined]
}>()

const COLUMNS: ColumnDef[] = [
  { key: 'account', label: 'Аккаунт', locked: true },
  { key: 'readiness', label: 'Готовность' },
  { key: 'app', label: 'Приложение' },
  { key: 'uploads', label: 'Публикаций' },
  { key: 'groups', label: 'Группы' },
  { key: 'limit', label: 'Лимит' },
  { key: 'warmup', label: 'Прогрев' },
  { key: 'lastPosted', label: 'Последняя' },
  { key: 'status', label: 'Статус' },
]

const WIDTHS: Record<string, string> = {
  account: 'minmax(210px,1fr)',
  readiness: '136px',
  app: '150px',
  uploads: '96px',
  groups: '76px',
  limit: '104px',
  warmup: '116px',
  lastPosted: '124px',
  status: '132px',
}

const visibleColumns = ref(COLUMNS.map(c => c.key))
const gridColumns = computed(() =>
  [...visibleColumns.value.map(k => WIDTHS[k] ?? '100px'), '64px'].join(' '),
)
const minWidth = computed(() => `${300 + visibleColumns.value.length * 120}px`)

// ── Фильтры ────────────────────────────────────────────────────────────
// Своего стора у раздела нет, а API принимает только appId/platform/status —
// поиск и «требуют внимания» считаются по загруженному списку.
const search = ref('')
const platform = ref<string>('')
const status = ref<string>('')
const appId = ref<number | ''>('')
const attentionOnly = ref(false)

watch(appId, v => emit('update:appId', v === '' ? undefined : Number(v)))

const rows = computed(() => {
  const q = search.value.trim().toLowerCase()
  return props.accounts.filter((a) => {
    if (platform.value && a.platform !== platform.value) return false
    if (status.value && a.status !== status.value) return false
    if (attentionOnly.value && !needsAttention(a)) return false
    if (q && !a.displayName.toLowerCase().includes(q)) return false
    return true
  })
})

const chips = computed<FilterChip[]>(() => {
  const out: FilterChip[] = []
  if (search.value) out.push({ key: 'search', label: 'Поиск', value: search.value })
  if (platform.value) out.push({ key: 'platform', label: 'Платформа', value: platform.value })
  if (status.value) out.push({ key: 'status', label: 'Статус', value: ACCOUNT_STATUS_LABELS[status.value] ?? status.value })
  if (appId.value !== '') {
    const name = props.apps.find(a => a.id === Number(appId.value))?.name
    out.push({ key: 'appId', label: 'Приложение', value: name ?? String(appId.value) })
  }
  if (attentionOnly.value) out.push({ key: 'attentionOnly', label: 'Отбор', value: 'требуют внимания' })
  return out
})

function clearChip(key: string) {
  if (key === 'search') search.value = ''
  else if (key === 'platform') platform.value = ''
  else if (key === 'status') status.value = ''
  else if (key === 'appId') appId.value = ''
  else if (key === 'attentionOnly') attentionOnly.value = false
}

function resetFilters() {
  search.value = ''
  platform.value = ''
  status.value = ''
  appId.value = ''
  attentionOnly.value = false
}

// ── Панель деталей с навигацией по соседям ─────────────────────────────
const drawerId = ref<number | null>(null)
const drawerIndex = computed(() => rows.value.findIndex(r => r.id === drawerId.value))
const drawerRow = computed(() => (drawerIndex.value >= 0 ? rows.value[drawerIndex.value] : null))

function step(delta: number) {
  const next = rows.value[drawerIndex.value + delta]
  if (next) drawerId.value = next.id
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow',
  })
}

const { can } = usePermissions()
const canDelete = computed(() => can('canDelete'))

function onMenu(key: string, row: AccountRow) {
  if (key === 'edit') emit('edit', row)
  else if (key === 'style') emit('style', row)
  else if (key === 'queue') navigateTo(`/posting-jobs?socialAccountId=${row.id}`)
  else if (key === 'disconnect') emit('disconnect', row)
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-semibold">Аккаунты</h1>
      <span class="tnum text-sm text-subtle">{{ accounts.length }}</span>
      <span class="flex-1" />
      <UiButton :loading="pending" @click="emit('refresh')">
        <Icon v-if="!pending" name="mingcute:refresh-3-line" />
        Обновить
      </UiButton>
      <UiButton @click="emit('create')">
        <Icon name="mingcute:add-line" />
        Добавить вручную
      </UiButton>
      <UiButton variant="primary" @click="emit('connect')">
        <Icon name="mingcute:link-line" />
        Подключить аккаунт
      </UiButton>
    </div>

    <AccountSummaryBar :accounts="accounts" @show-attention="attentionOnly = true" />

    <div class="flex flex-wrap items-center gap-2">
      <UiInput v-model="search" placeholder="Поиск по названию" class="max-w-64 flex-1" />
      <UiSelect
        v-model="platform"
        class="w-40"
        :options="[
          { value: '', label: 'Все платформы' },
          { value: 'tiktok', label: 'TikTok' },
          { value: 'instagram', label: 'Instagram' },
          { value: 'youtube', label: 'YouTube' },
        ]"
      />
      <UiSelect
        v-model="status"
        class="w-44"
        :options="[
          { value: '', label: 'Любой статус' },
          ...Object.entries(ACCOUNT_STATUS_LABELS).map(([value, label]) => ({ value, label })),
        ]"
      />
      <UiSelect
        v-if="apps.length > 1"
        v-model="appId"
        class="w-48"
        :options="[
          { value: '', label: 'Все приложения' },
          ...apps.map(a => ({ value: a.id, label: a.name })),
        ]"
      />
      <span class="flex-1" />
      <ListColumnsMenu v-model:visible="visibleColumns" :columns="COLUMNS" />
    </div>

    <ListFilterChips :chips="chips" @clear="clearChip" @clear-all="resetFilters" />

    <UiSkeleton v-if="pending && !accounts.length" variant="table" :count="8" />

    <UiErrorState
      v-else-if="error"
      message="Не удалось загрузить аккаунты."
      :details="error.message"
      @retry="emit('refresh')"
    />

    <UiEmptyState
      v-else-if="!rows.length && chips.length"
      variant="search"
      title="Ничего не найдено"
      :description="`Мешают активные фильтры: ${chips.map(c => c.label).join(', ')}.`"
    >
      <UiButton @click="resetFilters">Сбросить фильтры</UiButton>
    </UiEmptyState>

    <UiEmptyState
      v-else-if="!rows.length"
      variant="first"
      title="Ни один аккаунт не подключён"
      description="Подключение идёт через официальный OAuth платформы: Instagram и Facebook — через Meta Business, TikTok — через TikTok for Developers, YouTube — через Google. Логин и пароль мы не спрашиваем."
    >
      <UiButton variant="primary" @click="emit('connect')">Подключить через OAuth</UiButton>
    </UiEmptyState>

    <UiTable v-else :columns="gridColumns" :min-width="minWidth">
      <UiTableHead>
        <template v-for="key in visibleColumns" :key="key">
          <span :class="['uploads', 'groups', 'limit'].includes(key) ? 'text-right' : ''">
            {{ COLUMNS.find(c => c.key === key)?.label }}
          </span>
        </template>
        <span class="text-right">Действия</span>
      </UiTableHead>

      <UiTableRow
        v-for="row in rows"
        :key="row.id"
        density="media"
        :selected="drawerId === row.id"
        @click="drawerId = row.id"
      >
        <template v-for="key in visibleColumns" :key="key">
          <span v-if="key === 'account'" class="flex min-w-0 items-center gap-2.5">
            <span class="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-card font-mono text-micro text-subtle">
              {{ row.displayName.replace(/^@/, '').slice(0, 2).toUpperCase() }}
            </span>
            <span class="min-w-0">
              <span class="block truncate font-mono text-sm">{{ row.displayName }}</span>
              <span class="flex items-center gap-1.5 text-micro text-subtle">
                <span class="h-2 w-1 shrink-0 rounded-[2px]" :style="{ background: platformMeta(row.platform).color }" />
                <span class="truncate">
                  {{ platformMeta(row.platform).label }} · {{ POSTING_METHOD_LABELS[row.postingMethod ?? 'api'] ?? row.postingMethod }}
                </span>
              </span>
            </span>
          </span>

          <span v-else-if="key === 'readiness'"><AccountReadinessMarks :account="row" /></span>

          <span v-else-if="key === 'app'" class="truncate text-sm text-muted">{{ row.app?.name ?? '—' }}</span>

          <span v-else-if="key === 'uploads'" class="tnum text-right font-mono text-sm">{{ row._count?.uploads ?? 0 }}</span>

          <span v-else-if="key === 'groups'" class="tnum text-right font-mono text-sm" :class="row._count?.groups ? '' : 'text-subtle'">
            {{ row._count?.groups ?? 0 }}
          </span>

          <!--
            Лимит площадки: снимок в момент последней отправки. Пока замера
            нет, стоит прочерк с пояснением — «0 / 0» здесь означало бы, что
            публиковать нельзя, а на самом деле мы просто не спрашивали.
          -->
          <span
            v-else-if="key === 'limit'"
            class="tnum text-right font-mono text-sm"
            :class="quotaTone(row)"
            :title="quotaTitle(row)"
          >
            {{ quotaLabel(row) }}
          </span>

          <span v-else-if="key === 'warmup'">
            <AccountWarmupBadge :status="row.warmupStatus" :last-warmup-at="row.lastWarmupAt" />
          </span>

          <span v-else-if="key === 'lastPosted'" class="tnum font-mono text-sm" :class="row.lastPostedAt ? 'text-muted' : 'text-subtle'">
            {{ fmtDate(row.lastPostedAt) }}
          </span>

          <span v-else-if="key === 'status'"><AccountStatusBadge :status="row.status" size="xs" /></span>
        </template>

        <span class="flex justify-end opacity-0 transition-opacity group-hover:opacity-100" @click.stop>
          <UiActionMenu
            :items="[
              { key: 'edit', label: 'Настроить аккаунт', icon: 'mingcute:settings-3-line' },
              { key: 'style', label: 'Стиль-профиль', icon: 'mingcute:palette-line' },
              { key: 'queue', label: 'Очередь публикаций', icon: 'mingcute:send-line' },
              ...(canDelete ? [{ key: 'disconnect', label: 'Отключить аккаунт', icon: 'mingcute:unlink-line', danger: true }] : []),
            ]"
            @select="onMenu($event, row)"
          />
        </span>
      </UiTableRow>
    </UiTable>

    <p v-if="rows.length" class="tnum font-mono text-micro text-subtle">
      Показано {{ rows.length }} из {{ accounts.length }}. Отметки: ТКН токен · ПРФ стиль-профиль ·
      ПРК прокси · УСТР устройство. Пунктирная отметка — проверка не нужна при постинге через API.
    </p>

    <UiDrawer
      :open="!!drawerRow"
      :title="drawerRow?.displayName ?? ''"
      :subtitle="drawerRow ? `account_${drawerRow.id}` : ''"
      :position="drawerIndex >= 0 ? `${drawerIndex + 1} из ${rows.length}` : ''"
      :has-prev="drawerIndex > 0"
      :has-next="drawerIndex >= 0 && drawerIndex < rows.length - 1"
      @close="drawerId = null"
      @prev="step(-1)"
      @next="step(1)"
    >
      <AccountDrawerBody v-if="drawerRow" :account="drawerRow" />
      <template #footer>
        <UiButton variant="primary" @click="drawerRow && emit('edit', drawerRow)">Настроить</UiButton>
        <UiButton @click="drawerRow && emit('style', drawerRow)">Стиль-профиль</UiButton>
      </template>
    </UiDrawer>
  </div>
</template>
