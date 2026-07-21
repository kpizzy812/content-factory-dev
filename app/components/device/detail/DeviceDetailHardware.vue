<script setup lang="ts">
import type { DeviceProfileDto } from "~~/shared/types/device-profile"

const props = defineProps<{
  profile: DeviceProfileDto
}>()

const rows = computed(() => {
  const d = props.profile.duoplus
  return [
    {
      icon: "mingcute:android-2-line",
      label: "Android-версия",
      value: props.profile.os,
    },
    {
      icon: "mingcute:fingerprint-line",
      label: "ID устройства (image_id)",
      value: props.profile.indigoId,
      mono: true,
    },
    {
      icon: "mingcute:earth-line",
      label: "Регион",
      value: d?.area ?? null,
    },
    {
      icon: "mingcute:fullscreen-line",
      label: "Разрешение экрана",
      value: d?.size ?? props.profile.screenResolution,
      mono: true,
    },
  ]
})

const hasSnapshot = computed(() => props.profile.duoplus != null)
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 gap-3">
      <h3 class="font-semibold flex items-center gap-2">
        <Icon name="mingcute:cellphone-2-line" />
        Параметры устройства
      </h3>

      <div
        v-if="!hasSnapshot"
        role="alert"
        class="alert alert-info alert-soft text-sm"
      >
        <Icon name="mingcute:information-line" />
        <span>
          Параметры появятся после синхронизации с DuoPlus. Нажмите
          <b>«Синхронизация»</b> в списке устройств.
        </span>
      </div>

      <dl class="grid grid-cols-1 gap-2 text-sm">
        <div
          v-for="row in rows"
          :key="row.label"
          class="flex items-center justify-between gap-3 py-1 border-b border-base-200 last:border-0"
        >
          <dt class="flex items-center gap-2 text-base-content/60">
            <Icon :name="row.icon" class="text-base" />
            {{ row.label }}
          </dt>
          <dd
            class="text-right truncate"
            :class="[row.mono ? 'font-mono' : '', row.value ? 'text-base-content' : 'text-base-content/40']"
            :title="row.value ?? undefined"
          >
            {{ row.value || "—" }}
          </dd>
        </div>
      </dl>
    </div>
  </div>
</template>
