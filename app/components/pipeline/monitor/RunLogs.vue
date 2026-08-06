<script setup lang="ts">
/**
 * Логи запуска. Источник: design-preview/catalog/05-run-monitor.dc.html
 *
 * Отдельного потока логов у нас нет: строки лежат в `logs` каждого шага и
 * приезжают тем же опросом, что и сам запуск. Поэтому здесь сборка по шагам,
 * фильтр по уровню, поиск и привязка строки к шагу — но не «поток открыт».
 *
 * Автопрокрутка отключается: иначе невозможно читать то, что уже проехало.
 */
import type { WorkflowStep } from '~~/shared/types/workflow'
import { formatClock } from '../PipelineRunFormat'

const props = defineProps<{
  steps: WorkflowStep[]
  /** Предвыбранный шаг — приезжает из кнопки «Логи шага». */
  stepFilter: string
}>()

const emit = defineEmits<{ 'update:stepFilter': [value: string] }>()

interface LogLine {
  key: string
  ts: string
  level: string
  nodeId: string
  stepName: string
  message: string
  data: unknown
}

const LEVELS = [
  { value: '', label: 'все', tone: 'text-fg' },
  { value: 'info', label: 'info', tone: 'text-info' },
  { value: 'warn', label: 'warn', tone: 'text-warning' },
  { value: 'error', label: 'err', tone: 'text-danger' },
] as const

const level = ref<string>('')
const search = ref('')
const autoscroll = ref(true)
const expanded = ref<Set<string>>(new Set())
const viewport = ref<HTMLElement | null>(null)

const allLines = computed<LogLine[]>(() => {
  const out: LogLine[] = []
  for (const step of props.steps) {
    const logs = Array.isArray(step.logs) ? step.logs : []
    logs.forEach((entry, i) => {
      out.push({
        key: `${step.id}-${i}`,
        ts: entry.ts,
        level: entry.level,
        nodeId: step.nodeId,
        stepName: step.nodeName || step.nodeId,
        message: entry.message,
        data: entry.data,
      })
    })
  }
  return out.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
})

const lines = computed(() => {
  const q = search.value.trim().toLowerCase()
  return allLines.value.filter((line) => {
    if (level.value && line.level !== level.value) return false
    if (props.stepFilter && line.nodeId !== props.stepFilter) return false
    if (q && !line.message.toLowerCase().includes(q) && !line.stepName.toLowerCase().includes(q)) return false
    return true
  })
})

const counts = computed(() => ({
  warn: allLines.value.filter(l => l.level === 'warn').length,
  error: allLines.value.filter(l => l.level === 'error').length,
}))

const stepOptions = computed(() => [
  { value: '', label: 'Шаг: все' },
  ...props.steps.map(s => ({ value: s.nodeId, label: s.nodeName || s.nodeId })),
])

const levelTone: Record<string, string> = {
  info: 'text-info',
  warn: 'text-warning',
  error: 'text-danger',
  debug: 'text-subtle',
}

const rowTone: Record<string, string> = {
  warn: 'bg-warning-bg',
  error: 'bg-danger-bg',
}

function toggle(key: string) {
  if (expanded.value.has(key)) expanded.value.delete(key)
  else expanded.value.add(key)
  expanded.value = new Set(expanded.value)
}

watch(lines, async () => {
  if (!autoscroll.value) return
  await nextTick()
  const el = viewport.value
  if (el) el.scrollTop = el.scrollHeight
})

function download() {
  const text = lines.value
    .map(l => `${l.ts}\t${l.level.toUpperCase()}\t${l.stepName}\t${l.message}`)
    .join('\n')
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'run-logs.txt'
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="overflow-hidden rounded-lg border border-border bg-panel">
    <div class="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
      <UiInput v-model="search" placeholder="Поиск в логах" class="max-w-44 flex-1" />

      <div class="flex rounded-md border border-border bg-panel p-0.5">
        <button
          v-for="item in LEVELS"
          :key="item.value"
          type="button"
          class="h-[22px] cursor-pointer rounded-sm px-2 font-mono text-sm"
          :class="level === item.value ? ['bg-raised', item.tone] : [item.tone, 'opacity-70 hover:opacity-100']"
          @click="level = item.value"
        >
          {{ item.label }}
        </button>
      </div>

      <UiSelect
        :model-value="stepFilter"
        :options="stepOptions"
        class="w-44"
        @update:model-value="(v) => emit('update:stepFilter', String(v ?? ''))"
      />

      <span class="flex-1" />
      <UiCheckbox v-model="autoscroll" label="Автопрокрутка" />
      <UiButton variant="ghost" :disabled="!lines.length" @click="download">
        <Icon name="mingcute:download-2-line" />
        Скачать
      </UiButton>
    </div>

    <div ref="viewport" class="max-h-[420px] overflow-auto font-mono text-sm">
      <p v-if="!allLines.length" class="px-3 py-6 text-center text-muted">
        Шаги этого запуска логов не писали.
      </p>
      <p v-else-if="!lines.length" class="px-3 py-6 text-center text-muted">
        Под фильтр ничего не попало.
      </p>

      <div
        v-for="line in lines"
        :key="line.key"
        class="border-b border-divider last:border-b-0"
        :class="rowTone[line.level]"
      >
        <button
          type="button"
          class="grid w-full cursor-pointer grid-cols-[64px_40px_minmax(0,1fr)] items-baseline gap-x-2.5 px-3 py-1 text-left sm:grid-cols-[74px_44px_128px_minmax(0,1fr)_14px]"
          :aria-expanded="expanded.has(line.key)"
          @click="toggle(line.key)"
        >
          <span class="tnum text-subtle">{{ formatClock(line.ts) }}</span>
          <span :class="levelTone[line.level] ?? 'text-subtle'">{{ line.level.toUpperCase() }}</span>
          <span class="hidden truncate text-subtle sm:block">{{ line.stepName }}</span>
          <span
            class="col-span-3 truncate sm:col-span-1"
            :class="line.level === 'info' || line.level === 'debug' ? 'text-muted' : 'text-fg'"
          >{{ line.message }}</span>
          <Icon
            name="mingcute:up-line"
            class="hidden shrink-0 text-subtle transition-transform duration-(--duration-fast) sm:block"
            :class="!expanded.has(line.key) && 'rotate-180'"
          />
        </button>
        <pre
          v-if="expanded.has(line.key)"
          class="overflow-x-auto px-3 pb-2 leading-[1.7] text-muted sm:pl-[calc(74px+44px+128px+30px)]"
        >{{ line.data == null ? line.message : JSON.stringify(line.data, null, 2) }}</pre>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2 border-t border-divider bg-card px-3 py-[7px] text-sm text-subtle">
      <span class="tnum">показано {{ lines.length }} из {{ allLines.length }}</span>
      <span class="flex-1" />
      <span class="tnum font-mono">
        {{ counts.warn }} предупреждений · {{ counts.error }} ошибок
      </span>
    </div>
  </div>
</template>
