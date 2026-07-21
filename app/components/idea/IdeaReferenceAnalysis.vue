<script setup lang="ts">
import type { ReferenceProgress } from '~~/shared/types/reference'

const props = defineProps<{
  referenceBreakdown: Record<string, unknown> | null
  referenceStatus: string | null
  analysisProgress?: ReferenceProgress | null
}>()

const activeRefTab = ref<'patterns' | 'scenes' | 'narrative' | 'visual' | 'transcript'>('patterns')

// Helpers
const breakdown = computed(() => props.referenceBreakdown)

const abstractedPatterns = computed(() => {
  if (!breakdown.value?.abstractedPatterns) return []
  return breakdown.value.abstractedPatterns as Array<{
    name: string
    category: string
    abstractDescription: string
    applicationGuide: string
    strength: number
  }>
})

const sceneTimeline = computed(() => {
  if (!breakdown.value?.sceneTimeline) return []
  return breakdown.value.sceneTimeline as Array<{
    order: number
    startMarker: string
    duration: string
    action: string
    purpose: string
    onScreenText: string | null
    visualCues: string
    emotionalTone: string
    cameraWork: string | null
  }>
})

const narrativeMechanics = computed(() => {
  if (!breakdown.value?.narrativeMechanics) return null
  return breakdown.value.narrativeMechanics as {
    hookType: string
    hookDescription: string
    bodyMechanic: string
    ctaMechanic: string
    emotionalArc: string[]
    pacing: string
    narrativeTemplate: string
    transformationArc: string | null
  }
})

const visualPatterns = computed(() => {
  if (!breakdown.value?.visualPatterns) return null
  return breakdown.value.visualPatterns as {
    colorPalette: string[]
    lighting: string
    cameraStyle: string
    composition: string
    textOverlayStyle: string | null
    aesthetic: string
    effects: string[]
  }
})

const originalityGuide = computed(() => {
  if (!breakdown.value?.originalityGuide) return null
  return breakdown.value.originalityGuide as {
    safeToReuse: string[]
    mustTransform: string[]
    requireOriginal: string[]
    transformationSuggestions: string[]
    targetOriginalityScore: number
  }
})

const transcript = computed(() => {
  if (!breakdown.value?.transcript) return null
  return breakdown.value.transcript as {
    fullText: string
    segments: Array<{ start: number; duration: number; text: string }>
    source: string
    language: string | null
  }
})

const dataAvailability = computed(() => {
  if (!breakdown.value?.dataAvailability) return null
  return breakdown.value.dataAvailability as {
    hasTranscript: boolean
    hasTimedSegments: boolean
    hasThumbnail: boolean
    hasDescription: boolean
    metadataRichness: string
  }
})

const categoryColors: Record<string, string> = {
  hook: 'badge-warning',
  narrative: 'badge-info',
  visual: 'badge-secondary',
  pacing: 'badge-accent',
  subtitle: 'badge-primary',
  integration: 'badge-success',
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 gap-4">
      <!-- Status -->
      <div v-if="referenceStatus === 'running'" class="py-2">
        <IdeaReferenceProgress :progress="analysisProgress ?? null" />
      </div>

      <div v-else-if="referenceStatus === 'failed'" role="alert" class="alert alert-error alert-soft text-sm">
        <Icon name="mingcute:warning-line" />
        <span>Анализ референса завершился с ошибкой</span>
      </div>

      <template v-else-if="breakdown">
        <!-- Confidence + data availability -->
        <div class="flex items-center gap-3 flex-wrap">
          <div class="badge badge-outline gap-1">
            <Icon name="mingcute:target-line" class="text-xs" />
            Уверенность: {{ Math.round(Number(breakdown.confidence ?? 0) * 100) }}%
          </div>
          <div v-if="dataAvailability" class="badge badge-ghost gap-1">
            <Icon name="mingcute:database-line" class="text-xs" />
            {{ dataAvailability.metadataRichness === 'rich' ? 'Богатые данные' : dataAvailability.metadataRichness === 'moderate' ? 'Средние данные' : 'Скудные данные' }}
          </div>
          <div v-if="dataAvailability?.hasTranscript" class="badge badge-success badge-outline badge-sm gap-1">
            <Icon name="mingcute:check-line" class="text-xs" />
            Транскрипт
          </div>
          <div v-if="breakdown.mediaType" class="badge badge-ghost badge-sm">
            {{ breakdown.mediaType === 'video' ? 'Видео' : breakdown.mediaType === 'image' ? 'Изображение' : 'Неизвестно' }}
          </div>
        </div>

        <!-- Tabs -->
        <div class="tabs tabs-border">
          <button
            class="tab"
            :class="{ 'tab-active': activeRefTab === 'patterns' }"
            @click="activeRefTab = 'patterns'"
          >
            Паттерны
          </button>
          <button
            class="tab"
            :class="{ 'tab-active': activeRefTab === 'scenes' }"
            @click="activeRefTab = 'scenes'"
          >
            Сцены
          </button>
          <button
            class="tab"
            :class="{ 'tab-active': activeRefTab === 'narrative' }"
            @click="activeRefTab = 'narrative'"
          >
            Нарратив
          </button>
          <button
            class="tab"
            :class="{ 'tab-active': activeRefTab === 'visual' }"
            @click="activeRefTab = 'visual'"
          >
            Визуал
          </button>
          <button
            v-if="transcript"
            class="tab"
            :class="{ 'tab-active': activeRefTab === 'transcript' }"
            @click="activeRefTab = 'transcript'"
          >
            Транскрипт
          </button>
        </div>

        <!-- Patterns Tab -->
        <template v-if="activeRefTab === 'patterns'">
          <!-- Abstracted Patterns -->
          <div v-if="abstractedPatterns.length > 0" class="space-y-2">
            <h4 class="text-sm font-semibold flex items-center gap-2">
              <Icon name="mingcute:puzzle-line" class="text-primary" />
              Абстрагированные паттерны
            </h4>
            <div
              v-for="(p, i) in abstractedPatterns"
              :key="i"
              class="bg-base-200 rounded-lg p-3"
            >
              <div class="flex items-center gap-2 mb-1">
                <span class="badge badge-sm" :class="categoryColors[p.category] || 'badge-ghost'">
                  {{ p.category }}
                </span>
                <span class="font-medium text-sm">{{ p.name }}</span>
                <span class="text-xs text-base-content/40">{{ p.strength }}/100</span>
              </div>
              <p class="text-sm text-base-content/70">{{ p.abstractDescription }}</p>
              <p class="text-xs text-base-content/50 mt-1 italic">{{ p.applicationGuide }}</p>
            </div>
          </div>

          <!-- Originality Guide -->
          <div v-if="originalityGuide" class="space-y-2 mt-3">
            <h4 class="text-sm font-semibold flex items-center gap-2">
              <Icon name="mingcute:shield-line" class="text-warning" />
              Гайд оригинальности
              <span class="badge badge-sm badge-outline">
                Цель: {{ Math.round(originalityGuide.targetOriginalityScore * 100) }}%
              </span>
            </h4>

            <div v-if="originalityGuide.safeToReuse.length" class="bg-success/10 rounded-lg p-3">
              <p class="text-xs font-semibold text-success mb-1">Безопасно переиспользовать:</p>
              <ul class="text-sm space-y-0.5">
                <li v-for="(item, i) in originalityGuide.safeToReuse" :key="i" class="text-base-content/70">
                  {{ item }}
                </li>
              </ul>
            </div>

            <div v-if="originalityGuide.mustTransform.length" class="bg-error/10 rounded-lg p-3">
              <p class="text-xs font-semibold text-error mb-1">Нельзя копировать:</p>
              <ul class="text-sm space-y-0.5">
                <li v-for="(item, i) in originalityGuide.mustTransform" :key="i" class="text-base-content/70">
                  {{ item }}
                </li>
              </ul>
            </div>

            <div v-if="originalityGuide.transformationSuggestions.length" class="bg-info/10 rounded-lg p-3">
              <p class="text-xs font-semibold text-info mb-1">Рекомендации:</p>
              <ul class="text-sm space-y-0.5">
                <li v-for="(item, i) in originalityGuide.transformationSuggestions" :key="i" class="text-base-content/70">
                  {{ item }}
                </li>
              </ul>
            </div>
          </div>
        </template>

        <!-- Scenes Tab -->
        <template v-if="activeRefTab === 'scenes'">
          <div v-if="sceneTimeline.length > 0" class="space-y-2">
            <div
              v-for="scene in sceneTimeline"
              :key="scene.order"
              class="bg-base-200 rounded-lg p-3 text-sm"
            >
              <div class="flex items-center gap-2 mb-1">
                <span class="badge badge-xs badge-primary">{{ scene.order }}</span>
                <span class="text-xs text-base-content/50">{{ scene.startMarker }} — {{ scene.duration }}</span>
                <span class="badge badge-xs badge-ghost">{{ scene.emotionalTone }}</span>
              </div>
              <p class="text-base-content/80">{{ scene.action }}</p>
              <p class="text-xs text-base-content/50 mt-1">{{ scene.purpose }}</p>
              <p v-if="scene.onScreenText" class="text-xs mt-1 italic text-base-content/60">
                Текст: "{{ scene.onScreenText }}"
              </p>
              <p v-if="scene.cameraWork" class="text-xs text-base-content/40">
                Камера: {{ scene.cameraWork }}
              </p>
            </div>
          </div>
          <div v-else class="text-sm text-base-content/40 text-center py-4">
            Сцены не определены
          </div>
        </template>

        <!-- Narrative Tab -->
        <template v-if="activeRefTab === 'narrative' && narrativeMechanics">
          <div class="space-y-3">
            <div class="bg-base-200 rounded-lg p-3 space-y-2">
              <div class="flex items-center gap-2">
                <Icon name="mingcute:flash-line" class="text-warning" />
                <span class="font-semibold text-sm">Хук</span>
                <span class="badge badge-xs badge-outline">{{ narrativeMechanics.hookType }}</span>
              </div>
              <p class="text-sm text-base-content/70">{{ narrativeMechanics.hookDescription }}</p>
            </div>

            <div class="bg-base-200 rounded-lg p-3 space-y-2">
              <div class="flex items-center gap-2">
                <Icon name="mingcute:film-line" class="text-info" />
                <span class="font-semibold text-sm">Нарратив</span>
                <span class="badge badge-xs badge-outline">{{ narrativeMechanics.narrativeTemplate }}</span>
              </div>
              <p class="text-sm text-base-content/70">{{ narrativeMechanics.bodyMechanic }}</p>
            </div>

            <div v-if="narrativeMechanics.emotionalArc.length" class="bg-base-200 rounded-lg p-3">
              <p class="text-xs font-semibold mb-1">Эмоциональная дуга:</p>
              <div class="flex gap-1 flex-wrap">
                <span
                  v-for="(emotion, i) in narrativeMechanics.emotionalArc"
                  :key="i"
                  class="badge badge-sm badge-ghost"
                >
                  {{ emotion }}
                  <span v-if="i < narrativeMechanics.emotionalArc.length - 1" class="ml-1 text-base-content/30">&rarr;</span>
                </span>
              </div>
            </div>

            <div class="bg-base-200 rounded-lg p-3 space-y-1 text-sm">
              <p><strong>CTA:</strong> {{ narrativeMechanics.ctaMechanic }}</p>
              <p><strong>Ритм:</strong> {{ narrativeMechanics.pacing }}</p>
              <p v-if="narrativeMechanics.transformationArc">
                <strong>Трансформация:</strong> {{ narrativeMechanics.transformationArc }}
              </p>
            </div>
          </div>
        </template>

        <!-- Visual Tab -->
        <template v-if="activeRefTab === 'visual' && visualPatterns">
          <div class="space-y-3">
            <div class="bg-base-200 rounded-lg p-3 space-y-2">
              <div class="flex items-center gap-2 mb-2">
                <Icon name="mingcute:palette-line" class="text-secondary" />
                <span class="font-semibold text-sm">Визуальные паттерны</span>
                <span class="badge badge-xs badge-outline">{{ visualPatterns.aesthetic }}</span>
              </div>

              <!-- Color palette -->
              <div v-if="visualPatterns.colorPalette?.length" class="flex items-center gap-2">
                <span class="text-xs text-base-content/50">Палитра:</span>
                <div class="flex gap-1">
                  <div
                    v-for="(color, i) in visualPatterns.colorPalette"
                    :key="i"
                    class="w-6 h-6 rounded border border-base-300 tooltip"
                    :style="{ backgroundColor: color.startsWith('#') ? color : undefined }"
                    :data-tip="color"
                  />
                </div>
              </div>

              <div class="text-sm space-y-1">
                <p><strong>Свет:</strong> {{ visualPatterns.lighting }}</p>
                <p><strong>Камера:</strong> {{ visualPatterns.cameraStyle }}</p>
                <p><strong>Композиция:</strong> {{ visualPatterns.composition }}</p>
                <p v-if="visualPatterns.textOverlayStyle">
                  <strong>Текст:</strong> {{ visualPatterns.textOverlayStyle }}
                </p>
                <p v-if="visualPatterns.effects?.length">
                  <strong>Эффекты:</strong> {{ visualPatterns.effects.join(', ') }}
                </p>
              </div>
            </div>
          </div>
        </template>

        <!-- Transcript Tab -->
        <template v-if="activeRefTab === 'transcript' && transcript">
          <div class="space-y-2">
            <div class="flex items-center gap-2 text-sm">
              <span class="badge badge-sm badge-ghost">{{ transcript.source }}</span>
              <span v-if="transcript.language" class="badge badge-sm badge-outline">{{ transcript.language }}</span>
            </div>

            <!-- Timed segments -->
            <div v-if="transcript.segments?.length > 0" class="max-h-64 overflow-y-auto space-y-1">
              <div
                v-for="(seg, i) in transcript.segments"
                :key="i"
                class="flex gap-2 text-sm"
              >
                <span class="text-xs text-base-content/40 shrink-0 w-12 text-right font-mono">
                  {{ formatTime(seg.start) }}
                </span>
                <span class="text-base-content/70">{{ seg.text }}</span>
              </div>
            </div>

            <!-- Full text fallback -->
            <div v-else class="bg-base-200 rounded-lg p-3">
              <p class="text-sm text-base-content/70 whitespace-pre-wrap">
                {{ transcript.fullText }}
              </p>
            </div>
          </div>
        </template>
      </template>

      <!-- Empty state -->
      <div
        v-else-if="!referenceStatus || referenceStatus === 'none'"
        class="text-center py-6 text-base-content/40"
      >
        <Icon name="mingcute:search-line" class="text-3xl mb-2" />
        <p class="text-sm">Reference analysis не выполнен</p>
        <p class="text-xs mt-1">Нажмите "Анализ референса" для глубокого разбора</p>
      </div>
    </div>
  </div>
</template>
