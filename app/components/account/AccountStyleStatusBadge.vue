<script setup lang="ts">
defineProps<{
  status: 'not_set' | 'partial' | 'complete' | undefined | null
}>()

const config: Record<string, { label: string; class: string }> = {
  not_set: { label: 'Стиль не задан', class: 'badge-ghost' },
  partial: { label: 'Частично', class: 'badge-warning' },
  complete: { label: 'Стиль задан', class: 'badge-success' },
}
</script>

<template>
  <span
    v-if="status"
    class="badge badge-sm gap-1"
    :class="config[status]?.class ?? 'badge-ghost'"
  >
    <Icon
      :name="status === 'complete' ? 'mingcute:palette-line' : status === 'partial' ? 'mingcute:paint-brush-line' : 'mingcute:palette-line'"
      class="text-xs"
    />
    {{ config[status]?.label ?? 'Не задан' }}
  </span>
</template>
