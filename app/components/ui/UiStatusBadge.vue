<script setup lang="ts">
import type { EntityStatus } from '~~/shared/utils/entity-status'
import { ENTITY_STATUS_META } from '~~/shared/utils/entity-status'

/**
 * Бейдж статуса. Источник: design-preview/_system/blocks/StatusBadge.html
 *
 * Статус никогда не передаётся одним цветом: рядом с ним всегда точка или
 * иконка плюс подпись — иначе состояние не читается при дальтонизме и в ч/б.
 */
const props = withDefaults(defineProps<{
  status: EntityStatus
  size?: 'xs' | 'sm' | 'md'
  /** Точка-индикатор вместо иконки; у «выполняется» она пульсирует. */
  dot?: boolean
  /** Скрыть подпись — только для узких мест, где смысл ясен из колонки. */
  iconOnly?: boolean
}>(), { size: 'sm' })

const meta = computed(() => ENTITY_STATUS_META[props.status])

const sizing = computed(() => ({
  xs: 'h-[18px] gap-1 px-1.5 text-micro',
  sm: 'h-[22px] gap-[5px] px-2 text-sm',
  md: 'h-[26px] gap-1.5 px-2.5 text-base',
}[props.size]))

const tone = computed(() => {
  const m = meta.value
  if (props.status === 'blocked') return 'bg-surface border border-dashed border-danger-border text-danger opacity-80'
  if (props.status === 'cancelled') return 'bg-transparent border border-divider text-subtle'
  return {
    neutral: 'bg-neutral-bg border border-neutral-border text-neutral',
    info: 'bg-info-bg border border-info-border text-info',
    success: 'bg-success-bg border border-success-border text-success',
    warning: 'bg-warning-bg border border-warning-border text-warning',
    danger: 'bg-danger-bg border border-danger-border text-danger',
  }[m.tone]
})
</script>

<template>
  <span
    class="inline-flex w-fit items-center rounded-sm whitespace-nowrap"
    :class="[sizing, tone]"
    :title="iconOnly ? meta.label : undefined"
  >
    <span
      v-if="dot"
      class="size-1.5 shrink-0 rounded-full bg-current"
      :class="meta.live && 'motion-safe:animate-pulse'"
    />
    <Icon v-else :name="meta.icon" class="shrink-0" :class="meta.live && 'motion-safe:animate-spin'" />
    <span v-if="!iconOnly">{{ meta.label }}</span>
  </span>
</template>
