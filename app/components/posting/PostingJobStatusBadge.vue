<script setup lang="ts">
import type { PostingJobStatus } from "~~/shared/types/posting-job"

const props = withDefaults(
  defineProps<{
    status: PostingJobStatus
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

const config: Record<PostingJobStatus, BadgeConfig> = {
  scheduled: {
    label: "Запланирован",
    badgeClass: "badge-info",
    icon: "mingcute:calendar-line",
  },
  queued: {
    label: "В очереди",
    badgeClass: "badge-neutral",
    icon: "mingcute:list-check-line",
  },
  preparing: {
    label: "Подготовка",
    badgeClass: "badge-warning",
    icon: "mingcute:settings-3-line",
  },
  uploading: {
    label: "Загрузка",
    badgeClass: "badge-warning",
    icon: "mingcute:upload-3-line",
    showLoading: true,
  },
  published: {
    label: "Опубликовано",
    badgeClass: "badge-success",
    icon: "mingcute:check-circle-line",
  },
  failed: {
    label: "Ошибка",
    badgeClass: "badge-error",
    icon: "mingcute:close-circle-line",
  },
  retry_queued: {
    label: "Retry",
    badgeClass: "badge-warning",
    icon: "mingcute:refresh-3-line",
  },
  cancelled: {
    label: "Отменён",
    badgeClass: "badge-ghost",
    icon: "mingcute:forbid-circle-line",
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
