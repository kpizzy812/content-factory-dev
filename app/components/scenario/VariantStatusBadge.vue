<script setup lang="ts">
defineProps<{ status: string }>()

const statusMap: Record<string, { label: string; class: string }> = {
  draft: { label: 'Черновик', class: 'badge-ghost' },
  accepted: { label: 'Принят', class: 'badge-success' },
  rejected: { label: 'Отклонён', class: 'badge-error' },
  needs_rework: { label: 'На доработку', class: 'badge-warning' },
  superseded: { label: 'Заменён', class: 'badge-ghost badge-outline' },
}
</script>

<template>
  <span
    class="badge badge-xs"
    :class="statusMap[status]?.class ?? 'badge-ghost'"
  >
    {{ statusMap[status]?.label ?? status }}
  </span>
</template>
