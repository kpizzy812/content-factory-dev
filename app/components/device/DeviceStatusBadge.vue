<script setup lang="ts">
import { deviceStatusMeta } from "~~/shared/types/device-profile"

/**
 * DeviceStatusBadge — бейдж last-known статуса облачного устройства DuoPlus
 * (config.duoplus.deviceStatus: 0/1/2/3/4/10/11/12). Цвет по семантике статуса.
 * null → ничего не рендерим (профиль ещё не синкался).
 */
const props = withDefaults(
  defineProps<{
    status?: number | null
    size?: "xs" | "sm" | "md"
  }>(),
  { status: null, size: "sm" },
)

const meta = computed(() => deviceStatusMeta(props.status))
const sizeClass = computed(() =>
  props.size === "xs" ? "badge-xs" : props.size === "md" ? "" : "badge-sm",
)
const toneClass = computed(() => {
  switch (meta.value.tone) {
    case "success":
      return "badge-success"
    case "error":
      return "badge-error"
    case "warning":
      return "badge-warning"
    case "info":
      return "badge-info"
    default:
      return "badge-ghost"
  }
})
const pulsing = computed(() => props.status === 10 || props.status === 11)
</script>

<template>
  <span
    v-if="status != null"
    class="badge gap-1"
    :class="[toneClass, sizeClass]"
    :title="`Статус устройства DuoPlus: ${meta.label} (last-known)`"
  >
    <span
      v-if="status === 1 || pulsing"
      class="status status-xs"
      :class="[status === 1 ? 'status-success' : 'status-info', pulsing ? 'animate-pulse' : '']"
    />
    {{ meta.label }}
  </span>
</template>
