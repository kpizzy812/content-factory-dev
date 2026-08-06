<script setup lang="ts">
import { ACCOUNT_STATUS_LABELS, accountStatus } from './AccountStatusMap'

/**
 * Статус аккаунта: тон из общего словаря, подпись доменная.
 * Тот же приём, что у `ProxyHealthBadge` — «Токен истёк» точнее, чем «На ревью».
 */
const props = withDefaults(defineProps<{
  status: string
  size?: 'xs' | 'sm' | 'md'
}>(), { size: 'sm' })

const label = computed(() => ACCOUNT_STATUS_LABELS[props.status] ?? props.status)

const tone = computed(() => ({
  draft: 'border-neutral-border bg-neutral-bg text-neutral',
  queued: 'border-neutral-border bg-neutral-bg text-neutral',
  running: 'border-info-border bg-info-bg text-info',
  review: 'border-warning-border bg-warning-bg text-warning',
  done: 'border-success-border bg-success-bg text-success',
  failed: 'border-danger-border bg-danger-bg text-danger',
  blocked: 'border-dashed border-danger-border bg-surface text-danger',
  cancelled: 'border-divider bg-transparent text-subtle',
}[accountStatus(props.status)]))

const sizing = computed(() => ({
  xs: 'h-[18px] px-1.5 text-micro',
  sm: 'h-[22px] px-2 text-sm',
  md: 'h-[26px] px-2.5 text-base',
}[props.size]))
</script>

<template>
  <span class="inline-flex w-fit items-center rounded-sm border whitespace-nowrap" :class="[tone, sizing]">
    {{ label }}
  </span>
</template>
