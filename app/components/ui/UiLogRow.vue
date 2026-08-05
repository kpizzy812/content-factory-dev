<script setup lang="ts">
/**
 * Строка лога. Источник: design-preview/_system/blocks/LogRow.html
 *
 * Время моноширинное и фиксированной ширины, уровень — своей колонкой,
 * сообщение усекается в одну строку и разворачивается по клику.
 */
type Level = 'debug' | 'info' | 'warn' | 'error'

const props = withDefaults(defineProps<{
  time: string
  level: Level
  message: string
  details?: string
}>(), { level: 'info' })

const expanded = ref(false)

const levelClass = computed(() => ({
  debug: 'text-subtle',
  info: 'text-info',
  warn: 'text-warning',
  error: 'text-danger',
}[props.level]))
</script>

<template>
  <div
    class="rounded-sm font-mono text-[11.5px]"
    :class="level === 'error' && 'border border-danger-border bg-danger-bg'"
  >
    <div
      class="flex cursor-pointer gap-2.5 rounded-sm px-1.5 py-[5px] hover:bg-card"
      @click="expanded = !expanded"
    >
      <span class="tnum shrink-0 text-subtle">{{ time }}</span>
      <span class="w-11 shrink-0 uppercase" :class="levelClass">{{ level }}</span>
      <span class="text-muted" :class="expanded ? 'break-words whitespace-pre-wrap' : 'truncate'">
        {{ message }}
      </span>
    </div>
    <pre
      v-if="expanded && details"
      class="mx-1.5 mb-1.5 overflow-x-auto rounded-sm bg-surface p-2 text-[11px] text-muted"
    >{{ details }}</pre>
  </div>
</template>
