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
  }
  catch (e) {
    error.value = (e as { data?: { message?: string }, message?: string })?.data?.message
      || (e as Error)?.message
      || 'Ошибка AI-анализа'
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <UiButton
      :variant="isAnalyzed || isFailed ? 'secondary' : 'primary'"
      :loading="isRunning"
      class="w-fit"
      @click="handleAnalyze"
    >
      <template v-if="!isRunning">
        <Icon v-if="isAnalyzed" name="mingcute:check-circle-line" class="text-success" />
        <Icon v-else-if="isFailed" name="mingcute:refresh-2-line" class="text-danger" />
        <Icon v-else name="mingcute:sparkles-2-line" />
      </template>

      <template v-if="isRunning">Анализируем</template>
      <template v-else-if="isAnalyzed">Переанализировать</template>
      <template v-else-if="isFailed">Повторить анализ</template>
      <template v-else>Анализировать креатив</template>
    </UiButton>

    <div
      v-if="error"
      role="alert"
      class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
      <span>{{ error }}</span>
    </div>
  </div>
</template>
