<script setup lang="ts">
/**
 * Создание персонажа. Референс-фото добавляются уже в карточке — здесь только
 * то, без чего персонажа не завести.
 */
import type { CharacterRole } from '~~/shared/types/character'
import { CHARACTER_ROLE_LABELS } from '~~/shared/types/character'

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
  visualPrompt: form.visualPrompt,
  emotionDefault: form.emotionDefault,
  ageRange: form.ageRange,
  role: form.role,
  tags: form.tagsInput.split(/[,\n]/).map(t => t.trim()).filter(Boolean),
}))

function mapAiRoleToCharacterRole(value: unknown): CharacterRole | null {
  if (typeof value !== 'string') return null
  // Схема AI знает «main», форма — «protagonist».
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
    errorMessage.value = 'Без имени персонажа не завести'
    return
  }
  isBusy.value = true
  errorMessage.value = ''
  try {
    const created = await create({
      appId: props.appId,
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      role: form.role,
      visualPrompt: form.visualPrompt.trim() || undefined,
      tags: form.tagsInput.split(/[,\n]/).map(t => t.trim()).filter(Boolean),
      emotionDefault: form.emotionDefault.trim() || undefined,
      ageRange: form.ageRange.trim() || undefined,
    })
    emit('created', { id: created.id, name: created.name })
    close()
  }
  catch (e) {
    errorMessage.value = (e as { data?: { message?: string }, message?: string })?.data?.message
      || (e as Error)?.message
      || 'Не удалось создать персонажа'
  }
  finally {
    isBusy.value = false
  }
}
</script>

<template>
  <UiModal :open="isOpen" title="Новый персонаж" size="lg" @close="close">
    <div class="flex flex-col gap-3">
      <p class="text-sm text-muted">Референс-фото добавляются в карточке персонажа.</p>

      <CharacterAiAutofill
        :current-values="aiCurrentValues"
        :app-id="props.appId"
        entity-id="new"
        compact
        @apply="applyAiSuggestions"
      />

      <UiField label="Имя">
        <UiInput v-model="form.name" placeholder="Маша, Алекс, Босс" />
      </UiField>

      <div class="grid gap-3 sm:grid-cols-2">
        <UiField label="Роль">
          <div class="flex overflow-hidden rounded-md border border-border">
            <button
              v-for="r in roles"
              :key="r"
              type="button"
              class="h-8 flex-1 cursor-pointer text-sm"
              :class="form.role === r ? 'bg-accent text-on-accent' : 'bg-card text-muted hover:text-fg'"
              :aria-pressed="form.role === r"
              @click="form.role = r"
            >
              {{ CHARACTER_ROLE_LABELS[r] }}
            </button>
          </div>
        </UiField>

        <UiField label="Возраст">
          <UiInput v-model="form.ageRange" placeholder="25–30" />
        </UiField>
      </div>

      <UiField label="Описание">
        <UiTextarea
          v-model="form.description"
          :rows="2"
          placeholder="Брюнетка с короткой стрижкой, занимается фитнесом, открытая мимика"
        />
      </UiField>

      <UiField
        label="Визуальный промпт"
        hint="Уходит прямо в промпт генератора — лучше на английском"
      >
        <UiInput
          v-model="form.visualPrompt"
          placeholder="30y woman, short brown hair, blue jacket, friendly smile"
        />
      </UiField>

      <div class="grid gap-3 sm:grid-cols-2">
        <UiField label="Базовая эмоция">
          <UiInput v-model="form.emotionDefault" placeholder="curious, calm" />
        </UiField>
        <UiField label="Теги" hint="Через запятую">
          <UiInput v-model="form.tagsInput" placeholder="фитнес, друг, рассказчик" />
        </UiField>
      </div>

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
      <UiButton variant="primary" :disabled="!canSubmit" :loading="isBusy" @click="submit">Создать</UiButton>
    </template>
  </UiModal>
</template>
