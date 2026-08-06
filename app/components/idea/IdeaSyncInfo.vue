<script setup lang="ts">
import { IDEA_SYNC_LABELS } from './IdeaStatusMap'

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

const emit = defineEmits<{ synced: [] }>()

const { resyncIdea, exportToMc } = useIdeaSync()

const isSyncing = ref(false)
const syncError = ref('')
const syncResult = ref('')

function errorText(err: unknown, fallback: string) {
  return (err as { data?: { message?: string }, message?: string })?.data?.message
    || (err as Error)?.message
    || fallback
}

async function handleResync(mode?: 'force_remote' | 'force_local') {
  isSyncing.value = true
  syncError.value = ''
  syncResult.value = ''
  try {
    const result = await resyncIdea(props.ideaId, mode)
    syncResult.value = (result as { data?: { status?: string } })?.data?.status ?? 'Синхронизировано'
    emit('synced')
  }
  catch (err) {
    syncError.value = errorText(err, 'Ошибка синхронизации')
  }
  finally {
    isSyncing.value = false
  }
}

async function handleExport() {
  isSyncing.value = true
  syncError.value = ''
  syncResult.value = ''
  try {
    await exportToMc([props.ideaId])
    syncResult.value = 'Выгружено в MarketingCamp'
    emit('synced')
  }
  catch (err) {
    syncError.value = errorText(err, 'Ошибка выгрузки')
  }
  finally {
    isSyncing.value = false
  }
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const DIRECTION_LABELS: Record<string, string> = {
  local: 'Локальная',
  imported: 'Пришла из MarketingCamp',
  exported: 'Выгружена в MarketingCamp',
  bidirectional: 'Двусторонняя',
}

const SYNC_TONE: Record<string, string> = {
  synced: 'border-success-border bg-success-bg text-success',
  conflict: 'border-warning-border bg-warning-bg text-warning',
  error: 'border-danger-border bg-danger-bg text-danger',
  pending_export: 'border-info-border bg-info-bg text-info',
  pending_import: 'border-info-border bg-info-bg text-info',
}

const info = computed(() => [
  { label: 'Направление', value: DIRECTION_LABELS[props.syncDirection] ?? props.syncDirection, mono: false },
  { label: 'Внешний ID', value: props.externalId },
  { label: 'Синхронизация', value: props.lastSyncedAt ? formatDate(props.lastSyncedAt) : null },
])
</script>

<template>
  <section class="rounded-lg border border-border bg-panel p-3.5">
    <div class="mb-2 flex flex-wrap items-center gap-2">
      <Icon name="mingcute:refresh-2-line" class="text-accent" />
      <h2 class="text-sm font-medium">Синхронизация с MarketingCamp</h2>
      <span
        class="rounded-sm border px-1.5 py-0.5 text-micro"
        :class="SYNC_TONE[syncStatus] ?? 'border-divider text-muted'"
      >
        {{ IDEA_SYNC_LABELS[syncStatus] ?? 'Не синхронизирована' }}
      </span>
      <span
        v-if="localDirty"
        class="rounded-sm border border-warning-border bg-warning-bg px-1.5 py-0.5 text-micro text-warning"
      >
        есть несохранённые правки
      </span>
    </div>

    <UiKeyValue :items="info" label-width="140px" />

    <div
      v-if="lastSyncError"
      role="alert"
      class="mt-2 flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
      <span>{{ lastSyncError }}</span>
    </div>

    <div
      v-if="syncResult"
      role="status"
      class="mt-2 flex items-start gap-2 rounded-md border border-success-border bg-success-bg px-2.5 py-2 text-sm text-success"
    >
      <Icon name="mingcute:check-line" class="mt-0.5 shrink-0" />
      <span>{{ syncResult }}</span>
    </div>

    <div
      v-if="syncError"
      role="alert"
      class="mt-2 flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
      <span>{{ syncError }}</span>
    </div>

    <div class="mt-2.5 flex flex-wrap gap-1.5">
      <template v-if="externalId">
        <UiButton :loading="isSyncing" @click="handleResync()">
          <Icon v-if="!isSyncing" name="mingcute:refresh-2-line" />
          Синхронизировать
        </UiButton>
        <UiButton v-if="syncStatus === 'conflict'" :disabled="isSyncing" @click="handleResync('force_remote')">
          <Icon name="mingcute:download-line" />
          Принять версию MarketingCamp
        </UiButton>
      </template>

      <UiButton v-if="!externalId || syncDirection === 'local'" :loading="isSyncing" @click="handleExport">
        <Icon v-if="!isSyncing" name="mingcute:upload-line" />
        Выгрузить в MarketingCamp
      </UiButton>
    </div>

    <UiDisclosure v-if="remoteSnapshot" class="mt-2.5" title="Ответ MarketingCamp как есть">
      <pre class="font-mono text-micro break-all whitespace-pre-wrap text-muted">{{ JSON.stringify(remoteSnapshot, null, 2) }}</pre>
    </UiDisclosure>
  </section>
</template>
