<script setup lang="ts">
import type { AccountRow } from '~/components/account/account-row'

definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'social-upload' })
useHead({ title: 'Аккаунты' })

const toast = useToast()

const selectedAppId = ref<number | undefined>(undefined)

const { data: appsData } = useFetch('/api/apps')
const apps = computed(() => appsData.value?.data ?? [])

const listFilters = computed(() => ({
  ...(selectedAppId.value ? { appId: selectedAppId.value } : {}),
}))

const { data: accountsData, pending: accountsPending, error: accountsError, refresh: refreshAccounts } = useAccounts(listFilters)
const { data: groupsData, pending: groupsPending, refresh: refreshGroups } = useAccountGroups(listFilters)
// Свободная ёмкость и прогноз восстановления лимита — свой endpoint: список
// аккаунтов про наши публикации за сутки ничего не знает.
const { data: capacityData } = useFetch('/api/accounts/capacity', { query: listFilters })

const accounts = computed<AccountRow[]>(() => (accountsData.value?.data ?? []) as AccountRow[])
const groups = computed(() => groupsData.value?.data ?? [])
const capacity = computed(() => capacityData.value?.data ?? null)

const currentAppId = computed(() => selectedAppId.value ?? (apps.value.length ? apps.value[0].id : 1))

const connectModalRef = ref<{ open: () => void }>()
const createModalRef = ref<{ open: () => void, close: () => void }>()
const editModalRef = ref<{
  open: (payload: { id: number, displayName: string, proxyId: string | null, platform?: 'tiktok' | 'youtube' | 'instagram' }) => void
}>()
const styleModalRef = ref<{ open: (p: { accountId: number, accountName: string }) => void }>()
const groupModalRef = ref<{ open: (group?: unknown) => void }>()
const disconnectRef = ref<{ open: () => void, close: () => void, setBusy: (v: boolean) => void }>()
const groupDeleteRef = ref<{ open: () => void, close: () => void, setBusy: (v: boolean) => void }>()

const { disconnectAccount } = useAccountActions()

function onEdit(account: AccountRow) {
  editModalRef.value?.open({
    id: account.id,
    displayName: account.displayName,
    proxyId: account.proxyId ?? null,
    platform: account.platform as 'tiktok' | 'youtube' | 'instagram',
  })
}

function onStyle(account: AccountRow) {
  styleModalRef.value?.open({ accountId: account.id, accountName: account.displayName })
}

// ── Отключение аккаунта ────────────────────────────────────────────────
const pendingDisconnect = ref<AccountRow | null>(null)

function onDisconnect(account: AccountRow) {
  pendingDisconnect.value = account
  disconnectRef.value?.open()
}

async function confirmDisconnect() {
  const account = pendingDisconnect.value
  if (!account) return
  disconnectRef.value?.setBusy(true)
  const result = await disconnectAccount(account.id)
  disconnectRef.value?.setBusy(false)
  disconnectRef.value?.close()
  pendingDisconnect.value = null
  if (result) {
    toast.success(`Аккаунт ${account.displayName} отключён`)
    await refreshAccounts()
  }
  else {
    toast.error('Не удалось отключить аккаунт')
  }
}

// ── Пачки аккаунтов ────────────────────────────────────────────────────
const pendingGroupDelete = ref<{ id: number, name: string } | null>(null)

function onGroupDelete(group: { id: number, name: string }) {
  pendingGroupDelete.value = group
  groupDeleteRef.value?.open()
}

async function confirmGroupDelete() {
  const group = pendingGroupDelete.value
  if (!group) return
  groupDeleteRef.value?.setBusy(true)
  try {
    await $fetch(`/api/account-groups/${group.id}`, { method: 'DELETE' })
    toast.success(`Пачка «${group.name}» удалена`)
    await refreshGroups()
  }
  catch {
    toast.error('Не удалось удалить пачку')
  }
  finally {
    groupDeleteRef.value?.setBusy(false)
    groupDeleteRef.value?.close()
    pendingGroupDelete.value = null
  }
}

async function onAccountCreated(payload: { id: number, displayName: string, platform: 'tiktok' | 'youtube' | 'instagram' }) {
  await refreshAccounts()
  editModalRef.value?.open({
    id: payload.id,
    displayName: payload.displayName,
    proxyId: null,
    platform: payload.platform,
  })
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <AccountListView
      :accounts="accounts"
      :apps="apps"
      :pending="accountsPending"
      :error="accountsError"
      @refresh="refreshAccounts()"
      @connect="connectModalRef?.open()"
      @create="createModalRef?.open()"
      @edit="onEdit"
      @style="onStyle"
      @disconnect="onDisconnect"
      @update:app-id="selectedAppId = $event"
    />

    <AccountCapacityPanel :capacity="capacity" />

    <section class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="text-lg font-medium">Пачки аккаунтов</h2>
        <span class="tnum text-sm text-subtle">{{ groups.length }}</span>
        <span class="flex-1" />
        <UiButton @click="groupModalRef?.open()">
          <Icon name="mingcute:add-line" />
          Новая пачка
        </UiButton>
      </div>

      <UiSkeleton v-if="groupsPending && !groups.length" variant="cards" :count="3" />

      <UiEmptyState
        v-else-if="!groups.length"
        variant="first"
        title="Пачек пока нет"
        description="Пачка раздаёт ролики по кругу между своими аккаунтами — так один ролик не уходит дважды в один профиль."
      />

      <div v-else class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <AccountGroupCard
          v-for="group in groups"
          :key="group.id"
          :group="group"
          @edit="groupModalRef?.open(group)"
          @delete="onGroupDelete(group)"
        />
      </div>
    </section>

    <AccountConnectModal ref="connectModalRef" :app-id="currentAppId" />
    <AccountCreateModal ref="createModalRef" :app-id="currentAppId" @created="onAccountCreated" />
    <AccountEditModal ref="editModalRef" @updated="refreshAccounts()" />
    <AccountStyleProfileModal ref="styleModalRef" @saved="refreshAccounts()" />
    <AccountGroupEditModal ref="groupModalRef" :app-id="currentAppId" @saved="refreshGroups()" />

    <SharedConfirmModal
      ref="disconnectRef"
      title="Отключить аккаунт?"
      :message="pendingDisconnect
        ? `Аккаунт ${pendingDisconnect.displayName} будет отвязан, активные загрузки отменены. Токен придётся выдавать заново.`
        : ''"
      confirm-label="Отключить"
      @confirm="confirmDisconnect"
    />

    <SharedConfirmModal
      ref="groupDeleteRef"
      title="Удалить пачку?"
      :message="pendingGroupDelete
        ? `Пачка «${pendingGroupDelete.name}» будет удалена. Сами аккаунты останутся на месте.`
        : ''"
      confirm-label="Удалить"
      @confirm="confirmGroupDelete"
    />
  </div>
</template>
