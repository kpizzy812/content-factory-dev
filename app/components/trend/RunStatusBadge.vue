<script setup lang="ts">
/**
 * Статус запуска парсинга: тон из общего словаря, подпись доменная.
 *
 * У парсинга четыре разных «выполняется» — Apify собирает, идёт импорт, идёт
 * анализ, — и по ним оператор понимает, сколько ещё ждать. Общая подпись
 * «Выполняется» выкинула бы единственное, что здесь полезно.
 */
import { ENTITY_STATUS_META } from '~~/shared/utils/entity-status'
import { STATUS_TONE } from '~/components/pipeline/PipelineRunStatusMap'
import { trendRunStatus, profileValidation } from './TrendRunStatusMap'

const props = withDefaults(defineProps<{
  /** Статус запуска парсинга либо состояние проверки конфигурации профиля. */
  status: string | null | undefined
  kind?: 'run' | 'validation'
  size?: 'xs' | 'sm'
}>(), { kind: 'run', size: 'sm' })

const meta = computed(() => {
  if (props.kind === 'validation') {
    const v = profileValidation(props.status)
    return { entity: v.entity, label: v.label, icon: v.icon }
  }
  const run = trendRunStatus(props.status)
  return { entity: run.entity, label: run.label, icon: ENTITY_STATUS_META[run.entity].icon }
})

const live = computed(() => props.kind === 'run' && meta.value.entity === 'running')

const sizing = computed(() => ({
  xs: 'h-[18px] gap-1 px-1.5 text-micro',
  sm: 'h-5 gap-[5px] px-[7px] text-sm',
}[props.size]))
</script>

<template>
  <span
    class="inline-flex w-fit items-center rounded-sm border whitespace-nowrap"
    :class="[STATUS_TONE[meta.entity], sizing]"
  >
    <Icon :name="meta.icon" class="shrink-0" :class="live && 'motion-safe:animate-spin'" />
    {{ meta.label }}
  </span>
</template>
