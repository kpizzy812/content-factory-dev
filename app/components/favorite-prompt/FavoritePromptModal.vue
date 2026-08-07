<script setup lang="ts">
/**
 * Универсальная модалка избранного промта.
 * mode='create': принимает promptText + optional appId/sourceVideoAssetId, создаёт запись.
 * mode='edit': принимает favoritePromptId, подгружает деталь и разрешает редактировать
 *              tags/notes/appId/isPublic (promptText — immutable snapshot).
 */
import type { FavoritePrompt, FavoritePromptCreateInput, FavoritePromptUpdateInput } from '~~/shared/types/favorite-prompt'

const props = defineProps<{
  open: boolean
  mode: 'create' | 'edit'
  // create
  promptText?: string
  appId?: number | null
  sourceVideoAssetId?: number | null
  // edit
  favoritePromptId?: number | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'saved': [item: FavoritePrompt]
}>()

// Form state
const promptTextLocal = ref('')
const appIdLocal = ref<number | null>(null)
const tagsLocal = ref<string[]>([])
const notesLocal = ref('')
const isPublicLocal = ref(true)
const showAdvanced = ref(false)

const saving = ref(false)
const errorMsg = ref<string | null>(null)

// Свой контейнер тостов в углу удалён: он был написан до общего useToast.
const toast = useToast()

// Load detail for edit mode
const detailIdRef = computed(() => props.favoritePromptId ?? null)
const {
  data: detailData,
  pending: detailPending,
  refresh: refreshDetail,
} = useFavoritePromptDetail(detailIdRef)

// Список приложений для селекта
const { data: appsData } = useFetch<{ data: Array<{ id: number, name: string }> }>(
  '/api/apps',
  { default: () => ({ data: [] }) },
)

const apps = computed(() => appsData.value?.data ?? [])

const appOptions = computed(() => [
  { value: '', label: 'Универсальный (для всех приложений)' },
  ...apps.value.map(a => ({ value: a.id, label: a.name })),
])

function resetForm() {
  promptTextLocal.value = props.promptText ?? ''
  appIdLocal.value = props.appId ?? null
  tagsLocal.value = []
  notesLocal.value = ''
  isPublicLocal.value = true
  showAdvanced.value = false
  errorMsg.value = null
}

// При открытии — инициализируем форму
watch(
  () => props.open,
  async (v) => {
    if (!v) return
    errorMsg.value = null
    if (props.mode === 'create') {
      resetForm()
    } else if (props.mode === 'edit' && props.favoritePromptId) {
      await refreshDetail()
      const d = detailData.value?.data
      if (d) {
        promptTextLocal.value = d.promptText
        appIdLocal.value = d.appId
        tagsLocal.value = [...d.tags]
        notesLocal.value = d.notes ?? ''
        isPublicLocal.value = d.isPublic
      }
    }
  },
)

function close() {
  if (saving.value) return
  emit('update:open', false)
}

async function save() {
  if (saving.value) return
  errorMsg.value = null

  try {
    saving.value = true
    const { createFavoritePrompt, updateFavoritePrompt } = useFavoritePromptActions()

    if (props.mode === 'create') {
      const input: FavoritePromptCreateInput = {
        promptText: promptTextLocal.value.trim(),
        appId: appIdLocal.value,
        sourceVideoAssetId: props.sourceVideoAssetId ?? null,
        tags: tagsLocal.value,
        notes: notesLocal.value.trim() || null,
        isPublic: isPublicLocal.value,
      }
      if (!input.promptText) {
        errorMsg.value = 'Промт не может быть пустым'
        return
      }
      const created = await createFavoritePrompt(input)
      toast.success('Промт добавлен в избранное')
      emit('saved', created)
      emit('update:open', false)
    } else {
      if (!props.favoritePromptId) {
        errorMsg.value = 'Не указан ID промта для редактирования'
        return
      }
      const input: FavoritePromptUpdateInput = {
        appId: appIdLocal.value,
        tags: tagsLocal.value,
        notes: notesLocal.value.trim() || null,
        isPublic: isPublicLocal.value,
      }
      const updated = await updateFavoritePrompt(props.favoritePromptId, input)
      toast.success('Изменения сохранены')
      emit('saved', updated)
      emit('update:open', false)
    }
  } catch (e: unknown) {
    const err = e as { data?: { message?: string }, message?: string }
    errorMsg.value = err?.data?.message || err?.message || 'Не удалось сохранить промт'
  } finally {
    saving.value = false
  }
}

const title = computed(() =>
  props.mode === 'create' ? 'Добавить в избранное' : 'Редактировать промт',
)
</script>

<template>
  <UiModal :open="open" size="lg" :persistent="saving" @close="close">
    <template #header>
      <span class="flex items-center gap-2">
        <Icon name="mingcute:star-line" class="text-warning" />
        {{ title }}
      </span>
    </template>

    <div v-if="mode === 'edit' && detailPending" class="flex justify-center py-8 text-muted">
      <Icon name="mingcute:loading-line" class="animate-spin text-2xl" />
    </div>

    <div v-else class="flex flex-col gap-3">
      <!-- Превью промта (read-only во всех режимах: в edit — immutable snapshot) -->
      <UiField
        label="Промт (только чтение)"
        hint="Текст промта фиксируется снимком и не редактируется. Редактируйте теги, заметки и привязку."
      >
        <UiTextarea :model-value="promptTextLocal" :rows="5" readonly class="font-mono text-sm" />
      </UiField>

      <UiField label="Приложение">
        <UiSelect
          :model-value="appIdLocal ?? ''"
          :options="appOptions"
          @update:model-value="(v) => appIdLocal = v ? Number(v) : null"
        />
        <SharedFieldHint text="Универсальные промты видны всем приложениям. Привязка к приложению фильтрует промт только под него." />
      </UiField>

      <UiField label="Теги">
        <SharedTagInput
          :model-value="tagsLocal"
          placeholder="Введите тег и Enter"
          @update:model-value="(v) => tagsLocal = v"
        />
        <SharedFieldHint text="Теги помогают AI-ранжированию. Пример: closeup, transformation, cinematic. До 10 тегов, 40 символов каждый." />
      </UiField>

      <UiField label="Заметки (почему хорош)">
        <UiTextarea
          v-model="notesLocal"
          :rows="3"
          maxlength="1000"
          placeholder="Что делает этот промт удачным. Необязательно."
        />
      </UiField>

      <div class="border-t border-divider pt-2">
        <UiButton variant="ghost" @click="showAdvanced = !showAdvanced">
          <Icon :name="showAdvanced ? 'mingcute:up-line' : 'mingcute:down-line'" />
          Дополнительно
        </UiButton>
        <div v-if="showAdvanced" class="mt-2">
          <UiCheckbox v-model="isPublicLocal" label="Публичный (виден всем пользователям)" />
        </div>
      </div>

      <p
        v-if="errorMsg"
        class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-danger"
      >
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
        <span>{{ errorMsg }}</span>
      </p>
    </div>

    <template #footer>
      <UiButton variant="ghost" size="md" :disabled="saving" @click="close">Отмена</UiButton>
      <UiButton
        variant="primary"
        size="md"
        :disabled="mode === 'edit' && detailPending"
        :loading="saving"
        @click="save"
      >
        <Icon v-if="!saving" name="mingcute:save-line" />
        Сохранить
      </UiButton>
    </template>
  </UiModal>
</template>
