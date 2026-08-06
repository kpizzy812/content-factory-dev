<script setup lang="ts">
import type {
  AccountStyleProfileData,
  AccountStyleRevisionEntry,
  StyleRecommendation,
} from '~~/shared/types/account-style'
import { defaultAccountStyleProfileData } from '~~/shared/types/account-style'

/**
 * Стиль-профиль аккаунта: как звучит, как выглядит и чего не делает.
 * `mingcute:magic-line` в наборе нет — кнопка рекомендаций осталась без иконки;
 * теперь `mingcute:magic-2-line`.
 */
const props = defineProps<{
  accountId: number
  accountName: string
}>()

const emit = defineEmits<{ saved: [], close: [] }>()

const isLoading = ref(true)
const isSaving = ref(false)
const isSuggesting = ref(false)
const error = ref<string | null>(null)

type TabKey = 'tone' | 'visual' | 'subtitles' | 'protagonist' | 'editing' | 'cta' | 'history'
const activeTab = ref<TabKey>('tone')

const formData = ref<AccountStyleProfileData>(structuredClone(defaultAccountStyleProfileData))
const profileStatus = ref<string>('not_set')
const profileVersion = ref(0)
const revisions = ref<AccountStyleRevisionEntry[]>([])

const suggestions = ref<StyleRecommendation[]>([])
const selectedSuggestions = ref<Set<number>>(new Set())
const overallAssessment = ref('')
const identityStrength = ref(0)

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
    error.value = (e as Error).message || 'Не удалось загрузить стиль-профиль'
  }
  finally {
    isLoading.value = false
  }
}

async function save() {
  isSaving.value = true
  error.value = null
  try {
    await $fetch(`/api/accounts/${props.accountId}/style`, {
      method: 'PUT',
      body: { data: formData.value, changeSummary: 'Ручное обновление стиль-профиля' },
    })
    emit('saved')
    await loadProfile()
  }
  catch (e: unknown) {
    error.value = (e as Error).message || 'Не удалось сохранить'
  }
  finally {
    isSaving.value = false
  }
}

async function requestSuggestions() {
  isSuggesting.value = true
  error.value = null
  try {
    const res = await $fetch<{ data: {
      recommendations: StyleRecommendation[]
      overallAssessment: string
      identityStrength: number
    } }>(`/api/accounts/${props.accountId}/style/suggest`, { method: 'POST' })
    suggestions.value = res.data.recommendations
    selectedSuggestions.value = new Set()
    overallAssessment.value = res.data.overallAssessment
    identityStrength.value = res.data.identityStrength
  }
  catch (e: unknown) {
    error.value = (e as Error).message || 'Модель не ответила'
  }
  finally {
    isSuggesting.value = false
  }
}

async function applySuggestions(selected: StyleRecommendation[]) {
  if (!selected.length) return
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
    error.value = (e as Error).message || 'Не удалось применить рекомендации'
  }
  finally {
    isSaving.value = false
  }
}

function toggleSuggestion(idx: number) {
  const next = new Set(selectedSuggestions.value)
  if (next.has(idx)) next.delete(idx)
  else next.add(idx)
  selectedSuggestions.value = next
}

const TABS: Array<{ key: TabKey, label: string, icon: string }> = [
  { key: 'tone', label: 'Тон', icon: 'mingcute:voice-line' },
  { key: 'visual', label: 'Визуал', icon: 'mingcute:palette-line' },
  { key: 'subtitles', label: 'Субтитры', icon: 'mingcute:text-line' },
  { key: 'protagonist', label: 'Герой', icon: 'mingcute:user-star-line' },
  { key: 'editing', label: 'Монтаж', icon: 'mingcute:scissors-line' },
  { key: 'cta', label: 'Призыв', icon: 'mingcute:cursor-line' },
  { key: 'history', label: 'История', icon: 'mingcute:time-line' },
]

const REVISION_LABELS: Record<string, string> = {
  manual: 'Правка руками',
  ai_suggestion: 'Рекомендация модели',
  analytics_derived: 'Из аналитики',
}

const REVISION_TONES: Record<string, string> = {
  manual: 'border-neutral-border bg-neutral-bg text-neutral',
  ai_suggestion: 'border-info-border bg-info-bg text-info',
  analytics_derived: 'border-accent-border bg-accent-bg text-accent-text',
}

onMounted(loadProfile)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center gap-2">
      <AccountStyleStatusBadge :status="profileStatus as 'not_set' | 'partial' | 'complete'" />
      <span v-if="profileVersion > 0" class="tnum rounded-sm border border-border bg-card px-1.5 py-0.5 font-mono text-micro text-muted">
        версия {{ profileVersion }}
      </span>
    </div>

    <UiSkeleton v-if="isLoading" variant="details" :count="5" />

    <template v-else>
      <p v-if="error" class="flex items-center gap-2 rounded-md border border-danger-border bg-danger-bg p-2.5 text-sm text-danger">
        <Icon name="mingcute:warning-line" class="shrink-0" />
        {{ error }}
      </p>

      <div class="flex flex-wrap gap-1 rounded-md border border-border bg-card p-1">
        <button
          v-for="tab in TABS"
          :key="tab.key"
          type="button"
          class="flex h-7 cursor-pointer items-center gap-1.5 rounded-sm px-2.5 text-sm"
          :class="activeTab === tab.key ? 'bg-accent text-on-accent' : 'text-muted hover:text-fg'"
          @click="activeTab = tab.key"
        >
          <Icon :name="tab.icon" />
          {{ tab.label }}
        </button>
      </div>

      <div v-if="activeTab === 'tone'" class="flex flex-col gap-3">
        <UiField label="Голос аккаунта" hint="Как звучит текст, какой у него характер.">
          <UiInput v-model="formData.tone.voice" placeholder="Дружелюбный и энергичный" />
        </UiField>
        <UiField label="Кто рассказывает">
          <UiInput v-model="formData.tone.narratorPersona" placeholder="Молодой мастер, 25 лет" />
        </UiField>
        <UiField label="Формальность">
          <UiSelect
            v-model="formData.tone.formality"
            :options="[
              { value: 'casual', label: 'Разговорный' },
              { value: 'neutral', label: 'Нейтральный' },
              { value: 'formal', label: 'Формальный' },
            ]"
          />
        </UiField>
        <UiField label="Эмоции">
          <SharedTagInput v-model="formData.tone.emotionalRange" placeholder="Добавить эмоцию" />
        </UiField>
        <UiField label="Запрещённые фразы">
          <SharedTagInput v-model="formData.tone.forbiddenPhrases" placeholder="Фраза, которую нельзя" />
        </UiField>
      </div>

      <div v-else-if="activeTab === 'visual'" class="flex flex-col gap-3">
        <UiField label="Палитра" hint="Значения в hex — они уходят в промпт генерации.">
          <SharedTagInput v-model="formData.visual.colorPalette" placeholder="#ff5733" />
          <div v-if="formData.visual.colorPalette.length" class="mt-1.5 flex gap-1">
            <span
              v-for="color in formData.visual.colorPalette"
              :key="color"
              class="size-6 rounded-full border border-border"
              :style="{ backgroundColor: color }"
              :title="color"
            />
          </div>
        </UiField>
        <UiField label="Эстетика">
          <UiInput v-model="formData.visual.aesthetic" placeholder="тёплый минимализм, неон" />
        </UiField>
        <UiField label="Освещение">
          <UiInput v-model="formData.visual.lighting" placeholder="дневной свет, студия, кино" />
        </UiField>
        <UiField label="Работа камеры">
          <UiInput v-model="formData.visual.cameraStyle" placeholder="от первого лица, крупный план" />
        </UiField>
        <UiField label="Разрешённые эффекты">
          <SharedTagInput v-model="formData.visual.allowedEffects" placeholder="Эффект" />
        </UiField>
        <UiField label="Запрещённые визуалы">
          <SharedTagInput v-model="formData.visual.forbiddenVisuals" placeholder="Что показывать нельзя" />
        </UiField>
      </div>

      <div v-else-if="activeTab === 'subtitles'" class="flex flex-col gap-3">
        <UiField label="Шрифт">
          <UiInput v-model="formData.subtitles.fontIntent" placeholder="жирный без засечек, рукописный" />
        </UiField>
        <div class="grid gap-3 sm:grid-cols-2">
          <UiField label="Регистр">
            <UiSelect
              v-model="formData.subtitles.casing"
              :options="[
                { value: 'uppercase', label: 'ВЕРХНИЙ' },
                { value: 'lowercase', label: 'нижний' },
                { value: 'sentence', label: 'Как в предложении' },
                { value: 'mixed', label: 'Смешанный' },
              ]"
            />
          </UiField>
          <UiField label="Положение">
            <UiSelect
              v-model="formData.subtitles.defaultPosition"
              :options="[
                { value: 'top', label: 'Сверху' },
                { value: 'center', label: 'По центру' },
                { value: 'bottom', label: 'Снизу' },
              ]"
            />
          </UiField>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <UiField label="Цвет текста">
            <div class="flex items-center gap-2">
              <input v-model="formData.subtitles.primaryColor" type="color" class="size-8 cursor-pointer rounded-md border border-border bg-card">
              <UiInput v-model="formData.subtitles.primaryColor" mono class="flex-1" placeholder="#ffffff" />
            </div>
          </UiField>
          <UiField label="Цвет обводки">
            <div class="flex items-center gap-2">
              <input v-model="formData.subtitles.outlineColor" type="color" class="size-8 cursor-pointer rounded-md border border-border bg-card">
              <UiInput v-model="formData.subtitles.outlineColor" mono class="flex-1" placeholder="#000000" />
            </div>
          </UiField>
        </div>
        <UiField label="Появление">
          <UiSelect
            v-model="formData.subtitles.entrance"
            :options="[
              { value: 'fade', label: 'Проявление' },
              { value: 'slide_up', label: 'Выезд снизу' },
              { value: 'typewriter', label: 'Печатная машинка' },
              { value: 'pop', label: 'Скачок' },
              { value: 'none', label: 'Без анимации' },
            ]"
          />
        </UiField>
      </div>

      <div v-else-if="activeTab === 'protagonist'" class="flex flex-col gap-3">
        <UiField label="Кто в кадре">
          <UiSelect
            v-model="formData.protagonist.preferredType"
            :options="[
              { value: 'any', label: 'Не важно' },
              { value: 'person', label: 'Человек' },
              { value: 'object', label: 'Предмет или товар' },
              { value: 'abstract', label: 'Абстракция' },
            ]"
          />
        </UiField>
        <UiField label="Как выглядит">
          <UiTextarea v-model="formData.protagonist.visualStyle" :rows="2" placeholder="Молодой человек в яркой одежде" />
        </UiField>
        <UiField label="Узнаваемые детали" hint="То, что повторяется из ролика в ролик.">
          <SharedTagInput v-model="formData.protagonist.recurringMarkers" placeholder="Красные кроссовки" />
        </UiField>
        <UiField label="Чего герой не делает">
          <SharedTagInput v-model="formData.protagonist.restrictions" placeholder="Ограничение" />
        </UiField>
      </div>

      <div v-else-if="activeTab === 'editing'" class="flex flex-col gap-3">
        <div class="grid gap-3 sm:grid-cols-2">
          <UiField label="Темп">
            <UiSelect
              v-model="formData.editing.pacing"
              :options="[
                { value: 'slow', label: 'Медленный' },
                { value: 'moderate', label: 'Умеренный' },
                { value: 'fast', label: 'Быстрый' },
              ]"
            />
          </UiField>
          <UiField label="Длительность, секунд">
            <UiInput v-model.number="formData.editing.preferredDuration" type="number" />
          </UiField>
        </div>
        <UiField label="Переходы">
          <UiInput v-model="formData.editing.transitionStyle" placeholder="плавно, жёсткая склейка, свайп" />
        </UiField>
        <UiField label="Сколько сцен">
          <UiInput v-model.number="formData.editing.preferredSceneCount" type="number" />
        </UiField>

        <UiField :label="`Допустимость эксперимента · ${formData.experimentationDegree} из 100`">
          <input v-model.number="formData.experimentationDegree" type="range" min="0" max="100" class="w-full accent-(--color-accent)">
          <div class="flex justify-between text-micro text-subtle">
            <span>строго по стилю</span>
            <span>свободный поиск</span>
          </div>
        </UiField>

        <UiField :label="`Строгость стиля · ${formData.consistencyStrictness} из 100`">
          <input v-model.number="formData.consistencyStrictness" type="range" min="0" max="100" class="w-full accent-(--color-accent)">
          <div class="flex justify-between text-micro text-subtle">
            <span>мягко</span>
            <span>жёстко</span>
          </div>
        </UiField>

        <UiField label="Стиль превью">
          <UiInput v-model="formData.preview.thumbnailApproach" placeholder="крупный текст, лицо в кадре" />
        </UiField>
        <UiField label="Источники стиля">
          <SharedTagInput v-model="formData.referenceSources" placeholder="Ссылка или описание" />
        </UiField>
      </div>

      <div v-else-if="activeTab === 'cta'" class="flex flex-col gap-3">
        <UiField label="Как зовём к действию">
          <UiSelect
            v-model="formData.cta.style"
            :options="[
              { value: 'soft', label: 'Мягко, как совет' },
              { value: 'direct', label: 'Прямо' },
              { value: 'question', label: 'Вопросом' },
              { value: 'challenge', label: 'Вызовом' },
            ]"
          />
        </UiField>
        <UiField label="Удачные примеры">
          <SharedTagInput v-model="formData.cta.examples" placeholder="Попробуй сам" />
        </UiField>
        <UiField label="Запрещённые формулировки">
          <SharedTagInput v-model="formData.cta.forbidden" placeholder="Скачай прямо сейчас" />
        </UiField>
      </div>

      <div v-else-if="activeTab === 'history'" class="flex flex-col gap-2">
        <UiEmptyState
          v-if="!revisions.length"
          variant="first"
          title="Правок ещё не было"
          description="Каждое сохранение оставляет запись с тем, что изменилось."
        />
        <div
          v-for="rev in revisions"
          v-else
          :key="rev.id"
          class="flex flex-col gap-1 rounded-md border border-border bg-card p-2.5"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="rounded-sm border px-1.5 py-0.5 text-micro" :class="REVISION_TONES[rev.changeType] ?? REVISION_TONES.manual">
              {{ REVISION_LABELS[rev.changeType] ?? rev.changeType }}
            </span>
            <span
              class="rounded-sm border px-1.5 py-0.5 text-micro"
              :class="rev.accepted
                ? 'border-success-border bg-success-bg text-success'
                : 'border-divider bg-transparent text-subtle'"
            >
              {{ rev.accepted ? 'Применена' : 'Ожидает' }}
            </span>
            <span class="flex-1" />
            <span class="tnum font-mono text-micro text-subtle">
              версия {{ rev.version }} · {{ new Date(rev.createdAt).toLocaleDateString('ru-RU') }}
            </span>
          </div>
          <p class="text-sm">{{ rev.changeSummary }}</p>
          <div v-if="rev.changedSections.length" class="flex flex-wrap gap-1">
            <span
              v-for="section in rev.changedSections"
              :key="section"
              class="rounded-sm border border-divider px-1.5 text-micro text-subtle"
            >
              {{ section }}
            </span>
          </div>
        </div>
      </div>

      <section v-if="suggestions.length" class="flex flex-col gap-3 rounded-md border border-border bg-card p-3">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="flex-1 font-medium">Рекомендации модели</h3>
          <span class="tnum rounded-sm border border-info-border bg-info-bg px-1.5 py-0.5 text-micro text-info">
            узнаваемость {{ identityStrength }} из 100
          </span>
        </div>
        <p class="text-sm text-muted">{{ overallAssessment }}</p>
        <div class="flex flex-col gap-2">
          <label
            v-for="(rec, idx) in suggestions"
            :key="idx"
            class="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-panel p-2.5"
          >
            <input
              type="checkbox"
              class="mt-0.5 size-3.5 cursor-pointer accent-(--color-accent)"
              :checked="selectedSuggestions.has(idx)"
              @change="toggleSuggestion(idx)"
            >
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="rounded-sm border border-divider px-1.5 font-mono text-micro text-muted">{{ rec.section }}.{{ rec.field }}</span>
                <span class="tnum rounded-sm border border-divider px-1.5 font-mono text-micro text-subtle">уверенность {{ rec.confidence }}%</span>
              </div>
              <p class="mt-0.5 text-sm">{{ rec.reason }}</p>
              <p class="mt-0.5 font-mono text-micro text-subtle">
                {{ JSON.stringify(rec.currentValue) }} → {{ JSON.stringify(rec.suggestedValue) }}
              </p>
            </div>
          </label>
        </div>
        <UiButton
          variant="primary"
          class="w-fit"
          :loading="isSaving"
          :disabled="!selectedSuggestions.size"
          @click="applySuggestions(suggestions.filter((_, i) => selectedSuggestions.has(i)))"
        >
          Применить выбранные
        </UiButton>
      </section>

      <div class="flex flex-wrap items-center gap-2 border-t border-divider pt-3">
        <UiButton :loading="isSuggesting" @click="requestSuggestions">
          <Icon v-if="!isSuggesting" name="mingcute:magic-2-line" />
          Спросить модель
        </UiButton>
        <span class="flex-1" />
        <UiButton variant="ghost" @click="emit('close')">Закрыть</UiButton>
        <UiButton variant="primary" :loading="isSaving" @click="save">
          <Icon v-if="!isSaving" name="mingcute:save-line" />
          Сохранить
        </UiButton>
      </div>
    </template>
  </div>
</template>
