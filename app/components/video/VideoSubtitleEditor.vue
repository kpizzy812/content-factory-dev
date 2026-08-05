<script setup lang="ts">
/**
 * Редактирование субтитров на уже собранном видео.
 *
 * Источник истины wordsPerLine — Video.subtitlesStyle (через prop videoSubtitlesStyle).
 * Рекомендация сценария — storyPlan.subtitleStyle (через variant). Editor показывает
 * badge источника и кнопку сброса к рекомендации.
 *
 * Save → POST /api/videos/[id]/edit-subtitles → пересобирает assembly без перегенерации
 * клипов (5-10 сек, бесплатно).
 */

import {
  SUBTITLE_WORDS_PER_LINE_DEFAULT,
  SUBTITLE_WORDS_PER_LINE_MAX,
  SUBTITLE_WORDS_PER_LINE_MIN,
} from '~~/shared/types/story'

interface SceneSub {
  order: number
  subtitleCopy: string
  position: 'top' | 'center' | 'bottom'
  alignment: 'left' | 'center' | 'right'
}

interface SubtitleStyleSnapshot {
  typography?: {
    wordsPerLine?: number
    maxLines?: number
    casing?: string
  }
}

interface VariantSnapshot {
  storyPlan?: unknown
}

interface ParsedStoryPlan {
  scenes?: Array<{
    order: number
    subtitleCopy?: string
    subtitlePlacement?: { position?: string; alignment?: string }
  }>
  subtitleStyle?: SubtitleStyleSnapshot
}

const props = defineProps<{
  videoId: number
  /** ScenarioVariant payload — storyPlan приходит из БД как JsonValue, парсим лениво. */
  variant: VariantSnapshot | null
  /** Live-значение из Video.subtitlesStyle — главный источник для редактора. */
  videoSubtitlesStyle?: SubtitleStyleSnapshot | Record<string, unknown> | null
  currentPreset?: string | null
}>()

// Парс JsonValue → структурированный StoryPlan-shaped объект.
// Возвращаем null если структура не подходит (legacy variants без storyPlan).
const parsedStoryPlan = computed<ParsedStoryPlan | null>(() => {
  const sp = props.variant?.storyPlan
  if (!sp || typeof sp !== 'object' || Array.isArray(sp)) return null
  return sp as ParsedStoryPlan
})

const parsedVideoStyle = computed<SubtitleStyleSnapshot | null>(() => {
  const v = props.videoSubtitlesStyle
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  return v as SubtitleStyleSnapshot
})

const emit = defineEmits<{
  saved: []
}>()

type EditorTab = 'style' | 'scenes'
const activeTab = ref<EditorTab>('style')

const WORDS_PER_LINE_OPTIONS = [
  { value: 3, label: '3 слова' },
  { value: 4, label: '4 слова · стандарт TikTok' },
  { value: 5, label: '5 слов' },
  { value: 6, label: '6 слов' },
]

const MAX_LINES_OPTIONS = [
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
]

const CASING_OPTIONS = [
  { value: 'sentence', label: 'Как в предложении' },
  { value: 'uppercase', label: 'ВЕРХНИЙ РЕГИСТР' },
  { value: 'lowercase', label: 'нижний регистр' },
  { value: 'mixed', label: 'Смешанный' },
]

const POSITION_OPTIONS = [
  { value: 'top', label: 'Сверху' },
  { value: 'center', label: 'По центру' },
  { value: 'bottom', label: 'Снизу' },
]

const ALIGNMENT_OPTIONS = [
  { value: 'left', label: 'Слева' },
  { value: 'center', label: 'Центр' },
  { value: 'right', label: 'Справа' },
]

function clampWords(value: number | undefined | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return SUBTITLE_WORDS_PER_LINE_DEFAULT
  return Math.max(
    SUBTITLE_WORDS_PER_LINE_MIN,
    Math.min(SUBTITLE_WORDS_PER_LINE_MAX, Math.round(value)),
  )
}

const storyPlanWordsPerLine = computed(() => clampWords(
  parsedStoryPlan.value?.subtitleStyle?.typography?.wordsPerLine,
))

const storyPlanMaxLines = computed(() =>
  parsedStoryPlan.value?.subtitleStyle?.typography?.maxLines ?? 2,
)

const storyPlanCasing = computed(() =>
  (parsedStoryPlan.value?.subtitleStyle?.typography?.casing as 'sentence' | 'uppercase' | 'lowercase' | 'mixed' | undefined) ?? 'sentence',
)

// Initial values: Video.subtitlesStyle первым (актуальное состояние), storyPlan как fallback.
const scenes = ref<SceneSub[]>([])
const preset = ref<string>(props.currentPreset || 'classic')
const wordsPerLine = ref(clampWords(
  parsedVideoStyle.value?.typography?.wordsPerLine
    ?? parsedStoryPlan.value?.subtitleStyle?.typography?.wordsPerLine,
))
const maxLines = ref(
  parsedVideoStyle.value?.typography?.maxLines
    ?? parsedStoryPlan.value?.subtitleStyle?.typography?.maxLines
    ?? 2,
)
const casing = ref<'sentence' | 'uppercase' | 'lowercase' | 'mixed'>(
  (parsedVideoStyle.value?.typography?.casing
    ?? parsedStoryPlan.value?.subtitleStyle?.typography?.casing
    ?? 'sentence') as 'sentence' | 'uppercase' | 'lowercase' | 'mixed',
)
const isSaving = ref(false)
const message = ref<{ type: 'success' | 'error'; text: string } | null>(null)

// Источник текущего значения wordsPerLine: matches storyPlan → "из сценария",
// иначе → "изменено вручную". Полезно оператору понимать состояние.
const wordsPerLineSource = computed<'plan' | 'manual'>(() =>
  wordsPerLine.value === storyPlanWordsPerLine.value ? 'plan' : 'manual',
)

watch(
  parsedStoryPlan,
  (plan) => {
    const planScenes = plan?.scenes ?? []
    scenes.value = planScenes.map((s) => ({
      order: s.order,
      subtitleCopy: s.subtitleCopy ?? '',
      position: (['top', 'center', 'bottom'].includes(s.subtitlePlacement?.position ?? '')
        ? s.subtitlePlacement!.position
        : 'bottom') as 'top' | 'center' | 'bottom',
      alignment: (['left', 'center', 'right'].includes(s.subtitlePlacement?.alignment ?? '')
        ? s.subtitlePlacement!.alignment
        : 'center') as 'left' | 'center' | 'right',
    }))
  },
  { immediate: true, deep: true },
)

watch(() => props.currentPreset, (p) => {
  if (p) preset.value = p
})

// Live update: если внешний компонент обновил Video.subtitlesStyle (после save+refresh),
// подтянуть в editor — иначе оператор видит stale-состояние пока не перезагрузит страницу.
watch(parsedVideoStyle, (next) => {
  if (!next?.typography) return
  if (typeof next.typography.wordsPerLine === 'number') {
    wordsPerLine.value = clampWords(next.typography.wordsPerLine)
  }
  if (typeof next.typography.maxLines === 'number') {
    maxLines.value = next.typography.maxLines
  }
  if (next.typography.casing) {
    casing.value = next.typography.casing as typeof casing.value
  }
}, { deep: true })

function resetToStoryPlan() {
  wordsPerLine.value = storyPlanWordsPerLine.value
  maxLines.value = storyPlanMaxLines.value
  casing.value = storyPlanCasing.value
}

async function save() {
  isSaving.value = true
  message.value = null
  try {
    await $fetch(`/api/videos/${props.videoId}/edit-subtitles`, {
      method: 'POST',
      body: {
        subtitlePreset: preset.value,
        subtitleStyle: {
          typography: {
            wordsPerLine: clampWords(wordsPerLine.value),
            maxLines: Number(maxLines.value) || 2,
            casing: casing.value,
          },
        },
        scenes: scenes.value.map((s) => ({
          order: s.order,
          subtitleCopy: s.subtitleCopy,
          subtitlePlacement: {
            position: s.position,
            alignment: s.alignment,
            avoidZones: [],
          },
        })),
      },
    })
    message.value = { type: 'success', text: 'Видео пересобирается. Через 5-15 секунд обновите страницу.' }
    emit('saved')
  }
  catch (e) {
    const msg = e instanceof Error ? e.message : 'Ошибка обновления'
    message.value = { type: 'error', text: msg }
  }
  finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <p class="text-sm text-muted">
      Правка меняет только субтитры: клипы и звук переиспользуются, пересборка бесплатна и
      занимает 5–15 секунд.
    </p>

    <div role="tablist" class="flex gap-0.5 border-b border-divider">
      <button
        v-for="t in [{ key: 'style', label: 'Стиль' }, { key: 'scenes', label: 'Текст по сценам' }]"
        :key="t.key"
        type="button"
        role="tab"
        :aria-selected="activeTab === t.key"
        class="flex h-8 cursor-pointer items-center border-b-2 px-2.5 text-sm"
        :class="activeTab === t.key ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg'"
        @click="activeTab = t.key as EditorTab"
      >
        {{ t.label }}
      </button>
    </div>

    <template v-if="activeTab === 'style'">
      <UiField label="Пресет">
        <VideoSubtitlePresetPicker v-model="preset" />
      </UiField>

      <div class="grid gap-2 sm:grid-cols-3">
        <UiField
          label="Слов в строке"
          :hint="wordsPerLineSource === 'plan'
            ? `Как рекомендует сценарий: ${storyPlanWordsPerLine}`
            : `Изменено вручную, в сценарии ${storyPlanWordsPerLine}`"
        >
          <UiSelect
            :model-value="wordsPerLine"
            :options="WORDS_PER_LINE_OPTIONS"
            @update:model-value="wordsPerLine = Number($event)"
          />
          <UiButton
            v-if="wordsPerLineSource === 'manual'"
            variant="ghost"
            class="mt-1"
            @click="resetToStoryPlan"
          >
            <Icon name="mingcute:refresh-1-line" />
            Вернуть рекомендацию
          </UiButton>
        </UiField>

        <UiField label="Строк максимум">
          <UiSelect
            :model-value="maxLines"
            :options="MAX_LINES_OPTIONS"
            @update:model-value="maxLines = Number($event)"
          />
        </UiField>

        <UiField label="Регистр">
          <UiSelect v-model="casing" :options="CASING_OPTIONS" />
        </UiField>
      </div>
    </template>

    <template v-else>
      <div v-if="scenes.length" class="flex flex-col gap-2">
        <article
          v-for="scene in scenes"
          :key="scene.order"
          class="flex flex-col gap-1.5 rounded-md border border-border bg-card p-2.5"
        >
          <div class="flex items-center gap-2">
            <span class="font-mono text-micro text-subtle">сцена {{ scene.order }}</span>
            <span class="flex-1" />
            <UiSelect v-model="scene.position" :options="POSITION_OPTIONS" class="w-32" />
            <UiSelect v-model="scene.alignment" :options="ALIGNMENT_OPTIONS" class="w-28" />
          </div>
          <UiTextarea v-model="scene.subtitleCopy" :rows="2" placeholder="Текст субтитра" />
        </article>
      </div>

      <UiEmptyState
        v-else
        icon="mingcute:text-line"
        title="Разбивки по сценам нет"
        description="У сценария нет плана со сценами, поэтому править текст можно только целиком при перегенерации."
      />
    </template>

    <p
      v-if="message"
      class="rounded-md border p-2.5 text-sm"
      :class="message.type === 'success'
        ? 'border-success-border bg-success-bg text-success'
        : 'border-danger-border bg-danger-bg text-danger'"
    >
      {{ message.text }}
    </p>

    <UiButton variant="primary" :loading="isSaving" @click="save">
      Применить и пересобрать
    </UiButton>
  </div>
</template>
