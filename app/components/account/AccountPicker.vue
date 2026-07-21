<script setup lang="ts">
/**
 * AccountPicker — двухрежимный пикер для выбора SocialAccount или AccountGroup.
 *
 * Используется в UploadConfig.vue (pipeline) и потенциально в UploadCreateModal.
 * Если задан appId — фильтрует по приложению (с возможностью toggle «Показать все»).
 * Если задана targetPlatform — приоритизирует/фильтрует аккаунты этой платформы.
 *
 * Эмитит:
 *  - update:mode (account | group)
 *  - update:socialAccountId (number | null)
 *  - update:accountGroupId (number | null)
 *  - update:dispatchMode (round_robin | all | first_active)
 */

interface AccountItem {
  id: number
  appId: number
  platform: string
  displayName: string
  status: 'active' | 'expired' | 'revoked' | string
  expiresAt?: string | null
  lastPostedAt?: string | null
  profileCompleteness?: number
  app?: { id: number; name: string } | null
  styleProfile?: { status?: string } | null
}

interface GroupItem {
  id: number
  appId: number
  name: string
  dispatchMode: 'round_robin' | 'all' | 'first_active' | string
  activeMembersCount: number
  app?: { id: number; name: string } | null
  members: Array<{
    id: number
    socialAccount: {
      id: number
      platform: string
      displayName: string
      status: string
      lastPostedAt?: string | null
    }
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
  return accounts.value.filter((a) =>
    a.displayName.toLowerCase().includes(q)
    || a.platform.toLowerCase().includes(q)
    || (a.app?.name?.toLowerCase().includes(q) ?? false),
  )
})

const filteredGroups = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return groups.value
  return groups.value.filter((g) =>
    g.name.toLowerCase().includes(q)
    || (g.app?.name?.toLowerCase().includes(q) ?? false),
  )
})

const selectedAccount = computed(() =>
  accounts.value.find((a) => a.id === props.socialAccountId) ?? null,
)
const selectedGroup = computed(() =>
  groups.value.find((g) => g.id === props.accountGroupId) ?? null,
)

const platformIcons: Record<string, string> = {
  youtube: 'mingcute:youtube-line',
  tiktok: 'mingcute:tiktok-line',
  instagram: 'mingcute:instagram-line',
}

const statusBadge: Record<string, string> = {
  active: 'badge-success',
  expired: 'badge-warning',
  revoked: 'badge-error',
}

const dispatchLabels: Record<string, string> = {
  round_robin: 'Round-robin (по очереди)',
  all: 'На все активные',
  first_active: 'Первый активный',
}

function setMode(m: 'account' | 'group') {
  emit('update:mode', m)
}

function pickAccount(id: number) {
  emit('update:socialAccountId', id)
}

function pickGroup(g: GroupItem) {
  emit('update:accountGroupId', g.id)
  // Подхватываем dispatchMode из группы как дефолт, если ещё не задан
  if (g.dispatchMode && (g.dispatchMode === 'round_robin' || g.dispatchMode === 'all' || g.dispatchMode === 'first_active')) {
    emit('update:dispatchMode', g.dispatchMode)
  }
}

function setDispatchMode(value: string) {
  if (value === 'round_robin' || value === 'all' || value === 'first_active') {
    emit('update:dispatchMode', value)
  }
}

// Платформа выбранного аккаунта несовместима с targetPlatform — предупреждение
const platformMismatch = computed(() => {
  if (!props.targetPlatform || props.mode !== 'account' || !selectedAccount.value) return null
  if (selectedAccount.value.platform !== props.targetPlatform) {
    return `Аккаунт «${selectedAccount.value.displayName}» — ${selectedAccount.value.platform}, а целевая платформа видео — ${props.targetPlatform}`
  }
  return null
})

// Группа без активных members — ошибка
const groupHasNoActiveMembers = computed(() => {
  if (props.mode !== 'group' || !selectedGroup.value) return false
  return selectedGroup.value.activeMembersCount === 0
})

defineExpose({ refreshAccounts, refreshGroups })
</script>

<template>
  <div class="space-y-3">
    <!-- Tabs Account / Group -->
    <div role="tablist" class="tabs tabs-boxed tabs-sm">
      <button
        type="button"
        role="tab"
        class="tab"
        :class="{ 'tab-active': mode === 'account' }"
        @click="setMode('account')"
      >
        <Icon name="mingcute:user-3-line" class="text-sm mr-1" />
        Аккаунт
      </button>
      <button
        type="button"
        role="tab"
        class="tab"
        :class="{ 'tab-active': mode === 'group' }"
        @click="setMode('group')"
      >
        <Icon name="mingcute:group-line" class="text-sm mr-1" />
        Группа
      </button>
    </div>

    <!-- Search + filters -->
    <div class="flex flex-wrap gap-2">
      <input
        v-model="search"
        type="text"
        class="input input-sm flex-1 min-w-40"
        placeholder="Поиск..."
      />
      <select v-model="platformFilter" class="select select-sm">
        <option value="">Все платформы</option>
        <option value="youtube">YouTube</option>
        <option value="tiktok">TikTok</option>
        <option value="instagram">Instagram</option>
      </select>
      <label v-if="appId" class="label cursor-pointer gap-2 px-2">
        <input
          v-model="showAllApps"
          type="checkbox"
          class="checkbox checkbox-xs checkbox-primary"
        />
        <span class="label-text text-xs">Показать все приложения</span>
      </label>
    </div>

    <!-- Список аккаунтов -->
    <div v-if="mode === 'account'" class="space-y-1">
      <div
        v-if="filteredAccounts.length === 0"
        class="text-sm text-base-content/60 py-4 text-center border border-dashed border-base-300 rounded-lg"
      >
        Нет доступных аккаунтов
      </div>
      <div
        v-else
        class="max-h-64 overflow-y-auto space-y-1 border border-base-300 rounded-lg p-1"
      >
        <button
          v-for="acc in filteredAccounts"
          :key="acc.id"
          type="button"
          class="w-full flex items-center gap-2 p-2 rounded-md text-left hover:bg-base-200 transition-colors"
          :class="{ 'bg-primary/10 ring-1 ring-primary': socialAccountId === acc.id }"
          @click="pickAccount(acc.id)"
        >
          <Icon
            :name="platformIcons[acc.platform] ?? 'mingcute:share-2-line'"
            class="text-lg shrink-0"
          />
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">{{ acc.displayName }}</div>
            <div class="text-xs text-base-content/60 truncate flex items-center gap-1">
              <span>{{ acc.app?.name ?? `app#${acc.appId}` }}</span>
              <span v-if="acc.lastPostedAt">· опубликован {{ new Date(acc.lastPostedAt).toLocaleDateString('ru-RU') }}</span>
            </div>
          </div>
          <span class="badge badge-xs" :class="statusBadge[acc.status] ?? 'badge-ghost'">
            {{ acc.status }}
          </span>
        </button>
      </div>
    </div>

    <!-- Список групп -->
    <div v-else class="space-y-2">
      <div
        v-if="filteredGroups.length === 0"
        class="text-sm text-base-content/60 py-4 text-center border border-dashed border-base-300 rounded-lg"
      >
        Нет доступных групп
      </div>
      <div
        v-else
        class="max-h-64 overflow-y-auto space-y-1 border border-base-300 rounded-lg p-1"
      >
        <button
          v-for="g in filteredGroups"
          :key="g.id"
          type="button"
          class="w-full flex items-center gap-2 p-2 rounded-md text-left hover:bg-base-200 transition-colors"
          :class="{ 'bg-primary/10 ring-1 ring-primary': accountGroupId === g.id }"
          @click="pickGroup(g)"
        >
          <Icon name="mingcute:group-line" class="text-lg shrink-0" />
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">{{ g.name }}</div>
            <div class="text-xs text-base-content/60 truncate">
              {{ g.app?.name ?? `app#${g.appId}` }} · {{ g.activeMembersCount }} активных / {{ g.members.length }}
            </div>
          </div>
          <span class="badge badge-xs badge-ghost">
            {{ dispatchLabels[g.dispatchMode] ?? g.dispatchMode }}
          </span>
        </button>
      </div>

      <!-- DispatchMode override -->
      <fieldset v-if="selectedGroup" class="fieldset">
        <legend class="fieldset-legend">Стратегия распределения</legend>
        <select
          :value="dispatchMode"
          class="select select-sm w-full"
          @change="setDispatchMode(($event.target as HTMLSelectElement).value)"
        >
          <option value="round_robin">Round-robin (по очереди)</option>
          <option value="all">На все активные одновременно</option>
          <option value="first_active">Первый активный</option>
        </select>
      </fieldset>
    </div>

    <!-- Inline-warnings -->
    <div
      v-if="platformMismatch"
      role="alert"
      class="alert alert-warning alert-soft text-xs py-2"
    >
      <Icon name="mingcute:warning-line" />
      <span>{{ platformMismatch }}</span>
    </div>
    <div
      v-if="mode === 'account' && selectedAccount && selectedAccount.status !== 'active'"
      role="alert"
      class="alert alert-error alert-soft text-xs py-2"
    >
      <Icon name="mingcute:warning-line" />
      <span>Аккаунт «{{ selectedAccount.displayName }}» в статусе {{ selectedAccount.status }} — публикация будет отклонена.</span>
    </div>
    <div
      v-if="groupHasNoActiveMembers"
      role="alert"
      class="alert alert-error alert-soft text-xs py-2"
    >
      <Icon name="mingcute:warning-line" />
      <span>В группе «{{ selectedGroup?.name }}» нет активных аккаунтов.</span>
    </div>
  </div>
</template>
