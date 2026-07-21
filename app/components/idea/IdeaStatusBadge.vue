<script setup lang="ts">
defineProps<{
  status: string
  analysisStatus?: string
}>()

const statusMap: Record<string, { label: string; class: string }> = {
  pending: { label: 'Ожидание', class: 'badge-ghost' },
  processing: { label: 'Обработка', class: 'badge-info' },
  ready: { label: 'Готово', class: 'badge-success' },
  in_work: { label: 'В работе', class: 'badge-warning' },
  completed: { label: 'Завершено', class: 'badge-primary' },
  failed: { label: 'Ошибка', class: 'badge-error' },
}

const analysisStatusMap: Record<string, { label: string; class: string }> = {
  none: { label: 'Нет анализа', class: 'badge-ghost' },
  pending: { label: 'Анализ ожидает', class: 'badge-ghost' },
  running: { label: 'Анализ...', class: 'badge-info' },
  completed: { label: 'Анализ готов', class: 'badge-accent' },
  failed: { label: 'Анализ ошибка', class: 'badge-error' },
}
</script>

<template>
  <span
    class="badge badge-sm"
    :class="statusMap[status]?.class ?? 'badge-ghost'"
  >
    {{ statusMap[status]?.label ?? status }}
  </span>
  <span
    v-if="analysisStatus && analysisStatus !== 'none' && analysisStatus !== status"
    class="badge badge-sm badge-outline"
    :class="analysisStatusMap[analysisStatus]?.class ?? 'badge-ghost'"
  >
    {{ analysisStatusMap[analysisStatus]?.label ?? analysisStatus }}
  </span>
</template>
