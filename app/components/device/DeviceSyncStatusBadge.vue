<script setup lang="ts">
/**
 * Состояние синхронизации профиля с облаком.
 *
 * `indigoId === null` перекрывает статус из базы на «Не в облаке»: бывало, что
 * в базе стояло `synced`, а профиль после неудачного пуша так и не появился в
 * облаке. Показываем то, что есть на самом деле.
 */
import type { DeviceSyncStatus } from '~~/shared/types/device-profile'
import { DEVICE_SYNC_META } from './DeviceStatusMap'

const props = withDefaults(defineProps<{
  status: DeviceSyncStatus
  /** `null` — профиль не запушен; `undefined` — проверку не делаем. */
  indigoId?: string | null
  size?: 'xs' | 'sm' | 'md'
}>(), { indigoId: undefined, size: 'sm' })

const meta = computed(() =>
  DEVICE_SYNC_META[props.indigoId === null ? 'local_only' : props.status] ?? DEVICE_SYNC_META.error)
</script>

<template>
  <DeviceBadge :meta="meta" :size="size" />
</template>
