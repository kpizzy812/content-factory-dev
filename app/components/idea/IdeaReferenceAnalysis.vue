<script setup lang="ts">
import type { ReferenceProgress } from '~~/shared/types/reference'

const props = defineProps<{
  referenceBreakdown: Record<string, unknown> | null
  referenceStatus: string | null
  analysisProgress?: ReferenceProgress | null
}>()

const tab = ref<'patterns' | 'scenes' | 'narrative' | 'visual' | 'transcript'>('patterns')

const breakdown = computed(() => props.referenceBreakdown)

function part<T>(key: string): T | null {
  return (breakdown.value?.[key] as T | undefined) ?? null
}

const abstractedPatterns = computed(() => part<Array<{
  name: string
  category: string
  abstractDescription: string
  applicationGuide: string
  strength: number
}>>('abstractedPatterns') ?? [])

const sceneTimeline = computed(() => part<Array<{
  order: number
  startMarker: string
  duration: string
  action: string
  purpose: string
  onScreenText: string | null
  visualCues: string
  emotionalTone: string
  cameraWork: string | null
}>>('sceneTimeline') ?? [])

const narrativeMechanics = computed(() => part<{
  hookType: string
  hookDescription: string
  bodyMechanic: string
  ctaMechanic: string
  emotionalArc: string[]
  pacing: string
  narrativeTemplate: string
  transformationArc: string | null
}>('narrativeMechanics'))

const visualPatterns = computed(() => part<{
  colorPalette: string[]
  lighting: string
  cameraStyle: string
  composition: string
  textOverlayStyle: string | null
  aesthetic: string
  effects: string[]
}>('visualPatterns'))

const originalityGuide = computed(() => part<{
  safeToReuse: string[]
  mustTransform: string[]
  requireOriginal: string[]
  transformationSuggestions: string[]
  targetOriginalityScore: number
}>('originalityGuide'))

const transcript = computed(() => part<{
  fullText: string
  segments: Array<{ start: number, duration: number, text: string }>
  source: string
  language: string | null
}>('transcript'))

const dataAvailability = computed(() => part<{
  hasTranscript: boolean
  hasTimedSegments: boolean
  hasThumbnail: boolean
  hasDescription: boolean
  metadataRichness: string
}>('dataAvailability'))

const tabs = computed(() => {
  const list = [
    { key: 'patterns' as const, label: 'Паттерны' },
    { key: 'scenes' as const, label: 'Сцены' },
    { key: 'narrative' as const, label: 'Нарратив' },
    { key: 'visual' as const, label: 'Визуал' },
  ]
  if (transcript.value) list.push({ key: 'transcript' as const, label: 'Транскрипт' })
  return list
})

const RICHNESS_LABELS: Record<string, string> = {
  rich: 'данных много',
  moderate: 'данных средне',
  poor: 'данных мало',
}

const CHIP = 'rounded-sm border border-divider px-1.5 py-0.5 text-micro text-muted'

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
</script>

<template>
  <section class="rounded-lg border border-border bg-panel p-3.5">
    <div v-if="referenceStatus === 'running'">
      <IdeaReferenceProgress :progress="analysisProgress ?? null" />
    </div>

    <div
      v-else-if="referenceStatus === 'failed'"
      role="alert"
      class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
      <span>Разбор референса упал.</span>
    </div>

    <template v-else-if="breakdown">
      <div class="mb-3 flex flex-wrap items-center gap-1.5">
        <span class="tnum font-mono text-micro text-subtle">
          уверенность {{ Math.round(Number(breakdown.confidence ?? 0) * 100) }}%
        </span>
        <span v-if="dataAvailability" :class="CHIP">
          {{ RICHNESS_LABELS[dataAvailability.metadataRichness] ?? dataAvailability.metadataRichness }}
        </span>
        <span
          v-if="dataAvailability?.hasTranscript"
          class="rounded-sm border border-success-border bg-success-bg px-1.5 py-0.5 text-micro text-success"
        >
          есть транскрипт
        </span>
        <span v-if="breakdown.mediaType" :class="CHIP">
          {{ breakdown.mediaType === 'video' ? 'видео' : breakdown.mediaType === 'image' ? 'изображение' : 'тип неизвестен' }}
        </span>
      </div>

      <div role="tablist" class="mb-3 flex flex-wrap gap-0.5 border-b border-border">
        <button
          v-for="t in tabs"
          :key="t.key"
          type="button"
          role="tab"
          :aria-selected="tab === t.key"
          class="h-[30px] cursor-pointer border-b-2 px-2.5 text-sm"
          :class="tab === t.key ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg'"
          @click="tab = t.key"
        >
          {{ t.label }}
        </button>
      </div>

      <!-- Паттерны -->
      <div v-if="tab === 'patterns'" class="flex flex-col gap-3">
        <div v-if="abstractedPatterns.length">
          <h3 class="mb-1.5 flex items-center gap-2 text-sm font-medium">
            <Icon name="mingcute:puzzled-line" class="text-accent" />
            Абстрагированные паттерны
          </h3>
          <div
            v-for="(p, i) in abstractedPatterns"
            :key="i"
            class="border-b border-divider py-1.5 last:border-b-0"
          >
            <div class="flex flex-wrap items-center gap-2">
              <span :class="CHIP">{{ p.category }}</span>
              <span class="text-sm font-medium">{{ p.name }}</span>
              <span class="tnum font-mono text-micro text-subtle">{{ p.strength }}/100</span>
            </div>
            <p class="text-sm text-muted">{{ p.abstractDescription }}</p>
            <p class="text-micro text-subtle italic">{{ p.applicationGuide }}</p>
          </div>
        </div>

        <div v-if="originalityGuide" class="flex flex-col gap-2">
          <h3 class="flex flex-wrap items-center gap-2 text-sm font-medium">
            <Icon name="mingcute:shield-line" class="text-warning" />
            Гайд оригинальности
            <span class="tnum font-mono text-micro text-subtle">
              цель {{ Math.round(originalityGuide.targetOriginalityScore * 100) }}%
            </span>
          </h3>

          <div
            v-if="originalityGuide.safeToReuse.length"
            class="rounded-md border border-success-border bg-success-bg p-2.5"
          >
            <p class="mb-1 text-micro font-medium text-success">Можно переиспользовать</p>
            <ul class="flex flex-col gap-0.5 text-sm">
              <li v-for="(item, i) in originalityGuide.safeToReuse" :key="i">{{ item }}</li>
            </ul>
          </div>

          <div
            v-if="originalityGuide.mustTransform.length"
            class="rounded-md border border-danger-border bg-danger-bg p-2.5"
          >
            <p class="mb-1 text-micro font-medium text-danger">Копировать нельзя</p>
            <ul class="flex flex-col gap-0.5 text-sm">
              <li v-for="(item, i) in originalityGuide.mustTransform" :key="i">{{ item }}</li>
            </ul>
          </div>

          <div
            v-if="originalityGuide.transformationSuggestions.length"
            class="rounded-md border border-info-border bg-info-bg p-2.5"
          >
            <p class="mb-1 text-micro font-medium text-info">Как переработать</p>
            <ul class="flex flex-col gap-0.5 text-sm">
              <li v-for="(item, i) in originalityGuide.transformationSuggestions" :key="i">{{ item }}</li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Сцены -->
      <div v-else-if="tab === 'scenes'">
        <div v-if="sceneTimeline.length" class="flex flex-col">
          <div
            v-for="scene in sceneTimeline"
            :key="scene.order"
            class="flex gap-2.5 border-b border-divider py-2 last:border-b-0"
          >
            <span
              class="tnum mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border font-mono text-micro text-muted"
            >
              {{ scene.order }}
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="tnum font-mono text-micro text-subtle">
                  {{ scene.startMarker }} · {{ scene.duration }}
                </span>
                <span :class="CHIP">{{ scene.emotionalTone }}</span>
              </div>
              <p class="text-sm">{{ scene.action }}</p>
              <p class="text-micro text-subtle">{{ scene.purpose }}</p>
              <p v-if="scene.onScreenText" class="text-sm text-muted italic">«{{ scene.onScreenText }}»</p>
              <p v-if="scene.cameraWork" class="text-micro text-subtle">камера: {{ scene.cameraWork }}</p>
            </div>
          </div>
        </div>
        <p v-else class="text-sm text-subtle">Сцены не определены.</p>
      </div>

      <!-- Нарратив -->
      <div v-else-if="tab === 'narrative'" class="flex flex-col gap-3">
        <template v-if="narrativeMechanics">
          <div>
            <div class="mb-1.5 flex flex-wrap items-center gap-2">
              <Icon name="mingcute:flash-line" class="text-warning" />
              <h3 class="text-sm font-medium">Хук</h3>
              <span :class="CHIP">{{ narrativeMechanics.hookType }}</span>
            </div>
            <p class="text-sm text-muted">{{ narrativeMechanics.hookDescription }}</p>
          </div>

          <div>
            <div class="mb-1.5 flex flex-wrap items-center gap-2">
              <Icon name="mingcute:film-line" class="text-info" />
              <h3 class="text-sm font-medium">Нарратив</h3>
              <span :class="CHIP">{{ narrativeMechanics.narrativeTemplate }}</span>
            </div>
            <p class="text-sm text-muted">{{ narrativeMechanics.bodyMechanic }}</p>
          </div>

          <div v-if="narrativeMechanics.emotionalArc?.length" class="flex flex-wrap items-center gap-1">
            <span class="mr-1 text-micro text-subtle">Эмоции</span>
            <template v-for="(emotion, i) in narrativeMechanics.emotionalArc" :key="i">
              <span :class="CHIP">{{ emotion }}</span>
              <Icon
                v-if="i < narrativeMechanics.emotionalArc.length - 1"
                name="mingcute:right-line"
                class="text-subtle"
              />
            </template>
          </div>

          <UiKeyValue
            label-width="140px"
            :items="[
              { label: 'Механика CTA', value: narrativeMechanics.ctaMechanic, mono: false },
              { label: 'Ритм', value: narrativeMechanics.pacing, mono: false },
              { label: 'Трансформация', value: narrativeMechanics.transformationArc, mono: false },
            ].filter(i => i.value)"
          />
        </template>
        <p v-else class="text-sm text-subtle">Нарратив не разобран.</p>
      </div>

      <!-- Визуал -->
      <div v-else-if="tab === 'visual'">
        <template v-if="visualPatterns">
          <div class="mb-1.5 flex flex-wrap items-center gap-2">
            <Icon name="mingcute:palette-line" class="text-accent" />
            <h3 class="text-sm font-medium">Визуальные паттерны</h3>
            <span :class="CHIP">{{ visualPatterns.aesthetic }}</span>
          </div>

          <div v-if="visualPatterns.colorPalette?.length" class="mb-2 flex items-center gap-2">
            <span class="text-micro text-subtle">Палитра</span>
            <div class="flex gap-1">
              <span
                v-for="(color, i) in visualPatterns.colorPalette"
                :key="i"
                class="size-6 rounded-sm border border-border"
                :style="{ backgroundColor: color.startsWith('#') ? color : undefined }"
                :title="color"
              />
            </div>
          </div>

          <UiKeyValue
            label-width="140px"
            :items="[
              { label: 'Свет', value: visualPatterns.lighting, mono: false },
              { label: 'Камера', value: visualPatterns.cameraStyle, mono: false },
              { label: 'Композиция', value: visualPatterns.composition, mono: false },
              { label: 'Текст на экране', value: visualPatterns.textOverlayStyle, mono: false },
              { label: 'Эффекты', value: visualPatterns.effects?.join(', '), mono: false },
            ].filter(i => i.value)"
          />
        </template>
        <p v-else class="text-sm text-subtle">Визуальные паттерны не разобраны.</p>
      </div>

      <!-- Транскрипт -->
      <div v-else-if="tab === 'transcript' && transcript" class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-1.5">
          <span :class="CHIP">{{ transcript.source }}</span>
          <span v-if="transcript.language" :class="CHIP">{{ transcript.language }}</span>
        </div>

        <div v-if="transcript.segments?.length" class="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
          <div v-for="(seg, i) in transcript.segments" :key="i" class="flex gap-2 text-sm">
            <span class="tnum w-12 shrink-0 text-right font-mono text-micro text-subtle">
              {{ formatTime(seg.start) }}
            </span>
            <span class="text-muted">{{ seg.text }}</span>
          </div>
        </div>

        <p v-else class="rounded-md bg-surface p-3 text-sm whitespace-pre-wrap text-muted">
          {{ transcript.fullText }}
        </p>
      </div>
    </template>

    <UiEmptyState
      v-else
      title="Референс не разобран"
      description="Разбор запускается действием «Разобрать референс» — он платный и идёт несколько минут."
    />
  </section>
</template>
