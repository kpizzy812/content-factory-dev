<script setup lang="ts">
// FavoritePrompts picker живёт в ScenarioConfig.vue (quick-config), здесь намеренно не дублируется — см. .claude/agent-memory/architect/favorite_prompts_finalization.md
import { defaultScenarioNodeConfig } from '~~/shared/types/scenario'
import type {
  ScenarioNodeStorytellingConfig,
  ScenarioNodeSubtitlesConfig,
  ScenarioNodeAppConfig,
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

const tabs: Array<{ key: Tab; label: string; icon: string }> = [
  { key: 'storytelling', label: 'Сценарий', icon: 'mingcute:movie-line' },
  { key: 'subtitles', label: 'Субтитры', icon: 'mingcute:text-line' },
  { key: 'app', label: 'Приложение', icon: 'mingcute:apps-line' },
  { key: 'voiceover', label: 'Озвучка', icon: 'mingcute:voice-line' },
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

// ─── Tag input helper ─────────────────────────────────

const tagInputs = reactive<Record<string, string>>({})

function addTag(arr: string[], inputKey: string) {
  const val = (tagInputs[inputKey] ?? '').trim()
  if (val && !arr.includes(val)) {
    arr.push(val)
  }
  tagInputs[inputKey] = ''
}

function removeTag(arr: string[], index: number) {
  arr.splice(index, 1)
}

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
  <dialog class="modal" :class="{ 'modal-open': open }">
    <div class="modal-box max-w-3xl max-h-[85vh] flex flex-col p-0">
      <!-- Header -->
      <div class="flex items-center gap-2 px-4 py-3 border-b border-base-300">
        <Icon name="mingcute:document-line" class="text-primary text-lg" />
        <h3 class="font-bold text-sm flex-1">Настройка сценариев</h3>
        <button class="btn btn-ghost btn-xs btn-square" @click="close">
          <Icon name="mingcute:close-line" />
        </button>
      </div>

      <!-- AI Autofill Panel -->
      <div class="px-4 py-2 border-b border-base-300 bg-base-200/30">
        <div class="flex items-center gap-1.5 mb-1.5">
          <Icon name="mingcute:sparkles-2-line" class="text-primary text-sm" />
          <span class="text-xs font-medium text-base-content/70">AI-генерация конфигурации</span>
        </div>
        <div class="flex gap-1.5">
          <select v-model="aiSection" class="select select-xs w-28 shrink-0">
            <option value="all">Все секции</option>
            <option value="storytelling">Сценарий</option>
            <option value="subtitles">Субтитры</option>
            <option value="app">Приложение</option>
            <option value="voiceover">Озвучка</option>
          </select>
          <input
            v-model="aiPrompt"
            type="text"
            class="input input-xs flex-1"
            placeholder="Опишите задачу: «энергичный ролик про фитнес-приложение с яркими субтитрами»"
            :disabled="aiLoading"
            @keyup.enter="generateAi"
          />
          <button
            type="button"
            class="btn btn-primary btn-xs btn-square"
            :disabled="!aiPrompt.trim() || aiLoading"
            @click="generateAi"
          >
            <span v-if="aiLoading" class="loading loading-spinner loading-xs" />
            <Icon v-else name="mingcute:send-line" />
          </button>
        </div>

        <!-- AI Error -->
        <div v-if="aiError" class="mt-1.5 text-xs text-error">{{ aiError }}</div>

        <!-- AI Result preview -->
        <div v-if="aiResult?.suggestions" class="mt-2 p-2 rounded-box border border-primary/20 bg-primary/5 space-y-1.5">
          <div class="text-[10px] text-base-content/60" v-if="aiResult.reasoning">
            <Icon name="mingcute:bulb-line" class="inline text-info mr-0.5" />
            {{ aiResult.reasoning }}
          </div>
          <div class="text-[10px] text-base-content/50">
            Секции: {{ Object.keys(aiResult.suggestions).join(', ') }}
          </div>
          <div class="flex gap-1">
            <button class="btn btn-primary btn-xs" @click="applyAiResult">
              <Icon name="mingcute:check-line" class="text-[10px]" />
              Применить
            </button>
            <button class="btn btn-ghost btn-xs" @click="dismissAi">Отклонить</button>
          </div>
        </div>
      </div>

      <!-- Tabs -->
      <div role="tablist" class="tabs tabs-bordered px-4 pt-2 shrink-0">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          role="tab"
          class="tab gap-1 text-xs"
          :class="{ 'tab-active': activeTab === tab.key }"
          @click="activeTab = tab.key"
        >
          <Icon :name="tab.icon" class="text-sm" />
          {{ tab.label }}
        </button>
      </div>

      <!-- Tab content (scrollable) -->
      <div class="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        <!-- ═══ STORYTELLING TAB ═══ -->
        <div v-show="activeTab === 'storytelling'" class="space-y-3">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Режим сторителлинга</legend>
            <label class="flex items-center gap-2 cursor-pointer">
              <input v-model="localStorytelling.enabled" type="checkbox" class="toggle toggle-sm toggle-primary" />
              <span class="text-xs">Включить полноценный сторителлинг (StoryPlan)</span>
            </label>
            <SharedFieldHint text="Каждый вариант получит драматургическую дугу, protagonist bible, scene cards и continuity bible." />
          </fieldset>

          <div :class="{ 'opacity-40 pointer-events-none': !localStorytelling.enabled }" class="space-y-3">
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Тип протагониста</legend>
              <select v-model="localStorytelling.protagonistMode" class="select select-sm w-full">
                <option value="auto">Автоматически</option>
                <option value="person">Человек</option>
                <option value="object">Предмет / Продукт</option>
                <option value="abstract">Концепт</option>
              </select>
            </fieldset>

            <div class="grid grid-cols-2 gap-3">
              <fieldset class="fieldset">
                <legend class="fieldset-legend">Строгость continuity</legend>
                <select v-model="localStorytelling.continuityStrictness" class="select select-sm w-full">
                  <option value="strict">Строгая</option>
                  <option value="moderate">Умеренная</option>
                  <option value="relaxed">Свободная</option>
                </select>
              </fieldset>

              <fieldset class="fieldset">
                <legend class="fieldset-legend">Бюджет сценария</legend>
                <select v-model="localStorytelling.sceneCountStrategy" class="select select-sm w-full">
                  <option value="minimal">Минимум — 3 сцены × 3-4с (≈ $1)</option>
                  <option value="auto">Авто — 3-5 сцен × 3-6с (≈ $2)</option>
                  <option value="detailed">Детальная — 4-5 сцен × 4-7с (≈ $2.5-3.5)</option>
                  <option value="cinematic">Кинематографичная — 5-6 сцен × 6-9с (≈ $4-5)</option>
                </select>
                <p class="fieldset-label text-[10px] text-base-content/60 mt-1">
                  Каждая сцена = отдельный платный AI-вызов. Видео-блок ниже синхронизируется с этим выбором.
                </p>
              </fieldset>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <fieldset class="fieldset">
                <legend class="fieldset-legend">Стиль интеграции приложения</legend>
                <select v-model="localStorytelling.appIntegrationStyle" class="select select-sm w-full">
                  <option value="native">Нативная</option>
                  <option value="prominent">Заметная</option>
                  <option value="subtle">Лёгкая</option>
                </select>
              </fieldset>

              <fieldset class="fieldset">
                <legend class="fieldset-legend">Интенсивность вариаций</legend>
                <select v-model="localStorytelling.variationIntensity" class="select select-sm w-full">
                  <option value="low">Низкая</option>
                  <option value="medium">Средняя</option>
                  <option value="high">Высокая</option>
                </select>
              </fieldset>
            </div>

            <fieldset class="fieldset">
              <legend class="fieldset-legend">Дуга трансформации</legend>
              <textarea
                v-model="localStorytelling.transformationArcTemplate"
                class="textarea textarea-sm w-full"
                rows="2"
                placeholder="Как герой меняется от начала к концу: разочарование → интерес → открытие → удовлетворение"
                maxlength="300"
              />
            </fieldset>

            <fieldset class="fieldset">
              <legend class="fieldset-legend">Палитра / Настроение</legend>
              <input
                v-model="localStorytelling.paletteMood"
                type="text"
                class="input input-sm w-full"
                placeholder="тёплый и уютный, яркий и энергичный..."
                maxlength="100"
              />
            </fieldset>

            <!-- Tag fields -->
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Эмоциональная прогрессия</legend>
              <div class="flex flex-wrap gap-1 mb-1">
                <span
                  v-for="(tag, i) in localStorytelling.emotionalProgression"
                  :key="i"
                  class="badge badge-sm badge-primary gap-0.5"
                >
                  {{ tag }}
                  <button type="button" class="text-[9px]" @click="removeTag(localStorytelling.emotionalProgression, i)">&times;</button>
                </span>
              </div>
              <div class="flex gap-1">
                <input
                  v-model="tagInputs.emotions"
                  type="text"
                  class="input input-xs flex-1"
                  placeholder="curiosity, excitement..."
                  @keyup.enter="addTag(localStorytelling.emotionalProgression, 'emotions')"
                />
                <button type="button" class="btn btn-xs btn-ghost" @click="addTag(localStorytelling.emotionalProgression, 'emotions')">+</button>
              </div>
            </fieldset>

            <fieldset class="fieldset">
              <legend class="fieldset-legend">Подсказки окружения</legend>
              <div class="flex flex-wrap gap-1 mb-1">
                <span
                  v-for="(tag, i) in localStorytelling.environmentCues"
                  :key="i"
                  class="badge badge-sm badge-info gap-0.5"
                >
                  {{ tag }}
                  <button type="button" class="text-[9px]" @click="removeTag(localStorytelling.environmentCues, i)">&times;</button>
                </span>
              </div>
              <div class="flex gap-1">
                <input
                  v-model="tagInputs.envCues"
                  type="text"
                  class="input input-xs flex-1"
                  placeholder="кофейня, спортзал..."
                  @keyup.enter="addTag(localStorytelling.environmentCues, 'envCues')"
                />
                <button type="button" class="btn btn-xs btn-ghost" @click="addTag(localStorytelling.environmentCues, 'envCues')">+</button>
              </div>
            </fieldset>

            <fieldset class="fieldset">
              <legend class="fieldset-legend">Anti-loop правила</legend>
              <div class="flex flex-wrap gap-1 mb-1">
                <span
                  v-for="(tag, i) in localStorytelling.antiLoopRules"
                  :key="i"
                  class="badge badge-sm badge-warning gap-0.5"
                >
                  {{ tag }}
                  <button type="button" class="text-[9px]" @click="removeTag(localStorytelling.antiLoopRules, i)">&times;</button>
                </span>
              </div>
              <div class="flex gap-1">
                <input
                  v-model="tagInputs.antiLoop"
                  type="text"
                  class="input input-xs flex-1"
                  placeholder="не повторять сцену утро..."
                  @keyup.enter="addTag(localStorytelling.antiLoopRules, 'antiLoop')"
                />
                <button type="button" class="btn btn-xs btn-ghost" @click="addTag(localStorytelling.antiLoopRules, 'antiLoop')">+</button>
              </div>
            </fieldset>

            <fieldset class="fieldset">
              <legend class="fieldset-legend">Глобальные запреты</legend>
              <div class="flex flex-wrap gap-1 mb-1">
                <span
                  v-for="(tag, i) in localStorytelling.negativeRules"
                  :key="i"
                  class="badge badge-sm badge-error gap-0.5"
                >
                  {{ tag }}
                  <button type="button" class="text-[9px]" @click="removeTag(localStorytelling.negativeRules, i)">&times;</button>
                </span>
              </div>
              <div class="flex gap-1">
                <input
                  v-model="tagInputs.negative"
                  type="text"
                  class="input input-xs flex-1"
                  placeholder="без насилия, без политики..."
                  @keyup.enter="addTag(localStorytelling.negativeRules, 'negative')"
                />
                <button type="button" class="btn btn-xs btn-ghost" @click="addTag(localStorytelling.negativeRules, 'negative')">+</button>
              </div>
            </fieldset>
          </div>
        </div>

        <!-- ═══ SUBTITLES TAB ═══ -->
        <div v-show="activeTab === 'subtitles'" class="space-y-3">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Субтитры</legend>
            <label class="flex items-center gap-2 cursor-pointer">
              <input v-model="localSubtitles.enabled" type="checkbox" class="toggle toggle-sm toggle-primary" />
              <span class="text-xs">Генерировать субтитры для каждой сцены</span>
            </label>
          </fieldset>

          <div :class="{ 'opacity-40 pointer-events-none': !localSubtitles.enabled }" class="space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <fieldset class="fieldset">
                <legend class="fieldset-legend">Уровень читабельности</legend>
                <select v-model="localSubtitles.readabilityLevel" class="select select-sm w-full">
                  <option value="easy">Лёгкий</option>
                  <option value="normal">Обычный</option>
                  <option value="dense">Плотный</option>
                </select>
              </fieldset>

              <fieldset class="fieldset">
                <legend class="fieldset-legend">Размещение</legend>
                <select v-model="localSubtitles.placementStrategy" class="select select-sm w-full">
                  <option value="auto">Авто</option>
                  <option value="top">Сверху</option>
                  <option value="center">Центр</option>
                  <option value="bottom">Снизу</option>
                </select>
              </fieldset>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <fieldset class="fieldset">
                <legend class="fieldset-legend">Макс. длина строки</legend>
                <input
                  v-model.number="localSubtitles.maxLineLength"
                  type="number"
                  class="input input-sm w-full"
                  min="20"
                  max="80"
                />
                <SharedFieldHint text="Символов на строку (20-80)." />
              </fieldset>

              <fieldset class="fieldset">
                <legend class="fieldset-legend">Макс. строк</legend>
                <select v-model.number="localSubtitles.maxLines" class="select select-sm w-full">
                  <option :value="1">1 строка</option>
                  <option :value="2">2 строки</option>
                  <option :value="3">3 строки</option>
                </select>
              </fieldset>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <fieldset class="fieldset">
                <legend class="fieldset-legend">Избегать перекрытия</legend>
                <label class="flex items-center gap-2 cursor-pointer">
                  <input v-model="localSubtitles.avoidOcclusion" type="checkbox" class="toggle toggle-sm toggle-primary" />
                  <span class="text-xs">Не перекрывать лица / UI</span>
                </label>
              </fieldset>

              <fieldset class="fieldset">
                <legend class="fieldset-legend">Единый стиль</legend>
                <label class="flex items-center gap-2 cursor-pointer">
                  <input v-model="localSubtitles.styleConsistency" type="checkbox" class="toggle toggle-sm toggle-primary" />
                  <span class="text-xs">Одинаковый стиль во всех сценах</span>
                </label>
              </fieldset>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <fieldset class="fieldset">
                <legend class="fieldset-legend">Вариации по сценам</legend>
                <label class="flex items-center gap-2 cursor-pointer">
                  <input v-model="localSubtitles.sceneVariation" type="checkbox" class="toggle toggle-sm toggle-primary" />
                  <span class="text-xs">Менять стиль между сценами</span>
                </label>
              </fieldset>

              <fieldset class="fieldset">
                <legend class="fieldset-legend">Авто-выделение</legend>
                <label class="flex items-center gap-2 cursor-pointer">
                  <input v-model="localSubtitles.autoHighlight" type="checkbox" class="toggle toggle-sm toggle-primary" />
                  <span class="text-xs">Выделять ключевые слова</span>
                </label>
              </fieldset>
            </div>
          </div>
        </div>

        <!-- ═══ APP TAB ═══ -->
        <div v-show="activeTab === 'app'" class="space-y-3">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Приложение из библиотеки</legend>
            <PipelineConfigScenarioAppSelector
              v-model="localApp.appId"
              :context-mode="localApp.contextMode"
            />
          </fieldset>

          <div class="grid grid-cols-2 gap-3">
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Режим контекста</legend>
              <select v-model="localApp.contextMode" class="select select-sm w-full">
                <option value="full">Полный</option>
                <option value="light">Лёгкий</option>
                <option value="manual_only">Только ручной</option>
                <option value="off">Выключен</option>
              </select>
              <SharedFieldHint text="Полный — AI получает всё (scenarioContext, creativeAngles). Лёгкий — только name/description." />
            </fieldset>

            <fieldset class="fieldset">
              <legend class="fieldset-legend">Центрированность приложения</legend>
              <select v-model="localApp.appCenterStrength" class="select select-sm w-full">
                <option value="strong">Сильная — центр сюжета</option>
                <option value="soft">Мягкая — органичная</option>
                <option value="background">Фоновая</option>
              </select>
            </fieldset>
          </div>

          <fieldset v-if="localApp.contextMode !== 'off'" class="fieldset">
            <legend class="fieldset-legend">Ручной контекст (override)</legend>
            <textarea
              v-model="localApp.manualOverrideSummary"
              class="textarea textarea-sm w-full"
              rows="3"
              placeholder="Произвольное описание приложения, если хотите переопределить данные из библиотеки..."
              maxlength="500"
            />
            <SharedFieldHint text="Если заполнено — используется вместо данных из библиотеки приложений." />
          </fieldset>
        </div>

        <!-- ═══ VOICEOVER TAB ═══ -->
        <div v-show="activeTab === 'voiceover'" class="space-y-3">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Озвучка</legend>
            <label class="flex items-center gap-2 cursor-pointer">
              <input v-model="localVoiceover.enabled" type="checkbox" class="toggle toggle-sm toggle-primary" />
              <span class="text-xs">Генерировать план озвучки (VoiceoverPlan)</span>
            </label>
            <SharedFieldHint text="AI создаст персону рассказчика, текст для каждой сцены и заметки по синхронизации." />
          </fieldset>

          <div :class="{ 'opacity-40 pointer-events-none': !localVoiceover.enabled }" class="space-y-3">
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Персона рассказчика</legend>
              <input
                v-model="localVoiceover.narratorPersona"
                type="text"
                class="input input-sm w-full"
                placeholder="спокойный мужской голос 30 лет, энергичная женщина..."
                maxlength="150"
              />
            </fieldset>

            <div class="grid grid-cols-2 gap-3">
              <fieldset class="fieldset">
                <legend class="fieldset-legend">Темп</legend>
                <select v-model="localVoiceover.pacing" class="select select-sm w-full">
                  <option value="slow">Медленный</option>
                  <option value="moderate">Обычный</option>
                  <option value="fast">Быстрый</option>
                </select>
              </fieldset>

              <fieldset class="fieldset">
                <legend class="fieldset-legend">Режим синхронизации</legend>
                <select v-model="localVoiceover.syncMode" class="select select-sm w-full">
                  <option value="scene">По сценам</option>
                  <option value="continuous">Непрерывный</option>
                  <option value="highlights">Ключевые моменты</option>
                </select>
              </fieldset>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="flex justify-end gap-2 px-4 py-3 border-t border-base-300">
        <button class="btn btn-ghost btn-sm" @click="close">Отмена</button>
        <button class="btn btn-primary btn-sm" @click="save">
          <Icon name="mingcute:check-line" />
          Сохранить
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop" @click="close">
      <button>close</button>
    </form>
  </dialog>
</template>
