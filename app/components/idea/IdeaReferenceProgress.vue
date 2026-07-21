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
  const idx = STEPS.findIndex(s => s.stage === props.progress!.stage)
  return idx
})

function stepLabel(step: StepDef, i: number): string {
  if (step.stage === 'analyzing_frames' && currentStageIndex.value === i) {
    const done = props.progress?.framesDone ?? 0
    const total = props.progress?.framesTotal ?? 0
    if (total > 0) return `${step.label} (${done} из ${total})`
  }
  return step.label
}

const elapsedLabel = computed(() => {
  const sec = props.progress?.elapsedSec
  if (typeof sec !== 'number' || sec <= 0) return null
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}м ${s}с` : `${s}с`
})
</script>

<template>
  <div class="space-y-3 py-2" aria-busy="true">
    <ul class="steps steps-horizontal w-full text-xs">
      <li
        v-for="(step, i) in STEPS"
        :key="step.stage"
        class="step"
        :class="{ 'step-primary': i <= currentStageIndex }"
        :aria-current="i === currentStageIndex ? 'step' : undefined"
      >
        {{ stepLabel(step, i) }}
      </li>
    </ul>

    <div class="flex items-center justify-center gap-2 text-xs text-base-content/60">
      <span class="loading loading-spinner loading-xs" />
      <span>Анализ выполняется...</span>
      <span v-if="elapsedLabel" class="badge badge-ghost badge-sm">{{ elapsedLabel }}</span>
    </div>
  </div>
</template>
