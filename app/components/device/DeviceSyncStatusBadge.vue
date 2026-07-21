<script setup lang="ts">
import type { DeviceSyncStatus } from "~~/shared/types/device-profile"

/**
 * Badge статуса синхронизации профиля.
 *
 * Override через indigoId prop: если indigoId === null, badge форсится на
 * 'local_only' независимо от syncStatus в БД. Это truth-first - бывали случаи
 * рассинхрона (БД syncStatus='synced' но indigoId is null после failed push),
 * UI должен показывать реальность.
 */
const props = withDefaults(
  defineProps<{
    status: DeviceSyncStatus
    // null → override badge на "Не в Indigo" (профиль реально не запушен).
    // undefined (prop не передан) → используем status как есть (backwards compat).
    indigoId?: string | null
    size?: "sm" | "md"
  }>(),
  { indigoId: undefined, size: "md" },
)

const config: Record<
  DeviceSyncStatus,
  { label: string; badgeClass: string; icon: string }
> = {
  synced: {
    label: "Синхронизирован",
    badgeClass: "badge-success",
    icon: "mingcute:check-circle-line",
  },
  local_only: {
    label: "Не в облаке",
    badgeClass: "badge-warning",
    icon: "mingcute:save-line",
  },
  remote_only: {
    label: "Только в облаке",
    badgeClass: "badge-info",
    icon: "mingcute:cloud-line",
  },
  conflict: {
    label: "Конфликт",
    badgeClass: "badge-warning",
    icon: "mingcute:warning-line",
  },
  deleted_remote: {
    label: "Удалён в облаке",
    badgeClass: "badge-error",
    icon: "mingcute:delete-2-line",
  },
  error: {
    label: "Ошибка",
    badgeClass: "badge-error",
    icon: "mingcute:close-circle-line",
  },
  archived: {
    label: "Архивирован",
    badgeClass: "badge-ghost",
    icon: "mingcute:archive-line",
  },
}

const effectiveStatus = computed<DeviceSyncStatus>(() => {
  if (props.indigoId === null) return "local_only"
  return props.status
})

const current = computed(() => config[effectiveStatus.value])
const sizeClass = computed(() => (props.size === "sm" ? "badge-sm" : ""))
</script>

<template>
  <span class="badge gap-1" :class="[current.badgeClass, sizeClass]">
    <Icon :name="current.icon" class="text-xs" />
    {{ current.label }}
  </span>
</template>
