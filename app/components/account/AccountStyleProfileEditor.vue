<script setup lang="ts">
import type {
  AccountStyleProfileData,
  AccountStyleProfileFull,
  AccountStyleRevisionEntry,
  StyleRecommendation,
} from '~~/shared/types/account-style'
import { defaultAccountStyleProfileData } from '~~/shared/types/account-style'

const props = defineProps<{
  accountId: number
  accountName: string
}>()

const emit = defineEmits<{
  saved: []
  close: []
}>()

const isLoading = ref(true)
const isSaving = ref(false)
const isSuggesting = ref(false)
const error = ref<string | null>(null)
const activeTab = ref<'tone' | 'visual' | 'subtitles' | 'protagonist' | 'editing' | 'cta' | 'history'>('tone')

// Form data
const formData = ref<AccountStyleProfileData>(structuredClone(defaultAccountStyleProfileData))
const profileStatus = ref<string>('not_set')
const profileVersion = ref(0)
const revisions = ref<AccountStyleRevisionEntry[]>([])

// AI suggestions
const suggestions = ref<StyleRecommendation[]>([])
const selectedSuggestions = ref<Set<number>>(new Set())
const overallAssessment = ref('')
const identityStrength = ref(0)

// Загрузка данных
async function loadProfile() {
  isLoading.value = true
  error.value = null
  try {
    const res = await $fetch<{ data: {
      data: AccountStyleProfileData
      status: string
      version: number
      profileId: number | null
      source: string
      revisions: AccountStyleRevisionEntry[]
    } }>(`/api/accounts/${props.accountId}/style`)
    formData.value = res.data.data
    profileStatus.value = res.data.status
    profileVersion.value = res.data.version
    revisions.value = res.data.revisions
  }
  catch (e: unknown) {
    error.value = (e as Error).message || 'Ошибка загрузки'
  }
  finally {
    isLoading.value = false
  }
}

// Сохранение
async function save() {
  isSaving.value = true
  error.value = null
  try {
    await $fetch(`/api/accounts/${props.accountId}/style`, {
      method: 'PUT',
      body: {
        data: formData.value,
        changeSummary: 'Ручное обновление style profile',
      },
    })
    emit('saved')
    await loadProfile()
  }
  catch (e: unknown) {
    error.value = (e as Error).message || 'Ошибка сохранения'
  }
  finally {
    isSaving.value = false
  }
}

// AI suggestions
async function requestSuggestions() {
  isSuggesting.value = true
  error.value = null
  try {
    const res = await $fetch<{ data: {
      recommendations: StyleRecommendation[]
      overallAssessment: string
      identityStrength: number
    } }>(`/api/accounts/${props.accountId}/style/suggest`, {
      method: 'POST',
    })
    suggestions.value = res.data.recommendations
    selectedSuggestions.value = new Set()
    overallAssessment.value = res.data.overallAssessment
    identityStrength.value = res.data.identityStrength
  }
  catch (e: unknown) {
    error.value = (e as Error).message || 'Ошибка AI'
  }
  finally {
    isSuggesting.value = false
  }
}

async function applySuggestions(selected: StyleRecommendation[]) {
  if (selected.length === 0) return
  isSaving.value = true
  try {
    await $fetch(`/api/accounts/${props.accountId}/style/apply-suggestion`, {
      method: 'POST',
      body: { recommendations: selected },
    })
    suggestions.value = []
    selectedSuggestions.value = new Set()
    await loadProfile()
    emit('saved')
  }
  catch (e: unknown) {
    error.value = (e as Error).message || 'Ошибка применения'
  }
  finally {
    isSaving.value = false
  }
}

const tabs = [
  { key: 'tone' as const, label: 'Тон', icon: 'mingcute:voice-line' },
  { key: 'visual' as const, label: 'Визуал', icon: 'mingcute:palette-line' },
  { key: 'subtitles' as const, label: 'Субтитры', icon: 'mingcute:text-line' },
  { key: 'protagonist' as const, label: 'Герой', icon: 'mingcute:user-star-line' },
  { key: 'editing' as const, label: 'Монтаж', icon: 'mingcute:scissors-line' },
  { key: 'cta' as const, label: 'CTA', icon: 'mingcute:cursor-line' },
  { key: 'history' as const, label: 'История', icon: 'mingcute:time-line' },
]

onMounted(loadProfile)
</script>

<template>
  <div class="space-y-4">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-bold text-base-content">
        Style Profile: {{ accountName }}
      </h2>
      <div class="flex items-center gap-2">
        <AccountStyleStatusBadge :status="profileStatus as 'not_set' | 'partial' | 'complete'" />
        <span v-if="profileVersion > 0" class="badge badge-ghost badge-sm">
          v{{ profileVersion }}
        </span>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="flex justify-center py-8">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <template v-else>
      <!-- Error -->
      <div v-if="error" role="alert" class="alert alert-error alert-soft text-sm">
        <Icon name="mingcute:warning-line" />
        <span>{{ error }}</span>
      </div>

      <!-- Tabs -->
      <div class="tabs tabs-bordered">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="tab gap-1"
          :class="{ 'tab-active': activeTab === tab.key }"
          @click="activeTab = tab.key"
        >
          <Icon :name="tab.icon" class="text-sm" />
          {{ tab.label }}
        </button>
      </div>

      <!-- Tab: Tone -->
      <div v-show="activeTab === 'tone'" class="space-y-3">
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Голос / Tone of Voice</legend>
          <input
            v-model="formData.tone.voice"
            class="input w-full"
            placeholder="Например: дружелюбный и энергичный"
          />
          <SharedFieldHint text="Как звучит аккаунт? Какой характер у текста?" />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Персона нарратора</legend>
          <input
            v-model="formData.tone.narratorPersona"
            class="input w-full"
            placeholder="Например: молодой парень 25 лет, энергичный"
          />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Формальность</legend>
          <select v-model="formData.tone.formality" class="select w-full">
            <option value="casual">Casual (разговорный)</option>
            <option value="neutral">Нейтральный</option>
            <option value="formal">Формальный</option>
          </select>
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Эмоциональный диапазон</legend>
          <SharedTagInput
            v-model="formData.tone.emotionalRange"
            placeholder="Добавить эмоцию..."
          />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Запрещённые фразы</legend>
          <SharedTagInput
            v-model="formData.tone.forbiddenPhrases"
            placeholder="Фраза, которую нельзя использовать..."
          />
        </fieldset>
      </div>

      <!-- Tab: Visual -->
      <div v-show="activeTab === 'visual'" class="space-y-3">
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Палитра (hex-цвета)</legend>
          <SharedTagInput
            v-model="formData.visual.colorPalette"
            placeholder="#FF5733..."
          />
          <div v-if="formData.visual.colorPalette.length > 0" class="flex gap-1 mt-1">
            <span
              v-for="color in formData.visual.colorPalette"
              :key="color"
              class="w-6 h-6 rounded-full border border-base-300"
              :style="{ backgroundColor: color }"
            />
          </div>
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Эстетика</legend>
          <input
            v-model="formData.visual.aesthetic"
            class="input w-full"
            placeholder="warm minimalist, neon cyberpunk..."
          />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Освещение</legend>
          <input
            v-model="formData.visual.lighting"
            class="input w-full"
            placeholder="natural daylight, studio, cinematic..."
          />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Стиль камеры</legend>
          <input
            v-model="formData.visual.cameraStyle"
            class="input w-full"
            placeholder="POV, flat lay, close-up..."
          />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Допустимые эффекты</legend>
          <SharedTagInput v-model="formData.visual.allowedEffects" placeholder="Эффект..." />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Запрещённые визуалы</legend>
          <SharedTagInput v-model="formData.visual.forbiddenVisuals" placeholder="Что нельзя показывать..." />
        </fieldset>
      </div>

      <!-- Tab: Subtitles -->
      <div v-show="activeTab === 'subtitles'" class="space-y-3">
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Стиль шрифта</legend>
          <input
            v-model="formData.subtitles.fontIntent"
            class="input w-full"
            placeholder="bold sans-serif, handwritten..."
          />
        </fieldset>

        <div class="grid grid-cols-2 gap-3">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Регистр</legend>
            <select v-model="formData.subtitles.casing" class="select w-full">
              <option value="uppercase">UPPERCASE</option>
              <option value="lowercase">lowercase</option>
              <option value="sentence">Sentence case</option>
              <option value="mixed">Mixed</option>
            </select>
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">Позиция по умолчанию</legend>
            <select v-model="formData.subtitles.defaultPosition" class="select w-full">
              <option value="top">Сверху</option>
              <option value="center">По центру</option>
              <option value="bottom">Снизу</option>
            </select>
          </fieldset>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Основной цвет</legend>
            <div class="flex items-center gap-2">
              <input
                v-model="formData.subtitles.primaryColor"
                type="color"
                class="w-10 h-10 rounded cursor-pointer"
              />
              <input
                v-model="formData.subtitles.primaryColor"
                class="input input-sm flex-1"
                placeholder="#FFFFFF"
              />
            </div>
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">Цвет обводки</legend>
            <div class="flex items-center gap-2">
              <input
                v-model="formData.subtitles.outlineColor"
                type="color"
                class="w-10 h-10 rounded cursor-pointer"
              />
              <input
                v-model="formData.subtitles.outlineColor"
                class="input input-sm flex-1"
                placeholder="#000000"
              />
            </div>
          </fieldset>
        </div>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Анимация появления</legend>
          <select v-model="formData.subtitles.entrance" class="select w-full">
            <option value="fade">Fade</option>
            <option value="slide_up">Slide Up</option>
            <option value="typewriter">Typewriter</option>
            <option value="pop">Pop</option>
            <option value="none">Без анимации</option>
          </select>
        </fieldset>
      </div>

      <!-- Tab: Protagonist -->
      <div v-show="activeTab === 'protagonist'" class="space-y-3">
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Предпочтительный тип героя</legend>
          <select v-model="formData.protagonist.preferredType" class="select w-full">
            <option value="any">Любой</option>
            <option value="person">Человек</option>
            <option value="object">Объект / Продукт</option>
            <option value="abstract">Абстрактный</option>
          </select>
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Визуальный стиль героя</legend>
          <textarea
            v-model="formData.protagonist.visualStyle"
            class="textarea w-full"
            rows="2"
            placeholder="Молодой человек в яркой одежде, стиль casual..."
          />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Повторяющиеся маркеры</legend>
          <SharedTagInput v-model="formData.protagonist.recurringMarkers" placeholder="Красные кроссовки, наушники..." />
          <SharedFieldHint text="Визуальные элементы, которые узнаваемо повторяются" />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Ограничения героя</legend>
          <SharedTagInput v-model="formData.protagonist.restrictions" placeholder="Что герой НЕ может делать..." />
        </fieldset>
      </div>

      <!-- Tab: Editing -->
      <div v-show="activeTab === 'editing'" class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Темп</legend>
            <select v-model="formData.editing.pacing" class="select w-full">
              <option value="slow">Медленный</option>
              <option value="moderate">Умеренный</option>
              <option value="fast">Быстрый</option>
            </select>
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">Длительность (сек)</legend>
            <input
              v-model.number="formData.editing.preferredDuration"
              type="number"
              class="input w-full"
              min="5"
              max="120"
            />
          </fieldset>
        </div>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Стиль переходов</legend>
          <input
            v-model="formData.editing.transitionStyle"
            class="input w-full"
            placeholder="crossfade, hard cut, swipe..."
          />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Количество сцен</legend>
          <input
            v-model.number="formData.editing.preferredSceneCount"
            type="number"
            class="input w-full"
            min="2"
            max="10"
          />
        </fieldset>

        <!-- Sliders -->
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Допустимость эксперимента: {{ formData.experimentationDegree }}/100</legend>
          <input
            v-model.number="formData.experimentationDegree"
            type="range"
            class="range range-primary"
            min="0"
            max="100"
          />
          <div class="flex justify-between text-xs text-base-content/50 px-1">
            <span>Строгий стиль</span>
            <span>Свободный эксперимент</span>
          </div>
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Строгость стиля: {{ formData.consistencyStrictness }}/100</legend>
          <input
            v-model.number="formData.consistencyStrictness"
            type="range"
            class="range range-secondary"
            min="0"
            max="100"
          />
          <div class="flex justify-between text-xs text-base-content/50 px-1">
            <span>Мягкий</span>
            <span>Жёсткий</span>
          </div>
        </fieldset>

        <!-- Preview style -->
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Стиль превью</legend>
          <input
            v-model="formData.preview.thumbnailApproach"
            class="input w-full"
            placeholder="bright text overlay, minimalist, face-focused..."
          />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Источники стиля</legend>
          <SharedTagInput v-model="formData.referenceSources" placeholder="URL или описание..." />
        </fieldset>
      </div>

      <!-- Tab: CTA -->
      <div v-show="activeTab === 'cta'" class="space-y-3">
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Стиль CTA</legend>
          <select v-model="formData.cta.style" class="select w-full">
            <option value="soft">Мягкий (совет друга)</option>
            <option value="direct">Прямой</option>
            <option value="question">Вопрос</option>
            <option value="challenge">Вызов / Challenge</option>
          </select>
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Хорошие примеры CTA</legend>
          <SharedTagInput v-model="formData.cta.examples" placeholder="Попробуй сам..." />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Запрещённые CTA</legend>
          <SharedTagInput v-model="formData.cta.forbidden" placeholder="Скачай прямо сейчас..." />
        </fieldset>
      </div>

      <!-- Tab: History -->
      <div v-show="activeTab === 'history'" class="space-y-3">
        <div v-if="revisions.length === 0" class="text-base-content/50 text-sm py-4 text-center">
          Нет истории изменений
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="rev in revisions"
            :key="rev.id"
            class="card bg-base-200 p-3"
          >
            <div class="flex items-center justify-between text-sm">
              <div class="flex items-center gap-2">
                <span
                  class="badge badge-sm"
                  :class="{
                    'badge-primary': rev.changeType === 'manual',
                    'badge-secondary': rev.changeType === 'ai_suggestion',
                    'badge-accent': rev.changeType === 'analytics_derived',
                  }"
                >
                  {{ rev.changeType === 'manual' ? 'Ручное' : rev.changeType === 'ai_suggestion' ? 'AI' : 'Аналитика' }}
                </span>
                <span v-if="rev.accepted" class="badge badge-success badge-sm">Применено</span>
                <span v-else class="badge badge-ghost badge-sm">Ожидает</span>
              </div>
              <span class="text-xs text-base-content/50">
                v{{ rev.version }} &middot; {{ new Date(rev.createdAt).toLocaleDateString('ru') }}
              </span>
            </div>
            <p class="text-sm mt-1">{{ rev.changeSummary }}</p>
            <div v-if="rev.changedSections.length > 0" class="flex gap-1 mt-1">
              <span
                v-for="section in rev.changedSections"
                :key="section"
                class="badge badge-outline badge-xs"
              >
                {{ section }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- AI Suggestions Panel -->
      <div v-if="suggestions.length > 0" class="card bg-base-200 p-4 space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="font-semibold text-base-content">
            AI-рекомендации
          </h3>
          <span class="badge badge-info badge-sm">
            Identity: {{ identityStrength }}/100
          </span>
        </div>
        <p class="text-sm text-base-content/70">{{ overallAssessment }}</p>
        <div class="space-y-2">
          <label
            v-for="(rec, idx) in suggestions"
            :key="idx"
            class="flex items-start gap-2 p-2 bg-base-100 rounded-lg"
          >
            <input
              type="checkbox"
              class="checkbox checkbox-sm mt-0.5"
              :checked="selectedSuggestions.has(idx)"
              @change="selectedSuggestions.has(idx) ? selectedSuggestions.delete(idx) : selectedSuggestions.add(idx)"
            />
            <div class="flex-1">
              <div class="flex items-center gap-2">
                <span class="badge badge-outline badge-xs">{{ rec.section }}.{{ rec.field }}</span>
                <span class="badge badge-ghost badge-xs">{{ rec.confidence }}%</span>
              </div>
              <p class="text-sm mt-0.5">{{ rec.reason }}</p>
              <div class="text-xs text-base-content/50 mt-0.5">
                {{ JSON.stringify(rec.currentValue) }} &rarr; {{ JSON.stringify(rec.suggestedValue) }}
              </div>
            </div>
          </label>
        </div>
        <button
          class="btn btn-sm btn-primary"
          :disabled="isSaving || selectedSuggestions.size === 0"
          @click="applySuggestions(suggestions.filter((_, i) => selectedSuggestions.has(i)))"
        >
          <span v-if="isSaving" class="loading loading-spinner loading-xs" />
          Применить выбранные
        </button>
      </div>

      <!-- Actions -->
      <div class="flex items-center justify-between pt-2 border-t border-base-300">
        <button
          class="btn btn-sm btn-ghost gap-1"
          :disabled="isSuggesting"
          @click="requestSuggestions"
        >
          <span v-if="isSuggesting" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:magic-line" class="text-sm" />
          AI-рекомендации
        </button>

        <div class="flex gap-2">
          <button class="btn btn-sm btn-ghost" @click="emit('close')">
            Закрыть
          </button>
          <button
            class="btn btn-sm btn-primary gap-1"
            :disabled="isSaving"
            @click="save"
          >
            <span v-if="isSaving" class="loading loading-spinner loading-xs" />
            <Icon v-else name="mingcute:save-line" class="text-sm" />
            Сохранить
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
