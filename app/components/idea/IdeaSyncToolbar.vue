<script setup lang="ts">
const emit = defineEmits<{
  imported: []
}>()

const { importFromMc } = useIdeaSync()

const isImporting = ref(false)
const importResult = ref<{ imported: number; skipped: number } | null>(null)
const importError = ref('')

const showStatus = ref(false)
const { data: syncStatusData, refresh: refreshStatus } = useFetch('/api/ideas/sync/status', {
  immediate: false,
})
const syncStatus = computed(() => (syncStatusData.value as any)?.data ?? null)

async function handleImport() {
  isImporting.value = true
  importResult.value = null
  importError.value = ''
  try {
    const result = await importFromMc({ limit: 50 })
    importResult.value = (result as any).data ?? null
    emit('imported')
    // Обновляем статус после импорта
    if (showStatus.value) refreshStatus()
  } catch (err: any) {
    importError.value = err?.data?.message ?? err?.message ?? 'Ошибка импорта'
  } finally {
    isImporting.value = false
  }
}

function toggleStatus() {
  showStatus.value = !showStatus.value
  if (showStatus.value) refreshStatus()
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center gap-2 flex-wrap">
      <button
        class="btn btn-sm btn-outline btn-secondary gap-1"
        :disabled="isImporting"
        @click="handleImport"
      >
        <span v-if="isImporting" class="loading loading-spinner loading-xs" />
        <Icon v-else name="mingcute:download-line" class="text-xs" />
        Импорт из MarketingCamp
      </button>

      <button
        class="btn btn-sm btn-ghost gap-1"
        @click="toggleStatus"
      >
        <Icon name="mingcute:chart-bar-line" class="text-xs" />
        {{ showStatus ? 'Скрыть статистику' : 'Статистика синхр.' }}
      </button>
    </div>

    <!-- Результат импорта -->
    <div v-if="importResult" role="alert" class="alert alert-success alert-soft text-sm">
      <Icon name="mingcute:check-line" />
      <span>Импортировано: {{ importResult.imported }}, пропущено: {{ importResult.skipped }}</span>
      <button class="btn btn-xs btn-ghost" @click="importResult = null">
        <Icon name="mingcute:close-line" />
      </button>
    </div>

    <div v-if="importError" role="alert" class="alert alert-error alert-soft text-sm">
      <Icon name="mingcute:warning-line" />
      <span>{{ importError }}</span>
      <button class="btn btn-xs btn-ghost" @click="importError = ''">
        <Icon name="mingcute:close-line" />
      </button>
    </div>

    <!-- Sync status panel -->
    <div v-if="showStatus && syncStatus" class="card bg-base-200/50">
      <div class="card-body p-3 gap-2">
        <div class="flex items-center gap-2 text-sm">
          <span
            class="badge badge-sm"
            :class="syncStatus.connection?.connected ? 'badge-success' : 'badge-error'"
          >
            {{ syncStatus.connection?.connected ? 'Подключено' : 'Нет связи' }}
          </span>
          <span v-if="syncStatus.lastSyncedAt" class="text-xs text-base-content/50">
            Последняя синхр.: {{ new Date(syncStatus.lastSyncedAt).toLocaleString('ru-RU') }}
          </span>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div class="stat bg-base-100 rounded-lg p-2">
            <div class="text-base-content/50">Всего</div>
            <div class="text-lg font-bold">{{ syncStatus.counts?.total ?? 0 }}</div>
          </div>
          <div class="stat bg-base-100 rounded-lg p-2">
            <div class="text-base-content/50">Синхр.</div>
            <div class="text-lg font-bold text-success">{{ syncStatus.counts?.synced ?? 0 }}</div>
          </div>
          <div class="stat bg-base-100 rounded-lg p-2">
            <div class="text-base-content/50">Импорт</div>
            <div class="text-lg font-bold text-info">{{ syncStatus.counts?.imported ?? 0 }}</div>
          </div>
          <div class="stat bg-base-100 rounded-lg p-2">
            <div class="text-base-content/50">Конфликты</div>
            <div class="text-lg font-bold" :class="(syncStatus.counts?.conflicts ?? 0) > 0 ? 'text-warning' : ''">
              {{ syncStatus.counts?.conflicts ?? 0 }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
