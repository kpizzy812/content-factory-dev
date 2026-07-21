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
  <div class="space-y-3">
    <p class="text-xs text-base-content/60">
      Редактирование меняет только субтитры — клипы и аудио переиспользуются. Пересборка
      бесплатна и занимает 5-15 секунд. После сохранения обновите страницу через 10-20 сек.
    </p>

    <!-- Tabs: Стиль / Текст по сценам -->
    <div role="tablist" class="tabs tabs-box tabs-sm">
      <button
        type="button"
        role="tab"
        class="tab"
        :class="{ 'tab-active': activeTab === 'style' }"
        @click="activeTab = 'style'"
      >
        <Icon name="mingcute:palette-line" class="text-xs mr-1" />
        Стиль
      </button>
      <button
        type="button"
        role="tab"
        class="tab"
        :class="{ 'tab-active': activeTab === 'scenes' }"
        @click="activeTab = 'scenes'"
      >
        <Icon name="mingcute:edit-line" class="text-xs mr-1" />
        Текст по сценам
      </button>
    </div>

    <!-- Tab: Стиль -->
    <div v-show="activeTab === 'style'" class="space-y-3">
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Стиль субтитров</legend>
        <VideoSubtitlePresetPicker v-model="preset" />
      </fieldset>

      <!-- Typography -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <fieldset class="fieldset">
        <legend class="fieldset-legend flex items-center gap-1.5">
          <span>Слов в строке</span>
          <span
            class="badge badge-xs"
            :class="wordsPerLineSource === 'plan' ? 'badge-ghost' : 'badge-warning badge-soft'"
            :title="wordsPerLineSource === 'plan'
              ? 'Значение из рекомендации сценария'
              : 'Значение изменено вручную'"
          >
            {{ wordsPerLineSource === 'plan' ? `Из сценария: ${storyPlanWordsPerLine}` : 'Изменено вручную' }}
          </span>
        </legend>
        <select v-model.number="wordsPerLine" class="select select-sm w-full">
          <option :value="3">3 слова</option>
          <option :value="4">4 слова (TikTok стандарт)</option>
          <option :value="5">5 слов</option>
          <option :value="6">6 слов</option>
        </select>
        <button
          v-if="wordsPerLineSource === 'manual'"
          type="button"
          class="btn btn-ghost btn-xs mt-1 self-start"
          :title="`Вернуть к рекомендации сценария: ${storyPlanWordsPerLine}`"
          @click="resetToStoryPlan"
        >
          <Icon name="mingcute:refresh-1-line" />
          Сбросить к рекомендации
        </button>
      </fieldset>
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Макс. строк</legend>
        <select v-model.number="maxLines" class="select select-sm w-full">
          <option :value="1">1</option>
          <option :value="2">2</option>
          <option :value="3">3</option>
        </select>
      </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Регистр</legend>
          <select v-model="casing" class="select select-sm w-full">
            <option value="sentence">Sentence case</option>
            <option value="uppercase">UPPERCASE</option>
            <option value="lowercase">lowercase</option>
            <option value="mixed">Mixed</option>
          </select>
        </fieldset>
      </div>
    </div>

    <!-- Tab: Текст по сценам -->
    <div v-show="activeTab === 'scenes'" class="space-y-2">
      <div v-if="scenes.length > 0" class="space-y-2">
      <div class="text-xs font-semibold text-base-content/70">Текст и позиция по сценам</div>
      <div
        v-for="scene in scenes"
        :key="scene.order"
        class="border border-base-300 rounded-box p-2.5 space-y-1.5"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="badge badge-ghost badge-sm">Сцена {{ scene.order }}</span>
          <div class="flex gap-1">
            <select v-model="scene.position" class="select select-xs">
              <option value="top">Сверху</option>
              <option value="center">По центру</option>
              <option value="bottom">Снизу</option>
            </select>
            <select v-model="scene.alignment" class="select select-xs">
              <option value="left">Слева</option>
              <option value="center">Центр</option>
              <option value="right">Справа</option>
            </select>
          </div>
        </div>
        <textarea
          v-model="scene.subtitleCopy"
          class="textarea textarea-sm w-full text-xs"
          rows="2"
          placeholder="Текст субтитра для сцены"
        />
      </div>
    </div>
      <div v-else class="alert alert-warning alert-soft text-xs py-2">
        <Icon name="mingcute:warning-line" />
        <span>У сценария нет storyPlan со сценами — редактирование per-scene недоступно.</span>
      </div>
    </div>

    <!-- Status message -->
    <div
      v-if="message"
      class="alert alert-soft text-xs py-2"
      :class="message.type === 'success' ? 'alert-success' : 'alert-error'"
    >
      <Icon :name="message.type === 'success' ? 'mingcute:check-line' : 'mingcute:close-circle-line'" />
      <span>{{ message.text }}</span>
    </div>

    <!-- Save -->
    <button
      type="button"
      class="btn btn-primary btn-sm w-full"
      :disabled="isSaving"
      @click="save"
    >
      <span v-if="isSaving" class="loading loading-spinner loading-xs" />
      <Icon v-else name="mingcute:save-line" />
      Применить и пересобрать видео
    </button>
  </div>
</template>
