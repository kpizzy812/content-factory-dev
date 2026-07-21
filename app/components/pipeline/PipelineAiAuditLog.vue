<script setup lang="ts">
/**
 * AI Audit Trail — история AI-предложений и действий пользователя.
 * Поддерживает фильтрацию по типу ноды и статусу.
 */

const props = defineProps<{
  nodeType?: string
}>()

const store = usePipelineEditorStore()

interface AuditEntry {
  id: number
  action: string
  nodeType: string | null
  model: string
  prompt: string
  suggestions: unknown
  blockedFields: unknown
  rejectedFields: unknown
  appliedFields: unknown
  status: string
  createdAt: string
}

const expanded = ref(false)
const loading = ref(false)
const entries = ref<AuditEntry[]>([])
const total = ref(0)
const stats = ref<Record<string, number>>({})
const filterStatus = ref<string | null>(null)

const actionLabels: Record<string, string> = {
  block_suggest: 'Автозаполнение блока',
  field_suggest: 'Подсказка поля',
  taxonomy_suggest: 'Генерация taxonomy',
}

const statusLabels: Record<string, { label: string; class: string }> = {
  suggested: { label: 'Предложено', class: 'badge-info' },
  applied: { label: 'Применено', class: 'badge-success' },
  partial: { label: 'Частично', class: 'badge-warning' },
  dismissed: { label: 'Отклонено', class: 'badge-error' },
}

async function loadHistory() {
  loading.value = true
  try {
    const params: Record<string, string | number> = { limit: 20 }
    if (props.nodeType) params.nodeType = props.nodeType
    if (filterStatus.value) params.status = filterStatus.value
    if (store.pipelineId) params.pipelineId = store.pipelineId

    const res = await $fetch<{ data: AuditEntry[]; total: number; stats: Record<string, number> }>('/api/ai/audit', {
      params,
    })
    entries.value = res.data
    total.value = res.total
    stats.value = res.stats ?? {}
  }
  finally {
    loading.value = false
  }
}

function toggle() {
  expanded.value = !expanded.value
  if (expanded.value) loadHistory()
}

function setFilter(status: string | null) {
  filterStatus.value = filterStatus.value === status ? null : status
  loadHistory()
}

const totalActions = computed(() => Object.values(stats.value).reduce((a, b) => a + b, 0))

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function truncate(s: string, max = 60): string {
  return s.length > max ? s.slice(0, max) + '...' : s
}

// Reload when nodeType changes
watch(() => props.nodeType, () => {
  if (expanded.value) loadHistory()
})
</script>

<template>
  <div class="border border-base-300 rounded-box overflow-hidden">
    <button
      type="button"
      class="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-base-200/50 transition-colors text-base-content/60"
      @click="toggle"
    >
      <Icon name="mingcute:history-line" class="text-sm" />
      История AI-предложений
      <span v-if="total > 0" class="badge badge-xs badge-ghost">{{ total }}</span>
      <Icon
        :name="expanded ? 'mingcute:up-line' : 'mingcute:down-line'"
        class="ml-auto text-xs text-base-content/40"
      />
    </button>

    <Transition name="panel">
      <div v-if="expanded" class="px-3 pb-3 space-y-2">
        <!-- Stats row -->
        <div v-if="totalActions > 0" class="flex flex-wrap gap-1">
          <button
            v-for="(cfg, key) in statusLabels"
            :key="key"
            class="badge badge-xs cursor-pointer transition-opacity"
            :class="[cfg.class, filterStatus && filterStatus !== key ? 'opacity-40' : '']"
            @click="setFilter(key)"
          >
            {{ cfg.label }} {{ stats[key] ?? 0 }}
          </button>
          <button
            v-if="filterStatus"
            class="badge badge-xs badge-ghost cursor-pointer"
            @click="setFilter(null)"
          >
            Сбросить
          </button>
        </div>

        <div v-if="loading" class="flex justify-center py-4">
          <span class="loading loading-spinner loading-sm text-base-content/40" />
        </div>

        <div v-else-if="entries.length === 0" class="text-center text-[10px] text-base-content/40 py-3">
          {{ filterStatus ? 'Нет записей с таким статусом' : 'Пока нет AI-предложений' }}
        </div>

        <div v-else class="space-y-1.5 max-h-64 overflow-y-auto">
          <details
            v-for="entry in entries"
            :key="entry.id"
            class="rounded-box border border-base-300 bg-base-100"
          >
            <summary class="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer text-[10px] hover:bg-base-200/30">
              <span class="badge badge-xs" :class="statusLabels[entry.status]?.class ?? 'badge-ghost'">
                {{ statusLabels[entry.status]?.label ?? entry.status }}
              </span>
              <span class="font-medium text-base-content/70">
                {{ actionLabels[entry.action] ?? entry.action }}
              </span>
              <span v-if="entry.nodeType" class="text-base-content/40">
                ({{ entry.nodeType }})
              </span>
              <span class="ml-auto text-base-content/30">
                {{ formatDate(entry.createdAt) }}
              </span>
            </summary>

            <div class="px-2 pb-2 space-y-1 text-[10px]">
              <div class="text-base-content/50">
                <span class="font-medium">Промт:</span> {{ truncate(entry.prompt, 120) }}
              </div>
              <div class="text-base-content/40">
                <span class="font-medium">Модель:</span> {{ entry.model }}
              </div>

              <details v-if="entry.suggestions" class="mt-1">
                <summary class="text-base-content/40 cursor-pointer hover:text-base-content/60">Предложения</summary>
                <pre class="mt-1 whitespace-pre-wrap break-all text-[9px] max-h-24 overflow-auto bg-base-200/50 rounded p-1">{{ JSON.stringify(entry.suggestions, null, 2) }}</pre>
              </details>

              <details v-if="entry.appliedFields" class="mt-1">
                <summary class="text-success/60 cursor-pointer hover:text-success">Применено</summary>
                <pre class="mt-1 whitespace-pre-wrap break-all text-[9px] max-h-24 overflow-auto bg-success/5 rounded p-1">{{ JSON.stringify(entry.appliedFields, null, 2) }}</pre>
              </details>

              <details v-if="entry.rejectedFields" class="mt-1">
                <summary class="text-error/60 cursor-pointer hover:text-error">Отклонено валидацией</summary>
                <pre class="mt-1 whitespace-pre-wrap break-all text-[9px] max-h-24 overflow-auto bg-error/5 rounded p-1">{{ JSON.stringify(entry.rejectedFields, null, 2) }}</pre>
              </details>

              <div v-if="entry.blockedFields" class="text-warning/60">
                <span class="font-medium">Заблокировано:</span>
                {{ Array.isArray(entry.blockedFields) ? (entry.blockedFields as any[]).map((b: any) => b.label || b.field).join(', ') : '—' }}
              </div>
            </div>
          </details>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.panel-enter-active,
.panel-leave-active {
  transition: opacity 0.15s ease, max-height 0.2s ease;
  overflow: hidden;
}
.panel-enter-from,
.panel-leave-to {
  opacity: 0;
  max-height: 0;
}
.panel-enter-to,
.panel-leave-from {
  max-height: 500px;
}
</style>
