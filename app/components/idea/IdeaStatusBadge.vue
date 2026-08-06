<script setup lang="ts">
import { ideaStatus, ideaAnalysisStatus, IDEA_STATUS_LABELS } from './IdeaStatusMap'

/**
 * Статус идеи плюс состояние её разбора моделью.
 *
 * Разбор показывается отдельной пометкой: «Готова» у идеи и «Разобрана»
 * моделью — разные вещи, и оператор ждёт именно второго. Подпись доменная,
 * тон — из общего словаря, как у ProxyHealthBadge.
 */
const props = defineProps<{
  status: string
  analysisStatus?: string
}>()

const ANALYSIS_LABELS: Record<string, string> = {
  pending: 'Разбор в очереди',
  processing: 'Разбирается',
  running: 'Разбирается',
  completed: 'Разбор готов',
  failed: 'Разбор упал',
}

const TONE: Record<string, string> = {
  draft: 'border-neutral-border bg-neutral-bg text-neutral',
  queued: 'border-neutral-border bg-neutral-bg text-neutral',
  running: 'border-info-border bg-info-bg text-info',
  review: 'border-warning-border bg-warning-bg text-warning',
  done: 'border-success-border bg-success-bg text-success',
  failed: 'border-danger-border bg-danger-bg text-danger',
  blocked: 'border-danger-border bg-danger-bg text-danger',
  cancelled: 'border-divider bg-transparent text-subtle',
}

const showAnalysis = computed(() =>
  !!props.analysisStatus
  && props.analysisStatus !== 'none'
  && props.analysisStatus !== props.status
  && !!ANALYSIS_LABELS[props.analysisStatus],
)

const analysisTone = computed(() => TONE[ideaAnalysisStatus(props.analysisStatus)] ?? TONE.draft)
</script>

<template>
  <UiStatusBadge :status="ideaStatus(status)" size="sm" :title="IDEA_STATUS_LABELS[status] ?? status" />

  <span
    v-if="showAnalysis"
    class="inline-flex h-[22px] w-fit items-center rounded-sm border px-2 text-sm whitespace-nowrap"
    :class="analysisTone"
  >
    {{ ANALYSIS_LABELS[analysisStatus!] }}
  </span>
</template>
