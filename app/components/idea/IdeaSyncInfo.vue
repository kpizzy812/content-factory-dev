<script setup lang="ts">
const props = defineProps<{
  ideaId: number
  externalId: number | null
  syncStatus: string
  syncDirection: string
  lastSyncedAt: string | null
  lastSyncError: string | null
  localDirty: boolean
  remoteSnapshot: unknown
}>()

const emit = defineEmits<{
  synced: []
}>()

const { resyncIdea, exportToMc } = useIdeaSync()

const isSyncing = ref(false)
const syncError = ref('')
const syncResult = ref('')

async function handleResync(mode?: 'force_remote' | 'force_local') {
  isSyncing.value = true
  syncError.value = ''
  syncResult.value = ''
  try {
    const result = await resyncIdea(props.ideaId, mode)
    syncResult.value = (result as any).data?.status ?? 'ok'
    emit('synced')
  } catch (err: any) {
    syncError.value = err?.data?.message ?? err?.message ?? 'Ошибка синхронизации'
  } finally {
    isSyncing.value = false
  }
}

async function handleExport() {
  isSyncing.value = true
  syncError.value = ''
  syncResult.value = ''
  try {
    await exportToMc([props.ideaId])
    syncResult.value = 'exported'
    emit('synced')
  } catch (err: any) {
    syncError.value = err?.data?.message ?? err?.message ?? 'Ошибка экспорта'
  } finally {
    isSyncing.value = false
  }
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const directionLabel: Record<string, string> = {
  local: 'Локальная',
  imported: 'Импортирована из MarketingCamp',
  exported: 'Экспортирована в MarketingCamp',
  bidirectional: 'Двусторонняя синхронизация',
}

const statusLabel: Record<string, { text: string; class: string }> = {
  none: { text: 'Не синхронизирована', class: 'badge-ghost' },
  synced: { text: 'Синхронизирована', class: 'badge-success' },
  pending_export: { text: 'Ожидает экспорта', class: 'badge-info' },
  pending_import: { text: 'Ожидает импорта', class: 'badge-info' },
  conflict: { text: 'Конфликт', class: 'badge-warning' },
  error: { text: 'Ошибка', class: 'badge-error' },
}
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 gap-3">
      <h3 class="card-title text-sm gap-2">
        <Icon name="mingcute:refresh-2-line" class="text-primary" />
        Синхронизация с MarketingCamp
      </h3>

      <!-- Статус -->
      <div class="grid grid-cols-2 gap-2 text-sm">
        <div class="text-base-content/60">Статус</div>
        <div>
          <span
            class="badge badge-sm"
            :class="statusLabel[syncStatus]?.class ?? 'badge-ghost'"
          >
            {{ statusLabel[syncStatus]?.text ?? syncStatus }}
          </span>
        </div>

        <div class="text-base-content/60">Направление</div>
        <div class="text-base-content">{{ directionLabel[syncDirection] ?? syncDirection }}</div>

        <div class="text-base-content/60">External ID</div>
        <div class="text-base-content">
          {{ externalId ?? '—' }}
        </div>

        <div class="text-base-content/60">Последняя синхр.</div>
        <div class="text-base-content">
          {{ lastSyncedAt ? formatDate(lastSyncedAt) : '—' }}
        </div>

        <template v-if="localDirty">
          <div class="text-base-content/60">Локальные изменения</div>
          <div>
            <span class="badge badge-xs badge-warning">Есть несинхронизированные правки</span>
          </div>
        </template>
      </div>

      <!-- Ошибка sync -->
      <div v-if="lastSyncError" role="alert" class="alert alert-error alert-soft text-xs">
        <Icon name="mingcute:warning-line" />
        <span>{{ lastSyncError }}</span>
      </div>

      <!-- Результат действия -->
      <div v-if="syncResult" role="alert" class="alert alert-success alert-soft text-xs">
        <Icon name="mingcute:check-line" />
        <span>{{ syncResult }}</span>
      </div>
      <div v-if="syncError" role="alert" class="alert alert-error alert-soft text-xs">
        <Icon name="mingcute:warning-line" />
        <span>{{ syncError }}</span>
      </div>

      <!-- Действия -->
      <div class="flex gap-2 flex-wrap">
        <!-- Если есть externalId — ресинк -->
        <template v-if="externalId">
          <button
            class="btn btn-sm btn-outline btn-primary gap-1"
            :disabled="isSyncing"
            @click="handleResync()"
          >
            <span v-if="isSyncing" class="loading loading-spinner loading-xs" />
            <Icon v-else name="mingcute:refresh-2-line" class="text-xs" />
            Ресинхронизация
          </button>

          <button
            v-if="syncStatus === 'conflict'"
            class="btn btn-sm btn-outline btn-warning gap-1"
            :disabled="isSyncing"
            @click="handleResync('force_remote')"
          >
            <Icon name="mingcute:download-line" class="text-xs" />
            Принять remote
          </button>
        </template>

        <!-- Если локальная — экспорт -->
        <button
          v-if="!externalId || syncDirection === 'local'"
          class="btn btn-sm btn-outline btn-secondary gap-1"
          :disabled="isSyncing"
          @click="handleExport"
        >
          <span v-if="isSyncing" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:upload-line" class="text-xs" />
          Экспорт в MarketingCamp
        </button>
      </div>

      <!-- Remote snapshot preview -->
      <details v-if="remoteSnapshot" class="collapse collapse-arrow bg-base-200/50">
        <summary class="collapse-title text-xs font-medium py-2 min-h-0">
          Remote snapshot (raw)
        </summary>
        <div class="collapse-content text-xs">
          <pre class="whitespace-pre-wrap break-all text-base-content/60">{{ JSON.stringify(remoteSnapshot, null, 2) }}</pre>
        </div>
      </details>
    </div>
  </div>
</template>
