<script setup lang="ts">
/**
 * Данные между шагами. Источник: design-preview/catalog/05-run-monitor.dc.html
 *
 * То, ради чего сюда приходят. Дерево — по умолчанию, JSON — для копирования
 * целиком. Режим общий на весь запуск и живёт в сторе монитора: переключать
 * его у каждого шага отдельно оператор не станет.
 */
import { formatJson } from '~~/shared/utils/pipeline-format'

const props = defineProps<{
  title: string
  data: unknown
  mode: 'readable' | 'json'
}>()

const emit = defineEmits<{ 'update:mode': [value: 'readable' | 'json'] }>()

const toast = useToast()

const json = computed(() => formatJson(props.data))

const size = computed(() => {
  const bytes = new Blob([json.value]).size
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
})

const count = computed(() => {
  const v = props.data
  if (Array.isArray(v)) return `${v.length} элем.`
  if (v && typeof v === 'object') return `${Object.keys(v).length} полей`
  return null
})

async function copyAll() {
  try {
    await navigator.clipboard.writeText(json.value)
    toast.success('Скопировано в буфер обмена')
  }
  catch {
    toast.error('Буфер обмена недоступен')
  }
}

function download() {
  const blob = new Blob([json.value], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${props.title.toLowerCase().replace(/\s+/g, '-')}.json`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="overflow-hidden rounded-md border border-border bg-panel">
    <div class="flex flex-wrap items-center gap-2 border-b border-border bg-card px-2.5 py-2">
      <div class="flex rounded-md border border-border bg-panel p-0.5">
        <button
          type="button"
          class="h-[22px] cursor-pointer rounded-sm px-[9px] text-sm"
          :class="mode === 'readable' ? 'bg-raised text-fg' : 'text-muted hover:text-fg'"
          @click="emit('update:mode', 'readable')"
        >
          Дерево
        </button>
        <button
          type="button"
          class="h-[22px] cursor-pointer rounded-sm px-[9px] text-sm"
          :class="mode === 'json' ? 'bg-raised text-fg' : 'text-muted hover:text-fg'"
          @click="emit('update:mode', 'json')"
        >
          JSON
        </button>
      </div>
      <span class="text-sm text-muted">{{ title }}</span>
      <span class="tnum font-mono text-micro text-subtle">
        <template v-if="count">{{ count }} · </template>{{ size }}
      </span>
      <span class="flex-1" />
      <UiButton variant="ghost" @click="copyAll">
        <Icon name="mingcute:copy-2-line" />
        Скопировать
      </UiButton>
      <UiButton variant="ghost" @click="download">
        <Icon name="mingcute:download-2-line" />
        Скачать
      </UiButton>
    </div>

    <pre
      v-if="mode === 'json'"
      class="max-h-72 overflow-auto px-3 py-2.5 font-mono text-sm leading-[1.7] text-muted"
    >{{ json }}</pre>

    <div v-else class="max-h-72 overflow-auto px-3 py-2.5 font-mono text-sm leading-[1.7] text-muted">
      <PipelineMonitorStepDataNode :value="data" />
    </div>
  </div>
</template>
