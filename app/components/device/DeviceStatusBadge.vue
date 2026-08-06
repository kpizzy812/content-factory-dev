<script setup lang="ts">
/**
 * Последнее известное состояние облачного устройства.
 * `null` — профиль ещё ни разу не синхронизировался, бейдж не рисуется:
 * пустое место честнее выдуманного «неизвестно».
 */
import { deviceCloudStatus } from './DeviceStatusMap'

const props = withDefaults(defineProps<{
  status?: number | null
  size?: 'xs' | 'sm' | 'md'
}>(), { status: null, size: 'sm' })

const meta = computed(() => deviceCloudStatus(props.status))
</script>

<template>
  <DeviceBadge
    v-if="status != null"
    :meta="meta"
    :size="size"
    :title="`Состояние устройства в облаке: ${meta.label} (последнее известное)`"
  />
</template>
