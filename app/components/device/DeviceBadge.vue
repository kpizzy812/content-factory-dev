<script setup lang="ts">
/**
 * Бейдж устройства: тон из общего словаря, подпись доменная.
 * Собирает разметку для всех статусов зоны — состояние облака, синхронизация,
 * сессия, проверка страны прокси.
 */
import type { DeviceBadgeMeta } from './DeviceStatusMap'
import { DEVICE_TONE_CLASS, DEVICE_BADGE_SIZE } from './DeviceStatusMap'

const props = withDefaults(defineProps<{
  meta: DeviceBadgeMeta
  size?: 'xs' | 'sm' | 'md'
  title?: string
}>(), { size: 'sm' })
</script>

<template>
  <span
    class="inline-flex w-fit items-center rounded-sm border whitespace-nowrap"
    :class="[DEVICE_TONE_CLASS[meta.tone], DEVICE_BADGE_SIZE[props.size]]"
    :title="title"
  >
    <Icon :name="meta.icon" class="shrink-0" :class="meta.live && 'motion-safe:animate-spin'" />
    {{ meta.label }}
  </span>
</template>
