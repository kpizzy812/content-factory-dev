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
  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center gap-1.5">
      <UiButton :loading="isImporting" @click="handleImport">
        <Icon v-if="!isImporting" name="mingcute:download-line" />
        Импорт из MarketingCamp
      </UiButton>
      <UiButton variant="ghost" @click="toggleStatus">
        {{ showStatus ? 'Скрыть статистику' : 'Статистика синхронизации' }}
      </UiButton>
    </div>

    <p
      v-if="importResult"
      class="flex items-center gap-2 rounded-md border border-success-border bg-success-bg p-2.5 text-sm text-success"
    >
      Импортировано {{ importResult.imported }}, пропущено {{ importResult.skipped }}
      <UiButton icon-only variant="ghost" aria-label="Скрыть" class="ml-auto" @click="importResult = null">
        <Icon name="mingcute:close-line" />
      </UiButton>
    </p>

    <p
      v-if="importError"
      class="flex items-center gap-2 rounded-md border border-danger-border bg-danger-bg p-2.5 text-sm text-danger"
    >
      {{ importError }}
      <UiButton icon-only variant="ghost" aria-label="Скрыть" class="ml-auto" @click="importError = ''">
        <Icon name="mingcute:close-line" />
      </UiButton>
    </p>

    <div v-if="showStatus && syncStatus" class="rounded-lg border border-border bg-panel p-3">
      <div class="flex flex-wrap items-center gap-2">
        <UiStatusBadge
          :status="syncStatus.connection?.connected ? 'done' : 'failed'"
          size="xs"
          dot
        />
        <span class="text-sm text-muted">
          {{ syncStatus.connection?.connected ? 'Связь с MarketingCamp есть' : 'Связи с MarketingCamp нет' }}
        </span>
        <span v-if="syncStatus.lastSyncedAt" class="tnum ml-auto font-mono text-micro text-subtle">
          последняя синхронизация {{ new Date(syncStatus.lastSyncedAt).toLocaleString('ru-RU') }}
        </span>
      </div>

      <div class="mt-3 grid gap-4 sm:grid-cols-4">
        <UiMetricStat label="Всего" :value="syncStatus.counts?.total ?? 0" />
        <UiMetricStat label="Синхронизировано" :value="syncStatus.counts?.synced ?? 0" />
        <UiMetricStat label="Загружено" :value="syncStatus.counts?.imported ?? 0" />
        <UiMetricStat label="Конфликты" :value="syncStatus.counts?.conflicts ?? 0" />
      </div>
    </div>
  </div>
</template>
