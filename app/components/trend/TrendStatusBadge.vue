<script setup lang="ts">
defineProps<{
  status: string
}>()

const statusMap: Record<string, { label: string; class: string }> = {
  new: { label: 'Новый', class: 'badge-info' },
  reviewed: { label: 'Просмотрен', class: 'badge-warning' },
  in_work: { label: 'В работе', class: 'badge-accent' },
  completed: { label: 'Завершён', class: 'badge-success' },
  dismissed: { label: 'Отклонён', class: 'badge-ghost' },
}
</script>

<template>
  <span
    class="badge badge-sm"
    :class="statusMap[status]?.class ?? 'badge-ghost'"
  >
    {{ statusMap[status]?.label ?? status }}
  </span>
</template>
