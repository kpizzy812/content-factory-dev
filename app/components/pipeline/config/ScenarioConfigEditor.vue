<script setup lang="ts">
// FavoritePrompts picker живёт в ScenarioConfig.vue (quick-config), здесь намеренно не дублируется — см. .claude/agent-memory/architect/favorite_prompts_finalization.md
import { defaultScenarioNodeConfig } from '~~/shared/types/scenario'
import type {
  ScenarioNodeAppConfig,
  ScenarioNodeStorytellingConfig,
  ScenarioNodeSubtitlesConfig,
  ScenarioNodeVoiceoverConfig,
} from '~~/shared/types/scenario'

const props = defineProps<{
  open: boolean
  config: Record<string, any>
}>()

const emit = defineEmits<{
  close: []
  save: [config: Record<string, any>]
}>()

// ─── Tabs ─────────────────────────────────────────────

type Tab = 'storytelling' | 'subtitles' | 'app' | 'voiceover'
const activeTab = ref<Tab>('storytelling')

const tabs: Array<{ key: Tab, label: string, icon: string }> = [
  { key: 'storytelling', label: 'Сценарий', icon: 'mingcute:movie-line' },
  { key: 'subtitles', label: 'Субтитры', icon: 'mingcute:text-line' },
  { key: 'app', label: 'Приложение', icon: 'mingcute:apps-line' },
  { key: 'voiceover', label: 'Озвучка', icon: 'mingcute:voice-line' },
]

const aiSectionOptions = [
  { value: 'all', label: 'Все секции' },
  { value: 'storytelling', label: 'Сценарий' },
  { value: 'subtitles', label: 'Субтитры' },
  { value: 'app', label: 'Приложение' },
  { value: 'voiceover', label: 'Озвучка' },
]

const protagonistOptions = [
  { value: 'auto', label: 'Автоматически' },
  { value: 'person', label: 'Человек' },
  { value: 'object', label: 'Предмет / Продукт' },
  { value: 'abstract', label: 'Концепт' },
]

const continuityOptions = [
  { value: 'strict', label: 'Строгая' },
  { value: 'moderate', label: 'Умеренная' },
  { value: 'relaxed', label: 'Свободная' },
]

const sceneCountOptions = [
  { value: 'minimal', label: 'Минимум — 3 сцены × 3–4 с (≈ $1)' },
  { value: 'auto', label: 'Авто — 3–5 сцен × 3–6 с (≈ $2)' },
  { value: 'detailed', label: 'Детальная — 4–5 сцен × 4–7 с (≈ $2.5–3.5)' },
  { value: 'cinematic', label: 'Кинематографичная — 5–6 сцен × 6–9 с (≈ $4–5)' },
]

const appIntegrationOptions = [
  { value: 'native', label: 'Нативная' },
  { value: 'prominent', label: 'Заметная' },
  { value: 'subtle', label: 'Лёгкая' },
]

const variationOptions = [
  { value: 'low', label: 'Низкая' },
  { value: 'medium', label: 'Средняя' },
  { value: 'high', label: 'Высокая' },
]

const readabilityOptions = [
  { value: 'easy', label: 'Лёгкий' },
  { value: 'normal', label: 'Обычный' },
  { value: 'dense', label: 'Плотный' },
]

const placementOptions = [
  { value: 'auto', label: 'Авто' },
  { value: 'top', label: 'Сверху' },
  { value: 'center', label: 'Центр' },
  { value: 'bottom', label: 'Снизу' },
]

const maxLinesOptions = [
  { value: 1, label: '1 строка' },
  { value: 2, label: '2 строки' },
  { value: 3, label: '3 строки' },
]

const contextModeOptions = [
  { value: 'full', label: 'Полный' },
  { value: 'light', label: 'Лёгкий' },
  { value: 'manual_only', label: 'Только ручной' },
  { value: 'off', label: 'Выключен' },
]

const appCenterOptions = [
  { value: 'strong', label: 'Сильная — центр сюжета' },
  { value: 'soft', label: 'Мягкая — органичная' },
  { value: 'background', label: 'Фоновая' },
]

const pacingOptions = [
  { value: 'slow', label: 'Медленный' },
  { value: 'moderate', label: 'Обычный' },
  { value: 'fast', label: 'Быстрый' },
]

const syncModeOptions = [
  { value: 'scene', label: 'По сценам' },
  { value: 'continuous', label: 'Непрерывный' },
  { value: 'highlights', label: 'Ключевые моменты' },
]

// ─── Local config (deep clone on open) ────────────────

const d = defaultScenarioNodeConfig

const localStorytelling = reactive<ScenarioNodeStorytellingConfig>({ ...d.storytelling })
const localSubtitles = reactive<ScenarioNodeSubtitlesConfig>({ ...d.subtitles })
const localApp = reactive<ScenarioNodeAppConfig>({ ...d.app })
const localVoiceover = reactive<ScenarioNodeVoiceoverConfig>({ ...d.voiceover })

watch(() => props.open, (open) => {
  if (!open) return
  activeTab.value = 'storytelling'
  const c = props.config

  // Storytelling
  const s = c.storytelling ?? {}
  Object.assign(localStorytelling, {
    ...d.storytelling,
    ...s,
    emotionalProgression: [...(s.emotionalProgression ?? d.storytelling.emotionalProgression)],
    environmentCues: [...(s.environmentCues ?? d.storytelling.environmentCues)],
    antiLoopRules: [...(s.antiLoopRules ?? d.storytelling.antiLoopRules)],
    negativeRules: [...(s.negativeRules ?? d.storytelling.negativeRules)],
  })

  // Subtitles
  Object.assign(localSubtitles, { ...d.subtitles, ...(c.subtitles ?? {}) })

  // App
  Object.assign(localApp, { ...d.app, ...(c.app ?? {}) })

  // Voiceover
  Object.assign(localVoiceover, { ...d.voiceover, ...(c.voiceover ?? {}) })
}, { immediate: true })

// ─── AI autofill (section-level) ──────────────────────

const aiLoading = ref(false)
const aiError = ref<string | null>(null)
const aiPrompt = ref('')
const aiSection = ref<'all' | Tab>('all')
const aiResult = ref<Record<string, any> | null>(null)

const store = usePipelineEditorStore()

async function generateAi() {
  if (!aiPrompt.value.trim()) return
  aiLoading.value = true
  aiError.value = null
  aiResult.value = null

  try {
    const res = await $fetch<{ data: any }>('/api/ai/suggest/scenario-config', {
      method: 'POST',
      body: {
        prompt: aiPrompt.value.trim(),
        section: aiSection.value,
        currentConfig: {
          storytelling: { ...localStorytelling },
          subtitles: { ...localSubtitles },
          app: { ...localApp },
          voiceover: { ...localVoiceover },
        },
        pipelineId: store.pipelineId ?? undefined,
        nodeCanvasId: store.selectedNodeId ?? undefined,
      },
    })
    aiResult.value = res.data
  } catch (e: any) {
    aiError.value = e?.data?.message || e?.message || 'Ошибка AI-сервиса'
  } finally {
    aiLoading.value = false
  }
}

function applyAiResult() {
  if (!aiResult.value?.suggestions) return
  const s = aiResult.value.suggestions

  if (s.storytelling) Object.assign(localStorytelling, s.storytelling)
  if (s.subtitles) Object.assign(localSubtitles, s.subtitles)
  if (s.app) Object.assign(localApp, s.app)
  if (s.voiceover) Object.assign(localVoiceover, s.voiceover)

  aiResult.value = null
  aiPrompt.value = ''
}

function dismissAi() {
  aiResult.value = null
  aiError.value = null
}

// ─── Save / Close ─────────────────────────────────────

function save() {
  const newConfig = {
    ...props.config,
    storytelling: { ...localStorytelling },
    subtitles: { ...localSubtitles },
    app: { ...localApp },
    voiceover: { ...localVoiceover },
  }
  emit('save', newConfig)
}

function close() {
  emit('close')
}
</script>

<template>
  <UiModal :open="open" title="Настройка сценариев" size="lg" @close="close">
    <div class="flex flex-col gap-3">
      <!-- AI-генерация конфигурации -->
      <div class="flex flex-col gap-1.5 rounded-md border border-border bg-card p-2.5">
        <div class="flex items-center gap-1.5 font-medium text-muted">
          <Icon name="mingcute:sparkles-2-line" class="text-accent-text" />
          AI-генерация конфигурации
        </div>

        <div class="flex gap-1.5">
          <UiSelect
            v-model="aiSection"
            :options="aiSectionOptions"
            class="w-32 shrink-0"
          />
          <UiInput
            v-model="aiPrompt"
            class="flex-1"
            placeholder="Опишите задачу: «энергичный ролик про фитнес-приложение с яркими субтитрами»"
            :disabled="aiLoading"
            @keyup.enter="generateAi"
          />
          <UiButton
            variant="primary"
            icon-only
            size="md"
            :disabled="!aiPrompt.trim()"
            :loading="aiLoading"
            title="Сгенерировать"
            @click="generateAi"
          >
            <Icon v-if="!aiLoading" name="mingcute:send-line" />
          </UiButton>
        </div>

        <p v-if="aiError" class="text-sm text-danger">{{ aiError }}</p>

        <div
          v-if="aiResult?.suggestions"
          class="flex flex-col gap-1.5 rounded-md border border-accent-border bg-accent-bg p-2"
        >
          <p v-if="aiResult.reasoning" class="flex items-start gap-1 text-micro text-muted">
            <Icon name="mingcute:bulb-line" class="mt-0.5 shrink-0 text-info" />
            {{ aiResult.reasoning }}
          </p>
          <div class="text-micro text-subtle">
            Секции: {{ Object.keys(aiResult.suggestions).join(', ') }}
          </div>
          <div class="flex gap-1.5">
            <UiButton variant="primary" @click="applyAiResult">
              <Icon name="mingcute:check-line" />
              Применить
            </UiButton>
            <UiButton variant="ghost" @click="dismissAi">Отклонить</UiButton>
          </div>
        </div>
      </div>

      <!-- Вкладки -->
      <div role="tablist" class="sticky top-0 z-10 -mt-1 flex gap-1 border-b border-divider bg-raised pt-1">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          role="tab"
          type="button"
          class="flex cursor-pointer items-center gap-1 border-b-2 px-2 pb-1.5 font-medium transition-colors duration-(--duration-fast) ease-out"
          :class="activeTab === tab.key
            ? 'border-accent text-fg'
            : 'border-transparent text-muted hover:text-fg'"
          @click="activeTab = tab.key"
        >
          <Icon :name="tab.icon" />
          {{ tab.label }}
        </button>
      </div>

      <!-- ═══ Сценарий ═══ -->
      <div v-show="activeTab === 'storytelling'" class="flex flex-col gap-3">
        <UiField label="Режим сторителлинга">
          <UiToggle
            v-model="localStorytelling.enabled"
            label="Включить полноценный сторителлинг (StoryPlan)"
          />
          <SharedFieldHint text="Каждый вариант получит драматургическую дугу, protagonist bible, scene cards и continuity bible." />
        </UiField>

        <div class="flex flex-col gap-3" :class="!localStorytelling.enabled && 'pointer-events-none opacity-40'">
          <UiField label="Тип протагониста">
            <UiSelect v-model="localStorytelling.protagonistMode" :options="protagonistOptions" />
          </UiField>

          <div class="grid grid-cols-2 gap-3">
            <UiField label="Строгость continuity">
              <UiSelect v-model="localStorytelling.continuityStrictness" :options="continuityOptions" />
            </UiField>

            <UiField
              label="Бюджет сценария"
              hint="Каждая сцена — отдельный платный AI-вызов. Видео-блок синхронизируется с этим выбором."
            >
              <UiSelect v-model="localStorytelling.sceneCountStrategy" :options="sceneCountOptions" />
            </UiField>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <UiField label="Стиль интеграции приложения">
              <UiSelect v-model="localStorytelling.appIntegrationStyle" :options="appIntegrationOptions" />
            </UiField>

            <UiField label="Интенсивность вариаций">
              <UiSelect v-model="localStorytelling.variationIntensity" :options="variationOptions" />
            </UiField>
          </div>

          <UiField label="Дуга трансформации">
            <UiTextarea
              v-model="localStorytelling.transformationArcTemplate"
              :rows="2"
              maxlength="300"
              placeholder="Как герой меняется от начала к концу: разочарование → интерес → открытие → удовлетворение"
            />
          </UiField>

          <UiField label="Палитра / Настроение">
            <UiInput
              v-model="localStorytelling.paletteMood"
              maxlength="100"
              placeholder="тёплый и уютный, яркий и энергичный…"
            />
          </UiField>

          <UiField label="Эмоциональная прогрессия">
            <SharedTagInput
              :model-value="localStorytelling.emotionalProgression"
              placeholder="curiosity, excitement…"
              @update:model-value="(v) => localStorytelling.emotionalProgression = v"
            />
          </UiField>

          <UiField label="Подсказки окружения">
            <SharedTagInput
              :model-value="localStorytelling.environmentCues"
              placeholder="кофейня, спортзал…"
              @update:model-value="(v) => localStorytelling.environmentCues = v"
            />
          </UiField>

          <UiField label="Правила против повторов">
            <SharedTagInput
              :model-value="localStorytelling.antiLoopRules"
              placeholder="не повторять сцену утро…"
              @update:model-value="(v) => localStorytelling.antiLoopRules = v"
            />
          </UiField>

          <UiField label="Глобальные запреты">
            <SharedTagInput
              :model-value="localStorytelling.negativeRules"
              placeholder="без насилия, без политики…"
              @update:model-value="(v) => localStorytelling.negativeRules = v"
            />
          </UiField>
        </div>
      </div>

      <!-- ═══ Субтитры ═══ -->
      <div v-show="activeTab === 'subtitles'" class="flex flex-col gap-3">
        <UiField label="Субтитры">
          <UiToggle v-model="localSubtitles.enabled" label="Генерировать субтитры для каждой сцены" />
        </UiField>

        <div class="flex flex-col gap-3" :class="!localSubtitles.enabled && 'pointer-events-none opacity-40'">
          <div class="grid grid-cols-2 gap-3">
            <UiField label="Уровень читабельности">
              <UiSelect v-model="localSubtitles.readabilityLevel" :options="readabilityOptions" />
            </UiField>

            <UiField label="Размещение">
              <UiSelect v-model="localSubtitles.placementStrategy" :options="placementOptions" />
            </UiField>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <UiField label="Макс. длина строки">
              <UiInput v-model.number="localSubtitles.maxLineLength" type="number" min="20" max="80" />
              <SharedFieldHint text="Символов на строку (20–80)." />
            </UiField>

            <UiField label="Макс. строк">
              <UiSelect
                :model-value="localSubtitles.maxLines"
                :options="maxLinesOptions"
                @update:model-value="(v) => localSubtitles.maxLines = Number(v)"
              />
            </UiField>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <UiField label="Избегать перекрытия">
              <UiToggle v-model="localSubtitles.avoidOcclusion" label="Не перекрывать лица и интерфейс" />
            </UiField>

            <UiField label="Единый стиль">
              <UiToggle v-model="localSubtitles.styleConsistency" label="Одинаковый стиль во всех сценах" />
            </UiField>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <UiField label="Вариации по сценам">
              <UiToggle v-model="localSubtitles.sceneVariation" label="Менять стиль между сценами" />
            </UiField>

            <UiField label="Авто-выделение">
              <UiToggle v-model="localSubtitles.autoHighlight" label="Выделять ключевые слова" />
            </UiField>
          </div>
        </div>
      </div>

      <!-- ═══ Приложение ═══ -->
      <div v-show="activeTab === 'app'" class="flex flex-col gap-3">
        <UiField label="Приложение из библиотеки">
          <PipelineConfigScenarioAppSelector
            v-model="localApp.appId"
            :context-mode="localApp.contextMode"
          />
        </UiField>

        <div class="grid grid-cols-2 gap-3">
          <UiField label="Режим контекста">
            <UiSelect v-model="localApp.contextMode" :options="contextModeOptions" />
            <SharedFieldHint text="Полный — AI получает всё (scenarioContext, creativeAngles). Лёгкий — только name и description." />
          </UiField>

          <UiField label="Центрированность приложения">
            <UiSelect v-model="localApp.appCenterStrength" :options="appCenterOptions" />
          </UiField>
        </div>

        <UiField v-if="localApp.contextMode !== 'off'" label="Ручной контекст (override)">
          <UiTextarea
            v-model="localApp.manualOverrideSummary"
            :rows="3"
            maxlength="500"
            placeholder="Произвольное описание приложения, если хотите переопределить данные из библиотеки…"
          />
          <SharedFieldHint text="Если заполнено — используется вместо данных из библиотеки приложений." />
        </UiField>
      </div>

      <!-- ═══ Озвучка ═══ -->
      <div v-show="activeTab === 'voiceover'" class="flex flex-col gap-3">
        <UiField label="Озвучка">
          <UiToggle v-model="localVoiceover.enabled" label="Генерировать план озвучки (VoiceoverPlan)" />
          <SharedFieldHint text="AI создаст персону рассказчика, текст для каждой сцены и заметки по синхронизации." />
        </UiField>

        <div class="flex flex-col gap-3" :class="!localVoiceover.enabled && 'pointer-events-none opacity-40'">
          <UiField label="Персона рассказчика">
            <UiInput
              v-model="localVoiceover.narratorPersona"
              maxlength="150"
              placeholder="спокойный мужской голос 30 лет, энергичная женщина…"
            />
          </UiField>

          <div class="grid grid-cols-2 gap-3">
            <UiField label="Темп">
              <UiSelect v-model="localVoiceover.pacing" :options="pacingOptions" />
            </UiField>

            <UiField label="Режим синхронизации">
              <UiSelect v-model="localVoiceover.syncMode" :options="syncModeOptions" />
            </UiField>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <UiButton variant="ghost" @click="close">Отмена</UiButton>
      <UiButton variant="primary" @click="save">
        <Icon name="mingcute:check-line" />
        Сохранить
      </UiButton>
    </template>
  </UiModal>
</template>
