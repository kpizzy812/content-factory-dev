<script setup lang="ts">
const props = defineProps<{ status: string }>()

const statusMap: Record<string, { label: string; class: string }> = {
  draft: { label: 'Черновик', class: 'badge-ghost' },
  generating: { label: 'Генерация...', class: 'badge-info badge-outline' },
  generated: { label: 'Сгенерирован', class: 'badge-warning' },
  selected: { label: 'Выбран', class: 'badge-success' },
  rejected: { label: 'Отклонён', class: 'badge-error' },
  needs_rework: { label: 'На доработку', class: 'badge-warning badge-outline' },
  archived: { label: 'Архив', class: 'badge-ghost badge-outline' },
}
</script>

<template>
  <span
    class="badge badge-sm"
    :class="statusMap[status]?.class ?? 'badge-ghost'"
  >
    <span v-if="status === 'generating'" class="loading loading-spinner loading-xs mr-1" />
    {{ statusMap[status]?.label ?? status }}
  </span>
</template>
