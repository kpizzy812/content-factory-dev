<script setup lang="ts">
defineProps<{
  total: number
  success: number
  failed: number
  running?: number
}>()
</script>

<template>
  <div v-if="total > 0" class="flex items-center gap-3 text-xs bg-base-200/50 rounded-box px-3 py-2">
    <span class="text-base-content/60">
      <span class="font-semibold text-base-content">{{ total }}</span> запусков
    </span>
    <span v-if="success" class="text-success">
      {{ success }} успешно
    </span>
    <span v-if="failed" class="text-error">
      {{ failed }} ошибок
    </span>
    <span v-if="running" class="text-info flex items-center gap-1">
      <span class="loading loading-dots loading-xs" />
      {{ running }} активных
    </span>
  </div>
</template>
