<script setup lang="ts">
/**
 * AppAccountsManager — секция «Аккаунты и группы» на странице приложения.
 * Показывает список SocialAccount и AccountGroup, привязанных к данному App.
 * Позволяет подключить новый аккаунт (OAuth) и создать новую группу.
 */

const props = defineProps<{
  appId: number
}>()

const filters = computed(() => ({ appId: props.appId }))

const { data: accountsData, pending: accountsPending, refresh: refreshAccounts } = useAccounts(filters)
const { data: groupsData, pending: groupsPending, refresh: refreshGroups } = useAccountGroups(filters)

const accounts = computed(() => accountsData.value?.data ?? [])
const groups = computed(() => groupsData.value?.data ?? [])

const editModalRef = ref<{ open: (group: unknown) => void }>()
const createGroupModalRef = ref<HTMLDialogElement | null>(null)
const deleteConfirmRef = ref<HTMLDialogElement | null>(null)

const newGroupName = ref('')
const newGroupDispatchMode = ref<'round_robin' | 'all' | 'first_active'>('round_robin')
const selectedAccountIds = ref<number[]>([])
const creatingGroup = ref(false)
const createError = ref('')

const groupToDelete = ref<{ id: number; name: string } | null>(null)
const deletingGroup = ref(false)
const deleteError = ref('')

function openCreateGroup() {
  newGroupName.value = ''
  newGroupDispatchMode.value = 'round_robin'
  selectedAccountIds.value = []
  createError.value = ''
  createGroupModalRef.value?.showModal()
}

function toggleAccount(id: number) {
  const idx = selectedAccountIds.value.indexOf(id)
  if (idx >= 0) selectedAccountIds.value.splice(idx, 1)
  else selectedAccountIds.value.push(id)
}

async function createGroup() {
  if (!newGroupName.value.trim()) {
    createError.value = 'Название обязательно'
    return
  }
  creatingGroup.value = true
  createError.value = ''
  try {
    await $fetch('/api/account-groups', {
      method: 'POST',
      body: {
        appId: props.appId,
        name: newGroupName.value.trim(),
        dispatchMode: newGroupDispatchMode.value,
        accountIds: selectedAccountIds.value,
      },
    })
    createGroupModalRef.value?.close()
    await refreshGroups()
  } catch (e: unknown) {
    createError.value = (e as Error).message || 'Ошибка создания'
  } finally {
    creatingGroup.value = false
  }
}

function openEditGroup(group: unknown) {
  editModalRef.value?.open(group)
}

function askDeleteGroup(group: { id: number; name: string }) {
  groupToDelete.value = { id: group.id, name: group.name }
  deleteError.value = ''
  deleteConfirmRef.value?.showModal()
}

async function confirmDeleteGroup() {
  if (!groupToDelete.value) return
  deletingGroup.value = true
  deleteError.value = ''
  try {
    await $fetch(`/api/account-groups/${groupToDelete.value.id}`, { method: 'DELETE' })
    deleteConfirmRef.value?.close()
    groupToDelete.value = null
    await refreshGroups()
  } catch (e: unknown) {
    deleteError.value = (e as Error).message || 'Ошибка удаления'
  } finally {
    deletingGroup.value = false
  }
}

async function onAccountDisconnected() {
  await refreshAccounts()
  await refreshGroups()
}

function onGroupSaved() {
  refreshGroups()
}

const dispatchLabels: Record<string, string> = {
  round_robin: 'Round-robin (по очереди)',
  all: 'На все активные',
  first_active: 'Первый активный',
}
</script>

<template>
  <div class="space-y-6">
    <!-- Подключённые аккаунты -->
    <section class="space-y-3">
      <div class="flex items-center justify-between flex-wrap gap-2">
        <h3 class="text-base font-semibold flex items-center gap-2">
          <Icon name="mingcute:share-2-line" class="size-5 text-primary" />
          Подключённые аккаунты
          <span class="badge badge-sm badge-ghost">{{ accounts.length }}</span>
        </h3>
        <AccountConnectButton :app-id="appId" />
      </div>

      <div v-if="accountsPending" class="flex justify-center py-6">
        <span class="loading loading-spinner loading-md" />
      </div>

      <SharedEmptyState
        v-else-if="accounts.length === 0"
        icon="mingcute:share-2-line"
        title="Нет подключённых аккаунтов"
        description="Подключите аккаунт, чтобы публиковать видео в соцсети из этого приложения."
      />

      <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <AccountCard
          v-for="account in accounts"
          :key="account.id"
          :account="account"
          @disconnected="onAccountDisconnected"
        />
      </div>
    </section>

    <!-- Группы аккаунтов -->
    <section class="space-y-3">
      <div class="flex items-center justify-between flex-wrap gap-2">
        <h3 class="text-base font-semibold flex items-center gap-2">
          <Icon name="mingcute:group-line" class="size-5 text-primary" />
          Группы аккаунтов
          <span class="badge badge-sm badge-ghost">{{ groups.length }}</span>
        </h3>
        <button
          class="btn btn-primary btn-sm gap-1"
          :disabled="accounts.length === 0"
          @click="openCreateGroup"
        >
          <Icon name="mingcute:add-line" />
          Создать группу
        </button>
      </div>

      <div v-if="groupsPending" class="flex justify-center py-6">
        <span class="loading loading-spinner loading-md" />
      </div>

      <SharedEmptyState
        v-else-if="groups.length === 0"
        icon="mingcute:group-line"
        title="Нет групп"
        description="Группа задаёт стратегию распределения публикаций по нескольким аккаунтам."
      />

      <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <div
          v-for="group in groups"
          :key="group.id"
          class="card bg-base-100 shadow-sm"
        >
          <div class="card-body p-4 gap-2">
            <div class="flex items-center justify-between gap-2">
              <h4 class="font-semibold truncate">{{ group.name }}</h4>
              <span class="badge badge-ghost badge-sm">
                {{ group.activeMembersCount }} / {{ group.members.length }}
              </span>
            </div>
            <div class="text-xs text-base-content/60">
              <Icon name="mingcute:transfer-line" class="inline-block mr-1" />
              {{ dispatchLabels[group.dispatchMode] ?? group.dispatchMode }}
            </div>
            <div class="flex flex-wrap gap-1">
              <span
                v-for="m in group.members.slice(0, 4)"
                :key="m.id"
                class="badge badge-xs badge-outline"
              >
                {{ m.socialAccount.displayName }}
              </span>
              <span v-if="group.members.length > 4" class="badge badge-xs badge-ghost">
                +{{ group.members.length - 4 }}
              </span>
            </div>
            <div class="card-actions justify-end mt-1">
              <button
                class="btn btn-xs btn-ghost gap-1"
                @click="openEditGroup(group)"
              >
                <Icon name="mingcute:edit-line" />
                Изменить
              </button>
              <button
                class="btn btn-xs btn-error btn-outline gap-1"
                @click="askDeleteGroup(group)"
              >
                <Icon name="mingcute:delete-2-line" />
                Удалить
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <AccountGroupEditModal ref="editModalRef" @saved="onGroupSaved" />

    <!-- Modal: создание группы -->
    <dialog ref="createGroupModalRef" class="modal">
      <div class="modal-box">
        <h3 class="text-lg font-bold mb-4">Новая группа аккаунтов</h3>

        <div class="space-y-4">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Название</legend>
            <input
              v-model="newGroupName"
              type="text"
              class="input input-sm w-full"
              placeholder="Например: Основной набор TikTok"
            />
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">Стратегия распределения</legend>
            <select v-model="newGroupDispatchMode" class="select select-sm w-full">
              <option value="round_robin">Round-robin (по очереди)</option>
              <option value="all">На все активные одновременно</option>
              <option value="first_active">Первый активный</option>
            </select>
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">Аккаунты</legend>
            <div v-if="accounts.length" class="max-h-48 overflow-y-auto space-y-1 border border-base-300 rounded-lg p-1">
              <label
                v-for="account in accounts"
                :key="account.id"
                class="flex items-center gap-2 p-2 rounded-md hover:bg-base-200 cursor-pointer"
              >
                <input
                  type="checkbox"
                  class="checkbox checkbox-sm checkbox-primary"
                  :checked="selectedAccountIds.includes(account.id)"
                  @change="toggleAccount(account.id)"
                />
                <span class="text-sm flex-1 truncate">{{ account.displayName }}</span>
                <span class="badge badge-xs badge-ghost">{{ account.platform }}</span>
                <span
                  class="badge badge-xs"
                  :class="account.status === 'active' ? 'badge-success' : 'badge-warning'"
                >
                  {{ account.status }}
                </span>
              </label>
            </div>
            <p v-else class="text-sm text-base-content/50">
              Нет аккаунтов. Сначала подключите хотя бы один.
            </p>
          </fieldset>

          <div v-if="createError" role="alert" class="alert alert-error alert-soft">
            <Icon name="mingcute:warning-line" />
            <span>{{ createError }}</span>
          </div>
        </div>

        <div class="modal-action">
          <form method="dialog">
            <button class="btn btn-ghost btn-sm">Отмена</button>
          </form>
          <button
            class="btn btn-primary btn-sm"
            :disabled="creatingGroup"
            @click="createGroup"
          >
            <span v-if="creatingGroup" class="loading loading-spinner loading-xs" />
            Создать
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>

    <!-- Modal: подтверждение удаления группы -->
    <dialog ref="deleteConfirmRef" class="modal">
      <div class="modal-box">
        <h3 class="text-lg font-bold flex items-center gap-2">
          <Icon name="mingcute:delete-2-line" class="text-error" />
          Удалить группу?
        </h3>
        <p class="py-4 text-base-content/70">
          Группа <strong>{{ groupToDelete?.name }}</strong> будет удалена.
          Сами аккаунты останутся подключёнными.
        </p>
        <div v-if="deleteError" role="alert" class="alert alert-error alert-soft mb-4">
          <Icon name="mingcute:warning-line" />
          <span>{{ deleteError }}</span>
        </div>
        <div class="modal-action">
          <form method="dialog">
            <button class="btn btn-ghost btn-sm">Отмена</button>
          </form>
          <button
            class="btn btn-error btn-sm"
            :disabled="deletingGroup"
            @click="confirmDeleteGroup"
          >
            <span v-if="deletingGroup" class="loading loading-spinner loading-xs" />
            Удалить
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  </div>
</template>
