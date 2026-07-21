<script setup lang="ts">
const emit = defineEmits<{
  started: []
}>()

const modalRef = ref<HTMLDialogElement>()
const selectedApp = ref<number | undefined>(undefined)
const selectedGroup = ref<number | undefined>(undefined)
const starting = ref(false)
const error = ref('')

const { data: appsData } = useAdminApps()
const apps = computed(() => appsData.value?.data ?? [])

const { data: groupsData } = useFetch('/api/account-groups', {
  query: computed(() => selectedApp.value ? { appId: selectedApp.value } : {}),
  watch: [selectedApp],
})
const groups = computed(() => groupsData.value?.data ?? [])

function open() {
  selectedApp.value = undefined
  selectedGroup.value = undefined
  error.value = ''
  modalRef.value?.showModal()
}

async function start() {
  if (!selectedApp.value) {
    error.value = 'Выберите приложение'
    return
  }

  starting.value = true
  error.value = ''

  try {
    await $fetch('/api/admin/cycles/start', {
      method: 'POST',
      body: {
        appId: selectedApp.value,
        groupId: selectedGroup.value || undefined,
      },
    })
    modalRef.value?.close()
    emit('started')
  } catch (e: unknown) {
    error.value = (e as Error).message || 'Ошибка запуска'
  } finally {
    starting.value = false
  }
}

defineExpose({ open })
</script>

<template>
  <dialog ref="modalRef" class="modal">
    <div class="modal-box">
      <h3 class="text-lg font-bold mb-4">Запуск цикла</h3>

      <div class="space-y-4">
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Приложение</legend>
          <select v-model="selectedApp" class="select select-sm w-full">
            <option :value="undefined" disabled>Выберите приложение</option>
            <option v-for="app in apps" :key="app.id" :value="app.id">
              {{ app.name }}
            </option>
          </select>
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Группа аккаунтов (опционально)</legend>
          <select v-model="selectedGroup" class="select select-sm w-full">
            <option :value="undefined">Все аккаунты</option>
            <option v-for="group in groups" :key="group.id" :value="group.id">
              {{ group.name }}
            </option>
          </select>
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
        <button class="btn btn-primary btn-sm" :disabled="starting || !selectedApp" @click="start">
          <span v-if="starting" class="loading loading-spinner loading-sm" />
          Запустить
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button>close</button>
    </form>
  </dialog>
</template>
