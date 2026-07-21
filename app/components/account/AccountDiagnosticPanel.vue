<script setup lang="ts">
import type { AccountDiagnosticError } from "~~/shared/types/account-diagnostic"

const props = defineProps<{
  error: AccountDiagnosticError | null
  /**
   * jobId для загрузки полного timeline diagnostic snapshots (PNG+HTML+JSON).
   * Если не передан — показывается только screenshot из error.screenshotKey.
   */
  jobId?: string
}>()

const mode = ref<"human" | "json">("human")
const copied = ref(false)
const isOpen = ref(true)

async function copyError() {
  if (!props.error) return
  try {
    await navigator.clipboard.writeText(JSON.stringify(props.error, null, 2))
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    copied.value = false
  }
}

// Part D: открытие screenshot через signed URL
const screenshotLoading = ref(false)
const screenshotError = ref<string | null>(null)

async function openSignedUrl(key: string) {
  const res = await $fetch<{ data: { url: string } }>("/api/posting/screenshot-url", {
    query: { key },
  })
  window.open(res.data.url, "_blank", "noopener")
}

async function openScreenshot() {
  if (!props.error?.screenshotKey) return
  screenshotError.value = null
  screenshotLoading.value = true
  try {
    await openSignedUrl(props.error.screenshotKey)
  } catch (err: unknown) {
    const e = err as { data?: { message?: string }; message?: string }
    screenshotError.value = e?.data?.message ?? e?.message ?? "Не удалось получить URL"
  } finally {
    screenshotLoading.value = false
  }
}

// Timeline: PNG/HTML/JSON checkpoints для всего job (multi-keypoint diagnostic).
interface DiagnosticItem {
  key: string
  sizeBytes: number
  contentType: string | null
  createdAt: string | null
  parsed: {
    jobId: string | null
    phase: string | null
    label: string | null
    timestamp: string | null
    ext: string
  }
}
const timelineLoading = ref(false)
const timelineError = ref<string | null>(null)
const timelineItems = ref<DiagnosticItem[]>([])
const timelineLoaded = ref(false)

async function loadTimeline() {
  if (!props.jobId) return
  timelineError.value = null
  timelineLoading.value = true
  try {
    const res = await $fetch<{ data: { items: DiagnosticItem[]; count: number } }>(
      "/api/posting/diagnostics/list",
      { query: { jobId: props.jobId } },
    )
    timelineItems.value = res.data.items
    timelineLoaded.value = true
  } catch (err: unknown) {
    const e = err as { data?: { message?: string }; message?: string }
    timelineError.value = e?.data?.message ?? e?.message ?? "Не удалось загрузить timeline"
  } finally {
    timelineLoading.value = false
  }
}

function extIconName(ext: string): string {
  if (ext === ".png") return "mingcute:photo-album-line"
  if (ext === ".html") return "mingcute:code-line"
  if (ext === ".json") return "mingcute:file-code-line"
  return "mingcute:file-line"
}
function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / 1024 / 1024).toFixed(2)}MB`
}
async function openTimelineItem(item: DiagnosticItem) {
  try {
    await openSignedUrl(item.key)
  } catch (err: unknown) {
    const e = err as { data?: { message?: string }; message?: string }
    timelineError.value = e?.data?.message ?? e?.message ?? "Не удалось открыть"
  }
}
// Группировка по timestamp (один checkpoint = png+html+json с одним ts).
const timelineGroups = computed(() => {
  const groups = new Map<string, DiagnosticItem[]>()
  for (const item of timelineItems.value) {
    const ts = item.parsed.timestamp ?? "unknown"
    const phase = item.parsed.phase ?? "unknown"
    const label = item.parsed.label ?? "no-label"
    const groupKey = `${ts}__${phase}__${label}`
    const existing = groups.get(groupKey) ?? []
    existing.push(item)
    groups.set(groupKey, existing)
  }
  return Array.from(groups.entries()).map(([k, items]) => {
    const first = items[0]
    return {
      groupKey: k,
      phase: first?.parsed.phase ?? "unknown",
      label: first?.parsed.label ?? "no-label",
      timestamp: first?.parsed.timestamp ?? "unknown",
      items: items.sort((a, b) => a.parsed.ext.localeCompare(b.parsed.ext)),
    }
  })
})
</script>

<template>
  <div
    v-if="error"
    class="collapse collapse-arrow border border-error/40 bg-error/5 mt-3"
  >
    <input type="checkbox" v-model="isOpen" />
    <div class="collapse-title text-sm font-medium text-error flex items-center gap-2">
      <Icon name="mingcute:warning-line" />
      <span>Ошибка — нажмите для деталей</span>
    </div>
    <div class="collapse-content text-xs">
      <div class="flex flex-wrap gap-2 mb-2 items-center">
        <div role="tablist" class="tabs tabs-box tabs-xs">
          <button
            role="tab"
            class="tab"
            :class="{ 'tab-active': mode === 'human' }"
            @click="mode = 'human'"
          >
            Человекочитаемо
          </button>
          <button
            role="tab"
            class="tab"
            :class="{ 'tab-active': mode === 'json' }"
            @click="mode = 'json'"
          >
            JSON
          </button>
        </div>
        <button
          type="button"
          class="btn btn-xs btn-ghost ml-auto"
          @click="copyError"
        >
          <Icon name="mingcute:copy-2-line" />
          {{ copied ? "Скопировано" : "Копировать" }}
        </button>
      </div>

      <div v-if="mode === 'human'" class="space-y-1 leading-relaxed">
        <div>
          <span class="opacity-60">Сообщение:</span>
          <span class="ml-1 font-medium">{{ error.message }}</span>
        </div>
        <div v-if="error.statusCode">
          <span class="opacity-60">HTTP код:</span>
          <span class="ml-1 font-mono">{{ error.statusCode }}</span>
        </div>
        <div v-if="error.phase">
          <span class="opacity-60">Этап:</span>
          <span class="ml-1">{{ error.phase }}</span>
        </div>
        <div v-if="error.url">
          <span class="opacity-60">URL:</span>
          <code class="ml-1">{{ error.url }}</code>
        </div>
        <div v-if="error.cause">
          <span class="opacity-60">Причина:</span>
          <span class="ml-1">{{ error.cause }}</span>
        </div>
        <div v-if="error.suggestion" class="text-info mt-2">
          <Icon name="mingcute:lightbulb-line" class="inline-block" />
          <span class="ml-1"><b>Что делать:</b> {{ error.suggestion }}</span>
        </div>
        <div v-if="error.postingPhase">
          <span class="opacity-60">Фаза browser automation:</span>
          <span class="ml-1 font-mono">{{ error.postingPhase }}</span>
        </div>
        <div v-if="error.screenshotKey" class="mt-2 flex items-center gap-2">
          <button
            type="button"
            class="btn btn-xs btn-outline btn-info"
            :disabled="screenshotLoading"
            @click="openScreenshot"
          >
            <span v-if="screenshotLoading" class="loading loading-spinner loading-xs" />
            <Icon v-else name="mingcute:photo-album-line" />
            Открыть скриншот
          </button>
          <span v-if="screenshotError" class="text-error">{{ screenshotError }}</span>
        </div>

        <!-- Timeline всех diagnostic checkpoints (PNG+HTML+JSON) если jobId передан. -->
        <div v-if="jobId" class="mt-3 pt-2 border-t border-error/20">
          <div class="flex items-center gap-2 mb-2">
            <button
              type="button"
              class="btn btn-xs btn-outline"
              :disabled="timelineLoading"
              @click="loadTimeline"
            >
              <span v-if="timelineLoading" class="loading loading-spinner loading-xs" />
              <Icon v-else name="mingcute:time-line" />
              {{ timelineLoaded ? "Обновить" : "Загрузить" }} timeline checkpoints
            </button>
            <span v-if="timelineLoaded" class="opacity-60">
              {{ timelineItems.length }} файлов
            </span>
            <span v-if="timelineError" class="text-error">{{ timelineError }}</span>
          </div>
          <div v-if="timelineLoaded && timelineGroups.length > 0" class="space-y-1">
            <div
              v-for="group in timelineGroups"
              :key="group.groupKey"
              class="border border-base-300 rounded p-1 bg-base-100"
            >
              <div class="flex items-center gap-2 flex-wrap">
                <span class="badge badge-xs badge-info">{{ group.phase }}</span>
                <span class="font-mono text-[10px]">{{ group.label }}</span>
                <span class="opacity-50 text-[10px]">{{ group.timestamp }}</span>
              </div>
              <div class="flex items-center gap-1 mt-1 flex-wrap">
                <button
                  v-for="item in group.items"
                  :key="item.key"
                  type="button"
                  class="btn btn-xs btn-ghost gap-1"
                  :title="`${item.key} (${formatBytes(item.sizeBytes)})`"
                  @click="openTimelineItem(item)"
                >
                  <Icon :name="extIconName(item.parsed.ext)" />
                  {{ item.parsed.ext }}
                  <span class="opacity-50">{{ formatBytes(item.sizeBytes) }}</span>
                </button>
              </div>
            </div>
          </div>
          <div v-else-if="timelineLoaded" class="text-xs opacity-60">
            Файлов diagnostic не найдено.
          </div>
        </div>

        <div class="opacity-40 mt-2">{{ error.timestamp }}</div>
      </div>

      <pre
        v-else
        class="overflow-auto bg-base-300 text-base-content p-2 rounded text-[10px]"
      >{{ JSON.stringify(error, null, 2) }}</pre>
    </div>
  </div>
</template>
