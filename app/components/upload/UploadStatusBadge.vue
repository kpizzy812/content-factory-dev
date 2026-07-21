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
  uploading: {
    label: 'Загрузка',
    badgeClass: 'badge-info',
    icon: '',
    spinner: true,
  },
  published: {
    label: 'Опубликовано',
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
  scheduled: {
    label: 'Запланировано',
    badgeClass: 'badge-warning',
    icon: 'mingcute:calendar-line',
    spinner: false,
  },
  canceled: {
    label: 'Отменено',
    badgeClass: 'badge-warning',
    icon: 'mingcute:forbid-circle-line',
    spinner: false,
  },
  blocked_by_env: {
    label: 'Заблокировано (ENV)',
    badgeClass: 'badge-neutral',
    icon: 'mingcute:lock-line',
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
