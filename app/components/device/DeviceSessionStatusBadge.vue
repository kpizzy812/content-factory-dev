<script setup lang="ts">
/**
 * Состояние сессии профиля.
 *
 * `variant="warmup"` — то же состояние словами оператора постинга: запущенный
 * на сервере профиль означает, что раннер найдёт его прогретым.
 */
import type { DeviceSessionState } from '~~/shared/types/device-profile'
import { deviceSessionMeta } from './DeviceStatusMap'

const props = withDefaults(defineProps<{
  state: DeviceSessionState
  port?: number | null
  size?: 'xs' | 'sm' | 'md'
  variant?: 'session' | 'warmup'
}>(), { port: null, size: 'sm', variant: 'session' })

const meta = computed(() => deviceSessionMeta(props.state, props.port, props.variant))
</script>

<template>
  <DeviceBadge :meta="meta" :size="size" />
</template>
