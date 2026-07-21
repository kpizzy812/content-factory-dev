<script setup lang="ts">
const { can } = usePermissions()

const props = defineProps<{
  uploadId: number
}>()

const emit = defineEmits<{
  analyzed: []
}>()

const { analyzePost, isAnalyzing, analyzeError, analyzeResult } = useAnalyticsActions()

async function handleAnalyze() {
  const result = await analyzePost(props.uploadId)
  if (result) {
    emit('analyzed')
  }
}
</script>

<template>
  <div v-if="can('canRunAgent')" class="space-y-3">
    <button
      class="btn btn-secondary btn-sm"
      :disabled="isAnalyzing"
      @click="handleAnalyze"
    >
      <span v-if="isAnalyzing" class="loading loading-spinner loading-sm" />
      <Icon v-else name="mingcute:sparkles-line" />
      AI-анализ
    </button>

    <div v-if="analyzeError" role="alert" class="alert alert-error text-sm">
      <Icon name="mingcute:warning-line" />
      <span>{{ analyzeError }}</span>
    </div>

    <div v-if="analyzeResult" class="card bg-base-100 card-border">
      <div class="card-body space-y-3">
        <div class="flex items-center gap-2">
          <h3 class="font-semibold text-sm">Результат анализа</h3>
          <span v-if="analyzeResult.referenceCreated" class="badge badge-success badge-sm">
            <Icon name="mingcute:star-fill" class="text-xs mr-1" />
            Добавлен в референсы
          </span>
          <span
            class="badge badge-sm"
            :class="analyzeResult.analysis.isSuccessful ? 'badge-success' : 'badge-warning'"
          >
            {{ analyzeResult.analysis.isSuccessful ? 'Успешный' : 'Требует улучшений' }}
          </span>
        </div>

        <p class="text-sm font-medium text-base-content">
          {{ analyzeResult.analysis.reason }}
        </p>

        <p class="text-sm text-base-content/80 whitespace-pre-wrap">
          {{ analyzeResult.analysis.analysis }}
        </p>

        <div v-if="analyzeResult.analysis.recommendations.length" class="space-y-1">
          <h4 class="text-xs font-semibold text-base-content/60 uppercase">Рекомендации</h4>
          <ul class="list-disc list-inside text-sm text-base-content/70 space-y-1">
            <li v-for="(rec, i) in analyzeResult.analysis.recommendations" :key="i">
              {{ rec }}
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>
