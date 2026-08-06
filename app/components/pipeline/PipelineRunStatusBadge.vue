<script setup lang="ts">
/**
 * Статус запуска или шага: тон из общего словаря, подпись доменная.
 *
 * У шага подпись строчная («идёт», «готово») — она стоит внутри строки
 * хронологии рядом с длительностью, а не открывает предложение.
 */
import { runStatusMeta, stepStatusMeta, STATUS_TONE } from './PipelineRunStatusMap'

const props = withDefaults(defineProps<{
  status: string
  scope?: 'run' | 'step'
  size?: 'xs' | 'sm' | 'md'
  /** На обводке строки шага фон уже цветной — бейджу нужен нейтральный. */
  onTinted?: boolean
}>(), { scope: 'run', size: 'sm' })

const meta = computed(() => props.scope === 'step' ? stepStatusMeta(props.status) : runStatusMeta(props.status))

const tone = computed(() => {
  if (!props.onTinted) return STATUS_TONE[meta.value.entity]
  return {
    draft: 'border-neutral-border bg-panel text-neutral',
    queued: 'border-neutral-border bg-panel text-neutral',
    running: 'border-info-border bg-panel text-info',
    review: 'border-warning-border bg-panel text-warning',
    done: 'border-success-border bg-panel text-success',
    failed: 'border-danger-border bg-panel text-danger',
    blocked: 'border-danger-border bg-panel text-danger',
    cancelled: 'border-divider bg-panel text-subtle',
  }[meta.value.entity]
})

const sizing = computed(() => ({
  xs: 'h-[18px] gap-1 px-1.5 text-micro',
  sm: 'h-5 gap-[5px] px-[7px] text-sm',
  md: 'h-[22px] gap-[5px] px-2 text-sm',
}[props.size]))
</script>

<template>
  <span class="inline-flex w-fit items-center rounded-sm border whitespace-nowrap" :class="[tone, sizing]">
    <Icon :name="meta.icon" class="shrink-0" :class="meta.live && 'motion-safe:animate-spin'" />
    {{ meta.label }}
  </span>
</template>
