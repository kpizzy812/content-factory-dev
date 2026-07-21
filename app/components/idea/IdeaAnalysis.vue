<script setup lang="ts">
import type { IdeaAnalysis } from '~~/shared/types/idea'

const props = defineProps<{
  idea: {
    title: string | null
    hook: string | null
    body: string | null
    cta: string | null
    visualStyle: string | null
    whyViral: string | null
    analysisStatus: string | unknown
    analysis?: Record<string, unknown> | null
  }
}>()

const activeTab = ref<'basic' | 'structured'>('basic')

const hasBasicAnalysis = computed(() =>
  props.idea.title || props.idea.hook || props.idea.body || props.idea.cta || props.idea.visualStyle || props.idea.whyViral,
)

const hasStructuredAnalysis = computed(() => !!props.idea.analysis?.summary)

// Helpers для отображения structured analysis
function getHookAnalysis() {
  const h = props.idea.analysis?.hookAnalysis as Record<string, unknown> | undefined
  if (!h) return null
  return {
    type: h.type as string,
    description: h.description as string,
    strength: h.strength as number,
    emotionalTrigger: h.emotionalTrigger as string,
    textOnScreen: h.textOnScreen as string | undefined,
  }
}

function getSceneStructure() {
  const s = props.idea.analysis?.sceneStructure as Record<string, unknown> | undefined
  if (!s) return null
  return {
    estimatedDuration: s.estimatedDuration as string,
    narrativeArc: s.narrativeArc as string,
    pacingNotes: s.pacingNotes as string,
    scenes: s.scenes as Array<{ order: number; name: string; description: string; estimatedDuration: string; purpose: string }>,
  }
}

function getVisualStyle() {
  const v = props.idea.analysis?.visualStyle as Record<string, unknown> | undefined
  if (!v) return null
  return {
    colorTone: v.colorTone as string,
    lighting: v.lighting as string,
    cameraWork: v.cameraWork as string,
    aesthetic: v.aesthetic as string,
    textOverlays: v.textOverlays as boolean,
    effects: v.effects as string[],
  }
}

function getViralityReasons() {
  const vr = props.idea.analysis?.viralityReasons as Record<string, unknown> | undefined
  if (!vr) return null
  return {
    primaryReason: vr.primaryReason as string,
    targetAudience: vr.targetAudience as string,
    replicability: vr.replicability as number,
    replicabilityNotes: vr.replicabilityNotes as string,
    factors: vr.factors as Array<{ factor: string; description: string; impact: string }>,
  }
}
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 gap-4">
      <!-- Табы: базовый / структурированный -->
      <div v-if="hasBasicAnalysis && hasStructuredAnalysis" class="tabs tabs-bordered">
        <button
          class="tab"
          :class="{ 'tab-active': activeTab === 'basic' }"
          @click="activeTab = 'basic'"
        >
          Базовый анализ
        </button>
        <button
          class="tab"
          :class="{ 'tab-active': activeTab === 'structured' }"
          @click="activeTab = 'structured'"
        >
          <Icon name="mingcute:brain-line" class="mr-1" />
          Глубокий анализ
        </button>
      </div>

      <!-- ===== Базовый анализ ===== -->
      <div v-show="activeTab === 'basic' && hasBasicAnalysis" class="space-y-4">
        <div v-if="idea.title">
          <div class="flex items-center gap-2 mb-2">
            <Icon name="mingcute:text-line" class="text-primary text-lg" />
            <span class="font-semibold text-sm text-base-content">Заголовок</span>
          </div>
          <div class="bg-base-200 rounded-lg p-3 text-sm text-base-content/80">
            {{ idea.title }}
          </div>
        </div>

        <div v-if="idea.hook">
          <div class="flex items-center gap-2 mb-2">
            <Icon name="mingcute:flash-line" class="text-warning text-lg" />
            <span class="font-semibold text-sm text-base-content">Хук</span>
          </div>
          <div class="bg-base-200 rounded-lg p-3 text-sm text-base-content/80 whitespace-pre-wrap">
            {{ idea.hook }}
          </div>
        </div>

        <div v-if="idea.body">
          <div class="flex items-center gap-2 mb-2">
            <Icon name="mingcute:text-line" class="text-info text-lg" />
            <span class="font-semibold text-sm text-base-content">Основная часть</span>
          </div>
          <p class="text-sm text-base-content/80 whitespace-pre-wrap">
            {{ idea.body }}
          </p>
        </div>

        <div v-if="idea.cta">
          <div class="flex items-center gap-2 mb-2">
            <Icon name="mingcute:horn-line" class="text-success text-lg" />
            <span class="font-semibold text-sm text-base-content">Призыв к действию</span>
          </div>
          <p class="text-sm text-base-content/80 whitespace-pre-wrap">
            {{ idea.cta }}
          </p>
        </div>

        <div v-if="idea.visualStyle">
          <div class="flex items-center gap-2 mb-2">
            <Icon name="mingcute:palette-line" class="text-secondary text-lg" />
            <span class="font-semibold text-sm text-base-content">Визуальный стиль</span>
          </div>
          <p class="text-sm text-base-content/80 whitespace-pre-wrap">
            {{ idea.visualStyle }}
          </p>
        </div>

        <div v-if="idea.whyViral">
          <div class="flex items-center gap-2 mb-2">
            <Icon name="mingcute:fire-line" class="text-error text-lg" />
            <span class="font-semibold text-sm text-base-content">Почему залетело</span>
          </div>
          <p class="text-sm text-base-content/80 whitespace-pre-wrap">
            {{ idea.whyViral }}
          </p>
        </div>
      </div>

      <!-- ===== Структурированный анализ ===== -->
      <div v-show="activeTab === 'structured' && hasStructuredAnalysis" class="space-y-4">
        <!-- Summary -->
        <div v-if="idea.analysis?.summary" class="bg-primary/10 rounded-lg p-3">
          <p class="text-sm font-medium text-base-content">{{ idea.analysis.summary }}</p>
          <p v-if="idea.analysis.confidence" class="text-xs text-base-content/50 mt-1">
            Уверенность: {{ Math.round(Number(idea.analysis.confidence) * 100) }}%
          </p>
        </div>

        <!-- Hook Analysis -->
        <div v-if="getHookAnalysis()">
          <div class="flex items-center gap-2 mb-2">
            <Icon name="mingcute:flash-line" class="text-warning text-lg" />
            <span class="font-semibold text-sm">Hook-анализ</span>
            <span class="badge badge-xs badge-outline">{{ getHookAnalysis()!.type }}</span>
            <span class="badge badge-xs badge-warning">{{ getHookAnalysis()!.strength }}/100</span>
          </div>
          <div class="bg-base-200 rounded-lg p-3 text-sm space-y-1">
            <p>{{ getHookAnalysis()!.description }}</p>
            <p v-if="getHookAnalysis()!.emotionalTrigger" class="text-xs text-base-content/60">
              Эмоциональный триггер: {{ getHookAnalysis()!.emotionalTrigger }}
            </p>
            <p v-if="getHookAnalysis()!.textOnScreen" class="text-xs text-base-content/60">
              Текст на экране: {{ getHookAnalysis()!.textOnScreen }}
            </p>
          </div>
        </div>

        <!-- Scene Structure -->
        <div v-if="getSceneStructure()">
          <div class="flex items-center gap-2 mb-2">
            <Icon name="mingcute:film-line" class="text-info text-lg" />
            <span class="font-semibold text-sm">Структура сцен</span>
            <span class="badge badge-xs badge-ghost">{{ getSceneStructure()!.estimatedDuration }}</span>
            <span class="badge badge-xs badge-outline">{{ getSceneStructure()!.narrativeArc }}</span>
          </div>
          <div class="space-y-2">
            <div
              v-for="scene in getSceneStructure()!.scenes"
              :key="scene.order"
              class="bg-base-200 rounded-lg p-3 text-sm"
            >
              <div class="flex items-center gap-2 mb-1">
                <span class="badge badge-xs badge-primary">{{ scene.order }}</span>
                <span class="font-medium">{{ scene.name }}</span>
                <span class="text-xs text-base-content/50">{{ scene.estimatedDuration }}</span>
              </div>
              <p class="text-base-content/80">{{ scene.description }}</p>
              <p class="text-xs text-base-content/50 mt-1">{{ scene.purpose }}</p>
            </div>
            <p v-if="getSceneStructure()!.pacingNotes" class="text-xs text-base-content/60 italic">
              {{ getSceneStructure()!.pacingNotes }}
            </p>
          </div>
        </div>

        <!-- Visual Style -->
        <div v-if="getVisualStyle()">
          <div class="flex items-center gap-2 mb-2">
            <Icon name="mingcute:palette-line" class="text-secondary text-lg" />
            <span class="font-semibold text-sm">Визуальный стиль</span>
            <span class="badge badge-xs badge-outline">{{ getVisualStyle()!.aesthetic }}</span>
          </div>
          <div class="bg-base-200 rounded-lg p-3 text-sm space-y-1">
            <p><strong>Цвет:</strong> {{ getVisualStyle()!.colorTone }}</p>
            <p><strong>Свет:</strong> {{ getVisualStyle()!.lighting }}</p>
            <p><strong>Камера:</strong> {{ getVisualStyle()!.cameraWork }}</p>
            <p v-if="getVisualStyle()!.effects?.length">
              <strong>Эффекты:</strong> {{ getVisualStyle()!.effects.join(', ') }}
            </p>
          </div>
        </div>

        <!-- Virality Reasons -->
        <div v-if="getViralityReasons()">
          <div class="flex items-center gap-2 mb-2">
            <Icon name="mingcute:fire-line" class="text-error text-lg" />
            <span class="font-semibold text-sm">Причины вирусности</span>
            <span class="badge badge-xs badge-error">
              Воспроизводимость: {{ getViralityReasons()!.replicability }}/100
            </span>
          </div>
          <div class="bg-base-200 rounded-lg p-3 text-sm space-y-2">
            <p><strong>Главная причина:</strong> {{ getViralityReasons()!.primaryReason }}</p>
            <div v-if="getViralityReasons()!.factors?.length" class="space-y-1">
              <div
                v-for="(f, i) in getViralityReasons()!.factors"
                :key="i"
                class="flex items-start gap-2"
              >
                <span
                  class="badge badge-xs mt-0.5"
                  :class="{
                    'badge-error': f.impact === 'high',
                    'badge-warning': f.impact === 'medium',
                    'badge-ghost': f.impact === 'low',
                  }"
                >
                  {{ f.impact }}
                </span>
                <div>
                  <span class="font-medium">{{ f.factor }}</span>
                  <span class="text-base-content/60"> — {{ f.description }}</span>
                </div>
              </div>
            </div>
            <p class="text-xs text-base-content/60">
              Аудитория: {{ getViralityReasons()!.targetAudience }}
            </p>
            <p v-if="getViralityReasons()!.replicabilityNotes" class="text-xs text-base-content/60 italic">
              {{ getViralityReasons()!.replicabilityNotes }}
            </p>
          </div>
        </div>
      </div>

      <!-- Статус анализа -->
      <div
        v-if="idea.analysisStatus === 'running'"
        class="text-center py-4 text-base-content/50"
      >
        <span class="loading loading-spinner loading-sm" />
        <p class="text-sm mt-1">Структурированный анализ выполняется...</p>
      </div>

      <!-- Пустое состояние -->
      <div
        v-if="!hasBasicAnalysis && !hasStructuredAnalysis && idea.analysisStatus !== 'running'"
        class="text-center py-6 text-base-content/40"
      >
        <Icon name="mingcute:time-line" class="text-3xl mb-2" />
        <p class="text-sm">Анализ ещё не завершён</p>
      </div>
    </div>
  </div>
</template>
