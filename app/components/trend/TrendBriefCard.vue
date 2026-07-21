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

const activeTab = ref<'hook' | 'scenes' | 'visual' | 'virality'>('hook')

function impactColor(impact: string): string {
  if (impact === 'high') return 'badge-error'
  if (impact === 'medium') return 'badge-warning'
  return 'badge-info'
}
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 gap-3">
      <div class="flex items-center justify-between">
        <h4 class="card-title text-sm">
          <Icon name="mingcute:document-2-line" class="text-primary" />
          Креативный бриф
        </h4>
        <div class="flex items-center gap-2">
          <span v-if="brief.confidence != null" class="text-xs text-base-content/50">
            {{ Math.round(brief.confidence * 100) }}%
          </span>
          <span class="badge badge-xs badge-ghost">
            v{{ brief.promptVersion }}
          </span>
        </div>
      </div>

      <!-- Ошибка -->
      <div v-if="brief.errorMessage" class="alert alert-error alert-soft text-sm">
        <Icon name="mingcute:warning-line" />
        <span>{{ brief.errorMessage }}</span>
      </div>

      <!-- Резюме -->
      <p class="text-sm text-base-content/80 bg-base-200 p-3 rounded-lg">
        {{ brief.summary }}
      </p>

      <!-- Табы -->
      <div class="tabs tabs-box tabs-sm">
        <button
          class="tab"
          :class="{ 'tab-active': activeTab === 'hook' }"
          @click="activeTab = 'hook'"
        >
          Хук
        </button>
        <button
          class="tab"
          :class="{ 'tab-active': activeTab === 'scenes' }"
          @click="activeTab = 'scenes'"
        >
          Сцены
        </button>
        <button
          class="tab"
          :class="{ 'tab-active': activeTab === 'visual' }"
          @click="activeTab = 'visual'"
        >
          Визуал
        </button>
        <button
          class="tab"
          :class="{ 'tab-active': activeTab === 'virality' }"
          @click="activeTab = 'virality'"
        >
          Вирусность
        </button>
      </div>

      <!-- Hook Analysis -->
      <div v-if="activeTab === 'hook'" class="space-y-2">
        <div class="flex items-center gap-2">
          <span class="badge badge-primary badge-sm">{{ brief.hookAnalysis.type }}</span>
          <span class="text-xs text-base-content/50">
            Сила: {{ brief.hookAnalysis.strength }}/100
          </span>
        </div>
        <p class="text-sm">{{ brief.hookAnalysis.description }}</p>
        <p v-if="brief.hookAnalysis.textOnScreen" class="text-xs text-base-content/60">
          Текст на экране: {{ brief.hookAnalysis.textOnScreen }}
        </p>
        <p class="text-xs text-base-content/60">
          Эмоция: {{ brief.hookAnalysis.emotionalTrigger }}
        </p>
      </div>

      <!-- Scene Structure -->
      <div v-if="activeTab === 'scenes'" class="space-y-2">
        <div class="flex items-center gap-2 text-xs text-base-content/60">
          <span>{{ brief.sceneStructure.estimatedDuration }}</span>
          <span class="badge badge-ghost badge-xs">{{ brief.sceneStructure.narrativeArc }}</span>
        </div>

        <div
          v-for="scene in brief.sceneStructure.scenes"
          :key="scene.order"
          class="flex gap-2 text-sm"
        >
          <span class="badge badge-circle badge-sm badge-outline shrink-0 mt-0.5">
            {{ scene.order }}
          </span>
          <div>
            <p class="font-medium text-xs">{{ scene.name }} ({{ scene.estimatedDuration }})</p>
            <p class="text-xs text-base-content/70">{{ scene.description }}</p>
          </div>
        </div>

        <p v-if="brief.sceneStructure.pacingNotes" class="text-xs text-base-content/50 italic">
          {{ brief.sceneStructure.pacingNotes }}
        </p>
      </div>

      <!-- Visual Style -->
      <div v-if="activeTab === 'visual'" class="space-y-2 text-sm">
        <div class="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span class="font-medium text-base-content/60">Цвет</span>
            <p>{{ brief.visualStyle.colorTone }}</p>
          </div>
          <div>
            <span class="font-medium text-base-content/60">Свет</span>
            <p>{{ brief.visualStyle.lighting }}</p>
          </div>
          <div>
            <span class="font-medium text-base-content/60">Камера</span>
            <p>{{ brief.visualStyle.cameraWork }}</p>
          </div>
          <div>
            <span class="font-medium text-base-content/60">Эстетика</span>
            <p>{{ brief.visualStyle.aesthetic }}</p>
          </div>
        </div>

        <div v-if="brief.visualStyle.effects?.length" class="flex gap-1 flex-wrap">
          <span
            v-for="effect in brief.visualStyle.effects"
            :key="effect"
            class="badge badge-outline badge-xs"
          >
            {{ effect }}
          </span>
        </div>

        <p class="text-xs text-base-content/50">
          Текст на экране: {{ brief.visualStyle.textOverlays ? 'Да' : 'Нет' }}
        </p>
      </div>

      <!-- Virality Reasons -->
      <div v-if="activeTab === 'virality'" class="space-y-2">
        <p class="text-sm font-medium">{{ brief.viralityReasons.primaryReason }}</p>

        <div
          v-for="factor in brief.viralityReasons.factors"
          :key="factor.factor"
          class="flex items-start gap-2 text-xs"
        >
          <span class="badge badge-xs" :class="impactColor(factor.impact)">
            {{ factor.impact }}
          </span>
          <div>
            <p class="font-medium">{{ factor.factor }}</p>
            <p class="text-base-content/60">{{ factor.description }}</p>
          </div>
        </div>

        <div class="text-xs text-base-content/60 space-y-1 mt-2">
          <p>Аудитория: {{ brief.viralityReasons.targetAudience }}</p>
          <p>Воспроизводимость: {{ brief.viralityReasons.replicability }}/100</p>
          <p>{{ brief.viralityReasons.replicabilityNotes }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
