<script setup lang="ts">
/**
 * Рекурсивный узел дерева для режима "Читаемый" в StepDataViewer.
 * Рендерит примитив инлайном, объект/массив — вложенным списком пар
 * "человеко-читаемый ключ → значение".
 * Имя компонента в auto-import Nuxt: PipelineMonitorStepDataNode.
 */
import { humanizeKey, humanizeValue, detectKind } from '~~/shared/utils/pipeline-humanize'

const props = defineProps<{
  value: unknown
  /** Имя поля, в котором лежит value (для перевода enum-значений). */
  fieldKey?: string
}>()

const kind = computed(() => detectKind(props.value))

const entries = computed(() => {
  if (kind.value === 'object') {
    return Object.entries(props.value as Record<string, unknown>).map(([k, v]) => ({
      key: k,
      label: humanizeKey(k),
      value: v,
    }))
  }
  if (kind.value === 'array') {
    return (props.value as unknown[]).map((v, i) => ({
      key: String(i),
      label: `#${i + 1}`,
      value: v,
    }))
  }
  return []
})
</script>

<template>
  <span v-if="kind === 'empty'" class="text-base-content/40">—</span>

  <span
    v-else-if="kind === 'primitive'"
    :class="{
      'font-mono text-info': typeof value === 'number',
      'text-success': value === true,
      'text-error': value === false,
      'break-words': typeof value === 'string',
    }"
  >{{ humanizeValue(value, fieldKey) }}</span>

  <ul v-else class="space-y-0.5">
    <li
      v-for="entry in entries"
      :key="entry.key"
      class="flex gap-2"
      :class="{ 'flex-col': detectKind(entry.value) === 'object' || detectKind(entry.value) === 'array' }"
    >
      <span class="text-base-content/50 font-medium shrink-0">
        {{ entry.label }}:
      </span>
      <div
        :class="{
          'pl-3 border-l border-base-content/10': detectKind(entry.value) === 'object' || detectKind(entry.value) === 'array',
        }"
      >
        <PipelineMonitorStepDataNode :value="entry.value" :field-key="entry.key" />
      </div>
    </li>
  </ul>
</template>
