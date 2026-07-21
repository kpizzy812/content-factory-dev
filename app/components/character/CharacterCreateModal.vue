<script setup lang="ts">
/**
 * Создание персонажа. Стиль модалки зеркалит AccountCreateModal.vue:
 * - нативный <dialog ref> + showModal() через defineExpose
 * - daisyUI v5 fieldset/legend вместо form-control/label
 * - actions: Отмена (ghost) → Создать (primary)
 */
import type { CharacterRole } from '~~/shared/types/character'
import { CHARACTER_ROLE_LABELS } from '~~/shared/types/character'

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
  role: 'protagonist' as CharacterRole,
  ageRange: '',
  description: '',
  visualPrompt: '',
  emotionDefault: '',
  tagsInput: '',
})

const roles: CharacterRole[] = ['protagonist', 'support', 'extra']

function resetForm() {
  isBusy.value = false
  errorMessage.value = ''
  form.name = ''
  form.role = 'protagonist'
  form.ageRange = ''
  form.description = ''
  form.visualPrompt = ''
  form.emotionDefault = ''
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
  visualPrompt: form.visualPrompt,
  emotionDefault: form.emotionDefault,
  ageRange: form.ageRange,
  role: form.role,
  tags: form.tagsInput.split(/[,\n]/).map(t => t.trim()).filter(Boolean),
}))

function mapAiRoleToCharacterRole(value: unknown): CharacterRole | null {
  if (typeof value !== 'string') return null
  // Schema позволяет ['main', 'support', 'extra']; в форме — ['protagonist', 'support', 'extra']
  if (value === 'main' || value === 'protagonist') return 'protagonist'
  if (value === 'support' || value === 'extra') return value
  return null
}

function applyAiSuggestions(fields: Record<string, unknown>) {
  if (typeof fields.name === 'string') form.name = fields.name
  if (typeof fields.description === 'string') form.description = fields.description
  if (typeof fields.visualPrompt === 'string') form.visualPrompt = fields.visualPrompt
  if (typeof fields.emotionDefault === 'string') form.emotionDefault = fields.emotionDefault
  if (typeof fields.ageRange === 'string') form.ageRange = fields.ageRange
  const mappedRole = mapAiRoleToCharacterRole(fields.role)
  if (mappedRole) form.role = mappedRole
  if (Array.isArray(fields.tags)) {
    form.tagsInput = (fields.tags as unknown[]).filter(t => typeof t === 'string').join(', ')
  }
}

const { create } = useCharacterActions()

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
      role: form.role,
      visualPrompt: form.visualPrompt.trim() || undefined,
      tags,
      emotionDefault: form.emotionDefault.trim() || undefined,
      ageRange: form.ageRange.trim() || undefined,
    })
    emit('created', { id: created.id, name: created.name })
    close()
  } catch (e: any) {
    errorMessage.value = e?.data?.message || e?.message || 'Не удалось создать персонажа'
  } finally {
    isBusy.value = false
  }
}
</script>

<template>
  <dialog ref="dialogRef" class="modal">
    <div class="modal-box max-w-2xl">
      <h3 class="font-bold text-lg mb-1">Новый персонаж</h3>
      <p class="text-xs text-base-content/60 mb-4">
        Реф-фото добавляются на следующем шаге, в карточке персонажа.
      </p>

      <div class="space-y-3">
        <CharacterAiAutofill
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
            placeholder="Маша, Алекс, Босс…"
            maxlength="100"
            autocomplete="off"
          />
        </fieldset>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Роль</legend>
            <div class="join w-full">
              <button
                v-for="r in roles"
                :key="r"
                type="button"
                class="join-item btn btn-sm flex-1"
                :class="{ 'btn-primary': form.role === r }"
                @click="form.role = r"
              >
                {{ CHARACTER_ROLE_LABELS[r] }}
              </button>
            </div>
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">Возрастной диапазон</legend>
            <input
              v-model="form.ageRange"
              type="text"
              class="input input-sm w-full"
              placeholder="25-30"
              autocomplete="off"
            />
          </fieldset>
        </div>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Описание</legend>
          <textarea
            v-model="form.description"
            class="textarea textarea-sm w-full"
            rows="2"
            placeholder="Брюнетка с короткой стрижкой, занимается фитнесом, открытая мимика"
          />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Visual prompt (1 строка для генератора)</legend>
          <input
            v-model="form.visualPrompt"
            type="text"
            class="input input-sm w-full"
            placeholder="30y woman, short brown hair, blue jacket, friendly smile"
            autocomplete="off"
          />
          <p class="text-xs opacity-60 mt-1">
            EN preferred — это поле уйдёт прямо в prompt видео-генератора (Wan/fal.ai).
          </p>
        </fieldset>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Базовая эмоция</legend>
            <input
              v-model="form.emotionDefault"
              type="text"
              class="input input-sm w-full"
              placeholder="curious, calm…"
              autocomplete="off"
            />
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">Теги (через запятую)</legend>
            <input
              v-model="form.tagsInput"
              type="text"
              class="input input-sm w-full"
              placeholder="фитнес, друг, рассказчик"
              autocomplete="off"
            />
          </fieldset>
        </div>
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
          Создать
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button type="button" @click="close">close</button>
    </form>
  </dialog>
</template>
