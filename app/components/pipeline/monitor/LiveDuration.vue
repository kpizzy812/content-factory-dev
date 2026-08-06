<script setup lang="ts">
/**
 * Длительность, которая может расти прямо сейчас.
 *
 * Завершённое считается из самих дат и рисуется на сервере. Незавершённое
 * зависит от «сейчас», а оно на сервере и в браузере разное — такой кусок
 * уходит в ClientOnly, иначе Vue бросает поддерево при гидратации.
 */
import { durationBetween, formatDuration } from '../PipelineRunFormat'

const props = defineProps<{
  startedAt: string | null | undefined
  finishedAt: string | null | undefined
  /** Готовое значение из базы, если оно есть. */
  ms?: number | null
  now: number | null
  /** Что показать, когда считать не из чего. */
  empty?: string
}>()

const stable = computed(() => {
  if (props.ms != null) return props.ms
  if (props.startedAt && props.finishedAt) return durationBetween(props.startedAt, props.finishedAt)
  return null
})

const live = computed(() =>
  durationBetween(props.startedAt, props.finishedAt, props.now ?? undefined),
)
</script>

<template>
  <span v-if="stable != null" class="tnum">{{ formatDuration(stable) }}</span>
  <ClientOnly v-else-if="startedAt">
    <span class="tnum">{{ formatDuration(live) }}</span>
    <template #fallback><span class="tnum">…</span></template>
  </ClientOnly>
  <span v-else class="tnum">{{ empty ?? '—' }}</span>
</template>
