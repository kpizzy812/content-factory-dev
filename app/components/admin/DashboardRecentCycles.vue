<script setup lang="ts">
defineProps<{
  cycles: Array<{
    id: number
    status: string
    app: { id: number; name: string } | null
    startedAt: string
    trendsFound: number
    videosGen: number
    uploadsCount: number
  }>
}>()

const statusBadge: Record<string, string> = {
  pending: 'badge-ghost',
  running: 'badge-info',
  completed: 'badge-success',
  failed: 'badge-error',
  stopped: 'badge-warning',
}

const statusLabel: Record<string, string> = {
  pending: 'Ожидание',
  running: 'Работает',
  completed: 'Завершён',
  failed: 'Ошибка',
  stopped: 'Остановлен',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 gap-3">
      <h3 class="card-title text-sm">
        <Icon name="mingcute:refresh-2-line" />
        Последние циклы
      </h3>

      <div class="overflow-x-auto">
        <table class="table table-sm">
          <thead>
            <tr>
              <th>Приложение</th>
              <th>Статус</th>
              <th>Тренды</th>
              <th>Видео</th>
              <th>Загрузки</th>
              <th>Дата</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="cycle in cycles"
              :key="cycle.id"
              class="hover cursor-pointer"
              @click="navigateTo(`/admin/cycles/${cycle.id}`)"
            >
              <td class="font-medium">{{ cycle.app?.name ?? '—' }}</td>
              <td>
                <span :class="['badge badge-sm', statusBadge[cycle.status] ?? 'badge-ghost']">
                  {{ statusLabel[cycle.status] ?? cycle.status }}
                </span>
              </td>
              <td>{{ cycle.trendsFound }}</td>
              <td>{{ cycle.videosGen }}</td>
              <td>{{ cycle.uploadsCount }}</td>
              <td class="text-base-content/60">{{ formatDate(cycle.startedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-if="!cycles.length" class="text-sm text-base-content/50 text-center py-4">
        Нет циклов
      </p>
    </div>
  </div>
</template>
