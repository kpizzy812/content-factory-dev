<script setup lang="ts">
import type { AccountDiagnosticError } from '~~/shared/types/account-diagnostic'

/**
 * Разбор ошибки аккаунта: человекочитаемая версия и тот же объект в JSON —
 * второй нужен, чтобы приложить его к обращению без пересказа.
 *
 * `mingcute:lightbulb-line` в старой версии не существовала и молча не рисовалась;
 * подсказка теперь под `mingcute:bulb-line`.
 */
const props = defineProps<{
  error?: AccountDiagnosticError | null
  /** jobId для timeline всех снимков диагностики (PNG + HTML + JSON). */
  jobId?: string
}>()

const toast = useToast()

const mode = ref<'human' | 'json'>('human')

async function copyError() {
  if (!props.error) return
  try {
    await navigator.clipboard.writeText(JSON.stringify(props.error, null, 2))
    toast.success('Разбор ошибки скопирован')
  }
  catch {
    toast.error('Браузер не дал доступ к буферу обмена')
  }
}

const screenshotLoading = ref(false)
const screenshotError = ref<string | null>(null)

async function openSignedUrl(key: string) {
  const res = await $fetch<{ data: { url: string } }>('/api/posting/screenshot-url', { query: { key } })
  window.open(res.data.url, '_blank', 'noopener')
}

async function openScreenshot() {
  if (!props.error?.screenshotKey) return
  screenshotError.value = null
  screenshotLoading.value = true
  try {
    await openSignedUrl(props.error.screenshotKey)
  }
  catch (err: unknown) {
    const e = err as { data?: { message?: string }, message?: string }
    screenshotError.value = e?.data?.message ?? e?.message ?? 'Не удалось получить ссылку'
  }
  finally {
    screenshotLoading.value = false
  }
}

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
    const res = await $fetch<{ data: { items: DiagnosticItem[], count: number } }>(
      '/api/posting/diagnostics/list',
      { query: { jobId: props.jobId } },
    )
    timelineItems.value = res.data.items
    timelineLoaded.value = true
  }
  catch (err: unknown) {
    const e = err as { data?: { message?: string }, message?: string }
    timelineError.value = e?.data?.message ?? e?.message ?? 'Не удалось загрузить снимки'
  }
  finally {
    timelineLoading.value = false
  }
}

function extIconName(ext: string): string {
  if (ext === '.png') return 'mingcute:photo-album-line'
  if (ext === '.html') return 'mingcute:code-line'
  if (ext === '.json') return 'mingcute:file-code-line'
  return 'mingcute:file-line'
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`
  return `${(n / 1024 / 1024).toFixed(2)} МБ`
}

async function openTimelineItem(item: DiagnosticItem) {
  try {
    await openSignedUrl(item.key)
  }
  catch (err: unknown) {
    const e = err as { data?: { message?: string }, message?: string }
    timelineError.value = e?.data?.message ?? e?.message ?? 'Не удалось открыть'
  }
}

/** Один checkpoint — это png + html + json с одной меткой времени. */
const timelineGroups = computed(() => {
  const groups = new Map<string, DiagnosticItem[]>()
  for (const item of timelineItems.value) {
    const ts = item.parsed.timestamp ?? 'unknown'
    const phase = item.parsed.phase ?? 'unknown'
    const label = item.parsed.label ?? 'no-label'
    const groupKey = `${ts}__${phase}__${label}`
    const existing = groups.get(groupKey) ?? []
    existing.push(item)
    groups.set(groupKey, existing)
  }
  return Array.from(groups.entries()).map(([k, items]) => {
    const first = items[0]
    return {
      groupKey: k,
      phase: first?.parsed.phase ?? 'unknown',
      label: first?.parsed.label ?? 'no-label',
      timestamp: first?.parsed.timestamp ?? 'unknown',
      items: [...items].sort((a, b) => a.parsed.ext.localeCompare(b.parsed.ext)),
    }
  })
})
</script>

<template>
  <UiDisclosure
    v-if="error"
    title="Ошибка — раскрыть разбор"
    icon="mingcute:warning-line"
    icon-tone="text-danger"
    default-open
  >
    <div class="flex flex-col gap-2.5 text-sm">
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex overflow-hidden rounded-md border border-border">
          <button
            v-for="m in (['human', 'json'] as const)"
            :key="m"
            type="button"
            class="h-6 cursor-pointer px-2.5 text-micro"
            :class="mode === m ? 'bg-accent text-on-accent' : 'bg-card text-muted hover:text-fg'"
            @click="mode = m"
          >
            {{ m === 'human' ? 'Человекочитаемо' : 'JSON' }}
          </button>
        </div>
        <span class="flex-1" />
        <UiButton variant="ghost" @click="copyError">
          <Icon name="mingcute:copy-2-line" />
          Копировать
        </UiButton>
      </div>

      <template v-if="mode === 'human'">
        <UiKeyValue
          :items="[
            { label: 'Сообщение', value: error.message, mono: false },
            ...(error.statusCode ? [{ label: 'Код HTTP', value: error.statusCode }] : []),
            ...(error.phase ? [{ label: 'Этап', value: error.phase }] : []),
            ...(error.url ? [{ label: 'URL', value: error.url }] : []),
            ...(error.cause ? [{ label: 'Причина', value: error.cause, mono: false }] : []),
            ...(error.postingPhase ? [{ label: 'Фаза постинга', value: error.postingPhase }] : []),
            { label: 'Когда', value: error.timestamp },
          ]"
          label-width="130px"
        />

        <p v-if="error.suggestion" class="flex gap-2 rounded-md border border-info-border bg-info-bg p-2.5">
          <Icon name="mingcute:bulb-line" class="mt-0.5 shrink-0 text-info" />
          <span><b>Что делать:</b> {{ error.suggestion }}</span>
        </p>

        <div v-if="error.screenshotKey" class="flex items-center gap-2">
          <UiButton :loading="screenshotLoading" @click="openScreenshot">
            <Icon v-if="!screenshotLoading" name="mingcute:photo-album-line" />
            Открыть скриншот
          </UiButton>
          <span v-if="screenshotError" class="text-danger">{{ screenshotError }}</span>
        </div>

        <div v-if="jobId" class="flex flex-col gap-2 border-t border-divider pt-2.5">
          <div class="flex flex-wrap items-center gap-2">
            <UiButton :loading="timelineLoading" @click="loadTimeline">
              <Icon v-if="!timelineLoading" name="mingcute:time-line" />
              {{ timelineLoaded ? 'Обновить снимки' : 'Загрузить снимки' }}
            </UiButton>
            <span v-if="timelineLoaded" class="tnum font-mono text-micro text-subtle">{{ timelineItems.length }} файлов</span>
            <span v-if="timelineError" class="text-danger">{{ timelineError }}</span>
          </div>

          <div v-if="timelineLoaded && timelineGroups.length" class="flex flex-col gap-1.5">
            <div
              v-for="group in timelineGroups"
              :key="group.groupKey"
              class="rounded-md border border-border bg-card p-2"
            >
              <div class="flex flex-wrap items-center gap-2 text-micro">
                <span class="rounded-sm border border-info-border bg-info-bg px-1.5 text-info">{{ group.phase }}</span>
                <span class="font-mono">{{ group.label }}</span>
                <span class="tnum font-mono text-subtle">{{ group.timestamp }}</span>
              </div>
              <div class="mt-1.5 flex flex-wrap items-center gap-1">
                <UiButton
                  v-for="item in group.items"
                  :key="item.key"
                  variant="ghost"
                  @click="openTimelineItem(item)"
                >
                  <Icon :name="extIconName(item.parsed.ext)" />
                  {{ item.parsed.ext }}
                  <span class="tnum text-subtle">{{ formatBytes(item.sizeBytes) }}</span>
                </UiButton>
              </div>
            </div>
          </div>
          <p v-else-if="timelineLoaded" class="text-micro text-subtle">Снимков диагностики нет.</p>
        </div>
      </template>

      <pre
        v-else
        class="overflow-auto rounded-md border border-border bg-surface p-2 font-mono text-micro"
      >{{ JSON.stringify(error, null, 2) }}</pre>
    </div>
  </UiDisclosure>
</template>
