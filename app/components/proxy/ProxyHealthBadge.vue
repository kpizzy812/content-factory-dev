<script setup lang="ts">
import type { ProxyStatus } from "~~/shared/types/proxy"
import type { EntityStatus } from "~~/shared/utils/entity-status"

/**
 * Здоровье прокси в общем словаре статусов.
 *
 * «Деградирует» — это предупреждение, а не ошибка: прокси ещё работает, но
 * его пора менять; «мёртв» и «истёк» — уже блокеры публикации.
 */
const props = withDefaults(
  defineProps<{
    status: ProxyStatus
    size?: "xs" | "sm" | "md"
  }>(),
  { size: "md" },
)

const PROXY_STATUS_TO_ENTITY: Record<ProxyStatus, EntityStatus> = {
  unverified: "draft",
  healthy: "done",
  degraded: "review",
  dead: "failed",
  expired: "blocked",
}

const PROXY_STATUS_LABELS: Record<ProxyStatus, string> = {
  unverified: "Не проверен",
  healthy: "Здоров",
  degraded: "Деградирует",
  dead: "Мёртв",
  expired: "Истёк",
}

const label = computed(() => PROXY_STATUS_LABELS[props.status] ?? props.status)

// Тон берём из общего словаря, подпись — доменную: «Мёртв» точнее, чем
// «Ошибка», а цвет при этом остаётся системным.
const tone = computed(() => ({
  draft: "border-neutral-border bg-neutral-bg text-neutral",
  queued: "border-neutral-border bg-neutral-bg text-neutral",
  running: "border-info-border bg-info-bg text-info",
  review: "border-warning-border bg-warning-bg text-warning",
  done: "border-success-border bg-success-bg text-success",
  failed: "border-danger-border bg-danger-bg text-danger",
  blocked: "border-danger-border bg-danger-bg text-danger",
  cancelled: "border-divider bg-transparent text-subtle",
}[PROXY_STATUS_TO_ENTITY[props.status] ?? "draft"]))

const sizing = computed(() => ({
  xs: "h-[18px] px-1.5 text-micro",
  sm: "h-[22px] px-2 text-sm",
  md: "h-[26px] px-2.5 text-base",
}[props.size]))
</script>

<template>
  <span class="inline-flex w-fit items-center rounded-sm border whitespace-nowrap" :class="[tone, sizing]">
    {{ label }}
  </span>
</template>
