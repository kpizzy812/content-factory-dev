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
  if (res?.hooks?.length) form.hook = res.hooks[0]!.text
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
  }
  catch {
    errorMessage.value = 'Не удалось сохранить изменения. Попробуйте ещё раз.'
  }
  finally {
    isSaving.value = false
  }
}
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-border bg-panel">
    <header class="flex items-center gap-2 border-b border-border bg-card px-3.5 py-2.5">
      <Icon name="mingcute:edit-line" class="text-accent" />
      <h2 class="text-sm font-medium">Редактирование варианта</h2>
    </header>

    <div class="flex flex-col gap-3 p-3.5">
      <UiField label="Заголовок">
        <UiInput v-model="form.title" placeholder="Заголовок сценария" />
      </UiField>

      <UiField :error="hookAi.error.value ?? undefined">
        <template #default>
          <div class="mb-[5px] flex items-center gap-2">
            <span class="text-[11.5px] text-muted">Хук</span>
            <SharedAiSuggestButton :loading="hookAi.loading.value" @click="suggestHook" />
          </div>
          <UiTextarea v-model="form.hook" :rows="3" placeholder="Зацепка для зрителя" />
        </template>
      </UiField>

      <UiField label="Основная часть">
        <UiTextarea v-model="form.body" :rows="6" placeholder="Основной текст ролика" />
      </UiField>

      <UiField label="Призыв к действию">
        <UiTextarea v-model="form.cta" :rows="3" placeholder="Что зритель должен сделать" />
      </UiField>

      <UiField :error="visualAi.error.value ?? undefined">
        <template #default>
          <div class="mb-[5px] flex items-center gap-2">
            <span class="text-[11.5px] text-muted">Визуальный стиль</span>
            <SharedAiSuggestButton :loading="visualAi.loading.value" @click="suggestVisualStyle" />
          </div>
          <UiTextarea v-model="form.visualStyleText" :rows="4" placeholder="Описание визуального оформления" />
        </template>
      </UiField>

      <div
        v-if="errorMessage"
        role="alert"
        class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
      >
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
        <span>{{ errorMessage }}</span>
      </div>

      <div class="flex justify-end gap-1.5">
        <UiButton variant="ghost" :disabled="isSaving" @click="emit('cancel')">Отмена</UiButton>
        <UiButton variant="primary" :loading="isSaving" @click="handleSave">Сохранить</UiButton>
      </div>
    </div>
  </section>
</template>
