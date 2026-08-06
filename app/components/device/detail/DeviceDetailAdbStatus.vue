<script setup lang="ts">
/**
 * Состояние устройства и адрес ADB из последней синхронизации.
 *
 * Подписано как «последнее известное»: это снимок, а не онлайн-запрос, и
 * оператор не должен принимать его за живую проверку.
 */
import type { DeviceProfileDto } from '~~/shared/types/device-profile'
import { deviceCloudStatus } from '../DeviceStatusMap'

const props = defineProps<{
  profile: DeviceProfileDto
}>()

const status = computed(() => props.profile.duoplus?.deviceStatus ?? null)
const meta = computed(() => deviceCloudStatus(status.value))
const adbAddress = computed(() => props.profile.duoplus?.adbAddress ?? null)
const isOn = computed(() => status.value === 1)
const hasSnapshot = computed(() => props.profile.duoplus != null)
</script>

<template>
  <section class="flex flex-col gap-2.5 rounded-lg border border-border bg-panel p-3.5">
    <h2 class="text-micro tracking-[.06em] text-subtle uppercase">Состояние и ADB</h2>

    <p
      v-if="!hasSnapshot"
      role="note"
      class="flex items-start gap-2 rounded-md border border-info-border bg-info-bg px-2.5 py-2 text-sm text-info"
    >
      <Icon name="mingcute:information-line" class="mt-0.5 shrink-0" />
      <span>Состояние появится после синхронизации с облаком.</span>
    </p>

    <template v-else>
      <div class="flex items-center gap-3 border-b border-divider py-1.5">
        <span class="w-32 shrink-0 text-sm text-muted">Состояние</span>
        <DeviceBadge :meta="meta" size="xs" />
      </div>
      <div class="flex items-center gap-3 py-1.5">
        <span class="w-32 shrink-0 text-sm text-muted">Адрес ADB</span>
        <span
          class="min-w-0 flex-1 truncate font-mono text-sm"
          :class="adbAddress ? 'text-fg' : 'text-subtle'"
          :title="adbAddress ?? undefined"
        >
          {{ adbAddress || (isOn ? '—' : 'появится при включении') }}
        </span>
      </div>

      <p class="text-micro text-subtle">
        Последнее известное состояние из синхронизации, а не онлайн-запрос.
      </p>
    </template>
  </section>
</template>
