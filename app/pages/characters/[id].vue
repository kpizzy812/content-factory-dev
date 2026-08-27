<script setup lang="ts">
import type { Character, CharacterReferenceImage, CharacterRole } from '~~/shared/types/character'
import { CHARACTER_ROLE_LABELS } from '~~/shared/types/character'

definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'script-generator' })

const route = useRoute()
const id = computed(() => String(route.params.id))

const { data, pending, error, refresh } = useCharacter(id)
const character = computed<(Character & { referenceImages: CharacterReferenceImage[] }) | null>(
  () => data.value?.data ?? null,
)

const toast = useToast()

useHead({ title: () => character.value ? `${character.value.name} — персонаж` : 'Персонаж' })

const { update, archive } = useCharacterActions()

const saving = ref(false)
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
  errorMsg.value = ''
  try {
    await update(character.value.id, {
      name: form.name.trim(),
      description: form.description.trim() || null,
      role: form.role,
      visualPrompt: form.visualPrompt.trim() || null,
      emotionDefault: form.emotionDefault.trim() || null,
      ageRange: form.ageRange.trim() || null,
      tags: form.tagsInput.split(/[,\n]/).map(t => t.trim()).filter(Boolean),
    })
    toast.success('Персонаж сохранён')
    await refresh()
  }
  catch (e) {
    errorMsg.value = (e as { data?: { message?: string }, message?: string })?.data?.message
      || (e as Error)?.message
      || 'Не удалось сохранить'
  }
  finally {
    saving.value = false
  }
}

const showArchive = ref(false)
const archiving = ref(false)

async function onArchive() {
  if (!character.value) return
  archiving.value = true
  try {
    await archive(character.value.id)
    await navigateTo('/characters')
  }
  finally {
    archiving.value = false
    showArchive.value = false
  }
}

function onReferencesUpdated(updated: Character & { referenceImages: CharacterReferenceImage[] }) {
  if (data.value) data.value = { data: updated }
}

// ─── Повторная генерация референса ───────────────────────────────────────────
const regenerateModalOpen = ref(false)
const regenerateLastPrompt = ref('')
const generatorInitialPrompt = ref('')
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
  }
  catch (e) {
    errorMsg.value = (e as { data?: { message?: string }, message?: string })?.data?.message
      || (e as Error)?.message
      || 'Не удалось перегенерировать'
  }
}

function onRegenerateNew(promptText: string) {
  generatorInitialPrompt.value = promptText
  generatorKey.value++
  nextTick(() => {
    document.getElementById('character-ref-generator')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

// ─── Навигация по соседям ────────────────────────────────────────────────────
const filters = useCharacterFiltersStore()
const { data: listData } = useCharacters(computed(() => filters.query))

// Пагинация у /api/characters включается только по просьбе (page/perPage),
// а страница их не передаёт — список приходит целиком, и его длина совпадает
// с meta.total. Поэтому позиция считается по нему.
const siblings = computed(() => listData.value?.data?.map((c: { id: string }) => c.id) ?? [])
const currentIndex = computed(() => siblings.value.indexOf(id.value))
const inList = computed(() => currentIndex.value >= 0)

const hasPrev = computed(() => inList.value && currentIndex.value > 0)
const hasNext = computed(() => inList.value && currentIndex.value < siblings.value.length - 1)

const position = computed(() => {
  if (!inList.value) return undefined
  return `${currentIndex.value + 1} из ${siblings.value.length}`
})

async function goSibling(delta: -1 | 1) {
  const next = siblings.value[currentIndex.value + delta]
  if (next != null) await navigateTo(`/characters/${next}`)
}
</script>

<template>
  <!--
    Персонаж грузится только в браузере: `useCharacter` ходит с `server: false`,
    поэтому на сервере страница всегда в состоянии загрузки, а на клиенте — уже
    нет. Без ClientOnly Vue ругается на расхождение и бросает поддерево.
  -->
  <ClientOnly>
    <template #fallback>
      <UiSkeleton variant="details" :count="5" />
    </template>

    <UiSkeleton v-if="pending && !character" variant="details" :count="5" />

    <UiErrorState
      v-else-if="error"
      title="Не удалось загрузить персонажа"
      :message="error.message"
      @retry="refresh"
    />

    <template v-else-if="character">
      <DetailHeader
        :title="character.name"
        :code="`chr_${character.id.slice(0, 8)}`"
        back-to="/characters"
        back-label="К персонажам"
        :position="position"
        :has-prev="hasPrev"
        :has-next="hasNext"
        @prev="goSibling(-1)"
        @next="goSibling(1)"
      >
        <template #badges>
          <span class="rounded-sm border border-divider px-1.5 py-0.5 text-micro text-muted">
            {{ CHARACTER_ROLE_LABELS[character.role] }}
          </span>
        </template>

        <template #actions>
          <UiButton variant="primary" :loading="saving" @click="onSave">Сохранить</UiButton>
          <UiActionMenu
            :items="[{ key: 'archive', label: 'В архив', icon: 'mingcute:archive-line', danger: true }]"
            @select="showArchive = true"
          />
        </template>
      </DetailHeader>

      <div class="grid items-start gap-3.5 lg:grid-cols-2">
        <!-- Свойства -->
        <section class="flex flex-col gap-3 rounded-lg border border-border bg-panel p-3.5">
          <h2 class="text-micro tracking-[.06em] text-subtle uppercase">Свойства</h2>

          <CharacterAiAutofill
            :current-values="aiCurrentValues"
            :app-id="character.appId"
            :entity-id="character.id"
            @apply="applyAiSuggestions"
          />

          <UiField label="Имя">
            <UiInput v-model="form.name" placeholder="Маша, Алекс, Босс" />
          </UiField>

          <div class="grid gap-3 sm:grid-cols-2">
            <UiField label="Роль">
              <UiSelect
                v-model="form.role"
                :options="roles.map(r => ({ value: r, label: CHARACTER_ROLE_LABELS[r] }))"
              />
            </UiField>
            <UiField label="Возраст">
              <UiInput v-model="form.ageRange" placeholder="25–30" />
            </UiField>
          </div>

          <UiField>
            <div class="mb-[5px] flex items-center justify-between gap-2">
              <span class="text-[11.5px] text-muted">Описание</span>
              <CharacterBlockRegenerator
                :character-id="character.id"
                block-type="description"
                :current-value="form.description"
                @update:value="(v) => { form.description = v; refresh() }"
                @error="(m) => errorMsg = m"
              />
            </div>
            <UiTextarea
              v-model="form.description"
              :rows="3"
              placeholder="Брюнетка с короткой стрижкой, занимается фитнесом, открытая мимика"
            />
          </UiField>

          <UiField hint="Одна строка для генератора изображений, лучше на английском">
            <div class="mb-[5px] flex items-center justify-between gap-2">
              <span class="text-[11.5px] text-muted">Визуальный промпт</span>
              <CharacterBlockRegenerator
                :character-id="character.id"
                block-type="visualPrompt"
                :current-value="form.visualPrompt"
                @update:value="(v) => { form.visualPrompt = v; refresh() }"
                @error="(m) => errorMsg = m"
              />
            </div>
            <UiInput
              v-model="form.visualPrompt"
              placeholder="30y woman, short brown hair, blue jacket, friendly smile"
            />
          </UiField>

          <div class="grid gap-3 sm:grid-cols-2">
            <UiField label="Эмоция по умолчанию">
              <UiInput v-model="form.emotionDefault" placeholder="curious, calm" />
            </UiField>
            <UiField label="Теги" hint="Через запятую">
              <UiInput v-model="form.tagsInput" placeholder="фитнес, друг, рассказчик" />
            </UiField>
          </div>

          <div
            v-if="errorMsg"
            role="alert"
            class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
          >
            <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
            <span>{{ errorMsg }}</span>
          </div>
        </section>

        <!-- Референс-фото -->
        <section class="flex flex-col gap-3 rounded-lg border border-border bg-panel p-3.5">
          <h2 class="text-micro tracking-[.06em] text-subtle uppercase">Референс-фото</h2>

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
              @generated="refresh"
            />
          </div>
        </section>

        <!-- Видеоисходники -->
        <section class="flex flex-col gap-3 rounded-lg border border-border bg-panel p-3.5 lg:col-span-2">
          <div>
            <h2 class="text-micro tracking-[.06em] text-subtle uppercase">Видеоисходники для липсинка</h2>
            <p class="mt-1 text-sm text-muted">
              Реальные фрагменты ведущего 2–10 секунд. Из них собираются липсинк-сцены.
            </p>
          </div>
          <CharacterPresenterSourceClips :character-id="character.id" />
        </section>

        <!-- Голос -->
        <section class="flex flex-col gap-3 rounded-lg border border-border bg-panel p-3.5 lg:col-span-2">
          <div>
            <h2 class="text-micro tracking-[.06em] text-subtle uppercase">Голос персонажа</h2>
            <p class="mt-1 text-sm text-muted">
              Клон голоса из образца записи. Единственное платное действие на этой странице —
              прогон стоит фиксированную сумму и требует подтверждения.
            </p>
          </div>
          <CharacterVoiceClone
            :character-id="character.id"
            :voice-id="character.voiceId"
            :voice-model-id="character.voiceModelId"
            :voice-sample-sha1="character.voiceSampleSha1"
            @changed="refresh"
          />
        </section>
      </div>

      <SharedGenerateAgainModal
        v-model:open="regenerateModalOpen"
        :last-prompt="regenerateLastPrompt"
        @same="onRegenerateSame"
        @new="onRegenerateNew"
      />

      <UiModal :open="showArchive" title="Убрать персонажа в архив?" size="sm" @close="showArchive = false">
        <p class="text-sm text-muted">
          Персонаж пропадёт из списка, но останется доступен по фильтру «архив».
        </p>
        <template #footer>
          <UiButton variant="ghost" @click="showArchive = false">Отмена</UiButton>
          <UiButton variant="danger" :loading="archiving" @click="onArchive">В архив</UiButton>
        </template>
      </UiModal>
    </template>
  </ClientOnly>
</template>
