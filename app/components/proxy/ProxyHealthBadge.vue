<script setup lang="ts">
import type { ProxyStatus } from "~~/shared/types/proxy"

const props = withDefaults(
  defineProps<{
    status: ProxyStatus
    size?: "sm" | "md"
  }>(),
  { size: "md" },
)

const config: Record<
  ProxyStatus,
  { label: string; badgeClass: string; icon: string }
> = {
  unverified: {
    label: "Не проверен",
    badgeClass: "badge-ghost",
    icon: "mingcute:question-line",
  },
  healthy: {
    label: "Здоров",
    badgeClass: "badge-success",
    icon: "mingcute:check-circle-line",
  },
  degraded: {
    label: "Деградирует",
    badgeClass: "badge-warning",
    icon: "mingcute:warning-line",
  },
  dead: {
    label: "Мёртв",
    badgeClass: "badge-error",
    icon: "mingcute:close-circle-line",
  },
  expired: {
    label: "Истёк",
    badgeClass: "badge-neutral",
    icon: "mingcute:time-line",
  },
}

const current = computed(() => config[props.status])
const sizeClass = computed(() => (props.size === "sm" ? "badge-sm" : ""))
</script>

<template>
  <span class="badge gap-1" :class="[current.badgeClass, sizeClass]">
    <Icon :name="current.icon" class="text-xs" />
    {{ current.label }}
  </span>
</template>
