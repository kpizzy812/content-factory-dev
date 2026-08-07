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

// Тон из общего словаря состояний, подписи доменные: «Предложено» и «Применено»
// — это про судьбу подсказки, а не про состояние сущности.
const statusLabels: Record<string, { label: string, tone: string }> = {
  suggested: { label: 'Предложено', tone: 'border-info-border bg-info-bg text-info' },
  applied: { label: 'Применено', tone: 'border-success-border bg-success-bg text-success' },
  partial: { label: 'Частично', tone: 'border-warning-border bg-warning-bg text-warning' },
  dismissed: { label: 'Отклонено', tone: 'border-danger-border bg-danger-bg text-danger' },
}

const NEUTRAL_TONE = 'border-neutral-border bg-neutral-bg text-neutral'

async function loadHistory() {
  loading.value = true
  try {
    const params: Record<string, string | number> = { limit: 20 }
    if (props.nodeType) params.nodeType = props.nodeType
    if (filterStatus.value) params.status = filterStatus.value
    if (store.pipelineId) params.pipelineId = store.pipelineId

    const res = await $fetch<{ data: AuditEntry[], total: number, stats: Record<string, number> }>('/api/ai/audit', {
      params,
    })
    entries.value = res.data
    total.value = res.total
    stats.value = res.stats ?? {}
  } finally {
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
  return s.length > max ? s.slice(0, max) + '…' : s
}

// Reload when nodeType changes
watch(() => props.nodeType, () => {
  if (expanded.value) loadHistory()
})

const CHIP = 'inline-flex h-[18px] cursor-pointer items-center rounded-sm border px-1.5 text-micro transition-opacity duration-(--duration-fast) ease-out'
const JSON_BOX = 'mt-1 max-h-24 overflow-auto rounded-sm border border-divider bg-card p-1 font-mono text-micro break-all whitespace-pre-wrap'
</script>

<template>
  <div class="overflow-hidden rounded-md border border-border">
    <button
      type="button"
      class="flex w-full cursor-pointer items-center gap-2 px-3 py-2 font-medium text-muted transition-colors duration-(--duration-fast) ease-out hover:bg-raised hover:text-fg"
      @click="toggle"
    >
      <Icon name="mingcute:history-line" />
      История AI-предложений
      <span v-if="total > 0" class="tnum rounded-sm border border-neutral-border bg-neutral-bg px-1 text-micro text-neutral">
        {{ total }}
      </span>
      <Icon :name="expanded ? 'mingcute:up-line' : 'mingcute:down-line'" class="ml-auto text-subtle" />
    </button>

    <Transition name="panel">
      <div v-if="expanded" class="flex flex-col gap-2 px-3 pb-3">
        <!-- Разбивка по статусам, она же фильтр -->
        <div v-if="totalActions > 0" class="flex flex-wrap gap-1">
          <button
            v-for="(cfg, key) in statusLabels"
            :key="key"
            type="button"
            :class="[CHIP, cfg.tone, filterStatus && filterStatus !== key ? 'opacity-40' : '']"
            @click="setFilter(key)"
          >
            {{ cfg.label }} {{ stats[key] ?? 0 }}
          </button>
          <button
            v-if="filterStatus"
            type="button"
            :class="[CHIP, NEUTRAL_TONE]"
            @click="setFilter(null)"
          >
            Сбросить
          </button>
        </div>

        <div v-if="loading" class="flex justify-center py-4 text-subtle">
          <Icon name="mingcute:loading-line" class="animate-spin text-lg" />
        </div>

        <p v-else-if="entries.length === 0" class="py-3 text-center text-micro text-subtle">
          {{ filterStatus ? 'Нет записей с таким статусом' : 'Пока нет AI-предложений' }}
        </p>

        <div v-else class="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
          <details
            v-for="entry in entries"
            :key="entry.id"
            class="rounded-md border border-border bg-card"
          >
            <summary class="flex cursor-pointer items-center gap-1.5 px-2 py-1.5 text-micro hover:bg-raised">
              <span
                class="inline-flex h-[18px] items-center rounded-sm border px-1.5 text-micro"
                :class="statusLabels[entry.status]?.tone ?? NEUTRAL_TONE"
              >{{ statusLabels[entry.status]?.label ?? entry.status }}</span>
              <span class="font-medium text-muted">
                {{ actionLabels[entry.action] ?? entry.action }}
              </span>
              <span v-if="entry.nodeType" class="text-subtle">({{ entry.nodeType }})</span>
              <ClientOnly>
                <span class="ml-auto text-subtle">{{ formatDate(entry.createdAt) }}</span>
              </ClientOnly>
            </summary>

            <div class="flex flex-col gap-1 px-2 pb-2 text-micro">
              <div class="text-muted">
                <span class="font-medium">Промт:</span> {{ truncate(entry.prompt, 120) }}
              </div>
              <div class="text-subtle">
                <span class="font-medium">Модель:</span> {{ entry.model }}
              </div>

              <details v-if="entry.suggestions">
                <summary class="cursor-pointer text-subtle hover:text-muted">Предложения</summary>
                <pre :class="JSON_BOX">{{ JSON.stringify(entry.suggestions, null, 2) }}</pre>
              </details>

              <details v-if="entry.appliedFields">
                <summary class="cursor-pointer text-success">Применено</summary>
                <pre :class="JSON_BOX">{{ JSON.stringify(entry.appliedFields, null, 2) }}</pre>
              </details>

              <details v-if="entry.rejectedFields">
                <summary class="cursor-pointer text-danger">Отклонено валидацией</summary>
                <pre :class="JSON_BOX">{{ JSON.stringify(entry.rejectedFields, null, 2) }}</pre>
              </details>

              <div v-if="entry.blockedFields" class="text-warning">
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
