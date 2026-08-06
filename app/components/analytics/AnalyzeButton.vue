<script setup lang="ts">
const { can } = usePermissions()

const props = defineProps<{
  uploadId: number
}>()

const emit = defineEmits<{ analyzed: [] }>()

const { analyzePost, isAnalyzing, analyzeError, analyzeResult } = useAnalyticsActions()

async function handleAnalyze() {
  const result = await analyzePost(props.uploadId)
  if (result) emit('analyzed')
}
</script>

<template>
  <div v-if="can('canRunAgent')" class="flex flex-col gap-3">
    <UiButton variant="primary" class="w-fit" :loading="isAnalyzing" @click="handleAnalyze">
      <Icon v-if="!isAnalyzing" name="mingcute:sparkles-line" />
      Разобрать публикацию · платно
    </UiButton>

    <div
      v-if="analyzeError"
      role="alert"
      class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
      <span>{{ analyzeError }}</span>
    </div>

    <section v-if="analyzeResult" class="rounded-lg border border-border bg-panel p-3.5">
      <div class="mb-2 flex flex-wrap items-center gap-2">
        <h2 class="text-sm font-medium">Разбор публикации</h2>
        <span
          class="rounded-sm border px-1.5 py-0.5 text-micro"
          :class="analyzeResult.analysis.isSuccessful
            ? 'border-success-border bg-success-bg text-success'
            : 'border-warning-border bg-warning-bg text-warning'"
        >
          {{ analyzeResult.analysis.isSuccessful ? 'удачная' : 'есть что улучшить' }}
        </span>
        <span
          v-if="analyzeResult.referenceCreated"
          class="flex items-center gap-1 rounded-sm border border-accent-border bg-accent-bg px-1.5 py-0.5 text-micro text-accent"
        >
          <Icon name="mingcute:star-fill" />
          в референсах
        </span>
      </div>

      <p class="text-sm font-medium">{{ analyzeResult.analysis.reason }}</p>
      <p class="mt-1 text-sm whitespace-pre-wrap text-muted">{{ analyzeResult.analysis.analysis }}</p>

      <div v-if="analyzeResult.analysis.recommendations.length" class="mt-2.5">
        <h3 class="mb-1 text-micro tracking-[.06em] text-subtle uppercase">Что поменять</h3>
        <ul class="flex flex-col gap-1">
          <li
            v-for="(rec, i) in analyzeResult.analysis.recommendations"
            :key="i"
            class="flex gap-2 text-sm text-muted"
          >
            <span class="text-subtle">·</span>
            <span>{{ rec }}</span>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>
