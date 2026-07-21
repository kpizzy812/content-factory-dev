<script setup lang="ts">
const { can } = usePermissions()

const emit = defineEmits<{
  collected: []
}>()

const { collectMetrics, isCollecting, collectError, collectResult } = useAnalyticsActions()

async function handleCollect() {
  const result = await collectMetrics()
  if (result) {
    emit('collected')
  }
}
</script>

<template>
  <div v-if="can('canRunAgent')" class="flex flex-col sm:flex-row items-start sm:items-center gap-3">
    <button
      class="btn btn-primary btn-sm"
      :disabled="isCollecting"
      @click="handleCollect"
    >
      <span v-if="isCollecting" class="loading loading-spinner loading-sm" />
      <Icon v-else name="mingcute:refresh-2-line" />
      Собрать метрики
    </button>

    <div v-if="collectResult" class="flex items-center gap-2 text-sm">
      <span class="badge badge-success badge-sm">
        Собрано: {{ collectResult.collected }}
      </span>
      <span v-if="collectResult.errorsCount > 0" class="badge badge-error badge-sm">
        Ошибок: {{ collectResult.errorsCount }}
      </span>
    </div>

    <div v-if="collectError" role="alert" class="alert alert-error alert-sm text-sm py-1 px-3">
      <Icon name="mingcute:warning-line" class="text-xs" />
      <span>{{ collectError }}</span>
    </div>
  </div>
</template>
