<script setup lang="ts">
import type { ScenarioConfigSectionStatus } from '~~/shared/types/scenario'

const props = defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()

const countOptions = [1, 3, 5]
const modeOptions = [
  { value: 'auto', label: 'Авто' },
  { value: 'story_driven', label: 'Сторителлинг' },
  { value: 'simple', label: 'Быстрая' },
]

const editorOpen = ref(false)

const selectedStyles = computed<string[]>(() => {
  return Array.isArray(props.config.hookStyles) ? props.config.hookStyles : []
})

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

function statusBadgeClass(status: ScenarioConfigSectionStatus): string {
  if (status === 'ready') return 'badge-success'
  if (status === 'partial') return 'badge-warning'
  return 'badge-ghost'
}

function statusLabel(status: ScenarioConfigSectionStatus): string {
  if (status === 'ready') return 'Готово'
  if (status === 'partial') return 'Частично'
  return 'Не настроено'
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
  <!-- Base fields (always visible) -->
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Количество вариантов</legend>
    <select
      class="select select-sm w-full"
      :value="config.variantsCount || 3"
      @change="emit('update', 'variantsCount', Number(($event.target as HTMLSelectElement).value))"
    >
      <option v-for="n in countOptions" :key="n" :value="n">{{ n }}</option>
    </select>
    <SharedFieldHint text="Сколько вариантов сценария сгенерировать. Больше вариантов = больше выбор, но дольше генерация." />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Режим генерации</legend>
    <select
      class="select select-sm w-full"
      :value="config.generationMode || 'auto'"
      @change="emit('update', 'generationMode', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="opt in modeOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
    </select>
    <SharedFieldHint text="Авто — система выбирает режим. Сторителлинг — полноценная история. Быстрая — без StoryPlan." />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Стили хуков</legend>
    <SharedTaxonomyPicker
      type="hook_style"
      :model-value="selectedStyles"
      multiple
      @update:model-value="(v) => emit('update', 'hookStyles', v)"
    />
    <SharedFieldHint text="Как захватить внимание зрителя в первые секунды. Выберите один или несколько стилей." />
  </fieldset>

  <!-- Budget / scene count strategy — главный рычаг расхода -->
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Бюджет сценария</legend>
    <select
      class="select select-sm w-full"
      :value="config.storytelling?.sceneCountStrategy || 'auto'"
      @change="emit('update', 'storytelling', { ...(config.storytelling ?? {}), sceneCountStrategy: ($event.target as HTMLSelectElement).value })"
    >
      <option value="minimal">Минимум — 3 сцены по 3-4с (≈ $1 за видео)</option>
      <option value="auto">Авто — 3-5 сцен по 3-6с (≈ $2 за видео)</option>
      <option value="detailed">Проработанный — 4-5 сцен по 4-7с (≈ $2.5-3.5)</option>
      <option value="cinematic">Кинематографичный — 5-6 сцен по 6-9с (≈ $4-5)</option>
    </select>
    <SharedFieldHint text="Жёсткий лимит на количество сцен и их длительность. Scene planner обрежет хвост если превысит, duration каждой сцены clamp'ится в диапазон. Единственный способ гарантированно ограничить стоимость видео на этапе сценария." />
  </fieldset>

  <!-- Max trends limiter -->
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Лимит трендов</legend>
    <div class="flex items-center gap-2">
      <input
        type="number"
        class="input input-sm w-20"
        min="1"
        max="50"
        placeholder="1"
        :value="Math.max(1, Number(config.maxTrends) || 1)"
        @input="emit('update', 'maxTrends', Math.max(1, Math.min(50, Number(($event.target as HTMLInputElement).value) || 1)))"
      />
      <span class="text-xs text-base-content/60">сколько трендов в один запуск</span>
    </div>
    <SharedFieldHint text="Дефолт 1: сценарий генерируется по первому подходящему тренду из потока. Каждый дополнительный тренд = +N вариантов сценария = линейный рост AI-расхода." />
    <div v-if="Math.max(1, Number(config.maxTrends) || 1) > 1" class="alert alert-info alert-soft text-[10px] py-1 mt-1">
      <Icon name="mingcute:information-line" class="text-xs" />
      <span>Будет обработано до {{ Math.max(1, Number(config.maxTrends) || 1) }} трендов = до {{ Math.max(1, Number(config.maxTrends) || 1) * (config.variantsCount || 3) }} вариантов сценария.</span>
    </div>
  </fieldset>

  <!-- Лучшие практики: избранные промты как ориентир для AI -->
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Лучшие практики</legend>
    <PipelineConfigFavoritePromptsPicker
      :app-id="config.app?.appId ?? null"
      :auto-select="config.favoritePrompts?.autoSelect ?? false"
      :selected-ids="config.favoritePrompts?.manualIds ?? []"
      @update:auto-select="(v) => emit('update', 'favoritePrompts', { ...(config.favoritePrompts ?? {}), autoSelect: v })"
      @update:selected-ids="(v) => emit('update', 'favoritePrompts', { ...(config.favoritePrompts ?? {}), manualIds: v })"
    />
    <SharedFieldHint text="AI будет использовать выбранные промты как вдохновение (не копируя их). Отфильтровано по приложению ноды." />
  </fieldset>

  <!-- Summary card + open editor -->
  <div class="border border-base-300 rounded-box p-2.5 mt-1 space-y-2">
    <div class="flex items-center justify-between">
      <span class="text-xs font-semibold text-base-content/70 flex items-center gap-1">
        <Icon name="mingcute:settings-3-line" class="text-sm" />
        Расширенная настройка
      </span>
      <button
        type="button"
        class="btn btn-primary btn-xs"
        @click="editorOpen = true"
      >
        <Icon name="mingcute:edit-2-line" class="text-[10px]" />
        Настроить
      </button>
    </div>

    <!-- Section status badges -->
    <div class="flex flex-wrap gap-1.5">
      <div
        v-for="sec in sections"
        :key="sec.key"
        class="flex items-center gap-1 text-[10px] text-base-content/60"
      >
        <Icon :name="sec.icon" class="text-xs" />
        <span>{{ sec.label }}</span>
        <span class="badge badge-xs" :class="statusBadgeClass(sectionStatus(sec.key))">
          {{ statusLabel(sectionStatus(sec.key)) }}
        </span>
      </div>
    </div>

    <!-- Quick summary of key choices -->
    <div v-if="config.app?.appId || config.storytelling?.enabled" class="text-[10px] text-base-content/40 space-y-0.5">
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

  <!-- Editor modal -->
  <PipelineConfigScenarioConfigEditor
    :open="editorOpen"
    :config="config"
    @close="editorOpen = false"
    @save="onEditorSave"
  />
</template>
