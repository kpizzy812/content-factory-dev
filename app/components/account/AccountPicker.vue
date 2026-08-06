<script setup lang="ts">
/**
 * Выбор аккаунта или пачки аккаунтов. Используется настройкой узла публикации
 * в конвейере.
 *
 * Предупреждения (платформа не та, аккаунт не активен, пачка пустая) стоят
 * прямо под списком: это причины, по которым публикация не уйдёт, и узнавать
 * о них после запуска дорого.
 */
import { platformMeta } from '~/components/ui/platform-meta'
import { ACCOUNT_STATUS_LABELS } from './AccountStatusMap'

interface AccountItem {
  id: number
  appId: number
  platform: string
  displayName: string
  status: string
  expiresAt?: string | null
  lastPostedAt?: string | null
  profileCompleteness?: number
  app?: { id: number, name: string } | null
  styleProfile?: { status?: string } | null
}

interface GroupItem {
  id: number
  appId: number
  name: string
  dispatchMode: string
  activeMembersCount: number
  app?: { id: number, name: string } | null
  members: Array<{
    id: number
    socialAccount: { id: number, platform: string, displayName: string, status: string, lastPostedAt?: string | null }
  }>
}

const props = withDefaults(defineProps<{
  mode?: 'account' | 'group'
  socialAccountId?: number | null
  accountGroupId?: number | null
  dispatchMode?: 'round_robin' | 'all' | 'first_active'
  appId?: number | null
  targetPlatform?: string | null
}>(), {
  mode: 'account',
  socialAccountId: null,
  accountGroupId: null,
  dispatchMode: 'round_robin',
  appId: null,
  targetPlatform: null,
})

const emit = defineEmits<{
  'update:mode': [value: 'account' | 'group']
  'update:socialAccountId': [value: number | null]
  'update:accountGroupId': [value: number | null]
  'update:dispatchMode': [value: 'round_robin' | 'all' | 'first_active']
}>()

const showAllApps = ref(false)
const search = ref('')
const platformFilter = ref<string>('')

const queryFilters = computed(() => {
  const f: Record<string, string | number> = {}
  if (props.appId && !showAllApps.value) f.appId = props.appId
  if (platformFilter.value) f.platform = platformFilter.value
  return f
})

const { data: accountsResp, refresh: refreshAccounts } = useFetch<{ data: AccountItem[] }>(
  '/api/accounts',
  { query: queryFilters, watch: [queryFilters] },
)
const { data: groupsResp, refresh: refreshGroups } = useFetch<{ data: GroupItem[] }>(
  '/api/account-groups',
  { query: queryFilters, watch: [queryFilters] },
)

const accounts = computed<AccountItem[]>(() => accountsResp.value?.data ?? [])
const groups = computed<GroupItem[]>(() => groupsResp.value?.data ?? [])

const filteredAccounts = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return accounts.value
  return accounts.value.filter(a =>
    a.displayName.toLowerCase().includes(q)
    || a.platform.toLowerCase().includes(q)
    || (a.app?.name?.toLowerCase().includes(q) ?? false),
  )
})

const filteredGroups = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return groups.value
  return groups.value.filter(g =>
    g.name.toLowerCase().includes(q)
    || (g.app?.name?.toLowerCase().includes(q) ?? false),
  )
})

const selectedAccount = computed(() => accounts.value.find(a => a.id === props.socialAccountId) ?? null)
const selectedGroup = computed(() => groups.value.find(g => g.id === props.accountGroupId) ?? null)

const DISPATCH_OPTIONS = [
  { value: 'round_robin', label: 'По кругу — следующий аккаунт на каждый ролик' },
  { value: 'all', label: 'Во все сразу — ролик уходит в каждый аккаунт' },
  { value: 'first_active', label: 'В первый активный' },
]

const DISPATCH_SHORT: Record<string, string> = {
  round_robin: 'по кругу',
  all: 'во все',
  first_active: 'в первый',
}

function pickGroup(g: GroupItem) {
  emit('update:accountGroupId', g.id)
  // Режим раздачи у пачки уже задан — берём его как исходный.
  if (g.dispatchMode === 'round_robin' || g.dispatchMode === 'all' || g.dispatchMode === 'first_active') {
    emit('update:dispatchMode', g.dispatchMode)
  }
}

function setDispatchMode(value: string | number) {
  if (value === 'round_robin' || value === 'all' || value === 'first_active') {
    emit('update:dispatchMode', value)
  }
}

const platformMismatch = computed(() => {
  if (!props.targetPlatform || props.mode !== 'account' || !selectedAccount.value) return null
  if (selectedAccount.value.platform === props.targetPlatform) return null
  return `Аккаунт «${selectedAccount.value.displayName}» — ${platformMeta(selectedAccount.value.platform).label}, `
    + `а ролик готовится под ${platformMeta(props.targetPlatform).label}.`
})

const groupHasNoActiveMembers = computed(() => {
  if (props.mode !== 'group' || !selectedGroup.value) return false
  return selectedGroup.value.activeMembersCount === 0
})

defineExpose({ refreshAccounts, refreshGroups })
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex w-fit overflow-hidden rounded-md border border-border">
      <button
        v-for="m in (['account', 'group'] as const)"
        :key="m"
        type="button"
        class="flex h-7 cursor-pointer items-center gap-1.5 px-3 text-sm"
        :class="mode === m ? 'bg-accent text-on-accent' : 'bg-card text-muted hover:text-fg'"
        @click="emit('update:mode', m)"
      >
        <Icon :name="m === 'account' ? 'mingcute:user-3-line' : 'mingcute:group-line'" />
        {{ m === 'account' ? 'Аккаунт' : 'Пачка' }}
      </button>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <UiInput v-model="search" class="min-w-40 flex-1" placeholder="Поиск" />
      <UiSelect
        v-model="platformFilter"
        class="w-40"
        :options="[
          { value: '', label: 'Все платформы' },
          { value: 'youtube', label: 'YouTube' },
          { value: 'tiktok', label: 'TikTok' },
          { value: 'instagram', label: 'Instagram' },
        ]"
      />
      <label v-if="appId" class="flex cursor-pointer items-center gap-2 text-sm text-muted">
        <input v-model="showAllApps" type="checkbox" class="size-3.5 cursor-pointer accent-(--color-accent)">
        Все приложения
      </label>
    </div>

    <div v-if="mode === 'account'">
      <UiEmptyState
        v-if="!filteredAccounts.length"
        variant="search"
        title="Аккаунтов не нашлось"
        description="Смените фильтры или подключите аккаунт в разделе «Аккаунты»."
      />
      <div v-else class="max-h-64 overflow-y-auto rounded-md border border-border">
        <button
          v-for="acc in filteredAccounts"
          :key="acc.id"
          type="button"
          class="flex w-full cursor-pointer items-center gap-2.5 border-b border-divider px-2.5 py-2 text-left last:border-b-0"
          :class="socialAccountId === acc.id ? 'bg-accent-bg' : 'hover:bg-card'"
          @click="emit('update:socialAccountId', acc.id)"
        >
          <span class="h-5 w-1 shrink-0 rounded-[2px]" :style="{ background: platformMeta(acc.platform).color }" />
          <span class="min-w-0 flex-1">
            <span class="block truncate font-mono text-sm">{{ acc.displayName }}</span>
            <span class="block truncate text-micro text-subtle">
              {{ acc.app?.name ?? `приложение #${acc.appId}` }}
              <template v-if="acc.lastPostedAt">
                · публиковал {{ new Date(acc.lastPostedAt).toLocaleDateString('ru-RU') }}
              </template>
            </span>
          </span>
          <AccountStatusBadge :status="acc.status" size="xs" />
        </button>
      </div>
    </div>

    <div v-else class="flex flex-col gap-2">
      <UiEmptyState
        v-if="!filteredGroups.length"
        variant="search"
        title="Пачек не нашлось"
        description="Пачки заводятся на странице аккаунтов или на карточке приложения."
      />
      <div v-else class="max-h-64 overflow-y-auto rounded-md border border-border">
        <button
          v-for="g in filteredGroups"
          :key="g.id"
          type="button"
          class="flex w-full cursor-pointer items-center gap-2.5 border-b border-divider px-2.5 py-2 text-left last:border-b-0"
          :class="accountGroupId === g.id ? 'bg-accent-bg' : 'hover:bg-card'"
          @click="pickGroup(g)"
        >
          <Icon name="mingcute:group-line" class="shrink-0 text-muted" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium">{{ g.name }}</span>
            <span class="tnum block truncate text-micro text-subtle">
              {{ g.app?.name ?? `приложение #${g.appId}` }} · активных {{ g.activeMembersCount }} из {{ g.members.length }}
            </span>
          </span>
          <span class="shrink-0 rounded-sm border border-border bg-card px-1.5 py-0.5 text-micro text-muted">
            {{ DISPATCH_SHORT[g.dispatchMode] ?? g.dispatchMode }}
          </span>
        </button>
      </div>

      <UiField v-if="selectedGroup" label="Раздача роликов">
        <UiSelect :model-value="dispatchMode" :options="DISPATCH_OPTIONS" @update:model-value="setDispatchMode" />
      </UiField>
    </div>

    <p v-if="platformMismatch" class="flex gap-2 rounded-md border border-warning-border bg-warning-bg p-2.5 text-sm">
      <Icon name="mingcute:warning-line" class="mt-0.5 shrink-0 text-warning" />
      {{ platformMismatch }}
    </p>

    <p
      v-if="mode === 'account' && selectedAccount && selectedAccount.status !== 'active'"
      class="flex gap-2 rounded-md border border-danger-border bg-danger-bg p-2.5 text-sm"
    >
      <Icon name="mingcute:warning-line" class="mt-0.5 shrink-0 text-danger" />
      Аккаунт «{{ selectedAccount.displayName }}» —
      {{ (ACCOUNT_STATUS_LABELS[selectedAccount.status] ?? selectedAccount.status).toLowerCase() }}.
      Публикацию платформа отклонит.
    </p>

    <p v-if="groupHasNoActiveMembers" class="flex gap-2 rounded-md border border-danger-border bg-danger-bg p-2.5 text-sm">
      <Icon name="mingcute:warning-line" class="mt-0.5 shrink-0 text-danger" />
      В пачке «{{ selectedGroup?.name }}» нет активных аккаунтов — публиковать некуда.
    </p>
  </div>
</template>
