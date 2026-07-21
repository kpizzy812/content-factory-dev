<script setup lang="ts">
import type { DeviceProfileDto } from "~~/shared/types/device-profile"
import { deviceStatusMeta } from "~~/shared/types/device-profile"

const props = defineProps<{
  profile: DeviceProfileDto
}>()

const status = computed(() => props.profile.duoplus?.deviceStatus ?? null)
const meta = computed(() => deviceStatusMeta(status.value))

const badgeClass = computed(() => {
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

// adb-адрес присутствует только когда устройство включено (status=1).
const adbAddress = computed(() => props.profile.duoplus?.adbAddress ?? null)
const isOn = computed(() => status.value === 1)
const hasSnapshot = computed(() => props.profile.duoplus != null)
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 gap-3">
      <h3 class="font-semibold flex items-center gap-2">
        <Icon name="mingcute:plugin-2-line" />
        ADB-статус устройства
      </h3>

      <div
        v-if="!hasSnapshot"
        role="alert"
        class="alert alert-info alert-soft text-sm"
      >
        <Icon name="mingcute:information-line" />
        <span>
          Статус появится после синхронизации с DuoPlus.
        </span>
      </div>

      <template v-else>
        <div class="flex items-center justify-between gap-3 py-1">
          <span class="flex items-center gap-2 text-base-content/60 text-sm">
            <Icon name="mingcute:power-line" class="text-base" />
            Состояние
          </span>
          <span class="badge gap-1.5" :class="badgeClass">
            <span
              v-if="status === 1 || status === 10 || status === 11"
              class="status status-sm"
              :class="status === 1 ? 'status-success' : 'status-info animate-pulse'"
            />
            {{ meta.label }}
          </span>
        </div>

        <div class="flex items-center justify-between gap-3 py-1 border-t border-base-200 pt-2">
          <span class="flex items-center gap-2 text-base-content/60 text-sm">
            <Icon name="mingcute:terminal-line" class="text-base" />
            ADB-адрес
          </span>
          <span
            class="font-mono text-sm truncate"
            :class="adbAddress ? 'text-base-content' : 'text-base-content/40'"
            :title="adbAddress ?? undefined"
          >
            {{ adbAddress || (isOn ? "—" : "доступен при включении") }}
          </span>
        </div>

        <p class="text-xs text-base-content/50">
          Статус — последнее известное состояние из синхронизации, не онлайн-запрос.
        </p>
      </template>
    </div>
  </div>
</template>
