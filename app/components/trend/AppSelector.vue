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
const apps = computed<Array<{ id: number; name: string }>>(() => {
  const raw = appsData.value as { data?: Array<{ id: number; name: string }> } | Array<{ id: number; name: string }> | null
  if (Array.isArray(raw)) return raw
  return raw?.data ?? []
})

const selectedAppId = ref<number | null>(props.currentAppId)
const isSaving = ref(false)
const error = ref<string | null>(null)

// Быстрое создание приложения
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
  } catch (e: any) {
    error.value = e?.data?.message || 'Не удалось создать приложение'
  } finally {
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
  } catch (e: any) {
    error.value = e?.data?.message || 'Не удалось привязать приложение'
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div class="card bg-warning/10 border border-warning/30 shadow-sm">
    <div class="card-body p-4 gap-3">
      <div class="flex items-center gap-2 text-warning">
        <Icon name="mingcute:warning-line" class="text-lg" />
        <span class="font-medium text-sm">К тренду не привязано приложение</span>
      </div>
      <p class="text-xs text-base-content/60">
        Для генерации сценариев необходимо привязать приложение.
      </p>

      <!-- Выбор существующего -->
      <div v-if="apps.length > 0" class="flex items-center gap-2">
        <select v-model="selectedAppId" class="select select-sm flex-1">
          <option :value="null" disabled>Выберите приложение</option>
          <option v-for="app in apps" :key="app.id" :value="app.id">{{ app.name }}</option>
        </select>
        <button class="btn btn-warning btn-sm" :disabled="!selectedAppId || isSaving" @click="saveApp">
          <span v-if="isSaving" class="loading loading-spinner loading-xs" />
          Привязать
        </button>
      </div>

      <!-- Быстрое создание -->
      <div v-if="!showQuickCreate" class="flex items-center gap-2">
        <button class="btn btn-ghost btn-xs gap-1" @click="showQuickCreate = true">
          <Icon name="mingcute:add-line" />
          Создать новое приложение
        </button>
      </div>
      <div v-else class="flex items-center gap-2">
        <input
          v-model="newAppName"
          type="text"
          class="input input-sm flex-1"
          placeholder="Название приложения"
          @keyup.enter="quickCreateApp"
        />
        <button class="btn btn-primary btn-sm" :disabled="!newAppName.trim() || isCreating" @click="quickCreateApp">
          <span v-if="isCreating" class="loading loading-spinner loading-xs" />
          Создать
        </button>
        <button class="btn btn-ghost btn-sm btn-square" @click="showQuickCreate = false">
          <Icon name="mingcute:close-line" />
        </button>
      </div>

      <div v-if="error" role="alert" class="alert alert-error alert-soft text-xs">
        {{ error }}
      </div>
    </div>
  </div>
</template>
