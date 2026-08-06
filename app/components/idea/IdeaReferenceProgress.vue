<script setup lang="ts">
import type { ReferenceProgress, ReferenceProgressStage } from '~~/shared/types/reference'

const props = defineProps<{
  progress: ReferenceProgress | null
}>()

interface StepDef {
  stage: ReferenceProgressStage
  label: string
}

const STEPS: StepDef[] = [
  { stage: 'downloading', label: 'Скачивание' },
  { stage: 'extracting_frames', label: 'Кадры' },
  { stage: 'transcribing', label: 'Транскрипция' },
  { stage: 'analyzing_frames', label: 'Анализ кадров' },
  { stage: 'synthesizing', label: 'Синтез' },
]

const currentStageIndex = computed(() => {
  if (!props.progress) return 0
  if (props.progress.stage === 'queued') return -1
  return STEPS.findIndex(s => s.stage === props.progress!.stage)
})

const states = computed(() => STEPS.map((_, i) => {
  if (i < currentStageIndex.value) return 'done' as const
  if (i === currentStageIndex.value) return 'running' as const
  return 'pending' as const
}))

function stepLabel(step: StepDef, i: number): string {
  if (step.stage === 'analyzing_frames' && currentStageIndex.value === i) {
    const done = props.progress?.framesDone ?? 0
    const total = props.progress?.framesTotal ?? 0
    if (total > 0) return `${step.label} · ${done} из ${total}`
  }
  return step.label
}

const elapsedLabel = computed(() => {
  const sec = props.progress?.elapsedSec
  if (typeof sec !== 'number' || sec <= 0) return null
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m} мин ${s} с` : `${s} с`
})

const currentLabel = computed(() => {
  const i = currentStageIndex.value
  if (i < 0) return 'В очереди'
  const step = STEPS[i]
  return step ? stepLabel(step, i) : 'Идёт разбор'
})
</script>

<template>
  <div class="flex flex-col gap-2 py-2" aria-busy="true">
    <UiStepProgress :steps="states" :label="currentLabel" :caption="elapsedLabel ?? undefined" />

    <div class="flex flex-wrap gap-x-3 gap-y-1 text-micro text-subtle">
      <span
        v-for="(step, i) in STEPS"
        :key="step.stage"
        :aria-current="i === currentStageIndex ? 'step' : undefined"
        :class="i <= currentStageIndex ? 'text-muted' : ''"
      >
        {{ stepLabel(step, i) }}
      </span>
    </div>
  </div>
</template>
