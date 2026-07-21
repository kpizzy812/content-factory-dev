<script setup lang="ts">
const props = defineProps<{
  status: 'working' | 'idle' | 'error'
}>()

const statusConfig = computed(() => {
  const map = {
    working: {
      label: 'Завод работает',
      icon: 'mingcute:play-circle-line',
      badge: 'badge-success',
      statusColor: 'status-success',
    },
    idle: {
      label: 'Завод стоит',
      icon: 'mingcute:pause-circle-line',
      badge: 'badge-warning',
      statusColor: 'status-warning',
    },
    error: {
      label: 'Ошибка',
      icon: 'mingcute:alert-line',
      badge: 'badge-error',
      statusColor: 'status-error',
    },
  }
  return map[props.status]
})
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 flex-row items-center gap-3">
      <span :class="['status status-lg', statusConfig.statusColor]" />
      <div class="flex-1">
        <div class="text-sm text-base-content/60">Статус</div>
        <div class="text-lg font-bold text-base-content">
          {{ statusConfig.label }}
        </div>
      </div>
      <Icon :name="statusConfig.icon" class="text-3xl text-base-content/40" />
    </div>
  </div>
</template>
