<script setup lang="ts">
/**
 * Параметры устройства из последней синхронизации с облаком.
 * Пока снимка нет, поля пустые — придумывать их локально нечем.
 */
import type { DeviceProfileDto } from '~~/shared/types/device-profile'

const props = defineProps<{
  profile: DeviceProfileDto
}>()

const items = computed(() => {
  const d = props.profile.duoplus
  return [
    { label: 'Android', value: props.profile.os, mono: false },
    { label: 'ID устройства', value: props.profile.indigoId },
    { label: 'Регион', value: d?.area ?? null, mono: false },
    { label: 'Разрешение', value: d?.size ?? props.profile.screenResolution },
  ]
})

const hasSnapshot = computed(() => props.profile.duoplus != null)
</script>

<template>
  <section class="flex flex-col gap-2.5 rounded-lg border border-border bg-panel p-3.5">
    <h2 class="text-micro tracking-[.06em] text-subtle uppercase">Параметры устройства</h2>

    <p
      v-if="!hasSnapshot"
      role="note"
      class="flex items-start gap-2 rounded-md border border-info-border bg-info-bg px-2.5 py-2 text-sm text-info"
    >
      <Icon name="mingcute:information-line" class="mt-0.5 shrink-0" />
      <span>Параметры появятся после синхронизации — кнопка в списке устройств.</span>
    </p>

    <UiKeyValue :items="items" label-width="140px" />
  </section>
</template>
