<script setup lang="ts">
import type { PostingJobDto, PostingJobLogDto } from '~~/shared/types/posting-job'

/**
 * Журнал одной задачи постинга. Строки — общие `UiLogRow`: время, уровень,
 * сообщение, разворачивающиеся данные. Своя таблица здесь ничего не добавляла.
 */
const emit = defineEmits<{ close: [] }>()

const isOpen = ref(false)
const currentJobId = ref<string | null>(null)
const currentJobLabel = ref('')
const currentJob = ref<PostingJobDto | null>(null)
const logs = ref<PostingJobLogDto[]>([])
const total = ref(0)
const loading = ref(false)
const errorMessage = ref<string | null>(null)

const { fetchLogs } = usePostingJobActions()

const limit = 100
const offset = ref(0)

async function load() {
  if (!currentJobId.value) return
  loading.value = true
  errorMessage.value = null
  try {
    const res = await fetchLogs(currentJobId.value, { limit, offset: offset.value })
    if (res) {
      logs.value = res.items
      total.value = res.total
    }
    else {
      errorMessage.value = 'Журнал не загрузился'
    }
  }
  finally {
    loading.value = false
  }
}

async function open(jobOrId: string | PostingJobDto, label?: string) {
  if (typeof jobOrId === 'string') {
    currentJobId.value = jobOrId
    currentJob.value = null
    currentJobLabel.value = label ?? jobOrId.slice(0, 8)
  }
  else {
    currentJobId.value = jobOrId.id
    currentJob.value = jobOrId
    currentJobLabel.value = label ?? jobOrId.id.slice(0, 8)
  }
  logs.value = []
  total.value = 0
  offset.value = 0
  errorMessage.value = null
  isOpen.value = true
  await load()
}

function close() {
  isOpen.value = false
  logs.value = []
  currentJobId.value = null
  emit('close')
}

async function nextPage() {
  if (offset.value + limit >= total.value) return
  offset.value += limit
  await load()
}

async function prevPage() {
  if (offset.value === 0) return
  offset.value = Math.max(0, offset.value - limit)
  await load()
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function normalizeLevel(level: string): 'debug' | 'info' | 'warn' | 'error' {
  if (level === 'warn' || level === 'error' || level === 'debug') return level
  return 'info'
}

function formatData(data: Record<string, unknown> | null): string | undefined {
  if (!data) return undefined
  try {
    return JSON.stringify(data, null, 2)
  }
  catch {
    return String(data)
  }
}

const hasNext = computed(() => offset.value + limit < total.value)
const hasPrev = computed(() => offset.value > 0)
const pageInfo = computed(() => {
  if (!total.value) return 'записей нет'
  const from = offset.value + 1
  const to = Math.min(offset.value + logs.value.length, total.value)
  return `${from}–${to} из ${total.value}`
})

defineExpose({ open, close })
</script>

<template>
  <UiModal :open="isOpen" size="lg" @close="close">
    <template #header>
      <span class="flex flex-wrap items-baseline gap-2">
        Журнал публикации
        <span class="font-mono text-sm font-normal text-subtle">{{ currentJobLabel }}</span>
        <span class="tnum font-mono text-sm font-normal text-subtle">{{ pageInfo }}</span>
      </span>
    </template>

    <div class="flex flex-col gap-3">
      <div class="flex items-center gap-2">
        <UiButton variant="ghost" :loading="loading" @click="load">
          <Icon v-if="!loading" name="mingcute:refresh-3-line" />
          Обновить
        </UiButton>
      </div>

      <UiDisclosure
        v-if="currentJob && currentJob.platform === 'youtube'"
        title="Шаги публикации на YouTube"
        icon="mingcute:list-ordered-line"
      >
        <PostingJobPhaseProgress :job="currentJob" />
      </UiDisclosure>

      <UiSkeleton v-if="loading && !logs.length" variant="details" :count="6" />

      <UiErrorState v-else-if="errorMessage" message="Журнал не загрузился." :details="errorMessage" @retry="load" />

      <UiEmptyState
        v-else-if="!logs.length"
        variant="first"
        title="Записей ещё нет"
        description="Журнал заполняется, когда задача уходит в работу."
      />

      <div v-else class="max-h-[55vh] overflow-y-auto rounded-md border border-border bg-panel p-1">
        <UiLogRow
          v-for="log in logs"
          :key="log.id"
          :time="formatTime(log.createdAt)"
          :level="normalizeLevel(log.level)"
          :message="log.message"
          :details="formatData(log.data)"
        />
      </div>
    </div>

    <template #footer>
      <UiButton :disabled="!hasPrev || loading" @click="prevPage">
        <Icon name="mingcute:left-line" />
        Раньше
      </UiButton>
      <UiButton :disabled="!hasNext || loading" @click="nextPage">
        Позже
        <Icon name="mingcute:right-line" />
      </UiButton>
      <span class="flex-1" />
      <UiButton variant="ghost" @click="close">Закрыть</UiButton>
    </template>
  </UiModal>
</template>
