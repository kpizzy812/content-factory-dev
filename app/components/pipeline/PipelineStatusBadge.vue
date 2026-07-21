<script setup lang="ts">
const props = defineProps<{
  status: string
}>()

const badge = computed(() => {
  if (props.status === 'active') {
    return { class: 'badge-success', label: 'Активен' }
  }
  return { class: 'badge-ghost', label: 'Неактивен' }
})
</script>

<template>
  <span class="badge badge-sm" :class="badge.class">
    {{ badge.label }}
  </span>
</template>
