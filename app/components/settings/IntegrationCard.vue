<script setup lang="ts">
const { data, pending, refresh } = useIntegrationStatus()

const isRefreshing = ref(false)

async function checkConnection() {
  isRefreshing.value = true
  try {
    await refresh()
  } finally {
    isRefreshing.value = false
  }
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 gap-3">
      <div class="flex items-center justify-between">
        <h4 class="card-title text-sm">
          <Icon name="mingcute:link-line" />
          MarketingCamp
        </h4>
        <span
          v-if="!pending && data?.data"
          class="status"
          :class="data.data.connected ? 'status-success' : 'status-error'"
        />
      </div>

      <div v-if="pending" class="flex items-center gap-2">
        <span class="loading loading-spinner loading-sm" />
        <span class="text-sm text-base-content/60">Проверка...</span>
      </div>

      <template v-else-if="data?.data">
        <div class="flex items-center gap-2">
          <span
            class="badge badge-sm"
            :class="data.data.connected ? 'badge-success' : 'badge-error'"
          >
            {{ data.data.connected ? 'Подключено' : 'Нет связи' }}
          </span>
        </div>

        <p v-if="data.data.error" class="text-xs text-error">
          {{ data.data.error }}
        </p>

        <p class="text-xs text-base-content/50">
          Последняя проверка: {{ formatTime(data.data.lastChecked) }}
        </p>
      </template>

      <div class="card-actions">
        <button
          class="btn btn-sm btn-outline"
          :disabled="isRefreshing"
          @click="checkConnection"
        >
          <span v-if="isRefreshing" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:refresh-2-line" />
          Проверить связь
        </button>
      </div>
    </div>
  </div>
</template>
