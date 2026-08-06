<script setup lang="ts">
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

const tab = ref<'basic' | 'structured'>('basic')

const basicBlocks = computed(() => [
  { key: 'title', label: 'Заголовок', icon: 'mingcute:text-line', tone: 'text-accent', value: props.idea.title, boxed: true },
  { key: 'hook', label: 'Хук', icon: 'mingcute:flash-line', tone: 'text-warning', value: props.idea.hook, boxed: true },
  { key: 'body', label: 'Основная часть', icon: 'mingcute:text-line', tone: 'text-info', value: props.idea.body, boxed: false },
  { key: 'cta', label: 'Призыв к действию', icon: 'mingcute:horn-line', tone: 'text-success', value: props.idea.cta, boxed: false },
  { key: 'visual', label: 'Визуальный стиль', icon: 'mingcute:palette-line', tone: 'text-accent', value: props.idea.visualStyle, boxed: false },
  { key: 'viral', label: 'Почему залетело', icon: 'mingcute:fire-line', tone: 'text-danger', value: props.idea.whyViral, boxed: false },
].filter(b => b.value))

const hasBasicAnalysis = computed(() => basicBlocks.value.length > 0)
const hasStructuredAnalysis = computed(() => !!props.idea.analysis?.summary)

watch([hasBasicAnalysis, hasStructuredAnalysis], () => {
  if (!hasBasicAnalysis.value && hasStructuredAnalysis.value) tab.value = 'structured'
}, { immediate: true })

function section<T>(key: string): T | null {
  return (props.idea.analysis?.[key] as T | undefined) ?? null
}

const hookAnalysis = computed(() => section<{
  type: string
  description: string
  strength: number
  emotionalTrigger: string
  textOnScreen?: string
}>('hookAnalysis'))

const sceneStructure = computed(() => section<{
  estimatedDuration: string
  narrativeArc: string
  pacingNotes: string
  scenes: Array<{ order: number, name: string, description: string, estimatedDuration: string, purpose: string }>
}>('sceneStructure'))

const visualStyle = computed(() => section<{
  colorTone: string
  lighting: string
  cameraWork: string
  aesthetic: string
  textOverlays: boolean
  effects: string[]
}>('visualStyle'))

const viralityReasons = computed(() => section<{
  primaryReason: string
  targetAudience: string
  replicability: number
  replicabilityNotes: string
  factors: Array<{ factor: string, description: string, impact: string }>
}>('viralityReasons'))

const CHIP = 'rounded-sm border border-divider px-1.5 py-0.5 text-micro text-muted'

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
  <section class="rounded-lg border border-border bg-panel p-3.5">
    <div
      v-if="hasBasicAnalysis && hasStructuredAnalysis"
      role="tablist"
      class="mb-3 flex flex-wrap gap-0.5 border-b border-border"
    >
      <button
        v-for="t in [{ key: 'basic' as const, label: 'Базовый разбор' }, { key: 'structured' as const, label: 'Глубокий разбор' }]"
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

    <!-- Базовый разбор -->
    <div v-if="tab === 'basic' && hasBasicAnalysis" class="flex flex-col gap-3.5">
      <div v-for="b in basicBlocks" :key="b.key">
        <div class="mb-1.5 flex items-center gap-2">
          <Icon :name="b.icon" class="text-base" :class="b.tone" />
          <h3 class="text-sm font-medium">{{ b.label }}</h3>
        </div>
        <div class="text-sm whitespace-pre-wrap" :class="b.boxed && 'rounded-md bg-surface p-3'">
          {{ b.value }}
        </div>
      </div>
    </div>

    <!-- Глубокий разбор -->
    <div v-else-if="tab === 'structured' && hasStructuredAnalysis" class="flex flex-col gap-3.5">
      <div class="rounded-md bg-surface p-3">
        <p class="text-sm font-medium">{{ idea.analysis!.summary }}</p>
        <p v-if="idea.analysis!.confidence" class="tnum mt-1 font-mono text-micro text-subtle">
          уверенность {{ Math.round(Number(idea.analysis!.confidence) * 100) }}%
        </p>
      </div>

      <div v-if="hookAnalysis">
        <div class="mb-1.5 flex flex-wrap items-center gap-2">
          <Icon name="mingcute:flash-line" class="text-base text-warning" />
          <h3 class="text-sm font-medium">Хук</h3>
          <span :class="CHIP">{{ hookAnalysis.type }}</span>
          <span class="tnum font-mono text-micro text-subtle">сила {{ hookAnalysis.strength }}/100</span>
        </div>
        <p class="text-sm">{{ hookAnalysis.description }}</p>
        <UiKeyValue
          class="mt-1"
          label-width="140px"
          :items="[
            { label: 'Эмоция', value: hookAnalysis.emotionalTrigger, mono: false },
            { label: 'Текст на экране', value: hookAnalysis.textOnScreen, mono: false },
          ].filter(i => i.value)"
        />
      </div>

      <div v-if="sceneStructure">
        <div class="mb-1.5 flex flex-wrap items-center gap-2">
          <Icon name="mingcute:film-line" class="text-base text-info" />
          <h3 class="text-sm font-medium">Структура сцен</h3>
          <span class="tnum font-mono text-micro text-subtle">{{ sceneStructure.estimatedDuration }}</span>
          <span :class="CHIP">{{ sceneStructure.narrativeArc }}</span>
        </div>

        <div
          v-for="scene in sceneStructure.scenes"
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
            <p v-if="scene.purpose" class="text-micro text-subtle">{{ scene.purpose }}</p>
          </div>
        </div>

        <p v-if="sceneStructure.pacingNotes" class="mt-1 text-micro text-subtle italic">
          {{ sceneStructure.pacingNotes }}
        </p>
      </div>

      <div v-if="visualStyle">
        <div class="mb-1.5 flex flex-wrap items-center gap-2">
          <Icon name="mingcute:palette-line" class="text-base text-accent" />
          <h3 class="text-sm font-medium">Визуальный стиль</h3>
          <span :class="CHIP">{{ visualStyle.aesthetic }}</span>
        </div>
        <UiKeyValue
          label-width="140px"
          :items="[
            { label: 'Цвет', value: visualStyle.colorTone, mono: false },
            { label: 'Свет', value: visualStyle.lighting, mono: false },
            { label: 'Камера', value: visualStyle.cameraWork, mono: false },
            { label: 'Эффекты', value: visualStyle.effects?.join(', '), mono: false },
          ].filter(i => i.value)"
        />
      </div>

      <div v-if="viralityReasons">
        <div class="mb-1.5 flex flex-wrap items-center gap-2">
          <Icon name="mingcute:fire-line" class="text-base text-danger" />
          <h3 class="text-sm font-medium">Причины вирусности</h3>
          <span class="tnum font-mono text-micro text-subtle">
            повторяемость {{ viralityReasons.replicability }}/100
          </span>
        </div>
        <p class="text-sm">{{ viralityReasons.primaryReason }}</p>

        <div
          v-for="(f, i) in viralityReasons.factors ?? []"
          :key="i"
          class="flex items-start gap-2 border-b border-divider py-1.5 last:border-b-0"
        >
          <span
            class="mt-0.5 shrink-0 rounded-sm border px-1.5 py-0.5 text-micro"
            :class="IMPACT_TONE[f.impact] ?? 'border-divider text-muted'"
          >
            {{ IMPACT_LABEL[f.impact] ?? f.impact }}
          </span>
          <div class="min-w-0">
            <p class="text-sm font-medium">{{ f.factor }}</p>
            <p class="text-sm text-muted">{{ f.description }}</p>
          </div>
        </div>

        <UiKeyValue
          class="mt-1"
          label-width="140px"
          :items="[{ label: 'Аудитория', value: viralityReasons.targetAudience, mono: false }]"
        />
        <p v-if="viralityReasons.replicabilityNotes" class="text-sm text-muted italic">
          {{ viralityReasons.replicabilityNotes }}
        </p>
      </div>
    </div>

    <div
      v-else-if="idea.analysisStatus === 'running'"
      class="flex items-center gap-2 py-4 text-sm text-muted"
    >
      <Icon name="mingcute:loading-line" class="animate-spin" />
      Разбор выполняется
    </div>

    <UiEmptyState
      v-else
      title="Разбора пока нет"
      description="Модель ещё не разобрала идею — или разбор не запускался."
    />
  </section>
</template>
