<script setup lang="ts">
defineProps<{
  cycle: {
    id: number
    status: string
    app: { id: number; name: string } | null
    trendsFound: number
    scenariosGen: number
    videosGen: number
    uploadsCount: number
    startedAt: string
    createdAt: string
  }
}>()

const statusConfig: Record<string, { label: string; badge: string }> = {
  pending: { label: 'Ожидание', badge: 'badge-ghost' },
  running: { label: 'Работает', badge: 'badge-info' },
  completed: { label: 'Завершён', badge: 'badge-success' },
  failed: { label: 'Ошибка', badge: 'badge-error' },
  stopped: { label: 'Остановлен', badge: 'badge-warning' },
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <NuxtLink :to="`/admin/cycles/${cycle.id}`" class="card bg-base-100 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
    <div class="card-body p-4 gap-2">
      <div class="flex items-center justify-between">
        <h3 class="card-title text-base">
          {{ cycle.app?.name ?? 'Без приложения' }}
        </h3>
        <span :class="['badge badge-sm', statusConfig[cycle.status]?.badge ?? 'badge-ghost']">
          {{ statusConfig[cycle.status]?.label ?? cycle.status }}
        </span>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
        <div class="text-center">
          <div class="text-lg font-bold text-base-content">{{ cycle.trendsFound }}</div>
          <div class="text-xs text-base-content/60">Тренды</div>
        </div>
        <div class="text-center">
          <div class="text-lg font-bold text-base-content">{{ cycle.scenariosGen }}</div>
          <div class="text-xs text-base-content/60">Сценарии</div>
        </div>
        <div class="text-center">
          <div class="text-lg font-bold text-base-content">{{ cycle.videosGen }}</div>
          <div class="text-xs text-base-content/60">Видео</div>
        </div>
        <div class="text-center">
          <div class="text-lg font-bold text-base-content">{{ cycle.uploadsCount }}</div>
          <div class="text-xs text-base-content/60">Загрузки</div>
        </div>
      </div>

      <div class="text-xs text-base-content/50 mt-1">
        <Icon name="mingcute:time-line" class="text-sm align-text-bottom" />
        {{ formatDate(cycle.createdAt) }}
      </div>
    </div>
  </NuxtLink>
</template>
