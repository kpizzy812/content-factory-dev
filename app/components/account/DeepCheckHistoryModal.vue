<script setup lang="ts">
/**
 * Модалка истории Deep Proxy Check логов per-account (через proxyId).
 *
 * Использование:
 *   const modalRef = ref<{ open: (proxyId: string) => void }>()
 *   modalRef.value?.open(proxyId)
 *
 * Загружает GET /api/proxies/:id/deep-check-history?limit=20. Каждая строка —
 * краткая сводка (outcome/время/duration/detectedIp/recommendation), клик
 * раскрывает collapsible с fullResult (loaded по требованию через GET
 * /api/proxies/deep-check-logs/:logId).
 */
import type {
  DeepProxyCheckLogDetail,
  DeepProxyCheckLogSummary,
} from "~~/shared/types/deep-proxy-check"

const emit = defineEmits<{
  close: []
}>()

const modalRef = ref<HTMLDialogElement>()
const currentProxyId = ref<string | null>(null)
const logs = ref<DeepProxyCheckLogSummary[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const detailsCache = ref<Record<string, DeepProxyCheckLogDetail>>({})
const detailsLoading = ref<Record<string, boolean>>({})

async function loadHistory() {
  if (!currentProxyId.value) return
  loading.value = true
  error.value = null
  try {
    const res = await $fetch<{ data: DeepProxyCheckLogSummary[] }>(
      `/api/proxies/${currentProxyId.value}/deep-check-history?limit=20`,
    )
    logs.value = res.data
  } catch (err: unknown) {
    const e = err as { data?: { message?: string }; message?: string }
    error.value =
      e?.data?.message ?? e?.message ?? "Не удалось загрузить историю"
  } finally {
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
  } catch {
    // Best-effort — оставляем placeholder в UI
  } finally {
    detailsLoading.value[logId] = false
  }
}

async function open(proxyId: string) {
  currentProxyId.value = proxyId
  logs.value = []
  detailsCache.value = {}
  detailsLoading.value = {}
  modalRef.value?.showModal()
  await loadHistory()
}

function close() {
  modalRef.value?.close()
  currentProxyId.value = null
  emit("close")
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatDuration(ms: number | null): string {
  if (!ms) return "—"
  if (ms < 1000) return `${ms} ms`
  const seconds = Math.round(ms / 1000)
  return `${seconds}с`
}

const OUTCOME_CONFIG: Record<
  string,
  { label: string; badgeClass: string; icon: string }
> = {
  ok: {
    label: "OK",
    badgeClass: "badge-success",
    icon: "mingcute:check-circle-line",
  },
  leak: {
    label: "LEAK",
    badgeClass: "badge-error",
    icon: "mingcute:warning-line",
  },
  error: {
    label: "Ошибка",
    badgeClass: "badge-warning",
    icon: "mingcute:close-circle-line",
  },
  precondition_failed: {
    label: "Pre-flight",
    badgeClass: "badge-ghost",
    icon: "mingcute:information-line",
  },
}

function outcomeConfig(outcome: string) {
  return (
    OUTCOME_CONFIG[outcome] ?? {
      label: outcome,
      badgeClass: "badge-ghost",
      icon: "mingcute:question-line",
    }
  )
}

defineExpose({ open, close })
</script>

<template>
  <dialog ref="modalRef" class="modal">
    <div class="modal-box max-w-4xl max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-lg font-bold">История deep-check</h3>
        <button
          class="btn btn-xs btn-ghost"
          :disabled="loading"
          @click="loadHistory"
        >
          <span v-if="loading" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:refresh-3-line" />
          Обновить
        </button>
      </div>

      <div v-if="loading && logs.length === 0" class="flex justify-center py-8">
        <span class="loading loading-spinner loading-md" />
      </div>

      <div v-else-if="error" role="alert" class="alert alert-error alert-soft">
        <Icon name="mingcute:warning-line" />
        <span>{{ error }}</span>
      </div>

      <div v-else-if="logs.length === 0" class="text-center text-base-content/60 py-8">
        <Icon name="mingcute:document-line" class="text-4xl mb-2" />
        <p>Логов deep-check пока нет</p>
        <p class="text-xs mt-1">Запустите проверку из таба «Готовность»</p>
      </div>

      <div v-else class="space-y-2 max-h-[65vh] overflow-y-auto">
        <details
          v-for="log in logs"
          :key="log.id"
          class="collapse collapse-arrow bg-base-200/30 rounded-box"
          @toggle="(e) => (e.target as HTMLDetailsElement).open && loadDetail(log.id)"
        >
          <summary class="collapse-title text-sm py-2">
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="badge badge-xs gap-1"
                :class="outcomeConfig(log.outcome).badgeClass"
              >
                <Icon :name="outcomeConfig(log.outcome).icon" class="text-xs" />
                {{ outcomeConfig(log.outcome).label }}
              </span>
              <span class="font-mono text-xs">{{ formatDate(log.createdAt) }}</span>
              <span class="text-xs text-base-content/60">
                · {{ formatDuration(log.durationMs) }}
              </span>
              <span v-if="log.detectedIp" class="text-xs text-base-content/60">
                · IP {{ log.detectedIp }}
                <span v-if="log.detectedCountry"> ({{ log.detectedCountry }})</span>
              </span>
              <span
                v-if="log.isLeaking"
                class="badge badge-xs badge-error gap-1"
                title="LEAK обнаружен"
              >
                <Icon name="mingcute:warning-line" class="text-xs" />
                LEAK
              </span>
            </div>
          </summary>
          <div class="collapse-content text-xs space-y-2">
            <div v-if="log.recommendation" class="whitespace-pre-wrap text-base-content/80">
              {{ log.recommendation }}
            </div>
            <div
              v-if="detailsLoading[log.id]"
              class="text-base-content/40"
            >
              <span class="loading loading-spinner loading-xs" />
              Загружаю детали…
            </div>
            <pre
              v-else-if="detailsCache[log.id]"
              class="bg-base-200 p-2 rounded font-mono whitespace-pre-wrap break-all max-h-64 overflow-auto"
              >{{ JSON.stringify(detailsCache[log.id]?.fullResult?.steps ?? {}, null, 2) }}</pre>
          </div>
        </details>
      </div>

      <div class="modal-action">
        <button class="btn btn-sm" @click="close">Закрыть</button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="close">close</button>
    </form>
  </dialog>
</template>
