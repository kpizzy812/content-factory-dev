<script setup lang="ts">
import type { WarmupSessionStatus } from "~~/shared/types/warmup"

const props = withDefaults(
  defineProps<{
    status: WarmupSessionStatus
    size?: "xs" | "sm" | "md"
  }>(),
  { size: "sm" },
)

interface BadgeConfig {
  label: string
  badgeClass: string
  icon: string
  showLoading?: boolean
}

const config: Record<WarmupSessionStatus, BadgeConfig> = {
  planned: {
    label: "Запланировано",
    badgeClass: "badge-info",
    icon: "mingcute:calendar-line",
  },
  running: {
    label: "Выполняется",
    badgeClass: "badge-warning",
    icon: "mingcute:loading-3-line",
    showLoading: true,
  },
  completed: {
    label: "Завершено",
    badgeClass: "badge-success",
    icon: "mingcute:check-circle-line",
  },
  partial: {
    label: "Частично",
    badgeClass: "badge-warning",
    icon: "mingcute:alert-line",
  },
  failed: {
    label: "Ошибка",
    badgeClass: "badge-error",
    icon: "mingcute:close-circle-line",
  },
  cancelled: {
    label: "Отменено",
    badgeClass: "badge-ghost",
    icon: "mingcute:forbid-circle-line",
  },
  skipped: {
    label: "Пропущено",
    badgeClass: "badge-neutral",
    icon: "mingcute:skip-forward-line",
  },
}

const current = computed(() => config[props.status])
const sizeClass = computed(() => {
  if (props.size === "xs") return "badge-xs"
  if (props.size === "sm") return "badge-sm"
  return ""
})
</script>

<template>
  <span class="badge gap-1" :class="[current.badgeClass, sizeClass]">
    <span
      v-if="current.showLoading"
      class="loading loading-spinner loading-xs"
    />
    <Icon v-else :name="current.icon" class="text-xs" />
    {{ current.label }}
  </span>
</template>
