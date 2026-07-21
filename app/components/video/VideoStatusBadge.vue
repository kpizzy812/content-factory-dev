<script setup lang="ts">
defineProps<{
  status: string
}>()

const statusMap: Record<string, { label: string; badgeClass: string; icon: string; spinner: boolean }> = {
  pending: {
    label: 'Ожидание',
    badgeClass: 'badge-ghost',
    icon: 'mingcute:time-line',
    spinner: false,
  },
  configuring: {
    label: 'Настройка',
    badgeClass: 'badge-ghost',
    icon: 'mingcute:settings-3-line',
    spinner: false,
  },
  generating_prompts: {
    label: 'Генерация промптов',
    badgeClass: 'badge-info',
    icon: '',
    spinner: true,
  },
  generating_images: {
    label: 'Генерация изображений',
    badgeClass: 'badge-info',
    icon: '',
    spinner: true,
  },
  generating_clips: {
    label: 'Генерация клипов',
    badgeClass: 'badge-info',
    icon: '',
    spinner: true,
  },
  generating_music: {
    label: 'Генерация музыки',
    badgeClass: 'badge-info',
    icon: '',
    spinner: true,
  },
  assembling: {
    label: 'Сборка',
    badgeClass: 'badge-warning',
    icon: '',
    spinner: true,
  },
  completed: {
    label: 'Готово',
    badgeClass: 'badge-success',
    icon: 'mingcute:check-circle-line',
    spinner: false,
  },
  failed: {
    label: 'Ошибка',
    badgeClass: 'badge-error',
    icon: 'mingcute:close-circle-line',
    spinner: false,
  },
  canceled: {
    label: 'Отменено',
    badgeClass: 'badge-warning',
    icon: 'mingcute:forbid-circle-line',
    spinner: false,
  },
}
</script>

<template>
  <span
    class="badge badge-sm gap-1"
    :class="statusMap[status]?.badgeClass ?? 'badge-ghost'"
  >
    <span
      v-if="statusMap[status]?.spinner"
      class="loading loading-spinner loading-xs"
    />
    <Icon
      v-else-if="statusMap[status]?.icon"
      :name="statusMap[status]!.icon"
      class="text-xs"
    />
    {{ statusMap[status]?.label ?? status }}
  </span>
</template>
