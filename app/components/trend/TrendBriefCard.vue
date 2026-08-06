<script setup lang="ts">
import type { TrendHookAnalysis, TrendSceneStructure, TrendVisualStyle, TrendViralityReasons } from '~~/shared/types/agents'

defineProps<{
  brief: {
    id: number
    hookAnalysis: TrendHookAnalysis
    sceneStructure: TrendSceneStructure
    visualStyle: TrendVisualStyle
    viralityReasons: TrendViralityReasons
    summary: string
    confidence?: number | null
    modelVersion: string
    promptVersion: string
    errorMessage?: string | null
    createdAt: string
  }
}>()

const tab = ref<'hook' | 'scenes' | 'visual' | 'virality'>('hook')

const TABS = [
  { key: 'hook', label: 'Хук' },
  { key: 'scenes', label: 'Сцены' },
  { key: 'visual', label: 'Визуал' },
  { key: 'virality', label: 'Вирусность' },
] as const

/**
 * Влияние фактора — это не статус сущности, поэтому UiStatusBadge тут не к месту.
 * Берём из системы только тон: сильное влияние читается как предупреждение,
 * слабое — как справочная пометка.
 */
const IMPACT_TONE: Record<string, string> = {
  high: 'border-danger-border bg-danger-bg text-danger',
  medium: 'border-warning-border bg-warning-bg text-warning',
  low: 'border-info-border bg-info-bg text-info',
}

const IMPACT_LABEL: Record<string, string> = {
  high: 'сильное',
  medium: 'среднее',
  low: 'слабое',
}
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-border bg-panel">
    <header class="flex items-center gap-2 border-b border-border bg-card px-3.5 py-2.5">
      <Icon name="mingcute:document-2-line" class="text-accent" />
      <h2 class="text-sm font-medium">Креативный бриф</h2>
      <span class="flex-1" />
      <span v-if="brief.confidence != null" class="tnum font-mono text-micro text-subtle">
        уверенность {{ Math.round(brief.confidence * 100) }}%
      </span>
      <span class="font-mono text-micro text-subtle">v{{ brief.promptVersion }}</span>
    </header>

    <div class="flex flex-col gap-3 p-3.5">
      <div
        v-if="brief.errorMessage"
        role="alert"
        class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
      >
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
        <span>{{ brief.errorMessage }}</span>
      </div>

      <p class="rounded-md bg-surface p-3 text-sm">{{ brief.summary }}</p>

      <div role="tablist" class="flex flex-wrap gap-0.5 border-b border-border">
        <button
          v-for="t in TABS"
          :key="t.key"
          type="button"
          role="tab"
          :aria-selected="tab === t.key"
          class="h-[30px] cursor-pointer border-b-2 px-2.5 text-sm"
          :class="tab === t.key
            ? 'border-accent font-medium text-fg'
            : 'border-transparent text-muted hover:text-fg'"
          @click="tab = t.key"
        >
          {{ t.label }}
        </button>
      </div>

      <!-- Хук -->
      <div v-if="tab === 'hook'" class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <span class="rounded-sm border border-accent-border bg-accent-bg px-1.5 py-0.5 text-micro text-accent">
            {{ brief.hookAnalysis.type }}
          </span>
          <span class="tnum font-mono text-micro text-subtle">
            сила {{ brief.hookAnalysis.strength }}/100
          </span>
        </div>
        <p class="text-sm">{{ brief.hookAnalysis.description }}</p>
        <UiKeyValue
          :items="[
            { label: 'Текст на экране', value: brief.hookAnalysis.textOnScreen, mono: false },
            { label: 'Эмоция', value: brief.hookAnalysis.emotionalTrigger, mono: false },
          ]"
          label-width="140px"
        />
      </div>

      <!-- Сцены -->
      <div v-else-if="tab === 'scenes'" class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-2 text-micro text-subtle">
          <span class="tnum font-mono">{{ brief.sceneStructure.estimatedDuration }}</span>
          <span class="rounded-sm border border-divider px-1.5 py-0.5">{{ brief.sceneStructure.narrativeArc }}</span>
        </div>

        <div
          v-for="scene in brief.sceneStructure.scenes"
          :key="scene.order"
          class="flex gap-2.5 border-b border-divider py-1.5 last:border-b-0"
        >
          <span
            class="tnum mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border font-mono text-micro text-muted"
          >
            {{ scene.order }}
          </span>
          <div class="min-w-0">
            <p class="text-sm font-medium">
              {{ scene.name }}
              <span class="tnum font-mono text-micro text-subtle">{{ scene.estimatedDuration }}</span>
            </p>
            <p class="text-sm text-muted">{{ scene.description }}</p>
          </div>
        </div>

        <p v-if="brief.sceneStructure.pacingNotes" class="text-micro text-subtle italic">
          {{ brief.sceneStructure.pacingNotes }}
        </p>
      </div>

      <!-- Визуал -->
      <div v-else-if="tab === 'visual'" class="flex flex-col gap-2.5">
        <UiKeyValue
          :items="[
            { label: 'Цвет', value: brief.visualStyle.colorTone, mono: false },
            { label: 'Свет', value: brief.visualStyle.lighting, mono: false },
            { label: 'Камера', value: brief.visualStyle.cameraWork, mono: false },
            { label: 'Эстетика', value: brief.visualStyle.aesthetic, mono: false },
            { label: 'Текст на экране', value: brief.visualStyle.textOverlays ? 'да' : 'нет', mono: false },
          ]"
          label-width="140px"
        />

        <div v-if="brief.visualStyle.effects?.length" class="flex flex-wrap gap-1">
          <span
            v-for="effect in brief.visualStyle.effects"
            :key="effect"
            class="rounded-sm border border-divider px-1.5 py-0.5 text-micro text-muted"
          >
            {{ effect }}
          </span>
        </div>
      </div>

      <!-- Вирусность -->
      <div v-else class="flex flex-col gap-2.5">
        <p class="text-sm font-medium">{{ brief.viralityReasons.primaryReason }}</p>

        <div
          v-for="factor in brief.viralityReasons.factors"
          :key="factor.factor"
          class="flex items-start gap-2 border-b border-divider py-1.5 last:border-b-0"
        >
          <span
            class="mt-0.5 shrink-0 rounded-sm border px-1.5 py-0.5 text-micro"
            :class="IMPACT_TONE[factor.impact] ?? 'border-divider text-muted'"
          >
            {{ IMPACT_LABEL[factor.impact] ?? factor.impact }}
          </span>
          <div class="min-w-0">
            <p class="text-sm font-medium">{{ factor.factor }}</p>
            <p class="text-sm text-muted">{{ factor.description }}</p>
          </div>
        </div>

        <UiKeyValue
          :items="[
            { label: 'Аудитория', value: brief.viralityReasons.targetAudience, mono: false },
            { label: 'Повторяемость', value: `${brief.viralityReasons.replicability}/100` },
          ]"
          label-width="140px"
        />
        <p v-if="brief.viralityReasons.replicabilityNotes" class="text-sm text-muted">
          {{ brief.viralityReasons.replicabilityNotes }}
        </p>
      </div>
    </div>
  </section>
</template>
