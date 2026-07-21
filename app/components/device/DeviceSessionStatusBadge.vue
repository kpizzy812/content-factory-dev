<script setup lang="ts">
import type { DeviceSessionState } from "~~/shared/types/device-profile"

/**
 * DeviceSessionStatusBadge — бейдж состояния сессии антидетект-профиля.
 *
 * variant:
 *   - "session" (дефолт) — общее состояние профиля: «Запущен :port» / «Запускается» / «Остановлен».
 *   - "warmup" — готовность для постинга (прогрев на сервере):
 *       running  → «Прогрет ✓ :port» (success)
 *       starting → «Прогревается…»   (warning)
 *       idle     → «Не прогрет»       (neutral — actionable, читаемо во всех темах)
 *     Семантика та же (sessionState=running ⇒ серверный агент держит профиль
 *     запущенным ⇒ poster-runner session_start найдёт его готовым), но текст
 *     ориентирован на оператора постинга.
 */
const props = withDefaults(
  defineProps<{
    state: DeviceSessionState
    port?: number | null
    size?: "sm" | "md"
    variant?: "session" | "warmup"
  }>(),
  { port: null, size: "md", variant: "session" },
)

const sizeClass = computed(() => (props.size === "sm" ? "badge-sm" : ""))

const config = computed(() => {
  if (props.variant === "warmup") {
    switch (props.state) {
      case "running":
        return {
          label: props.port ? `Прогрет :${props.port}` : "Прогрет",
          badgeClass: "badge-success",
          icon: "mingcute:check-circle-line",
        }
      case "starting":
        return {
          label: "Прогревается…",
          badgeClass: "badge-warning",
          icon: "mingcute:loading-line",
        }
      case "idle":
      default:
        return {
          label: "Не прогрет",
          badgeClass: "badge-neutral",
          icon: "mingcute:fire-line",
        }
    }
  }

  switch (props.state) {
    case "running":
      return {
        label: props.port ? `Запущен :${props.port}` : "Запущен",
        badgeClass: "badge-success",
        icon: "mingcute:play-circle-line",
      }
    case "starting":
      return {
        label: "Запускается",
        badgeClass: "badge-warning",
        icon: "mingcute:loading-line",
      }
    case "idle":
    default:
      return {
        label: "Остановлен",
        badgeClass: "badge-ghost",
        icon: "mingcute:pause-circle-line",
      }
  }
})
</script>

<template>
  <span class="badge gap-1" :class="[config.badgeClass, sizeClass]">
    <Icon :name="config.icon" class="text-xs" />
    {{ config.label }}
  </span>
</template>
