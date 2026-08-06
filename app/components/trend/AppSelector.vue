<script setup lang="ts">
const props = defineProps<{
  trendId: number
  currentAppId: number | null
  currentAppName: string | null
}>()

const emit = defineEmits<{
  updated: []
}>()

const { data: appsData, refresh: refreshApps } = useFetch('/api/admin/apps', { key: 'apps-for-trends' })
const apps = computed<Array<{ id: number, name: string }>>(() => {
  const raw = appsData.value as { data?: Array<{ id: number, name: string }> } | Array<{ id: number, name: string }> | null
  if (Array.isArray(raw)) return raw
  return raw?.data ?? []
})

const appOptions = computed(() => apps.value.map(a => ({ value: a.id, label: a.name })))

const selectedAppId = ref<number | null>(props.currentAppId)
const isSaving = ref(false)
const error = ref<string | null>(null)

// Быстрое создание приложения: без него оператор уходит в админку и теряет тренд.
const showQuickCreate = ref(false)
const newAppName = ref('')
const isCreating = ref(false)

async function quickCreateApp() {
  if (!newAppName.value.trim()) return
  isCreating.value = true
  error.value = null
  try {
    const result = await $fetch<{ data: { id: number } }>('/api/admin/apps', {
      method: 'POST',
      body: { name: newAppName.value.trim() },
    })
    await refreshApps()
    selectedAppId.value = result.data.id
    newAppName.value = ''
    showQuickCreate.value = false
  }
  catch (e) {
    error.value = (e as { data?: { message?: string } })?.data?.message || 'Не удалось создать приложение'
  }
  finally {
    isCreating.value = false
  }
}

async function saveApp() {
  if (!selectedAppId.value) return
  isSaving.value = true
  error.value = null
  try {
    await $fetch(`/api/trends/${props.trendId}/app`, {
      method: 'PUT',
      body: { appId: selectedAppId.value },
    })
    emit('updated')
  }
  catch (e) {
    error.value = (e as { data?: { message?: string } })?.data?.message || 'Не удалось привязать приложение'
  }
  finally {
    isSaving.value = false
  }
}
</script>

<template>
  <section class="rounded-lg border border-warning-border bg-warning-bg p-3.5">
    <div class="flex items-start gap-2.5">
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-lg text-warning" />
      <div class="min-w-0 flex-1">
        <div class="text-sm font-medium text-warning">К тренду не привязано приложение</div>
        <p class="mt-1 text-sm text-muted">Без приложения сценарии не сгенерировать.</p>

        <div v-if="appOptions.length" class="mt-2.5 flex flex-wrap items-center gap-1.5">
          <UiSelect
            v-model="selectedAppId"
            class="w-56"
            placeholder="Выберите приложение"
            :options="appOptions"
          />
          <UiButton
            variant="primary"
            :disabled="!selectedAppId"
            :loading="isSaving"
            @click="saveApp"
          >
            Привязать
          </UiButton>
        </div>

        <div class="mt-2 flex flex-wrap items-center gap-1.5">
          <UiButton v-if="!showQuickCreate" variant="ghost" @click="showQuickCreate = true">
            <Icon name="mingcute:add-line" />
            Создать приложение
          </UiButton>
          <template v-else>
            <UiInput
              v-model="newAppName"
              class="w-56"
              placeholder="Название приложения"
              @keyup.enter="quickCreateApp"
            />
            <UiButton
              variant="primary"
              :disabled="!newAppName.trim()"
              :loading="isCreating"
              @click="quickCreateApp"
            >
              Создать
            </UiButton>
            <UiButton icon-only variant="ghost" aria-label="Отменить создание" @click="showQuickCreate = false">
              <Icon name="mingcute:close-line" />
            </UiButton>
          </template>
        </div>

        <p v-if="error" role="alert" class="mt-2 text-sm text-danger">{{ error }}</p>
      </div>
    </div>
  </section>
</template>
