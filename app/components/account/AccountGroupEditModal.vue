<script setup lang="ts">
const emit = defineEmits<{
  saved: []
  cancel: []
}>()

const modalRef = ref<HTMLDialogElement>()
const saving = ref(false)
const error = ref('')

const groupId = ref<number | null>(null)
const groupName = ref('')
const selectedAccountIds = ref<number[]>([])

const { data: accountsData } = useFetch('/api/accounts')
const allAccounts = computed(() => accountsData.value?.data ?? [])

function open(group: {
  id: number
  name: string
  members: { socialAccount: { id: number } }[]
}) {
  groupId.value = group.id
  groupName.value = group.name
  selectedAccountIds.value = group.members.map(m => m.socialAccount.id)
  error.value = ''
  modalRef.value?.showModal()
}

function toggleAccount(id: number) {
  const idx = selectedAccountIds.value.indexOf(id)
  if (idx >= 0) {
    selectedAccountIds.value.splice(idx, 1)
  } else {
    selectedAccountIds.value.push(id)
  }
}

async function save() {
  if (!groupName.value.trim()) {
    error.value = 'Название обязательно'
    return
  }

  saving.value = true
  error.value = ''

  try {
    await $fetch(`/api/account-groups/${groupId.value}`, {
      method: 'PUT',
      body: {
        name: groupName.value.trim(),
        accountIds: selectedAccountIds.value,
      },
    })
    modalRef.value?.close()
    emit('saved')
  } catch (e: unknown) {
    error.value = (e as Error).message || 'Ошибка сохранения'
  } finally {
    saving.value = false
  }
}

defineExpose({ open })
</script>

<template>
  <dialog ref="modalRef" class="modal">
    <div class="modal-box max-w-lg max-h-[90vh] overflow-y-auto">
      <h3 class="font-bold text-lg mb-1">Редактирование группы</h3>
      <p class="text-xs text-base-content/60 mb-4">
        Имя и состав аккаунтов в группе. Удаление группы не удаляет сами аккаунты.
      </p>

      <div class="space-y-4">
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Название группы</legend>
          <input
            v-model="groupName"
            type="text"
            class="input input-sm w-full"
            placeholder="Название"
          />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Аккаунты</legend>
          <div v-if="allAccounts.length" class="max-h-48 overflow-y-auto space-y-1">
            <label
              v-for="account in allAccounts"
              :key="account.id"
              class="flex items-center gap-2 p-2 rounded-lg hover:bg-base-200 cursor-pointer"
            >
              <input
                type="checkbox"
                class="checkbox checkbox-sm checkbox-primary"
                :checked="selectedAccountIds.includes(account.id)"
                @change="toggleAccount(account.id)"
              />
              <span class="text-sm">{{ account.displayName }}</span>
              <span class="badge badge-xs badge-ghost">{{ account.platform }}</span>
            </label>
          </div>
          <p v-else class="text-sm text-base-content/50">Нет доступных аккаунтов</p>
        </fieldset>

        <div v-if="error" role="alert" class="alert alert-error alert-soft">
          <Icon name="mingcute:warning-line" />
          <span>{{ error }}</span>
        </div>
      </div>

      <div class="modal-action">
        <form method="dialog">
          <button class="btn btn-ghost btn-sm">Отмена</button>
        </form>
        <button
          class="btn btn-primary btn-sm"
          :disabled="saving"
          @click="save"
        >
          <span v-if="saving" class="loading loading-spinner loading-sm" />
          Сохранить
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button>close</button>
    </form>
  </dialog>
</template>
