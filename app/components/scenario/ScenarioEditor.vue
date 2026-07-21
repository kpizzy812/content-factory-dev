<script setup lang="ts">
import type { HookAgentResult, VisualStyleResult } from '~~/shared/types/agents'

const props = defineProps<{
  scenarioId: number
  variantId: number
  initial: {
    title: string
    hook: string
    body: string
    cta: string
    visualStyleText: string
  }
}>()

const emit = defineEmits<{
  saved: []
  cancel: []
}>()

const { updateVariant } = useScenarioActions()

const form = reactive({
  title: props.initial.title,
  hook: props.initial.hook,
  body: props.initial.body,
  cta: props.initial.cta,
  visualStyleText: props.initial.visualStyleText,
})

const isSaving = ref(false)
const errorMessage = ref('')

const hookAi = useAiSuggest<HookAgentResult>('/api/ai/suggest/hooks', {
  cacheKey: () => `scenario:${props.scenarioId}:${props.variantId}:hook`,
})
const visualAi = useAiSuggest<VisualStyleResult>('/api/ai/suggest/visual-style', {
  cacheKey: () => `scenario:${props.scenarioId}:${props.variantId}:visual`,
})

async function suggestHook() {
  const res = await hookAi.suggest({
    scenario: { title: form.title, hook: form.hook, body: form.body, cta: form.cta, visualStyle: form.visualStyleText },
  })
  if (res?.hooks?.length) {
    form.hook = res.hooks[0]!.text
  }
}

async function suggestVisualStyle() {
  const res = await visualAi.suggest({
    scenarioHook: form.hook,
    scenarioBody: form.body,
    scenarioTitle: form.title,
    scenarioCta: form.cta,
    appName: form.title,
  })
  if (res?.mood && res?.lighting) {
    form.visualStyleText = `${res.mood}. ${res.lighting}. ${res.characterDescription ?? ''}`
  }
}

async function handleSave() {
  isSaving.value = true
  errorMessage.value = ''

  try {
    await updateVariant(props.scenarioId, props.variantId, {
      title: form.title,
      hook: form.hook,
      body: form.body,
      cta: form.cta,
      visualStyleText: form.visualStyleText,
    })
    emit('saved')
  } catch {
    errorMessage.value = 'Не удалось сохранить изменения. Попробуйте ещё раз.'
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 gap-3">
      <h3 class="card-title text-sm">
        <Icon name="mingcute:edit-line" class="text-primary" />
        Редактирование варианта
      </h3>

      <fieldset class="fieldset">
        <legend class="fieldset-legend">Заголовок</legend>
        <input
          v-model="form.title"
          type="text"
          class="input w-full"
          placeholder="Заголовок сценария"
        >
      </fieldset>

      <fieldset class="fieldset">
        <legend class="fieldset-legend flex items-center gap-2">
          Хук
          <SharedAiSuggestButton :loading="hookAi.loading.value" @click="suggestHook" />
        </legend>
        <textarea
          v-model="form.hook"
          class="textarea w-full"
          rows="3"
          placeholder="Зацепка для зрителя"
        />
        <p v-if="hookAi.error.value" class="text-xs text-error mt-1">{{ hookAi.error.value }}</p>
      </fieldset>

      <fieldset class="fieldset">
        <legend class="fieldset-legend">Основная часть</legend>
        <textarea
          v-model="form.body"
          class="textarea w-full"
          rows="6"
          placeholder="Основной контент"
        />
      </fieldset>

      <fieldset class="fieldset">
        <legend class="fieldset-legend">Призыв к действию</legend>
        <textarea
          v-model="form.cta"
          class="textarea w-full"
          rows="3"
          placeholder="CTA"
        />
      </fieldset>

      <fieldset class="fieldset">
        <legend class="fieldset-legend flex items-center gap-2">
          Визуальный стиль
          <SharedAiSuggestButton :loading="visualAi.loading.value" @click="suggestVisualStyle" />
        </legend>
        <textarea
          v-model="form.visualStyleText"
          class="textarea w-full"
          rows="4"
          placeholder="Описание визуального оформления"
        />
        <p v-if="visualAi.error.value" class="text-xs text-error mt-1">{{ visualAi.error.value }}</p>
      </fieldset>

      <div v-if="errorMessage" role="alert" class="alert alert-error alert-soft text-sm">
        <Icon name="mingcute:warning-line" />
        <span>{{ errorMessage }}</span>
      </div>

      <div class="flex gap-2 justify-end">
        <button
          class="btn btn-sm btn-ghost"
          :disabled="isSaving"
          @click="emit('cancel')"
        >
          Отмена
        </button>
        <button
          class="btn btn-sm btn-primary"
          :disabled="isSaving"
          @click="handleSave"
        >
          <span v-if="isSaving" class="loading loading-spinner loading-xs" />
          Сохранить
        </button>
      </div>
    </div>
  </div>
</template>
