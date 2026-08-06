<script setup lang="ts">
/**
 * История глубоких проверок прокси у аккаунта.
 *
 * Открывается по `open(proxyId)`. Сводка приезжает сразу, полный разбор шагов —
 * только при раскрытии записи: он тяжёлый и нужен редко.
 */
import type {
  DeepProxyCheckLogDetail,
  DeepProxyCheckLogSummary,
} from '~~/shared/types/deep-proxy-check'

const emit = defineEmits<{ close: [] }>()

const isOpen = ref(false)
const currentProxyId = ref<string | null>(null)
const logs = ref<DeepProxyCheckLogSummary[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const detailsCache = ref<Record<string, DeepProxyCheckLogDetail>>({})
const detailsLoading = ref<Record<string, boolean>>({})
const expanded = ref<string | null>(null)

async function loadHistory() {
  if (!currentProxyId.value) return
  loading.value = true
  error.value = null
  try {
    const res = await $fetch<{ data: DeepProxyCheckLogSummary[] }>(
      `/api/proxies/${currentProxyId.value}/deep-check-history?limit=20`,
    )
    logs.value = res.data
  }
  catch (err: unknown) {
    const e = err as { data?: { message?: string }, message?: string }
    error.value = e?.data?.message ?? e?.message ?? 'Не удалось загрузить историю'
  }
  finally {
    loading.value = false
  }
}

async function loadDetail(logId: string) {
  if (detailsCache.value[logId]) return
  detailsLoading.value[logId] = true
  try {
    const res = await $fetch<{ data: DeepProxyCheckLogDetail }>(
      `/api/proxies/deep-check-logs/${logId}`,
    )
    detailsCache.value[logId] = res.data
  }
  catch {
    // Разбор шагов необязателен: сводка уже показана.
  }
  finally {
    detailsLoading.value[logId] = false
  }
}

function toggle(logId: string) {
  if (expanded.value === logId) {
    expanded.value = null
    return
  }
  expanded.value = logId
  loadDetail(logId)
}

async function open(proxyId: string) {
  currentProxyId.value = proxyId
  logs.value = []
  detailsCache.value = {}
  detailsLoading.value = {}
  expanded.value = null
  isOpen.value = true
  await loadHistory()
}

function close() {
  isOpen.value = false
  currentProxyId.value = null
  emit('close')
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function formatDuration(ms: number | null): string {
  if (!ms) return '—'
  if (ms < 1000) return `${ms} мс`
  return `${Math.round(ms / 1000)} с`
}

const OUTCOME: Record<string, { label: string, tone: string, icon: string }> = {
  ok: { label: 'Прокси работает', tone: 'border-success-border bg-success-bg text-success', icon: 'mingcute:check-circle-line' },
  leak: { label: 'Утечка адреса', tone: 'border-danger-border bg-danger-bg text-danger', icon: 'mingcute:warning-line' },
  error: { label: 'Проверка упала', tone: 'border-warning-border bg-warning-bg text-warning', icon: 'mingcute:close-circle-line' },
  precondition_failed: { label: 'Не с чем проверять', tone: 'border-divider bg-transparent text-subtle', icon: 'mingcute:information-line' },
}

function outcomeConfig(outcome: string) {
  return OUTCOME[outcome] ?? {
    label: outcome,
    tone: 'border-divider bg-transparent text-subtle',
    icon: 'mingcute:question-line',
  }
}

defineExpose({ open, close })
</script>

<template>
  <UiModal :open="isOpen" size="lg" @close="close">
    <template #header>
      <span class="flex items-center gap-3">
        История проверок прокси
        <UiButton variant="ghost" :loading="loading" @click="loadHistory">
          <Icon v-if="!loading" name="mingcute:refresh-3-line" />
          Обновить
        </UiButton>
      </span>
    </template>

    <UiSkeleton v-if="loading && !logs.length" variant="details" :count="4" />

    <UiErrorState v-else-if="error" message="Не удалось загрузить историю." :details="error" @retry="loadHistory" />

    <UiEmptyState
      v-else-if="!logs.length"
      variant="first"
      title="Проверок ещё не было"
      description="Запустите проверку на вкладке «Готовность» — она откроет ifconfig.me через устройство."
    />

    <div v-else class="flex flex-col gap-1.5">
      <div v-for="log in logs" :key="log.id" class="overflow-hidden rounded-md border border-border">
        <button
          type="button"
          class="flex w-full cursor-pointer flex-wrap items-center gap-2 bg-card px-2.5 py-2 text-left"
          :aria-expanded="expanded === log.id"
          @click="toggle(log.id)"
        >
          <Icon
            name="mingcute:right-line"
            class="shrink-0 text-subtle transition-transform duration-(--duration-fast)"
            :class="expanded === log.id && 'rotate-90'"
          />
          <span
            class="flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-micro"
            :class="outcomeConfig(log.outcome).tone"
          >
            <Icon :name="outcomeConfig(log.outcome).icon" />
            {{ outcomeConfig(log.outcome).label }}
          </span>
          <span class="tnum font-mono text-micro">{{ formatDate(log.createdAt) }}</span>
          <span class="tnum font-mono text-micro text-subtle">{{ formatDuration(log.durationMs) }}</span>
          <span v-if="log.detectedIp" class="font-mono text-micro text-subtle">
            {{ log.detectedIp }}<template v-if="log.detectedCountry"> · {{ log.detectedCountry }}</template>
          </span>
          <span
            v-if="log.isLeaking"
            class="rounded-sm border border-danger-border bg-danger-bg px-1.5 py-0.5 text-micro text-danger"
          >
            адрес утёк
          </span>
        </button>

        <div v-if="expanded === log.id" class="flex flex-col gap-2 border-t border-divider bg-panel px-2.5 py-2 text-sm">
          <p v-if="log.recommendation" class="whitespace-pre-wrap text-muted">{{ log.recommendation }}</p>
          <p v-if="detailsLoading[log.id]" class="text-micro text-subtle">Загружаю разбор шагов…</p>
          <pre
            v-else-if="detailsCache[log.id]"
            class="max-h-64 overflow-auto rounded-md border border-border bg-surface p-2 font-mono text-micro break-all whitespace-pre-wrap"
          >{{ JSON.stringify(detailsCache[log.id]?.fullResult?.steps ?? {}, null, 2) }}</pre>
        </div>
      </div>
    </div>

    <template #footer>
      <UiButton variant="ghost" @click="close">Закрыть</UiButton>
    </template>
  </UiModal>
</template>
