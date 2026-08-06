<script setup lang="ts">
/**
 * Создание сцены. Блоки собираются уже в композиторе — здесь только то,
 * без чего сцену не завести.
 */
const props = defineProps<{
  appId: number
}>()

const emit = defineEmits<{
  created: [payload: { id: string, name: string }]
  close: []
}>()

const isOpen = ref(false)
const isBusy = ref(false)
const errorMessage = ref('')

const form = reactive({
  name: '',
  description: '',
  tagsInput: '',
})

function resetForm() {
  isBusy.value = false
  errorMessage.value = ''
  form.name = ''
  form.description = ''
  form.tagsInput = ''
}

function open() {
  resetForm()
  isOpen.value = true
}

function close() {
  isOpen.value = false
  emit('close')
}

defineExpose({ open, close })

const canSubmit = computed(() => form.name.trim().length > 0)

const aiCurrentValues = computed(() => ({
  name: form.name,
  description: form.description,
  tags: form.tagsInput.split(/[,\n]/).map(t => t.trim()).filter(Boolean),
}))

function applyAiSuggestions(fields: Record<string, unknown>) {
  if (typeof fields.name === 'string') form.name = fields.name
  if (typeof fields.description === 'string') form.description = fields.description
  if (Array.isArray(fields.tags)) {
    form.tagsInput = (fields.tags as unknown[]).filter(t => typeof t === 'string').join(', ')
  }
}

const { create } = useSceneActions()

async function submit() {
  if (!canSubmit.value) {
    errorMessage.value = 'Без имени сцену не завести'
    return
  }
  isBusy.value = true
  errorMessage.value = ''
  try {
    const created = await create({
      appId: props.appId,
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      tags: form.tagsInput.split(/[,\n]/).map(t => t.trim()).filter(Boolean),
      blocks: [],
    })
    emit('created', { id: created.id, name: created.name })
    close()
  }
  catch (e) {
    errorMessage.value = (e as { data?: { message?: string }, message?: string })?.data?.message
      || (e as Error)?.message
      || 'Не удалось создать сцену'
  }
  finally {
    isBusy.value = false
  }
}
</script>

<template>
  <UiModal :open="isOpen" title="Новая сцена" size="lg" @close="close">
    <div class="flex flex-col gap-3">
      <p class="text-sm text-muted">
        После создания откроется композитор — там добавляются блоки: персонаж, стиль, окружение,
        действие, скрин.
      </p>

      <SceneAiAutofill
        :current-values="aiCurrentValues"
        :app-id="props.appId"
        entity-id="new"
        compact
        @apply="applyAiSuggestions"
      />

      <UiField label="Имя">
        <UiInput v-model="form.name" placeholder="Утренняя пробежка с другом" />
      </UiField>

      <UiField label="Краткое описание">
        <UiTextarea
          v-model="form.description"
          :rows="2"
          placeholder="О чём сцена, какой кадр должен получиться"
        />
      </UiField>

      <UiField label="Теги" hint="Через запятую">
        <UiInput v-model="form.tagsInput" placeholder="спорт, утро, друг" />
      </UiField>

      <div
        v-if="errorMessage"
        role="alert"
        class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
      >
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
        <span>{{ errorMessage }}</span>
      </div>
    </div>

    <template #footer>
      <UiButton variant="ghost" :disabled="isBusy" @click="close">Отмена</UiButton>
      <UiButton variant="primary" :disabled="!canSubmit" :loading="isBusy" @click="submit">
        Создать и открыть
      </UiButton>
    </template>
  </UiModal>
</template>
