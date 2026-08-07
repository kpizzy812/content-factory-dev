<script setup lang="ts">
import type { VideoCostEstimateResponse, VideoModelInfo } from '~~/shared/types/video'
import { getExpectedScenePlan, normalizeSceneCountStrategy } from '~~/shared/utils/scene-budget'
import type { SceneCountStrategy } from '~~/shared/types/scenario'

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
function findUpstreamScenarioNode(nodeId: string): { id: string, data?: { type?: string, config?: Record<string, any> } } | null {
  const edges = editorStore.edges as Array<{ source: string, target: string }>
  const nodes = editorStore.nodes as Array<{ id: string, data?: { type?: string, config?: Record<string, any> } }>
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
  { value: 'compress_audio', label: 'Ускорить (до 1.2x) — естественный звук, если озвучка длиннее сцены' },
  { value: 'trim_audio', label: 'Обрезать по сцене — честно обрезать озвучку до длины клипа' },
].map(r => ({ value: r.value, label: r.label }))
const languageOptions = [
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
] as const
const strategyOptions = [
  { value: 'auto', label: 'Авто — определяется по story plan и scene count' },
  { value: 'fast_draft', label: 'Черновик — быстро и дёшево, budget tier' },
  { value: 'balanced', label: 'Баланс — standard качество, разумная цена' },
  { value: 'story_continuity', label: 'Story continuity — для multi-scene видео с озвучкой' },
  { value: 'high_realism', label: 'Premium — максимальное качество, дороже' },
]

// ─── Динамический расчёт стоимости ─────────────────

const { data: costData } = await useFetch<VideoCostEstimateResponse>(
  '/api/videos/estimate-cost',
  {
    method: 'POST',
    body: currentConfig,
    watch: [currentConfig],
  },
)

// ─── UI state ──────────────────────────────────────

const showCostDetails = ref(false)
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

function formatCost(value: number): string {
  if (value === 0) return 'бесплатно'
  if (value < 0.01) return '<$0.01'
  return `$${value.toFixed(2)}`
}

function tierLabel(tier: string): string {
  const map: Record<string, string> = { budget: 'Бюджет', standard: 'Стандарт', premium: 'Премиум' }
  return map[tier] || tier
}

// Тон бейджа берём из общего словаря состояний, подписи — доменные.
const NEUTRAL_TONE = 'border-neutral-border bg-neutral-bg text-neutral'

function tierTone(tier: string): string {
  const map: Record<string, string> = {
    budget: 'border-success-border bg-success-bg text-success',
    standard: 'border-info-border bg-info-bg text-info',
    premium: 'border-warning-border bg-warning-bg text-warning',
  }
  return map[tier] || NEUTRAL_TONE
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
]

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

function accessStatusTone(status?: string): string {
  const map: Record<string, string> = {
    available: 'border-success-border bg-success-bg text-success',
    blocked_by_access: 'border-danger-border bg-danger-bg text-danger',
    no_api_key: 'border-danger-border bg-danger-bg text-danger',
    unsupported_by_runtime: NEUTRAL_TONE,
    probe_error: 'border-warning-border bg-warning-bg text-warning',
  }
  return map[status ?? ''] || NEUTRAL_TONE
}

function isModelBlocked(model?: { accessStatus?: string, integrated?: boolean }): boolean {
  if (!model) return false
  if (!model.integrated) return true
  return model.accessStatus !== 'available' && model.accessStatus !== undefined
}

// Списки моделей для UiSelect: подпись собирается один раз.
const imageModelOptions = computed(() => imageModels.value.map(m => ({
  value: m.id,
  label: `${m.name} — ${tierLabel(m.tier)} (${formatCost(m.pricing.base)}/MP)`
    + (isModelBlocked(m) ? ` [${accessStatusLabel(m.accessStatus)}]` : ''),
})))

const videoModelOptions = computed(() => videoModels.value.map(m => ({
  value: m.id,
  label: `${m.name} — ${tierLabel(m.tier)} (${formatCost(m.pricing.withAudio ?? m.pricing.base)}/сек)`
    + (isModelBlocked(m) ? ` [${accessStatusLabel(m.accessStatus)}]` : ''),
})))

const ttsModelOptions = computed(() => ttsModels.value.map((m) => {
  const price = m.pricing?.unit === 'character'
    ? `${formatCost(m.pricing.base * 1000)}/1K симв`
    : `${formatCost(m.pricing.base * 60)}/мин`
  return {
    value: m.id,
    label: `${m.name} — ${tierLabel(m.tier)} (${price})`
      + (isModelBlocked(m) ? ` [${accessStatusLabel(m.accessStatus)}]` : ''),
  }
}))

const BADGE = 'inline-flex h-[18px] shrink-0 items-center gap-0.5 rounded-sm border px-1.5 text-micro'
const RANGE = 'h-1 w-full cursor-pointer appearance-none rounded-full bg-neutral-bg accent-(--color-accent)'
</script>

<template>
  <!-- ═══ Параметры пришли из сценария ═══ -->
  <div
    v-if="isDrivenByScenario"
    class="flex items-start gap-2 rounded-md border border-info-border bg-info-bg px-2.5 py-2"
  >
    <Icon name="mingcute:link-line" class="mt-0.5 shrink-0 text-info" />
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-1 font-semibold">
        Параметры синхронизированы со сценарием
        <span v-if="upstream.sceneCountStrategy" :class="[BADGE, 'border-accent-border bg-accent-bg text-accent-text']">
          {{ strategyLabels[upstream.sceneCountStrategy] ?? upstream.sceneCountStrategy }}
        </span>
      </div>
      <div class="mt-0.5 text-micro text-muted">
        Блок «Сценарий» задал {{ upstream.expectedSceneCount }} сцен × ~{{ upstream.expectedAvgDurationSec }} с
        <span v-if="upstream.expectedTotalSec"> · {{ upstream.expectedTotalSec }}</span>.
        Ползунки количества сцен и длительности клипа заблокированы — реальная генерация идёт по плану сценария.
      </div>
    </div>
  </div>

  <!-- ═══ Оценка стоимости ═══ -->
  <div
    v-if="costData"
    class="flex items-start gap-2 rounded-md border px-2.5 py-2"
    :class="(costData.maxTotal ?? costData.total ?? 0) > 3
      ? 'border-warning-border bg-warning-bg'
      : 'border-info-border bg-info-bg'"
  >
    <Icon
      :name="(costData.maxTotal ?? costData.total ?? 0) > 3 ? 'mingcute:warning-line' : 'mingcute:wallet-4-line'"
      class="mt-0.5 shrink-0"
      :class="(costData.maxTotal ?? costData.total ?? 0) > 3 ? 'text-warning' : 'text-info'"
    />
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-baseline gap-2">
        <template v-if="!isDrivenByScenario && costData.minTotal != null && costData.maxTotal != null && costData.maxTotal - costData.minTotal > 0.5">
          <span class="tnum font-bold">{{ formatCost(costData.minTotal) }} — {{ formatCost(costData.maxTotal) }}</span>
          <span class="text-sm text-muted">за 1 видео</span>
          <span class="text-micro text-subtle">≈ {{ formatCost(costData.total) }} ожидаемо</span>
        </template>
        <template v-else>
          <span class="tnum font-bold">≈ {{ formatCost(costData.total) }}</span>
          <span class="text-sm text-muted">за 1 видео</span>
          <span v-if="isDrivenByScenario" :class="[BADGE, 'border-accent-border bg-accent-bg text-accent-text']">
            по плану сценария
          </span>
        </template>
      </div>
      <div class="text-micro text-muted">
        {{ costData.models.image?.name }} + {{ costData.models.video?.name }}
        <template v-if="costData.models.music"> + {{ costData.models.music.name }}</template>
        <template v-if="costData.models.tts"> + {{ costData.models.tts.name }}</template>
        <template v-if="isDrivenByScenario">
          · {{ upstream.expectedSceneCount }} сцен
          ({{ upstream.expectedPerSceneDurations?.join(' с, ') }} с)
        </template>
        <template v-else-if="costData.storyDriven"> · план-сценарий (3–6 сцен по 3–9 с)</template>
      </div>
    </div>
    <UiButton variant="ghost" @click="showCostDetails = !showCostDetails">
      {{ showCostDetails ? 'Скрыть' : 'Детали' }}
    </UiButton>
  </div>

  <!-- Разбивка стоимости -->
  <div v-if="showCostDetails && costData" class="flex flex-col gap-1">
    <div class="flex flex-wrap items-center gap-1.5 text-micro">
      <span class="shrink-0 text-muted">Источник данных:</span>
      <span v-if="isDrivenByScenario" :class="[BADGE, 'border-accent-border bg-accent-bg text-accent-text h-auto py-0.5 text-left leading-tight whitespace-normal']">
        <Icon name="mingcute:link-line" class="shrink-0" />
        <span>план сценария ({{ upstream.sceneCountStrategy && strategyLabels[upstream.sceneCountStrategy] }})</span>
      </span>
      <span v-else :class="[BADGE, NEUTRAL_TONE]">параметры видео-блока</span>
    </div>

    <div class="overflow-x-auto rounded-md border border-border">
      <table class="w-full text-sm">
        <thead class="border-b border-divider text-micro text-subtle">
          <tr>
            <th class="px-2 py-1 text-left font-medium">Этап</th>
            <th class="px-2 py-1 text-right font-medium">Кол-во</th>
            <th class="px-2 py-1 text-right font-medium">За ед.</th>
            <th class="px-2 py-1 text-right font-medium">Итого</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in costData.breakdown" :key="item.stage" class="border-b border-divider last:border-0">
            <td class="px-2 py-1">
              <div>{{ item.label }}</div>
              <div class="text-micro text-subtle">{{ item.modelName }}</div>
            </td>
            <td class="px-2 py-1 text-right tnum">{{ item.units }} {{ item.unitLabel }}</td>
            <td class="px-2 py-1 text-right font-mono">{{ formatCost(item.unitPrice) }}</td>
            <td class="px-2 py-1 text-right font-mono font-semibold">{{ formatCost(item.subtotal) }}</td>
          </tr>
        </tbody>
        <tfoot class="border-t border-divider">
          <tr v-if="isDrivenByScenario && costData.minTotal != null && costData.maxTotal != null">
            <td colspan="3" class="px-2 py-1 text-right text-micro text-muted">Диапазон (min / max):</td>
            <td class="px-2 py-1 text-right font-mono text-micro text-muted">
              {{ formatCost(costData.minTotal) }} / {{ formatCost(costData.maxTotal) }}
            </td>
          </tr>
          <tr>
            <td colspan="3" class="px-2 py-1 text-right font-semibold">Итого:</td>
            <td class="px-2 py-1 text-right font-mono font-bold">{{ formatCost(costData.total) }}</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <p
      v-for="(w, i) in costData.warnings"
      :key="i"
      class="flex items-start gap-1.5 rounded-md border border-warning-border bg-warning-bg px-2 py-1 text-micro text-muted"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-warning" />
      <span>{{ w }}</span>
    </p>
  </div>

  <!-- ═══ Быстрые пресеты ═══ -->
  <UiField label="Быстрые пресеты">
    <div class="flex flex-wrap gap-1.5">
      <UiButton
        v-for="preset in costData?.presets ?? []"
        :key="preset.key"
        @click="applyPreset(preset)"
      >
        {{ preset.label }}
      </UiButton>
    </div>
    <SharedFieldHint text="Пресеты устанавливают все настройки сразу. Можно подкорректировать отдельные поля после." />
  </UiField>

  <!-- ═══ Формат видео ═══ -->
  <UiField label="Формат видео">
    <div class="flex flex-wrap gap-1.5">
      <UiButton
        v-for="f in formats"
        :key="f.value"
        :variant="(config.format || 'vertical') === f.value ? 'primary' : 'secondary'"
        @click="updateField('format', f.value)"
      >
        {{ f.label }}
        <span class="text-micro opacity-70">{{ f.hint }}</span>
      </UiButton>
    </div>
  </UiField>

  <!-- ═══ Стратегия моделей ═══ -->
  <UiField label="Стратегия моделей">
    <UiSelect
      :model-value="config.modelStrategy || 'auto'"
      :options="strategyOptions"
      @update:model-value="(v) => updateField('modelStrategy', v)"
    />
    <SharedFieldHint text="Авто-режим анализирует план сценария и сам подбирает модели изображения, видео и TTS. Иначе применяется профиль качества." />
  </UiField>

  <!-- ═══ Проблема доступа ═══ -->
  <div
    v-if="hasAccessIssue"
    class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2"
  >
    <Icon name="mingcute:forbid-circle-line" class="mt-0.5 shrink-0 text-danger" />
    <div class="min-w-0 flex-1">
      <div class="font-semibold">Проблема доступа к моделям</div>
      <div class="text-micro text-muted">
        Одна или несколько выбранных моделей недоступны для текущего API-ключа fal.ai.
        Генерация будет заблокирована до выбора доступной модели.
      </div>
    </div>
  </div>

  <!-- ═══ Модель изображений ═══ -->
  <UiField label="Модель изображений">
    <UiSelect
      :model-value="config.imageModelId || 'fal-ai/flux/dev'"
      :options="imageModelOptions"
      :invalid="isModelBlocked(selectedImageModel)"
      @update:model-value="(v) => updateField('imageModelId', v)"
    />

    <div v-if="selectedImageModel" class="mt-1 flex flex-col gap-1">
      <div class="flex flex-wrap items-center gap-1">
        <span :class="[BADGE, tierTone(selectedImageModel.tier)]">{{ tierLabel(selectedImageModel.tier) }}</span>
        <span
          v-if="selectedImageModel.accessStatus"
          :class="[BADGE, accessStatusTone(selectedImageModel.accessStatus)]"
          :title="selectedImageModel.accessReason"
        >{{ accessStatusLabel(selectedImageModel.accessStatus) }}</span>
        <span v-if="selectedImageModel.avgGenerationTime" class="text-micro text-subtle">
          {{ selectedImageModel.avgGenerationTime }}
        </span>
      </div>

      <p
        v-if="isModelBlocked(selectedImageModel)"
        class="rounded-md border border-danger-border bg-danger-bg px-1.5 py-1 text-micro text-danger"
      >
        {{ selectedImageModel.accessReason || 'Модель недоступна для текущего ключа' }}
      </p>

      <button
        type="button"
        class="cursor-pointer self-start text-micro text-subtle hover:text-muted"
        @click="expandedModelInfo = expandedModelInfo === 'image' ? null : 'image'"
      >
        {{ expandedModelInfo === 'image' ? 'Скрыть детали' : 'Подробнее о модели' }}
      </button>

      <div
        v-if="expandedModelInfo === 'image'"
        class="flex flex-col gap-1 rounded-md border border-border bg-card px-1.5 py-1 text-micro text-muted"
      >
        <div>
          <span class="font-semibold text-success">+</span>
          <span v-for="(s, i) in selectedImageModel.strengths" :key="i">
            {{ s }}{{ i < selectedImageModel.strengths.length - 1 ? ' · ' : '' }}
          </span>
        </div>
        <div>
          <span class="font-semibold text-warning">−</span>
          <span v-for="(t, i) in selectedImageModel.tradeoffs" :key="i">
            {{ t }}{{ i < selectedImageModel.tradeoffs.length - 1 ? ' · ' : '' }}
          </span>
        </div>
      </div>
    </div>
  </UiField>

  <!-- ═══ Модель видео ═══ -->
  <UiField label="Модель видео">
    <UiSelect
      :model-value="config.videoModelId || 'fal-ai/kling-video/v3/standard/text-to-video'"
      :options="videoModelOptions"
      :invalid="isModelBlocked(selectedVideoModel)"
      @update:model-value="(v) => updateField('videoModelId', v)"
    />

    <div v-if="selectedVideoModel" class="mt-1 flex flex-col gap-1">
      <div class="flex flex-wrap items-center gap-1">
        <span :class="[BADGE, tierTone(selectedVideoModel.tier)]">{{ tierLabel(selectedVideoModel.tier) }}</span>
        <span
          v-if="selectedVideoModel.accessStatus"
          :class="[BADGE, accessStatusTone(selectedVideoModel.accessStatus)]"
          :title="selectedVideoModel.accessReason"
        >{{ accessStatusLabel(selectedVideoModel.accessStatus) }}</span>
        <span v-if="selectedVideoModel.avgGenerationTime" class="text-micro text-subtle">
          {{ selectedVideoModel.avgGenerationTime }}
        </span>
      </div>

      <p
        v-if="isModelBlocked(selectedVideoModel)"
        class="rounded-md border border-danger-border bg-danger-bg px-1.5 py-1 text-micro text-danger"
      >
        {{ selectedVideoModel.accessReason || 'Модель недоступна для текущего ключа' }}
      </p>

      <button
        type="button"
        class="cursor-pointer self-start text-micro text-subtle hover:text-muted"
        @click="expandedModelInfo = expandedModelInfo === 'video' ? null : 'video'"
      >
        {{ expandedModelInfo === 'video' ? 'Скрыть детали' : 'Подробнее о модели' }}
      </button>

      <div
        v-if="expandedModelInfo === 'video'"
        class="flex flex-col gap-1 rounded-md border border-border bg-card px-1.5 py-1 text-micro text-muted"
      >
        <div>
          <span class="font-semibold text-success">+</span>
          <span v-for="(s, i) in selectedVideoModel.strengths" :key="i">
            {{ s }}{{ i < selectedVideoModel.strengths.length - 1 ? ' · ' : '' }}
          </span>
        </div>
        <div>
          <span class="font-semibold text-warning">−</span>
          <span v-for="(t, i) in selectedVideoModel.tradeoffs" :key="i">
            {{ t }}{{ i < selectedVideoModel.tradeoffs.length - 1 ? ' · ' : '' }}
          </span>
        </div>
      </div>
    </div>
  </UiField>

  <!-- ═══ Качество ═══ -->
  <UiField label="Качество">
    <div class="flex flex-wrap gap-1.5">
      <UiButton
        v-for="q in qualityOptions"
        :key="q.value"
        :variant="(config.quality || '1080p') === q.value ? 'primary' : 'secondary'"
        @click="updateField('quality', q.value)"
      >
        {{ q.label }}
        <span class="text-micro opacity-70">{{ q.hint }}</span>
      </UiButton>
    </div>
  </UiField>

  <!-- ═══ Количество сцен ═══ -->
  <div>
    <div class="mb-[5px] flex items-center gap-1 text-micro text-muted">
      Количество сцен
      <span
        v-if="isDrivenByScenario"
        :class="[BADGE, 'border-info-border bg-info-bg text-info']"
        title="Значение взято из блока «Сценарий»"
      >
        <Icon name="mingcute:link-line" /> из сценария
      </span>
    </div>
    <div class="flex items-center gap-2">
      <input
        type="range"
        :class="[RANGE, isDrivenByScenario && 'cursor-not-allowed opacity-50']"
        min="2"
        max="8"
        step="1"
        :value="effectiveSceneCount"
        :disabled="isDrivenByScenario"
        @input="updateField('sceneCount', Number(($event.target as HTMLInputElement).value))"
      >
      <span class="tnum w-8 rounded-sm border border-border bg-card text-center font-mono text-sm">
        {{ effectiveSceneCount }}
      </span>
    </div>
    <SharedFieldHint
      :text="isDrivenByScenario
        ? 'Количество сцен зафиксировано блоком «Сценарий» (стратегия бюджета). Чтобы изменить — настройте стратегию в блоке «Сценарий».'
        : 'Сколько сцен и кадров будет в видео: начало, середина и призыв к действию. Больше сцен — больше изображений и клипов, то есть дороже.'"
    />
  </div>

  <!-- ═══ Длительность клипа ═══ -->
  <div>
    <div class="mb-[5px] flex items-center gap-1 text-micro text-muted">
      Длительность клипа
      <span
        v-if="isDrivenByScenario"
        :class="[BADGE, 'border-info-border bg-info-bg text-info']"
        title="Значение взято из блока «Сценарий»"
      >
        <Icon name="mingcute:link-line" /> из сценария
      </span>
    </div>
    <div class="flex items-center gap-2">
      <input
        type="range"
        :class="[RANGE, isDrivenByScenario && 'cursor-not-allowed opacity-50']"
        min="3"
        max="15"
        step="1"
        :value="effectiveClipDuration"
        :disabled="isDrivenByScenario"
        @input="updateField('clipDuration', Number(($event.target as HTMLInputElement).value))"
      >
      <span class="tnum w-14 rounded-sm border border-border bg-card text-center font-mono text-sm">
        {{ effectiveClipDuration }} сек
      </span>
    </div>
    <div class="mt-0.5 text-micro text-subtle">
      Общая длительность ≈ {{ effectiveClipDuration * effectiveSceneCount }} сек
    </div>
    <SharedFieldHint
      :text="isDrivenByScenario
        ? 'Длительность определяется отдельно для каждой сцены из плана сценария. В оценке выше — точные значения каждой сцены.'
        : 'Длительность каждого отдельного клипа. Итого видео — количество сцен × длительность клипа.'"
    />
  </div>

  <!-- ═══ Аудио в видеоклипах ═══
       Toggle актуален только для моделей с встроенным аудио (Kling).
       Wan/Hailuo не имеют native audio — скрываем чекбокс, чтобы не путать. -->
  <UiField v-if="selectedVideoModel?.pricing?.withAudio" label="Аудио в клипах">
    <UiToggle
      :model-value="config.generateAudio !== false"
      label="Генерировать звук в клипах"
      @update:model-value="(v) => updateField('generateAudio', v)"
    />
    <SharedFieldHint :text="`${selectedVideoModel.name} генерирует видео со встроенным звуком. Отключение экономит около половины стоимости клипов, но видео будет без нативного звука.`" />
  </UiField>
  <UiField v-else label="Аудио в клипах">
    <p class="flex items-start gap-1.5 rounded-md border border-info-border bg-info-bg px-2 py-1 text-micro text-muted">
      <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
      <span>
        {{ selectedVideoModel?.name || 'Выбранная модель' }} не поддерживает встроенное аудио в клипах —
        используйте TTS-озвучку или фоновую музыку ниже.
      </span>
    </p>
  </UiField>

  <!-- ═══ Субтитры ═══ -->
  <UiField label="Субтитры">
    <UiToggle
      :model-value="config.subtitlesEnabled !== false"
      label="Добавить субтитры (начало и призыв к действию)"
      @update:model-value="(v) => updateField('subtitlesEnabled', v)"
    />
    <SharedFieldHint text="Текст hook отображается в начале, CTA — в конце видео. Субтитры накладываются при сборке (FFmpeg), стоимость не увеличивается." />
  </UiField>

  <UiField v-if="config.subtitlesEnabled !== false" label="Стиль субтитров (пресет)">
    <VideoSubtitlePresetPicker
      :model-value="config.subtitlePreset || 'classic'"
      compact
      @update:model-value="(v) => updateField('subtitlePreset', v)"
    />
    <SharedFieldHint text="Пресет по умолчанию применяется ко всем видео контейнера. Для отдельного видео его можно перебить в редакторе субтитров после сборки." />
  </UiField>

  <!-- ═══ Озвучка ═══ -->
  <UiField label="Озвучка (TTS)">
    <UiToggle
      :model-value="voiceoverEnabled"
      label="Озвучивать сценарий через TTS"
      @update:model-value="(v) => updateField('voiceoverEnabled', v)"
    />
    <SharedFieldHint text="Генерирует реальную озвучку через fal.ai TTS по voiceoverPlan.lines из плана истории. Каждая сцена синтезируется отдельно и микшуется в единый трек с приглушением музыки." />

    <div v-if="voiceoverEnabled" class="mt-2 flex flex-col gap-2">
      <UiField label="TTS-провайдер">
        <UiSelect
          :model-value="config.voiceoverModelId || (ttsModels.find(m => m.integrated)?.id ?? '')"
          :options="ttsModelOptions"
          @update:model-value="(v) => updateField('voiceoverModelId', v || null)"
        />
        <div v-if="selectedTtsModel" class="mt-1 flex flex-col gap-1">
          <div class="flex flex-wrap items-center gap-1">
            <span :class="[BADGE, tierTone(selectedTtsModel.tier)]">{{ tierLabel(selectedTtsModel.tier) }}</span>
            <span
              v-if="selectedTtsModel.accessStatus"
              :class="[BADGE, accessStatusTone(selectedTtsModel.accessStatus)]"
            >{{ accessStatusLabel(selectedTtsModel.accessStatus) }}</span>
          </div>
          <p
            v-if="isModelBlocked(selectedTtsModel)"
            class="rounded-md border border-danger-border bg-danger-bg px-1.5 py-1 text-micro text-danger"
          >
            {{ selectedTtsModel.accessReason || 'TTS-модель недоступна' }}
          </p>
        </div>
      </UiField>

      <UiField label="Язык озвучки">
        <div class="flex gap-1.5">
          <UiButton
            v-for="l in languageOptions"
            :key="l.value"
            :variant="(config.voiceoverLanguage || 'en') === l.value ? 'primary' : 'secondary'"
            @click="updateField('voiceoverLanguage', l.value)"
          >
            {{ l.label }}
          </UiButton>
        </div>
      </UiField>

      <UiField
        label="Voice ID (опционально)"
        hint="Kokoro: af_heart, af_bella, am_adam. PlayAI и ElevenLabs — свой идентификатор голоса."
      >
        <UiInput
          mono
          placeholder="Оставьте пустым для голоса по умолчанию"
          :model-value="config.voiceoverVoiceId || ''"
          @update:model-value="(v) => updateField('voiceoverVoiceId', v || null)"
        />
      </UiField>

      <UiField label="Темп речи">
        <div class="flex flex-wrap gap-1.5">
          <UiButton
            v-for="p in pacingOptions"
            :key="p.value"
            :variant="(config.voiceoverPacing || 'moderate') === p.value ? 'primary' : 'secondary'"
            @click="updateField('voiceoverPacing', p.value)"
          >
            {{ p.label }}
            <span class="text-micro opacity-70">{{ p.hint }}</span>
          </UiButton>
        </div>
      </UiField>

      <UiField label="Если озвучка длиннее сцены">
        <UiSelect
          :model-value="config.voiceoverReconciliation || 'compress_audio'"
          :options="reconciliationOptions"
          @update:model-value="(v) => updateField('voiceoverReconciliation', v)"
        />
      </UiField>

      <div v-if="config.enableMusic !== false">
        <div class="mb-[5px] flex items-center gap-1 text-micro text-muted">
          Громкость музыки во время озвучки
          <span class="tnum font-mono">{{ Math.round((config.musicVolumeWithVoiceover ?? 0.12) * 100) }}%</span>
        </div>
        <input
          type="range"
          :class="RANGE"
          min="0"
          max="0.5"
          step="0.02"
          :value="config.musicVolumeWithVoiceover ?? 0.12"
          @input="updateField('musicVolumeWithVoiceover', Number(($event.target as HTMLInputElement).value))"
        >
        <div class="mt-0.5 text-micro text-subtle">
          Насколько приглушить фоновую музыку, когда говорит озвучка. 0 % — полная тишина музыки под голосом.
        </div>
      </div>

      <p class="flex items-start gap-1.5 rounded-md border border-info-border bg-info-bg px-2 py-1 text-micro text-muted">
        <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
        <span>
          Озвучка работает только если план сценария содержит строки озвучки (voiceoverPlan).
          Без сценарного режима озвучка будет пропущена с предупреждением.
        </span>
      </p>
    </div>
  </UiField>

  <!-- ═══ Lip-sync ═══ -->
  <div>
    <div class="mb-[5px] flex items-center gap-1 text-micro text-muted">
      AI Lip-sync персонажа
      <span :class="[BADGE, 'border-warning-border bg-warning-bg text-warning']">Premium</span>
    </div>
    <UiToggle
      :model-value="config.lipSyncEnabled === true"
      :disabled="lipSyncGated"
      label="Синхронизировать губы с репликой персонажа"
      @update:model-value="(v) => updateField('lipSyncEnabled', v)"
    />
    <SharedFieldHint
      :text="lipSyncGated
        ? 'Заблокировано на стратегии «Черновик». Переключите стратегию или примените пресет максимального качества, чтобы активировать lip-sync.'
        : 'Берёт каждую сцену с репликой, синтезирует TTS и прогоняет через fal.ai sync-lipsync. На выходе клип, в котором персонаж реально произносит свою реплику. Биллинг ~$0.07 за секунду каждой синхронизированной сцены плюс TTS.'"
    />

    <p
      v-if="config.lipSyncEnabled === true && !lipSyncGated"
      class="mt-2 flex items-start gap-1.5 rounded-md border border-warning-border bg-warning-bg px-2 py-1 text-micro text-muted"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-warning" />
      <span>
        Lip-sync обрабатывает только сцены с человеком-протагонистом и заполненной репликой.
        Если в сценарии нет таких сцен, шаг автоматически пропустится.
      </span>
    </p>
  </div>

  <!-- ═══ Музыка ═══ -->
  <UiField label="Фоновая музыка">
    <UiToggle
      :model-value="config.enableMusic !== false"
      label="Включить музыку"
      @update:model-value="(v) => updateField('enableMusic', v)"
    />

    <div v-if="config.enableMusic !== false" class="mt-2 flex flex-col gap-2">
      <UiSelect
        :model-value="config.musicMood || 'energetic upbeat'"
        :options="musicMoods"
        @update:model-value="(v) => updateField('musicMood', v)"
      />
      <div>
        <div class="mb-[5px] flex items-center gap-1 text-micro text-muted">
          Громкость музыки
          <span class="tnum font-mono">{{ Math.round((config.musicVolume ?? 0.3) * 100) }}%</span>
        </div>
        <input
          type="range"
          :class="RANGE"
          min="0"
          max="1"
          step="0.05"
          :value="config.musicVolume ?? 0.3"
          @input="updateField('musicVolume', Number(($event.target as HTMLInputElement).value))"
        >
        <div class="mt-0.5 text-micro text-subtle">
          Базовая громкость музыки. Если озвучка включена, во время речи применяется приглушение — отдельная настройка выше.
        </div>
      </div>
    </div>
  </UiField>
</template>
