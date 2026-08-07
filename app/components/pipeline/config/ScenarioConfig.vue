<script setup lang="ts">
import type { ScenarioConfigSectionStatus } from '~~/shared/types/scenario'

const props = defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()

const countOptions = [1, 3, 5].map(n => ({ value: n, label: String(n) }))
const modeOptions = [
  { value: 'auto', label: 'Авто' },
  { value: 'story_driven', label: 'Сторителлинг' },
  { value: 'simple', label: 'Быстрая' },
]

const budgetOptions = [
  { value: 'minimal', label: 'Минимум — 3 сцены по 3–4 с (≈ $1 за видео)' },
  { value: 'auto', label: 'Авто — 3–5 сцен по 3–6 с (≈ $2 за видео)' },
  { value: 'detailed', label: 'Проработанный — 4–5 сцен по 4–7 с (≈ $2.5–3.5)' },
  { value: 'cinematic', label: 'Кинематографичный — 5–6 сцен по 6–9 с (≈ $4–5)' },
  { value: 'longform', label: 'Длинный — 9 сцен по 8–10 с (72–90 секунд)' },
]

const editorOpen = ref(false)

const selectedStyles = computed<string[]>(() => {
  return Array.isArray(props.config.hookStyles) ? props.config.hookStyles : []
})

const maxTrends = computed(() => Math.max(1, Number(props.config.maxTrends) || 1))

// ─── Section status badges ────────────────────────────

function sectionStatus(section: string): ScenarioConfigSectionStatus {
  const s = props.config[section]
  if (!s || typeof s !== 'object') return 'empty'

  if (section === 'storytelling') {
    if (!s.enabled) return 'empty'
    const hasCustom = s.protagonistMode !== 'auto'
      || s.sceneCountStrategy !== 'auto'
      || s.transformationArcTemplate
      || (s.emotionalProgression?.length > 0)
      || (s.negativeRules?.length > 0)
    return hasCustom ? 'ready' : 'partial'
  }

  if (section === 'subtitles') {
    return s.enabled ? 'ready' : 'empty'
  }

  if (section === 'app') {
    if (!s.appId && !s.manualOverrideSummary) return 'empty'
    return s.appId ? 'ready' : 'partial'
  }

  if (section === 'voiceover') {
    return s.enabled ? 'ready' : 'empty'
  }

  return 'empty'
}

const STATUS_META: Record<ScenarioConfigSectionStatus, { label: string, tone: string }> = {
  ready: { label: 'Готово', tone: 'border-success-border bg-success-bg text-success' },
  partial: { label: 'Частично', tone: 'border-warning-border bg-warning-bg text-warning' },
  empty: { label: 'Не настроено', tone: 'border-neutral-border bg-neutral-bg text-neutral' },
}

const sections = [
  { key: 'storytelling', label: 'Сценарий', icon: 'mingcute:movie-line' },
  { key: 'subtitles', label: 'Субтитры', icon: 'mingcute:text-line' },
  { key: 'app', label: 'Приложение', icon: 'mingcute:apps-line' },
  { key: 'voiceover', label: 'Озвучка', icon: 'mingcute:voice-line' },
]

// ─── Editor save handler ──────────────────────────────

function onEditorSave(newConfig: Record<string, any>) {
  // Emit each top-level key as a separate update to maintain compatibility
  for (const [key, value] of Object.entries(newConfig)) {
    emit('update', key, value)
  }
  editorOpen.value = false
}
</script>

<template>
  <UiField label="Количество вариантов">
    <UiSelect
      :model-value="config.variantsCount || 3"
      :options="countOptions"
      @update:model-value="(v) => emit('update', 'variantsCount', Number(v))"
    />
    <SharedFieldHint text="Сколько вариантов сценария сгенерировать. Больше вариантов — больше выбор, но дольше генерация." />
  </UiField>

  <UiField label="Режим генерации">
    <UiSelect
      :model-value="config.generationMode || 'auto'"
      :options="modeOptions"
      @update:model-value="(v) => emit('update', 'generationMode', v)"
    />
    <SharedFieldHint text="Авто — система выбирает режим. Сторителлинг — полноценная история. Быстрая — без StoryPlan." />
  </UiField>

  <UiField label="Стили хуков">
    <SharedTaxonomyPicker
      type="hook_style"
      :model-value="selectedStyles"
      multiple
      @update:model-value="(v) => emit('update', 'hookStyles', v)"
    />
    <SharedFieldHint text="Как захватить внимание зрителя в первые секунды. Выберите один или несколько стилей." />
  </UiField>

  <!-- Бюджет сценария — главный рычаг расхода -->
  <UiField label="Бюджет сценария">
    <UiSelect
      :model-value="config.storytelling?.sceneCountStrategy || 'auto'"
      :options="budgetOptions"
      @update:model-value="(v) => emit('update', 'storytelling', { ...(config.storytelling ?? {}), sceneCountStrategy: v })"
    />
    <SharedFieldHint text="Жёсткий лимит на количество сцен и их длительность. Планировщик сцен обрежет хвост при превышении, длительность каждой сцены зажимается в диапазон. Единственный способ гарантированно ограничить стоимость видео на этапе сценария." />
  </UiField>

  <!-- Лимит трендов -->
  <UiField label="Лимит трендов">
    <div class="flex items-center gap-2">
      <UiInput
        type="number"
        min="1"
        max="50"
        placeholder="1"
        class="w-20"
        :model-value="maxTrends"
        @update:model-value="(v) => emit('update', 'maxTrends', Math.max(1, Math.min(50, Number(v) || 1)))"
      />
      <span class="text-sm text-muted">сколько трендов в один запуск</span>
    </div>
    <SharedFieldHint text="По умолчанию 1: сценарий генерируется по первому подходящему тренду из потока. Каждый дополнительный тренд — плюс N вариантов сценария и линейный рост AI-расхода." />
    <p
      v-if="maxTrends > 1"
      class="mt-1 flex items-start gap-1.5 rounded-md border border-info-border bg-info-bg px-2 py-1 text-micro text-muted"
    >
      <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
      <span>Будет обработано до {{ maxTrends }} трендов — до {{ maxTrends * (config.variantsCount || 3) }} вариантов сценария.</span>
    </p>
  </UiField>

  <!-- Лучшие практики: избранные промты как ориентир для AI -->
  <UiField label="Лучшие практики">
    <PipelineConfigFavoritePromptsPicker
      :app-id="config.app?.appId ?? null"
      :auto-select="config.favoritePrompts?.autoSelect ?? false"
      :selected-ids="config.favoritePrompts?.manualIds ?? []"
      @update:auto-select="(v) => emit('update', 'favoritePrompts', { ...(config.favoritePrompts ?? {}), autoSelect: v })"
      @update:selected-ids="(v) => emit('update', 'favoritePrompts', { ...(config.favoritePrompts ?? {}), manualIds: v })"
    />
    <SharedFieldHint text="AI будет использовать выбранные промты как вдохновение, не копируя их. Отфильтровано по приложению ноды." />
  </UiField>

  <!-- Сводка и переход в расширенную настройку -->
  <div class="flex flex-col gap-2 rounded-md border border-border p-2.5">
    <div class="flex items-center justify-between gap-2">
      <span class="flex items-center gap-1 font-semibold text-muted">
        <Icon name="mingcute:settings-3-line" />
        Расширенная настройка
      </span>
      <UiButton variant="primary" @click="editorOpen = true">
        <Icon name="mingcute:edit-2-line" />
        Настроить
      </UiButton>
    </div>

    <div class="flex flex-wrap gap-x-3 gap-y-1.5">
      <div
        v-for="sec in sections"
        :key="sec.key"
        class="flex items-center gap-1 text-micro text-muted"
      >
        <Icon :name="sec.icon" />
        <span>{{ sec.label }}</span>
        <span
          class="inline-flex h-[18px] items-center rounded-sm border px-1.5 text-micro"
          :class="STATUS_META[sectionStatus(sec.key)].tone"
        >{{ STATUS_META[sectionStatus(sec.key)].label }}</span>
      </div>
    </div>

    <div
      v-if="config.app?.appId || config.storytelling?.enabled"
      class="flex flex-col gap-0.5 text-micro text-subtle"
    >
      <div v-if="config.storytelling?.enabled">
        Сторителлинг: {{ config.storytelling.protagonistMode || 'auto' }} /
        {{ config.storytelling.sceneCountStrategy || 'auto' }}
      </div>
      <div v-if="config.app?.appId">
        Приложение: #{{ config.app.appId }} ({{ config.app.contextMode || 'full' }})
      </div>
      <div v-if="config.voiceover?.enabled">
        Озвучка: {{ config.voiceover.pacing || 'moderate' }}
      </div>
    </div>
  </div>

  <PipelineConfigScenarioConfigEditor
    :open="editorOpen"
    :config="config"
    @close="editorOpen = false"
    @save="onEditorSave"
  />
</template>
