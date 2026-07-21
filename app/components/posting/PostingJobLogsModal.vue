<script setup lang="ts">
import type { PostingJobDto, PostingJobLogDto } from "~~/shared/types/posting-job"

const emit = defineEmits<{
  close: []
}>()

const modalRef = ref<HTMLDialogElement>()
const currentJobId = ref<string | null>(null)
const currentJobLabel = ref<string>("")
const currentJob = ref<PostingJobDto | null>(null)
const logs = ref<PostingJobLogDto[]>([])
const total = ref<number>(0)
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
    const res = await fetchLogs(currentJobId.value, {
      limit,
      offset: offset.value,
    })
    if (res) {
      logs.value = res.items
      total.value = res.total
    } else {
      errorMessage.value = "Не удалось загрузить логи"
    }
  } finally {
    loading.value = false
  }
}

async function open(jobOrId: string | PostingJobDto, label?: string) {
  if (typeof jobOrId === "string") {
    currentJobId.value = jobOrId
    currentJob.value = null
    currentJobLabel.value = label ?? jobOrId.slice(0, 8)
  } else {
    currentJobId.value = jobOrId.id
    currentJob.value = jobOrId
    currentJobLabel.value = label ?? jobOrId.id.slice(0, 8)
  }
  logs.value = []
  total.value = 0
  offset.value = 0
  errorMessage.value = null
  modalRef.value?.showModal()
  await load()
}

function close() {
  modalRef.value?.close()
  logs.value = []
  currentJobId.value = null
  emit("close")
}

async function refresh() {
  await load()
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

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

const levelBadgeClass: Record<string, string> = {
  info: "badge-info",
  warn: "badge-warning",
  error: "badge-error",
}

function badgeClassFor(level: string): string {
  return levelBadgeClass[level] ?? "badge-ghost"
}

function formatData(data: Record<string, unknown> | null): string {
  if (!data) return ""
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

const hasNext = computed(() => offset.value + limit < total.value)
const hasPrev = computed(() => offset.value > 0)
const pageInfo = computed(() => {
  if (total.value === 0) return "0 записей"
  const from = offset.value + 1
  const to = Math.min(offset.value + logs.value.length, total.value)
  return `${from}–${to} из ${total.value}`
})

defineExpose({ open, close })
</script>

<template>
  <dialog ref="modalRef" class="modal">
    <div class="modal-box max-w-5xl">
      <div class="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div>
          <h3 class="text-lg font-bold">Логи публикации</h3>
          <p class="text-xs text-base-content/60">
            Job: <code class="bg-base-200 px-1 rounded">{{ currentJobLabel }}</code>
            · {{ pageInfo }}
          </p>
        </div>
        <button
          class="btn btn-xs btn-ghost gap-1"
          :disabled="loading"
          @click="refresh"
        >
          <span v-if="loading" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:refresh-3-line" />
          Обновить
        </button>
      </div>

      <!-- YouTube phase progress (только для youtube job, отдельная collapsible секция) -->
      <details
        v-if="currentJob && currentJob.platform === 'youtube'"
        class="collapse collapse-arrow bg-base-200/30 mb-3"
      >
        <summary class="collapse-title text-sm font-medium">
          Фазы постинга YouTube
        </summary>
        <div class="collapse-content">
          <PostingJobPhaseProgress :job="currentJob" />
        </div>
      </details>

      <div v-if="loading && logs.length === 0" class="flex justify-center py-8">
        <span class="loading loading-spinner loading-lg" />
      </div>

      <div
        v-else-if="errorMessage"
        role="alert"
        class="alert alert-error alert-soft"
      >
        <Icon name="mingcute:warning-line" />
        <span>{{ errorMessage }}</span>
      </div>

      <div
        v-else-if="logs.length === 0"
        class="py-8 text-center text-base-content/60"
      >
        <Icon name="mingcute:document-line" class="text-4xl mb-2" />
        <p>Логов пока нет</p>
      </div>

      <div v-else class="overflow-x-auto max-h-[60vh]">
        <table class="table table-xs table-pin-rows">
          <thead>
            <tr>
              <th class="w-32">Когда</th>
              <th class="w-20">Уровень</th>
              <th>Сообщение</th>
              <th class="w-64">Данные</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="log in logs" :key="log.id">
              <td class="whitespace-nowrap font-mono text-xs">
                {{ formatDate(log.createdAt) }}
              </td>
              <td>
                <span
                  class="badge badge-xs"
                  :class="badgeClassFor(log.level)"
                >
                  {{ log.level }}
                </span>
              </td>
              <td class="text-sm break-words">{{ log.message }}</td>
              <td>
                <details v-if="log.data" class="text-xs">
                  <summary class="cursor-pointer text-base-content/60">
                    Развернуть
                  </summary>
                  <pre
                    class="bg-base-200 p-2 rounded mt-1 whitespace-pre-wrap break-all max-h-40 overflow-auto"
                  >{{ formatData(log.data) }}</pre>
                </details>
                <span v-else class="text-base-content/40">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="modal-action items-center justify-between flex-wrap gap-2">
        <div class="join">
          <button
            class="btn btn-xs join-item"
            :disabled="!hasPrev || loading"
            @click="prevPage"
          >
            <Icon name="mingcute:left-line" />
            Назад
          </button>
          <button
            class="btn btn-xs join-item"
            :disabled="!hasNext || loading"
            @click="nextPage"
          >
            Вперёд
            <Icon name="mingcute:right-line" />
          </button>
        </div>
        <button class="btn btn-sm" @click="close">Закрыть</button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="close">close</button>
    </form>
  </dialog>
</template>
