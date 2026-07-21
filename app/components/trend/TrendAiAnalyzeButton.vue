<script setup lang="ts">
const props = defineProps<{
  trendId: number
  analysisStatus?: string | null
}>()

const emit = defineEmits<{
  analyzed: []
}>()

const loading = ref(false)
const error = ref<string | null>(null)

const isAnalyzed = computed(() => props.analysisStatus === 'completed')
const isRunning = computed(() => props.analysisStatus === 'running' || loading.value)
const isFailed = computed(() => props.analysisStatus === 'failed')

async function handleAnalyze() {
  loading.value = true
  error.value = null
  try {
    await $fetch(`/api/trends/${props.trendId}/analyze`, { method: 'POST' })
    emit('analyzed')
  } catch (e: any) {
    error.value = e?.data?.message || e?.message || 'Ошибка AI-анализа'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="space-y-2">
    <button
      class="btn btn-sm gap-1"
      :class="{
        'btn-primary': !isAnalyzed && !isFailed,
        'btn-success btn-outline': isAnalyzed,
        'btn-error btn-outline': isFailed,
      }"
      :disabled="isRunning"
      @click="handleAnalyze"
    >
      <span v-if="isRunning" class="loading loading-spinner loading-xs" />
      <Icon v-else-if="isAnalyzed" name="mingcute:check-circle-line" />
      <Icon v-else-if="isFailed" name="mingcute:refresh-2-line" />
      <Icon v-else name="mingcute:sparkles-2-line" />

      <template v-if="isRunning">Анализ...</template>
      <template v-else-if="isAnalyzed">Переанализировать</template>
      <template v-else-if="isFailed">Повторить анализ</template>
      <template v-else>AI: Анализировать креатив</template>
    </button>

    <div v-if="error" role="alert" class="alert alert-error alert-soft text-sm">
      <Icon name="mingcute:warning-line" />
      <span>{{ error }}</span>
    </div>
  </div>
</template>
