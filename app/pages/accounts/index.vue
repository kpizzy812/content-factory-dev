<script setup lang="ts">
definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'social-upload' })
useHead({ title: 'Аккаунты' })

const selectedAppId = ref<number | undefined>(undefined)

const { data: appsData } = useFetch('/api/apps')
const apps = computed(() => appsData.value?.data ?? [])

const accountFilters = computed(() => ({
  ...(selectedAppId.value ? { appId: selectedAppId.value } : {}),
}))
const groupFilters = computed(() => ({
  ...(selectedAppId.value ? { appId: selectedAppId.value } : {}),
}))

const { data: accountsData, pending: accountsPending, error: accountsError, refresh: refreshAccounts } = useAccounts(accountFilters)
const { data: groupsData, pending: groupsPending, error: groupsError, refresh: refreshGroups } = useAccountGroups(groupFilters)

const accounts = computed(() => accountsData.value?.data ?? [])
const groups = computed(() => groupsData.value?.data ?? [])

const pending = computed(() => accountsPending.value || groupsPending.value)
const error = computed(() => accountsError.value || groupsError.value)

const currentAppId = computed(() => selectedAppId.value ?? (apps.value.length ? apps.value[0].id : 1))

const editModalRef = ref<{ open: (group: unknown) => void }>()
const accountEditModalRef = ref<{
  open: (payload: {
    id: number
    displayName: string
    proxyId: string | null
    platform?: "tiktok" | "youtube" | "instagram"
  }) => void
}>()
const accountCreateModalRef = ref<{ open: () => void; close: () => void }>()

function onAccountCreated(payload: {
  id: number
  displayName: string
  platform: "tiktok" | "youtube" | "instagram"
}) {
  refreshAccounts()
  accountEditModalRef.value?.open({
    id: payload.id,
    displayName: payload.displayName,
    proxyId: null,
    platform: payload.platform,
  })
}

// Style profile modal — обёртка над AccountStyleProfileEditor
const styleModalRef = ref<{ open: (p: { accountId: number; accountName: string }) => void }>()

function onOpenStyle(accountId: number) {
  const account = accounts.value.find(a => a.id === accountId)
  styleModalRef.value?.open({
    accountId,
    accountName: account?.displayName ?? `Аккаунт #${accountId}`,
  })
}

function onStyleSaved() {
  refreshAccounts()
}

async function onDisconnected() {
  await refreshAccounts()
}

function onGroupEdit(group: unknown) {
  editModalRef.value?.open(group)
}

async function onGroupDelete(group: { id: number; name: string }) {
  if (!confirm(`Удалить группу "${group.name}"? Аккаунты не будут удалены.`)) return

  try {
    await $fetch(`/api/account-groups/${group.id}`, { method: 'DELETE' })
    await refreshGroups()
  } catch {
    // Ошибка будет видна при обновлении
  }
}

function onGroupSaved() {
  refreshGroups()
}

function onAccountEdit(payload: {
  id: number
  displayName: string
  proxyId: string | null
  platform: string
}) {
  accountEditModalRef.value?.open({
    ...payload,
    platform: payload.platform as "tiktok" | "youtube" | "instagram",
  })
}

async function onAccountUpdated() {
  await refreshAccounts()
}
</script>

<template>
  <div class="space-y-6">
    <!-- Заголовок -->
    <div class="flex items-center justify-between flex-wrap gap-3">
      <h1 class="text-2xl font-bold text-base-content">
        Аккаунты соцсетей
      </h1>
      <div class="flex items-center gap-2">
        <select
          v-if="apps.length > 1"
          v-model="selectedAppId"
          class="select select-sm"
        >
          <option :value="undefined">Все приложения</option>
          <option v-for="app in apps" :key="app.id" :value="app.id">
            {{ app.name }}
          </option>
        </select>
        <AccountConnectButton :app-id="currentAppId" />
        <button
          class="btn btn-ghost btn-sm gap-1"
          @click="accountCreateModalRef?.open()"
        >
          <Icon name="mingcute:add-line" />
          Добавить вручную
        </button>
      </div>
    </div>

    <SharedPageGuide
      guide-key="accounts"
      :title="pageGuides.accounts.title"
      :steps="pageGuides.accounts.steps"
      :tips="pageGuides.accounts.tips"
    />

    <!-- Loading -->
    <SharedListSkeleton v-if="pending" :count="6" variant="card" :cols="3" />

    <!-- Error -->
    <div v-else-if="error" role="alert" class="alert alert-error">
      <Icon name="mingcute:warning-line" />
      <span>Ошибка загрузки: {{ error.message }}</span>
    </div>

    <template v-else>
      <!-- Аккаунты -->
      <SharedEmptyState
        v-if="accounts.length === 0"
        icon="mingcute:group-line"
        title="Нет подключённых аккаунтов"
        description="Подключите аккаунт, чтобы начать публикацию видео в соцсети."
      />

      <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <AccountCard
          v-for="account in accounts"
          :key="account.id"
          :account="account"
          @disconnected="onDisconnected"
          @open-style="onOpenStyle"
          @edit="onAccountEdit"
        />
      </div>

      <!-- Пачки аккаунтов -->
      <template v-if="groups.length > 0">
        <div class="divider">Пачки аккаунтов</div>

        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <AccountGroupCard
            v-for="group in groups"
            :key="group.id"
            :group="group"
            @edit="onGroupEdit(group)"
            @delete="onGroupDelete(group)"
          />
        </div>
      </template>
    </template>

    <AccountGroupEditModal ref="editModalRef" @saved="onGroupSaved" />
    <AccountEditModal ref="accountEditModalRef" @updated="onAccountUpdated" />
    <AccountCreateModal
      ref="accountCreateModalRef"
      :app-id="currentAppId"
      @created="onAccountCreated"
    />

    <AccountStyleProfileModal ref="styleModalRef" @saved="onStyleSaved" />
  </div>
</template>
