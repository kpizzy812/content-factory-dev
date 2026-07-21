<script setup lang="ts">
import type { VideoCostEstimateResponse, VideoModelInfo } from '~~/shared/types/video'

const props = defineProps<{
  config: Record<string, any>
  nodeId?: string
  pipelineId?: number
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()

// ─── Загрузка моделей ──────────────────────────────

const { data: modelsData } = await useFetch('/api/videos/models')

const imageModels = computed<VideoModelInfo[]>(() => modelsData.value?.image ?? [])
const videoModels = computed<VideoModelInfo[]>(() => modelsData.value?.video ?? [])
const ttsModels = computed<VideoModelInfo[]>(() => (modelsData.value as { tts?: VideoModelInfo[] } | null)?.tts ?? [])

// ─── Upstream scenario context ──────────────────────
// Если блок видео соединён с upstream scenario, его sceneCountStrategy - источник
// истины для sceneCount/perSceneDurations. Читаем СИНХРОННО из pipeline editor
// store, без сетевого запроса — изменения в Scenario блоке мгновенно отражаются
// в estimate цены без необходимости сохранять пайплайн в БД (старая реализация
// шла через `/api/pipelines/.../upstream-context` и кешировалась useFetch'ем,
// из-за чего пользователь видел устаревшую стоимость).

import { getExpectedScenePlan, normalizeSceneCountStrategy } from '~~/shared/utils/scene-budget'
import type { SceneCountStrategy } from '~~/shared/types/scenario'

interface UpstreamContext {
  hasUpstreamScenario: boolean
  scenarioNodeId?: string
  sceneCountStrategy?: SceneCountStrategy
  expectedSceneCount?: number
  expectedAvgDurationSec?: number
  expectedPerSceneDurations?: number[]
  expectedTotalSec?: string
}

const editorStore = usePipelineEditorStore()

/**
 * BFS назад по edges от текущего nodeId, ищем ближайший scenario-узел.
 * Возвращает scenario node или null.
 */
function findUpstreamScenarioNode(nodeId: string): { id: string; data?: { type?: string; config?: Record<string, any> } } | null {
  const edges = editorStore.edges as Array<{ source: string; target: string }>
  const nodes = editorStore.nodes as Array<{ id: string; data?: { type?: string; config?: Record<string, any> } }>
  if (!nodeId || nodes.length === 0) return null

  const upstreamIds = new Set<string>()
  const queue = [nodeId]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const e of edges) {
      if (e.target === current && !upstreamIds.has(e.source)) {
        upstreamIds.add(e.source)
        queue.push(e.source)
      }
    }
  }

  return nodes.find(n => upstreamIds.has(n.id) && n.data?.type === 'scenario') ?? null
}

const upstream = computed<UpstreamContext>(() => {
  if (!props.nodeId) return { hasUpstreamScenario: false }
  const scenarioNode = findUpstreamScenarioNode(props.nodeId)
  if (!scenarioNode) return { hasUpstreamScenario: false }

  const strategy = normalizeSceneCountStrategy(scenarioNode.data?.config?.storytelling?.sceneCountStrategy)
  const expected = getExpectedScenePlan(strategy)

  return {
    hasUpstreamScenario: true,
    scenarioNodeId: scenarioNode.id,
    sceneCountStrategy: strategy,
    expectedSceneCount: expected.sceneCount,
    expectedAvgDurationSec: expected.avgDurationSec,
    expectedPerSceneDurations: expected.perSceneDurations,
    expectedTotalSec: expected.totalSec,
  }
})
const isDrivenByScenario = computed(() => upstream.value.hasUpstreamScenario === true)

const strategyLabels: Record<string, string> = {
  minimal: 'Минимальный',
  auto: 'Авто',
  detailed: 'Проработанный',
  cinematic: 'Кинематографичный',
}

// ─── Эффективные значения (с учётом upstream) ──────
const effectiveSceneCount = computed(() => {
  if (isDrivenByScenario.value && upstream.value.expectedSceneCount) {
    return upstream.value.expectedSceneCount
  }
  return Number(props.config.sceneCount) || 3
})

const effectiveClipDuration = computed(() => {
  if (isDrivenByScenario.value && upstream.value.expectedAvgDurationSec) {
    return upstream.value.expectedAvgDurationSec
  }
  return Number(props.config.clipDuration) || 5
})

// ─── Локальные значения для cost computation ───────

const currentConfig = computed(() => ({
  imageModelId: props.config.imageModelId || 'fal-ai/flux/dev',
  videoModelId: props.config.videoModelId || 'fal-ai/kling-video/v3/standard/text-to-video',
  format: props.config.format || 'vertical',
  sceneCount: effectiveSceneCount.value,
  clipDuration: effectiveClipDuration.value,
  // Если сценарий известен - передаём точные per-scene durations, чтобы estimate
  // посчитал по каждой сцене отдельно (видно разбивку в breakdown).
  perSceneDurations: isDrivenByScenario.value ? upstream.value.expectedPerSceneDurations : undefined,
  generateAudio: props.config.generateAudio !== false,
  enableMusic: props.config.enableMusic !== false,
  quality: props.config.quality || '1080p',
  voiceoverEnabled: props.config.voiceoverEnabled === true,
  voiceoverModelId: props.config.voiceoverModelId || null,
  modelStrategy: props.config.modelStrategy || 'auto',
  lipSyncEnabled: props.config.lipSyncEnabled === true,
  lipSyncModelId: props.config.lipSyncModelId || null,
}))

// Lip-sync ($0.07/sec) — премиум-фича. Блокируем только в явно бюджетной
// стратегии fast_draft, чтобы не прокралось случайно в дешёвый пайплайн.
// При quality-пресете preset.config.lipSyncEnabled=true прилетит автоматом
// и чекбокс сразу станет включённым.
const lipSyncGated = computed(() => {
  const strat = props.config.modelStrategy || 'auto'
  return strat === 'fast_draft'
})

// ─── Voiceover UI state ──────────────────────────────

const voiceoverEnabled = computed(() => props.config.voiceoverEnabled === true)
const selectedTtsModel = computed(() =>
  ttsModels.value.find(m => m.id === (props.config.voiceoverModelId || ttsModels.value.find(x => x.integrated)?.id)),
)
const pacingOptions = [
  { value: 'slow', label: 'Медленно', hint: '~2 слов/сек' },
  { value: 'moderate', label: 'Средне', hint: '~2.8 слов/сек' },
  { value: 'fast', label: 'Быстро', hint: '~3.5 слов/сек' },
] as const
const reconciliationOptions = [
  { value: 'compress_audio', label: 'Ускорить (до 1.2x)', hint: 'Естественный звук, если озвучка длиннее сцены' },
  { value: 'trim_audio', label: 'Обрезать по сцене', hint: 'Честно обрезать vo до длины клипа' },
] as const
const languageOptions = [
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
] as const
const strategyOptions = [
  { value: 'auto', label: 'Авто', hint: 'Определяется по story plan и scene count' },
  { value: 'fast_draft', label: 'Черновик', hint: 'Быстро и дёшево, budget tier' },
  { value: 'balanced', label: 'Баланс', hint: 'Standard качество, разумная цена' },
  { value: 'story_continuity', label: 'Story continuity', hint: 'Для multi-scene видео с озвучкой' },
  { value: 'high_realism', label: 'Premium', hint: 'Максимальное качество, дороже' },
] as const

// ─── Динамический расчёт стоимости ─────────────────

const { data: costData, refresh: refreshCost } = await useFetch<VideoCostEstimateResponse>(
  '/api/videos/estimate-cost',
  {
    method: 'POST',
    body: currentConfig,
    watch: [currentConfig],
  },
)

// ─── UI state ──────────────────────────────────────

const showCostDetails = ref(false)
const showTips = ref(false)
const expandedModelInfo = ref<string | null>(null)

// ─── Helpers ───────────────────────────────────────

function updateField(key: string, value: any) {
  emit('update', key, value)
  // Защита: при переключении на fast_draft автоматически выключаем lip-sync,
  // чтобы оно не висело включённым невидимо за заблокированным чекбоксом и
  // не списывало деньги через quality-пресет, оставленный в config.
  if (key === 'modelStrategy' && value === 'fast_draft' && props.config.lipSyncEnabled === true) {
    emit('update', 'lipSyncEnabled', false)
  }
}

function applyPreset(preset: { config: Record<string, unknown> }) {
  for (const [key, value] of Object.entries(preset.config)) {
    emit('update', key, value)
  }
}

function applyTip(field: string, value: unknown) {
  emit('update', field, value)
}

function formatCost(value: number): string {
  if (value === 0) return 'бесплатно'
  if (value < 0.01) return '<$0.01'
  return `$${value.toFixed(2)}`
}

function tierLabel(tier: string): string {
  const map: Record<string, string> = { budget: 'Бюджет', standard: 'Стандарт', premium: 'Премиум' }
  return map[tier] || tier
}

function tierClass(tier: string): string {
  const map: Record<string, string> = {
    budget: 'badge-success',
    standard: 'badge-info',
    premium: 'badge-warning',
  }
  return map[tier] || 'badge-ghost'
}

// ─── Форматы и опции ───────────────────────────────

const formats = [
  { value: 'vertical', label: 'Верт. 9:16', hint: 'TikTok, Reels, Shorts' },
  { value: 'horizontal', label: 'Гор. 16:9', hint: 'YouTube' },
] as const

const qualityOptions = [
  { value: '720p', label: '720p', hint: 'Быстрее, дешевле' },
  { value: '1080p', label: '1080p (Full HD)', hint: 'Лучшее качество' },
] as const

const musicMoods = [
  { value: 'energetic upbeat', label: 'Энергичная' },
  { value: 'calm ambient', label: 'Спокойная' },
  { value: 'dramatic cinematic', label: 'Кинематографичная' },
  { value: 'happy positive', label: 'Весёлая' },
  { value: 'dark moody', label: 'Тёмная / атмосферная' },
  { value: 'corporate professional', label: 'Корпоративная' },
] as const

const selectedImageModel = computed(() =>
  imageModels.value.find(m => m.id === (props.config.imageModelId || 'fal-ai/flux/dev')),
)
const selectedVideoModel = computed(() =>
  videoModels.value.find(m => m.id === (props.config.videoModelId || 'fal-ai/kling-video/v3/standard/text-to-video')),
)

/** Есть ли хотя бы одна модель с проблемой доступа */
const hasAccessIssue = computed(() => {
  const img = selectedImageModel.value
  const vid = selectedVideoModel.value
  return (img?.accessStatus && img.accessStatus !== 'available')
    || (vid?.accessStatus && vid.accessStatus !== 'available')
})

function accessStatusLabel(status?: string): string {
  const map: Record<string, string> = {
    available: 'Доступна',
    blocked_by_access: 'Нет доступа',
    no_api_key: 'Нет API-ключа',
    unsupported_by_runtime: 'Не подключена',
    probe_error: 'Не проверена',
  }
  return map[status ?? ''] || 'Неизвестно'
}

function accessStatusClass(status?: string): string {
  const map: Record<string, string> = {
    available: 'badge-success',
    blocked_by_access: 'badge-error',
    no_api_key: 'badge-error',
    unsupported_by_runtime: 'badge-ghost',
    probe_error: 'badge-warning',
  }
  return map[status ?? ''] || 'badge-ghost'
}

function isModelBlocked(model?: { accessStatus?: string; integrated?: boolean }): boolean {
  if (!model) return false
  if (!model.integrated) return true
  return model.accessStatus !== 'available' && model.accessStatus !== undefined
}
</script>

<template>
  <!-- ═══ Upstream Scenario Source-of-Truth Banner ═══ -->
  <div v-if="isDrivenByScenario" class="alert alert-info alert-soft py-2 mb-3">
    <Icon name="mingcute:link-line" class="text-lg" />
    <div class="flex-1 text-xs">
      <div class="font-semibold">
        Параметры синхронизированы со сценарием
        <span v-if="upstream.sceneCountStrategy" class="badge badge-xs badge-primary ml-1">
          {{ strategyLabels[upstream.sceneCountStrategy] ?? upstream.sceneCountStrategy }}
        </span>
      </div>
      <div class="text-[10px] opacity-80 mt-0.5">
        Блок Сценарий (входящий) задал {{ upstream.expectedSceneCount }} сцен × ~{{ upstream.expectedAvgDurationSec }}с
        <span v-if="upstream.expectedTotalSec"> · {{ upstream.expectedTotalSec }}</span>.
        Слайдеры количества сцен и длительности клипа заблокированы - реальная генерация идёт по плану сценария.
      </div>
    </div>
  </div>

  <!-- ═══ Cost Summary Banner ═══ -->
  <div v-if="costData" class="alert py-2 mb-3" :class="(costData.maxTotal ?? costData.total ?? 0) > 3 ? 'alert-warning' : 'alert-info'">
    <Icon :name="(costData.maxTotal ?? costData.total ?? 0) > 3 ? 'mingcute:warning-line' : 'mingcute:wallet-4-line'" class="text-lg" />
    <div class="flex-1">
      <div class="flex items-baseline gap-2 flex-wrap">
        <template v-if="!isDrivenByScenario && costData.minTotal != null && costData.maxTotal != null && costData.maxTotal - costData.minTotal > 0.5">
          <span class="font-bold text-sm">{{ formatCost(costData.minTotal) }} — {{ formatCost(costData.maxTotal) }}</span>
          <span class="text-xs opacity-70">за 1 видео</span>
          <span class="text-[10px] opacity-50">≈ {{ formatCost(costData.total) }} ожидаемо</span>
        </template>
        <template v-else>
          <span class="font-bold text-sm">≈ {{ formatCost(costData.total) }}</span>
          <span class="text-xs opacity-70">за 1 видео</span>
          <span v-if="isDrivenByScenario" class="badge badge-xs badge-primary">по плану сценария</span>
        </template>
      </div>
      <div class="text-[10px] opacity-60">
        {{ costData.models.image?.name }} + {{ costData.models.video?.name }}
        <template v-if="costData.models.music"> + {{ costData.models.music.name }}</template>
        <template v-if="costData.models.tts"> + {{ costData.models.tts.name }}</template>
        <template v-if="isDrivenByScenario">
          · {{ upstream.expectedSceneCount }} сцен
          ({{ upstream.expectedPerSceneDurations?.join('с, ') }}с)
        </template>
        <template v-else-if="costData.storyDriven"> · план-сценарий (3-6 сцен по 3-9с)</template>
      </div>
    </div>
    <button
      type="button"
      class="btn btn-xs btn-ghost"
      @click="showCostDetails = !showCostDetails"
    >
      {{ showCostDetails ? 'Скрыть' : 'Детали' }}
    </button>
  </div>

  <!-- Cost Breakdown Table -->
  <div v-if="showCostDetails && costData" class="mb-3">
    <!-- Source-of-truth header. Flex-wrap чтобы длинный badge не выходил за рамки:
         если не влезает - переносится на следующую строку под надпись. -->
    <div class="flex items-center gap-1.5 mb-1 text-[10px] flex-wrap">
      <span class="text-base-content/60 shrink-0">Источник данных:</span>
      <span v-if="isDrivenByScenario" class="badge badge-xs badge-primary gap-1 max-w-full whitespace-normal text-left leading-tight py-0.5 h-auto">
        <Icon name="mingcute:link-line" class="size-2.5 shrink-0" />
        <span>
          план сценария
          ({{ upstream.sceneCountStrategy && strategyLabels[upstream.sceneCountStrategy] }})
        </span>
      </span>
      <span v-else class="badge badge-xs badge-ghost">параметры видео-блока</span>
    </div>

    <table class="table table-xs">
      <thead>
        <tr>
          <th>Этап</th>
          <th class="text-right">Кол-во</th>
          <th class="text-right">За ед.</th>
          <th class="text-right">Итого</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in costData.breakdown" :key="item.stage">
          <td>
            <div class="text-xs">{{ item.label }}</div>
            <div class="text-[10px] text-base-content/40">{{ item.modelName }}</div>
          </td>
          <td class="text-right text-xs">{{ item.units }} {{ item.unitLabel }}</td>
          <td class="text-right text-xs font-mono">{{ formatCost(item.unitPrice) }}</td>
          <td class="text-right text-xs font-mono font-semibold">{{ formatCost(item.subtotal) }}</td>
        </tr>
      </tbody>
      <tfoot>
        <tr v-if="isDrivenByScenario && costData.minTotal != null && costData.maxTotal != null">
          <td colspan="3" class="text-right text-[10px] text-base-content/60">Диапазон (min / max):</td>
          <td class="text-right text-[10px] font-mono text-base-content/60">
            {{ formatCost(costData.minTotal) }} / {{ formatCost(costData.maxTotal) }}
          </td>
        </tr>
        <tr>
          <td colspan="3" class="text-right font-semibold text-xs">Итого:</td>
          <td class="text-right font-bold text-sm font-mono">{{ formatCost(costData.total) }}</td>
        </tr>
      </tfoot>
    </table>

    <!-- Warnings -->
    <div v-for="(w, i) in costData.warnings" :key="i" class="alert alert-warning alert-soft text-[10px] py-1 mt-1">
      <Icon name="mingcute:alert-line" class="text-xs" />
      <span>{{ w }}</span>
    </div>
  </div>

  <!-- ═══ Cost Presets ═══ -->
  <fieldset class="fieldset mb-1">
    <legend class="fieldset-legend">Быстрые пресеты</legend>
    <div class="flex flex-wrap gap-1">
      <button
        v-for="preset in costData?.presets ?? []"
        :key="preset.key"
        type="button"
        class="btn btn-xs btn-outline"
        :class="{
          'btn-success': preset.key === 'budget',
          'btn-info': preset.key === 'balanced',
          'btn-warning': preset.key === 'quality',
        }"
        @click="applyPreset(preset)"
      >
        {{ preset.label }}
      </button>
    </div>
    <SharedFieldHint text="Пресеты устанавливают все настройки сразу. Можно подкорректировать отдельные поля после." />
  </fieldset>

  <!-- ═══ Формат видео ═══ -->
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Формат видео</legend>
    <div class="flex flex-wrap gap-1">
      <button
        v-for="f in formats"
        :key="f.value"
        type="button"
        class="btn btn-xs"
        :class="(config.format || 'vertical') === f.value ? 'btn-primary' : 'btn-ghost'"
        @click="updateField('format', f.value)"
      >
        {{ f.label }}
        <span class="text-[9px] opacity-60">{{ f.hint }}</span>
      </button>
    </div>
  </fieldset>

  <!-- ═══ Model Strategy ═══ -->
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Стратегия моделей</legend>
    <select
      class="select select-sm w-full"
      :value="config.modelStrategy || 'auto'"
      @change="updateField('modelStrategy', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="s in strategyOptions" :key="s.value" :value="s.value">
        {{ s.label }} — {{ s.hint }}
      </option>
    </select>
    <SharedFieldHint text="Авто-режим анализирует план сценария и сам подбирает модели изображения/видео/TTS. Иначе - применяется профиль качества." />
  </fieldset>

  <!-- ═══ Access Warning Banner ═══ -->
  <div v-if="hasAccessIssue" class="alert alert-error alert-soft py-2 mb-3">
    <Icon name="mingcute:forbid-circle-line" class="text-lg" />
    <div class="flex-1">
      <div class="font-bold text-xs">Проблема доступа к моделям</div>
      <div class="text-[10px] opacity-80">
        Одна или несколько выбранных моделей недоступны для текущего API-ключа fal.ai.
        Генерация будет заблокирована до выбора доступной модели.
      </div>
    </div>
  </div>

  <!-- ═══ Модель изображений ═══ -->
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Модель изображений</legend>
    <select
      class="select select-sm w-full"
      :class="{ 'select-error': isModelBlocked(selectedImageModel) }"
      :value="config.imageModelId || 'fal-ai/flux/dev'"
      @change="updateField('imageModelId', ($event.target as HTMLSelectElement).value)"
    >
      <option
        v-for="m in imageModels"
        :key="m.id"
        :value="m.id"
        :disabled="isModelBlocked(m)"
      >
        {{ m.name }} — {{ tierLabel(m.tier) }} ({{ formatCost(m.pricing.base) }}/MP)
        {{ isModelBlocked(m) ? ` [${accessStatusLabel(m.accessStatus)}]` : '' }}
      </option>
    </select>
    <!-- Selected model info -->
    <div v-if="selectedImageModel" class="mt-1 text-[10px]">
      <div class="flex items-center gap-1 flex-wrap">
        <span class="badge badge-xs" :class="tierClass(selectedImageModel.tier)">{{ tierLabel(selectedImageModel.tier) }}</span>
        <span
          v-if="selectedImageModel.accessStatus"
          class="badge badge-xs"
          :class="accessStatusClass(selectedImageModel.accessStatus)"
          :title="selectedImageModel.accessReason"
        >
          {{ accessStatusLabel(selectedImageModel.accessStatus) }}
        </span>
        <span v-if="selectedImageModel.avgGenerationTime" class="text-base-content/40">{{ selectedImageModel.avgGenerationTime }}</span>
      </div>
      <!-- Access error detail -->
      <div
        v-if="isModelBlocked(selectedImageModel)"
        class="mt-1 p-1.5 bg-error/10 rounded text-error text-[10px]"
      >
        {{ selectedImageModel.accessReason || 'Модель недоступна для текущего ключа' }}
      </div>
      <button
        type="button"
        class="text-[9px] text-base-content/40 hover:text-base-content/60 mt-0.5"
        @click="expandedModelInfo = expandedModelInfo === 'image' ? null : 'image'"
      >
        {{ expandedModelInfo === 'image' ? 'Скрыть детали' : 'Подробнее о модели' }}
      </button>
      <div v-if="expandedModelInfo === 'image'" class="mt-1 p-1.5 bg-base-200/60 rounded-box space-y-1">
        <div>
          <span class="font-semibold text-success/80">+</span>
          <span v-for="(s, i) in selectedImageModel.strengths" :key="i">
            {{ s }}{{ i < selectedImageModel.strengths.length - 1 ? ' · ' : '' }}
          </span>
        </div>
        <div>
          <span class="font-semibold text-warning/80">−</span>
          <span v-for="(t, i) in selectedImageModel.tradeoffs" :key="i">
            {{ t }}{{ i < selectedImageModel.tradeoffs.length - 1 ? ' · ' : '' }}
          </span>
        </div>
      </div>
    </div>
  </fieldset>

  <!-- ═══ Модель видео ═══ -->
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Модель видео</legend>
    <select
      class="select select-sm w-full"
      :class="{ 'select-error': isModelBlocked(selectedVideoModel) }"
      :value="config.videoModelId || 'fal-ai/kling-video/v3/standard/text-to-video'"
      @change="updateField('videoModelId', ($event.target as HTMLSelectElement).value)"
    >
      <option
        v-for="m in videoModels"
        :key="m.id"
        :value="m.id"
        :disabled="isModelBlocked(m)"
      >
        {{ m.name }} — {{ tierLabel(m.tier) }}
        ({{ formatCost(m.pricing.withAudio ?? m.pricing.base) }}/сек)
        {{ isModelBlocked(m) ? ` [${accessStatusLabel(m.accessStatus)}]` : '' }}
      </option>
    </select>
    <div v-if="selectedVideoModel" class="mt-1 text-[10px]">
      <div class="flex items-center gap-1 flex-wrap">
        <span class="badge badge-xs" :class="tierClass(selectedVideoModel.tier)">{{ tierLabel(selectedVideoModel.tier) }}</span>
        <span
          v-if="selectedVideoModel.accessStatus"
          class="badge badge-xs"
          :class="accessStatusClass(selectedVideoModel.accessStatus)"
          :title="selectedVideoModel.accessReason"
        >
          {{ accessStatusLabel(selectedVideoModel.accessStatus) }}
        </span>
        <span v-if="selectedVideoModel.avgGenerationTime" class="text-base-content/40">{{ selectedVideoModel.avgGenerationTime }}</span>
      </div>
      <!-- Access error detail -->
      <div
        v-if="isModelBlocked(selectedVideoModel)"
        class="mt-1 p-1.5 bg-error/10 rounded text-error text-[10px]"
      >
        {{ selectedVideoModel.accessReason || 'Модель недоступна для текущего ключа' }}
      </div>
      <button
        type="button"
        class="text-[9px] text-base-content/40 hover:text-base-content/60 mt-0.5"
        @click="expandedModelInfo = expandedModelInfo === 'video' ? null : 'video'"
      >
        {{ expandedModelInfo === 'video' ? 'Скрыть детали' : 'Подробнее о модели' }}
      </button>
      <div v-if="expandedModelInfo === 'video'" class="mt-1 p-1.5 bg-base-200/60 rounded-box space-y-1">
        <div>
          <span class="font-semibold text-success/80">+</span>
          <span v-for="(s, i) in selectedVideoModel.strengths" :key="i">
            {{ s }}{{ i < selectedVideoModel.strengths.length - 1 ? ' · ' : '' }}
          </span>
        </div>
        <div>
          <span class="font-semibold text-warning/80">−</span>
          <span v-for="(t, i) in selectedVideoModel.tradeoffs" :key="i">
            {{ t }}{{ i < selectedVideoModel.tradeoffs.length - 1 ? ' · ' : '' }}
          </span>
        </div>
      </div>
    </div>
  </fieldset>

  <!-- ═══ Качество / Разрешение ═══ -->
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Качество</legend>
    <div class="flex flex-wrap gap-1">
      <button
        v-for="q in qualityOptions"
        :key="q.value"
        type="button"
        class="btn btn-xs"
        :class="(config.quality || '1080p') === q.value ? 'btn-primary' : 'btn-ghost'"
        @click="updateField('quality', q.value)"
      >
        {{ q.label }}
        <span class="text-[9px] opacity-60">{{ q.hint }}</span>
      </button>
    </div>
  </fieldset>

  <!-- ═══ Количество сцен ═══ -->
  <fieldset class="fieldset">
    <legend class="fieldset-legend">
      Количество сцен
      <span v-if="isDrivenByScenario" class="badge badge-xs badge-info ml-1" title="Значение взято из upstream scenario">
        <Icon name="mingcute:link-line" class="size-2.5" /> из сценария
      </span>
    </legend>
    <div class="flex items-center gap-2">
      <input
        type="range"
        class="range range-xs range-primary flex-1"
        :class="{ 'opacity-50 cursor-not-allowed': isDrivenByScenario }"
        min="2"
        max="8"
        step="1"
        :value="effectiveSceneCount"
        :disabled="isDrivenByScenario"
        @input="updateField('sceneCount', Number(($event.target as HTMLInputElement).value))"
      />
      <span class="badge badge-sm font-mono w-6 text-center">{{ effectiveSceneCount }}</span>
    </div>
    <SharedFieldHint
      :text="isDrivenByScenario
        ? 'Количество сцен зафиксировано блоком Сценарий (sceneCountStrategy). Чтобы изменить - настрой стратегию в блоке Сценарий.'
        : 'Сколько сцен/кадров будет в видео. Hook (начало) + Body (середина) + CTA (конец). Больше сцен = больше изображений и клипов = дороже.'"
    />
  </fieldset>

  <!-- ═══ Длительность клипа ═══ -->
  <fieldset class="fieldset">
    <legend class="fieldset-legend">
      Длительность клипа
      <span v-if="isDrivenByScenario" class="badge badge-xs badge-info ml-1" title="Значение взято из upstream scenario">
        <Icon name="mingcute:link-line" class="size-2.5" /> из сценария
      </span>
    </legend>
    <div class="flex items-center gap-2">
      <input
        type="range"
        class="range range-xs range-primary flex-1"
        :class="{ 'opacity-50 cursor-not-allowed': isDrivenByScenario }"
        min="3"
        max="15"
        step="1"
        :value="effectiveClipDuration"
        :disabled="isDrivenByScenario"
        @input="updateField('clipDuration', Number(($event.target as HTMLInputElement).value))"
      />
      <span class="badge badge-sm font-mono w-10 text-center">{{ effectiveClipDuration }} сек</span>
    </div>
    <div class="text-[10px] text-base-content/40 mt-0.5">
      Общая длительность ≈ {{ effectiveClipDuration * effectiveSceneCount }} сек
    </div>
    <SharedFieldHint
      :text="isDrivenByScenario
        ? 'Длительность определяется отдельно для каждой сцены из плана сценария. В оценке ниже - точные значения каждой сцены.'
        : 'Длительность каждого отдельного клипа. Итого видео = кол-во сцен × длительность клипа.'"
    />
  </fieldset>

  <!-- ═══ Аудио в видеоклипах ═══
       Toggle актуален только для моделей с встроенным аудио (Kling).
       Wan/Hailuo не имеют native audio — скрываем чекбокс, чтобы не путать. -->
  <fieldset v-if="selectedVideoModel?.pricing?.withAudio" class="fieldset">
    <legend class="fieldset-legend">Аудио в клипах</legend>
    <label class="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        class="toggle toggle-sm toggle-primary"
        :checked="config.generateAudio !== false"
        @change="updateField('generateAudio', ($event.target as HTMLInputElement).checked)"
      />
      <span class="text-xs">Генерировать звук в клипах</span>
    </label>
    <SharedFieldHint :text="`${selectedVideoModel.name} генерирует видео со встроенным звуком. Отключение экономит ~50% стоимости клипов, но видео будет без нативного звука.`" />
  </fieldset>
  <fieldset v-else class="fieldset">
    <legend class="fieldset-legend">Аудио в клипах</legend>
    <div class="alert alert-info alert-soft text-[10px] py-1">
      <Icon name="mingcute:information-line" class="text-xs" />
      <span>
        {{ selectedVideoModel?.name || 'Выбранная модель' }} не поддерживает встроенное аудио в клипах — используйте TTS-озвучку или фоновую музыку ниже.
      </span>
    </div>
  </fieldset>

  <!-- ═══ Субтитры ═══ -->
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Субтитры</legend>
    <label class="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        class="toggle toggle-sm toggle-primary"
        :checked="config.subtitlesEnabled !== false"
        @change="updateField('subtitlesEnabled', ($event.target as HTMLInputElement).checked)"
      />
      <span class="text-xs">Добавить субтитры (hook + CTA)</span>
    </label>
    <SharedFieldHint text="Текст hook отображается в начале, CTA — в конце видео. Субтитры накладываются при сборке (FFmpeg), стоимость не увеличивается." />
  </fieldset>

  <fieldset v-if="config.subtitlesEnabled !== false" class="fieldset">
    <legend class="fieldset-legend">Стиль субтитров (preset)</legend>
    <VideoSubtitlePresetPicker
      :model-value="config.subtitlePreset || 'classic'"
      compact
      @update:model-value="(v) => updateField('subtitlePreset', v)"
    />
    <SharedFieldHint text="Дефолтный пресет применяется ко всем видео контейнера. Per-video можно перебить в редакторе субтитров после сборки." />
  </fieldset>

  <!-- ═══ Voiceover / Озвучка ═══ -->
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Озвучка (TTS)</legend>
    <label class="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        class="toggle toggle-sm toggle-primary"
        :checked="voiceoverEnabled"
        @change="updateField('voiceoverEnabled', ($event.target as HTMLInputElement).checked)"
      />
      <span class="text-xs">Озвучивать сценарий через TTS</span>
    </label>
    <SharedFieldHint text="Генерирует реальную озвучку через fal.ai TTS по voiceoverPlan.lines из story plan. Каждая сцена синтезируется отдельно, miксуется в единый трек с ducking музыки." />

    <div v-if="voiceoverEnabled" class="mt-2 space-y-2">
      <!-- TTS provider select -->
      <div>
        <label class="label label-text text-xs mb-0.5">TTS провайдер</label>
        <select
          class="select select-xs w-full"
          :value="config.voiceoverModelId || (ttsModels.find(m => m.integrated)?.id ?? '')"
          @change="updateField('voiceoverModelId', ($event.target as HTMLSelectElement).value || null)"
        >
          <option
            v-for="m in ttsModels"
            :key="m.id"
            :value="m.id"
            :disabled="isModelBlocked(m)"
          >
            {{ m.name }} — {{ tierLabel(m.tier) }}
            ({{ m.pricing?.unit === 'character' ? `${formatCost(m.pricing.base * 1000)}/1K симв` : `${formatCost(m.pricing.base * 60)}/мин` }})
            {{ isModelBlocked(m) ? ` [${accessStatusLabel(m.accessStatus)}]` : '' }}
          </option>
        </select>
        <div v-if="selectedTtsModel" class="mt-1 text-[10px]">
          <div class="flex items-center gap-1 flex-wrap">
            <span class="badge badge-xs" :class="tierClass(selectedTtsModel.tier)">{{ tierLabel(selectedTtsModel.tier) }}</span>
            <span
              v-if="selectedTtsModel.accessStatus"
              class="badge badge-xs"
              :class="accessStatusClass(selectedTtsModel.accessStatus)"
            >
              {{ accessStatusLabel(selectedTtsModel.accessStatus) }}
            </span>
          </div>
          <div
            v-if="isModelBlocked(selectedTtsModel)"
            class="mt-1 p-1.5 bg-error/10 rounded text-error text-[10px]"
          >
            {{ selectedTtsModel.accessReason || 'TTS модель недоступна' }}
          </div>
        </div>
      </div>

      <!-- Language -->
      <div>
        <label class="label label-text text-xs mb-0.5">Язык озвучки</label>
        <div class="flex gap-1">
          <button
            v-for="l in languageOptions"
            :key="l.value"
            type="button"
            class="btn btn-xs"
            :class="(config.voiceoverLanguage || 'en') === l.value ? 'btn-primary' : 'btn-ghost'"
            @click="updateField('voiceoverLanguage', l.value)"
          >
            {{ l.label }}
          </button>
        </div>
      </div>

      <!-- Voice id override (opt-in) -->
      <div>
        <label class="label label-text text-xs mb-0.5">Voice ID (опционально)</label>
        <input
          type="text"
          class="input input-xs w-full font-mono"
          placeholder="Оставьте пустым для голоса по умолчанию"
          :value="config.voiceoverVoiceId || ''"
          @input="updateField('voiceoverVoiceId', ($event.target as HTMLInputElement).value || null)"
        />
        <div class="text-[10px] text-base-content/40 mt-0.5">
          Kokoro: af_heart, af_bella, am_adam. PlayAI/ElevenLabs: provider-specific voice id.
        </div>
      </div>

      <!-- Pacing -->
      <div>
        <label class="label label-text text-xs mb-0.5">Темп речи</label>
        <div class="flex gap-1">
          <button
            v-for="p in pacingOptions"
            :key="p.value"
            type="button"
            class="btn btn-xs"
            :class="(config.voiceoverPacing || 'moderate') === p.value ? 'btn-primary' : 'btn-ghost'"
            @click="updateField('voiceoverPacing', p.value)"
          >
            {{ p.label }}
            <span class="text-[9px] opacity-60">{{ p.hint }}</span>
          </button>
        </div>
      </div>

      <!-- Reconciliation strategy -->
      <div>
        <label class="label label-text text-xs mb-0.5">Если озвучка длиннее сцены</label>
        <select
          class="select select-xs w-full"
          :value="config.voiceoverReconciliation || 'compress_audio'"
          @change="updateField('voiceoverReconciliation', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="r in reconciliationOptions" :key="r.value" :value="r.value">
            {{ r.label }} — {{ r.hint }}
          </option>
        </select>
      </div>

      <!-- Music ducking slider -->
      <div v-if="config.enableMusic !== false">
        <label class="label label-text text-xs mb-0.5">
          Громкость музыки во время озвучки
          <span class="font-mono ml-1">{{ Math.round((config.musicVolumeWithVoiceover ?? 0.12) * 100) }}%</span>
        </label>
        <input
          type="range"
          class="range range-xs range-primary w-full"
          min="0"
          max="0.5"
          step="0.02"
          :value="config.musicVolumeWithVoiceover ?? 0.12"
          @input="updateField('musicVolumeWithVoiceover', Number(($event.target as HTMLInputElement).value))"
        />
        <div class="text-[10px] text-base-content/40">
          Ducking: насколько приглушить фоновую музыку когда говорит voiceover. 0% = полная тишина музыки под голосом.
        </div>
      </div>

      <div class="alert alert-info alert-soft text-[10px] py-1">
        <Icon name="mingcute:information-line" class="text-xs" />
        <span>
          Озвучка работает только если план сценария содержит строки озвучки (voiceoverPlan).
          Без сценарного режима озвучка будет пропущена с предупреждением.
        </span>
      </div>
    </div>
  </fieldset>

  <!-- ═══ AI Lip-sync (premium) ═══ -->
  <fieldset class="fieldset">
    <legend class="fieldset-legend">
      AI Lip-sync персонажа
      <span class="badge badge-warning badge-xs ml-1">Premium</span>
    </legend>
    <label class="flex items-center gap-2" :class="lipSyncGated ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'">
      <input
        type="checkbox"
        class="toggle toggle-sm toggle-warning"
        :checked="config.lipSyncEnabled === true"
        :disabled="lipSyncGated"
        @change="updateField('lipSyncEnabled', ($event.target as HTMLInputElement).checked)"
      />
      <span class="text-xs">Синхронизировать губы со spokenLine персонажа</span>
    </label>
    <SharedFieldHint
      :text="lipSyncGated
        ? 'Заблокировано на стратегии Черновик. Переключи стратегию или применяй пресет Максимальное качество, чтобы активировать lip-sync.'
        : 'Берёт каждую сцену со spokenLine, синтезирует TTS, прогоняет через fal.ai sync-lipsync. На выходе клип, в котором персонаж реально произносит свою реплику. Биллинг ~$0.07/сек на каждую sync-нутую сцену + TTS.'"
    />

    <div v-if="config.lipSyncEnabled === true && !lipSyncGated" class="alert alert-warning alert-soft text-[10px] py-1 mt-2">
      <Icon name="mingcute:alert-line" class="text-xs" />
      <span>
        Lip-sync обрабатывает только сцены с person-протагонистом и заполненным spokenLine.
        Если в сценарии нет таких сцен, шаг автоматически пропустится.
      </span>
    </div>
  </fieldset>

  <!-- ═══ Музыка ═══ -->
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Фоновая музыка</legend>
    <label class="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        class="toggle toggle-sm toggle-primary"
        :checked="config.enableMusic !== false"
        @change="updateField('enableMusic', ($event.target as HTMLInputElement).checked)"
      />
      <span class="text-xs">Включить музыку</span>
    </label>

    <div v-if="config.enableMusic !== false" class="mt-2 space-y-2">
      <select
        class="select select-xs w-full"
        :value="config.musicMood || 'energetic upbeat'"
        @change="updateField('musicMood', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="m in musicMoods" :key="m.value" :value="m.value">{{ m.label }}</option>
      </select>
      <div>
        <label class="label label-text text-xs mb-0.5">
          Громкость музыки
          <span class="font-mono ml-1">{{ Math.round((config.musicVolume ?? 0.3) * 100) }}%</span>
        </label>
        <input
          type="range"
          class="range range-xs range-primary w-full"
          min="0"
          max="1"
          step="0.05"
          :value="config.musicVolume ?? 0.3"
          @input="updateField('musicVolume', Number(($event.target as HTMLInputElement).value))"
        />
        <div class="text-[10px] text-base-content/40">
          Базовая громкость музыки. Если voiceover включён, во время речи применяется ducking (отдельная настройка выше).
        </div>
      </div>
    </div>
  </fieldset>

  <!-- ═══ Лимит видео ═══ -->
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Лимит видео</legend>
    <div class="flex items-center gap-2">
      <input
        type="number"
        class="input input-sm w-20"
        min="0"
        max="50"
        placeholder="0"
        :value="config.maxVideos || 0"
        @input="updateField('maxVideos', Number(($event.target as HTMLInputElement).value) || 0)"
      />
      <span class="text-xs text-base-content/60">0 = без ограничений</span>
    </div>
    <SharedFieldHint text="Максимум видео за один запуск. Если upstream генерирует 10 сценариев, но лимит = 3, будут созданы только 3 видео." />
    <div v-if="(config.maxVideos ?? 0) > 0" class="alert alert-info alert-soft text-[10px] py-1 mt-1">
      <Icon name="mingcute:information-line" class="text-xs" />
      <div>
        <span>Будет создано не более {{ config.maxVideos }} видео.</span>
        <span v-if="costData" class="font-semibold ml-1">
          Макс. стоимость: ≈ {{ formatCost((costData.maxTotal ?? costData.total ?? 0) * (config.maxVideos ?? 1)) }}
        </span>
      </div>
    </div>
  </fieldset>

  <!-- ═══ Целевая платформа ═══ -->
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Целевая платформа</legend>
    <select
      class="select select-sm w-full"
      :value="config.targetPlatform || ''"
      @change="updateField('targetPlatform', ($event.target as HTMLSelectElement).value)"
    >
      <option value="">Без привязки</option>
      <option value="tiktok">TikTok</option>
      <option value="instagram">Instagram Reels</option>
      <option value="youtube">YouTube / Shorts</option>
    </select>
    <SharedFieldHint text="Влияет на рекомендуемый формат и параметры. При выгрузке через Upload блок платформа определяет, куда отправить видео." />
  </fieldset>

  <!-- ═══ Cost Optimization Tips ═══ -->
  <div v-if="costData?.tips?.length" class="mt-2">
    <button
      type="button"
      class="btn btn-xs btn-ghost text-success gap-1"
      @click="showTips = !showTips"
    >
      <Icon name="mingcute:sparkles-2-line" class="text-xs" />
      {{ showTips ? 'Скрыть советы' : `Как сэкономить (${costData.tips.length})` }}
    </button>

    <div v-if="showTips" class="mt-1 space-y-1">
      <div
        v-for="(tip, i) in costData.tips"
        :key="i"
        class="flex items-center gap-2 p-1.5 bg-base-200/60 rounded-box text-[10px]"
      >
        <span class="badge badge-xs badge-success">−{{ tip.savingsPercent }}%</span>
        <div class="flex-1">
          <div class="font-medium">{{ tip.tip }}</div>
          <div class="text-base-content/40">{{ tip.action }}</div>
        </div>
        <button
          type="button"
          class="btn btn-xs btn-ghost btn-success"
          @click="applyTip(tip.field, tip.newValue)"
        >
          Применить
        </button>
      </div>
    </div>
  </div>
</template>
