<script setup lang="ts">
import type { Character, CharacterReferenceImage, CharacterRole } from '~~/shared/types/character'
import { CHARACTER_ROLE_LABELS } from '~~/shared/types/character'

definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'script-generator' })

const route = useRoute()
const router = useRouter()
const id = computed(() => String(route.params.id))

const { data, pending, error, refresh } = useCharacter(id)
const character = computed<(Character & { referenceImages: CharacterReferenceImage[] }) | null>(() => data.value?.data ?? null)

useHead({ title: () => character.value ? `${character.value.name} — Персонаж` : 'Персонаж' })

const { update, archive } = useCharacterActions()

const saving = ref(false)
const message = ref('')
const errorMsg = ref('')

const form = reactive({
  name: '',
  description: '',
  role: 'protagonist' as CharacterRole,
  visualPrompt: '',
  emotionDefault: '',
  ageRange: '',
  tagsInput: '',
})

watchEffect(() => {
  if (!character.value) return
  form.name = character.value.name
  form.description = character.value.description ?? ''
  form.role = character.value.role
  form.visualPrompt = character.value.visualPrompt ?? ''
  form.emotionDefault = character.value.emotionDefault ?? ''
  form.ageRange = character.value.ageRange ?? ''
  form.tagsInput = (character.value.tags ?? []).join(', ')
})

const roles: CharacterRole[] = ['protagonist', 'support', 'extra']

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

async function onSave() {
  if (!character.value) return
  saving.value = true
  message.value = ''
  errorMsg.value = ''
  try {
    const tags = form.tagsInput.split(/[,\n]/).map(t => t.trim()).filter(Boolean)
    await update(character.value.id, {
      name: form.name.trim(),
      description: form.description.trim() || null,
      role: form.role,
      visualPrompt: form.visualPrompt.trim() || null,
      emotionDefault: form.emotionDefault.trim() || null,
      ageRange: form.ageRange.trim() || null,
      tags,
    })
    message.value = 'Сохранено'
    setTimeout(() => { message.value = '' }, 2000)
    refresh()
  } catch (e: any) {
    errorMsg.value = e?.data?.message || e?.message || 'Ошибка сохранения'
  } finally {
    saving.value = false
  }
}

async function onArchive() {
  if (!character.value) return
  if (!confirm('Архивировать персонажа? Можно будет восстановить из списка с фильтром «архив».')) return
  await archive(character.value.id)
  router.push('/characters')
}

function onReferencesUpdated(updated: Character & { referenceImages: CharacterReferenceImage[] }) {
  if (data.value) {
    data.value = { data: updated } as any
  }
}

// Регенерация существующего AI-сгенерированного референса.
const regenerateModalOpen = ref(false)
const regenerateLastPrompt = ref('')
// initialPrompt + key для генератора: при "Новый промт" увеличиваем key, чтобы
// CharacterReferenceGenerator пересоздался с новым initialPrompt.
const generatorInitialPrompt = ref<string>('')
const generatorKey = ref(0)

function onRegenerateClick(refImg: CharacterReferenceImage) {
  regenerateLastPrompt.value = refImg.generationPrompt ?? ''
  if (!regenerateLastPrompt.value) return
  regenerateModalOpen.value = true
}

async function onRegenerateSame(promptText: string) {
  if (!character.value || !promptText) return
  try {
    await $fetch(`/api/characters/${character.value.id}/generate-reference`, {
      method: 'POST',
      body: { prompt: promptText },
    })
    await refresh()
  } catch (e: any) {
    errorMsg.value = e?.data?.message || e?.message || 'Ошибка перегенерации'
  }
}

function onRegenerateNew(promptText: string) {
  generatorInitialPrompt.value = promptText
  generatorKey.value++
  // Скроллим к панели генератора, чтобы юзер сразу видел textarea.
  nextTick(() => {
    document.getElementById('character-ref-generator')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

function onReferenceGenerated() {
  // Сразу подтягиваем актуальный character с новым ref'ом.
  refresh()
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-2">
      <NuxtLink to="/characters" class="btn btn-ghost btn-sm">
        <Icon name="mingcute:arrow-left-line" />
        К списку
      </NuxtLink>
      <h1 v-if="character" class="text-2xl font-bold text-base-content">{{ character.name }}</h1>
    </div>

    <div v-if="pending" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <div v-else-if="error" role="alert" class="alert alert-error">
      <Icon name="mingcute:warning-line" />
      <span>Ошибка: {{ error.message }}</span>
    </div>

    <div v-else-if="character" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <section class="card bg-base-100 shadow-sm border border-base-300">
        <div class="card-body space-y-3">
          <h2 class="card-title text-base">Свойства</h2>

          <CharacterAiAutofill
            :current-values="aiCurrentValues"
            :app-id="character.appId"
            :entity-id="character.id"
            @apply="applyAiSuggestions"
          />

          <fieldset class="fieldset">
            <legend class="fieldset-legend">Имя</legend>
            <input
              v-model="form.name"
              type="text"
              class="input input-sm w-full"
              placeholder="Маша, Алекс, Босс…"
            />
          </fieldset>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Роль</legend>
              <select v-model="form.role" class="select select-sm w-full">
                <option v-for="r in roles" :key="r" :value="r">{{ CHARACTER_ROLE_LABELS[r] }}</option>
              </select>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Возрастной диапазон</legend>
              <input
                v-model="form.ageRange"
                type="text"
                class="input input-sm w-full"
                placeholder="25-30"
              />
            </fieldset>
          </div>

          <fieldset class="fieldset">
            <legend class="fieldset-legend flex items-center justify-between gap-2">
              <span>Описание</span>
              <CharacterBlockRegenerator
                :character-id="character.id"
                block-type="description"
                :current-value="form.description"
                @update:value="(v) => { form.description = v; refresh() }"
                @error="(m) => errorMsg = m"
              />
            </legend>
            <textarea
              v-model="form.description"
              class="textarea textarea-sm w-full"
              rows="3"
              placeholder="Брюнетка с короткой стрижкой, занимается фитнесом, открытая мимика"
            />
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend flex items-center justify-between gap-2">
              <span>Visual prompt — 1 строка для генератора (EN preferred)</span>
              <CharacterBlockRegenerator
                :character-id="character.id"
                block-type="visualPrompt"
                :current-value="form.visualPrompt"
                @update:value="(v) => { form.visualPrompt = v; refresh() }"
                @error="(m) => errorMsg = m"
              />
            </legend>
            <input
              v-model="form.visualPrompt"
              type="text"
              class="input input-sm w-full"
              placeholder="30y woman, short brown hair, blue jacket, friendly smile"
            />
          </fieldset>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Эмоция по умолчанию</legend>
              <input
                v-model="form.emotionDefault"
                type="text"
                class="input input-sm w-full"
                placeholder="curious, calm…"
              />
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Теги (через запятую)</legend>
              <input
                v-model="form.tagsInput"
                type="text"
                class="input input-sm w-full"
                placeholder="фитнес, друг, рассказчик"
              />
            </fieldset>
          </div>

          <div class="flex items-center justify-between pt-2 flex-wrap gap-2">
            <div class="flex items-center gap-2">
              <button class="btn btn-primary btn-sm" :disabled="saving" @click="onSave">
                <span v-if="saving" class="loading loading-spinner loading-xs" />
                Сохранить
              </button>
              <span v-if="message" class="text-xs text-success">{{ message }}</span>
              <span v-if="errorMsg" class="text-xs text-error">{{ errorMsg }}</span>
            </div>
            <button class="btn btn-ghost btn-sm text-error" @click="onArchive">
              <Icon name="mingcute:archive-line" />
              В архив
            </button>
          </div>
        </div>
      </section>

      <section class="card bg-base-100 shadow-sm border border-base-300">
        <div class="card-body space-y-3">
          <h2 class="card-title text-base">Референс-фото</h2>
          <CharacterReferenceUploader
            :character="character"
            @updated="onReferencesUpdated"
            @regenerate="onRegenerateClick"
          />
          <div id="character-ref-generator">
            <CharacterReferenceGenerator
              :key="generatorKey"
              :character-id="character.id"
              :app-id="character.appId"
              :initial-prompt="generatorInitialPrompt"
              @generated="onReferenceGenerated"
            />
          </div>
        </div>
      </section>
    </div>

    <GenerateAgainModal
      v-model:open="regenerateModalOpen"
      :last-prompt="regenerateLastPrompt"
      @same="onRegenerateSame"
      @new="onRegenerateNew"
    />
  </div>
</template>
