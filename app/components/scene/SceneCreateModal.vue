<script setup lang="ts">
/**
 * Создание сцены. Стиль модалки зеркалит AccountCreateModal.vue (daisyUI v5).
 */
const props = defineProps<{
  appId: number
}>()

const emit = defineEmits<{
  created: [payload: { id: string; name: string }]
  close: []
}>()

const dialogRef = ref<HTMLDialogElement>()

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
  dialogRef.value?.showModal()
}

function close() {
  dialogRef.value?.close()
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
    errorMessage.value = "Поле 'Имя' обязательно"
    return
  }
  isBusy.value = true
  errorMessage.value = ''
  try {
    const tags = form.tagsInput
      .split(/[,\n]/)
      .map(t => t.trim())
      .filter(Boolean)
    const created = await create({
      appId: props.appId,
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      tags,
      blocks: [],
    })
    emit('created', { id: created.id, name: created.name })
    close()
  } catch (e: any) {
    errorMessage.value = e?.data?.message || e?.message || 'Не удалось создать сцену'
  } finally {
    isBusy.value = false
  }
}
</script>

<template>
  <dialog ref="dialogRef" class="modal">
    <div class="modal-box max-w-xl">
      <h3 class="font-bold text-lg mb-1">Новая сцена</h3>
      <p class="text-xs text-base-content/60 mb-4">
        После создания откроется композитор — добавите блоки (персонаж, стиль, окружение, действие, скрин).
      </p>

      <div class="space-y-3">
        <SceneAiAutofill
          :current-values="aiCurrentValues"
          :app-id="props.appId"
          entity-id="new"
          compact
          @apply="applyAiSuggestions"
        />

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Имя *</legend>
          <input
            v-model="form.name"
            type="text"
            class="input input-sm w-full"
            placeholder="Утренняя пробежка с другом"
            maxlength="120"
            autocomplete="off"
          />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Краткое описание</legend>
          <textarea
            v-model="form.description"
            class="textarea textarea-sm w-full"
            rows="2"
            placeholder="Опционально: о чём сцена, какой кадр получится"
          />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Теги (через запятую)</legend>
          <input
            v-model="form.tagsInput"
            type="text"
            class="input input-sm w-full"
            placeholder="спорт, утро, friend"
            autocomplete="off"
          />
        </fieldset>
      </div>

      <div v-if="errorMessage" role="alert" class="alert alert-error alert-soft text-sm mt-4">
        <Icon name="mingcute:warning-line" />
        <span>{{ errorMessage }}</span>
      </div>

      <div class="modal-action">
        <button type="button" class="btn btn-sm btn-ghost" :disabled="isBusy" @click="close">
          Отмена
        </button>
        <button
          type="button"
          class="btn btn-sm btn-primary"
          :disabled="isBusy || !canSubmit"
          @click="submit"
        >
          <span v-if="isBusy" class="loading loading-spinner loading-xs" />
          Создать и открыть
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button type="button" @click="close">close</button>
    </form>
  </dialog>
</template>
