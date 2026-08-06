<script setup lang="ts">
/**
 * Запуск производственного цикла.
 *
 * Цикл дёргает платные модели на всех шагах, поэтому запуск подписан ценой и
 * спрашивает приложение явно: перепутать приложение здесь дорого.
 */
const emit = defineEmits<{
  started: []
}>()

const isOpen = ref(false)
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
  isOpen.value = true
}

function close() {
  if (!starting.value) isOpen.value = false
}

defineExpose({ open, close })

async function start() {
  if (!selectedApp.value) {
    error.value = 'Сначала выберите приложение'
    return
  }

  starting.value = true
  error.value = ''
  try {
    await $fetch('/api/admin/cycles/start', {
      method: 'POST',
      body: { appId: selectedApp.value, groupId: selectedGroup.value || undefined },
    })
    isOpen.value = false
    emit('started')
  }
  catch (e) {
    error.value = (e as { data?: { message?: string }, message?: string })?.data?.message
      || (e as Error)?.message
      || 'Не удалось запустить цикл'
  }
  finally {
    starting.value = false
  }
}
</script>

<template>
  <UiModal :open="isOpen" title="Запустить цикл?" @close="close">
    <div class="flex flex-col gap-3">
      <p class="text-sm text-muted">
        Цикл пройдёт весь конвейер — от поиска трендов до публикаций — и по дороге дёрнет
        платные модели.
      </p>

      <UiField label="Приложение">
        <UiSelect
          v-model="selectedApp"
          placeholder="Выберите приложение"
          :options="apps.map((a: { id: number, name: string }) => ({ value: a.id, label: a.name }))"
        />
      </UiField>

      <UiField label="Группа аккаунтов" hint="Необязательно — по умолчанию все аккаунты приложения">
        <UiSelect
          v-model="selectedGroup"
          placeholder="Все аккаунты"
          :options="groups.map((g: { id: number, name: string }) => ({ value: g.id, label: g.name }))"
        />
      </UiField>

      <p
        v-if="error"
        role="alert"
        class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
      >
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
        <span>{{ error }}</span>
      </p>
    </div>

    <template #footer>
      <UiButton variant="ghost" :disabled="starting" @click="close">Отмена</UiButton>
      <UiButton variant="primary" :disabled="!selectedApp" :loading="starting" @click="start">
        Запустить · платно
      </UiButton>
    </template>
  </UiModal>
</template>
