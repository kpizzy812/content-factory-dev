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

// Toast уведомление об успехе (inline, как в других местах проекта)
const toast = ref<{ message: string, type: 'success' | 'error' } | null>(null)
function showToast(message: string, type: 'success' | 'error' = 'success') {
  toast.value = { message, type }
  setTimeout(() => { toast.value = null }, 3000)
}

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
      showToast('Промт добавлен в избранное')
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
      showToast('Изменения сохранены')
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

// Close on Escape
watchEffect((onCleanup) => {
  if (!props.open || typeof window === 'undefined') return
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }
  window.addEventListener('keydown', handler)
  onCleanup(() => window.removeEventListener('keydown', handler))
})

const title = computed(() =>
  props.mode === 'create' ? 'Добавить в избранное' : 'Редактировать промт',
)
</script>

<template>
  <Teleport to="body">
    <dialog class="modal" :class="{ 'modal-open': open }">
      <div class="modal-box max-w-2xl">
        <div class="flex items-start justify-between gap-3 mb-3">
          <h3 class="font-bold text-lg flex items-center gap-2">
            <Icon name="mingcute:star-line" class="size-5 text-warning" />
            {{ title }}
          </h3>
          <button
            type="button"
            class="btn btn-sm btn-circle btn-ghost"
            aria-label="Закрыть"
            :disabled="saving"
            @click="close"
          >
            <Icon name="mingcute:close-line" class="size-4" />
          </button>
        </div>

        <div v-if="mode === 'edit' && detailPending" class="flex justify-center py-8">
          <span class="loading loading-spinner loading-md" />
        </div>

        <div v-else class="space-y-3">
          <!-- Превью промта (read-only во всех режимах: в edit — immutable snapshot) -->
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Промт (read-only)</legend>
            <textarea
              class="textarea w-full text-xs"
              rows="5"
              readonly
              :value="promptTextLocal"
            />
            <p class="label text-[10px] text-base-content/50">
              Текст промта фиксируется как snapshot и не редактируется. Редактируйте теги, заметки и привязку.
            </p>
          </fieldset>

          <!-- Приложение -->
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Приложение</legend>
            <select
              class="select select-sm w-full"
              :value="appIdLocal ?? ''"
              @change="appIdLocal = ($event.target as HTMLSelectElement).value ? Number(($event.target as HTMLSelectElement).value) : null"
            >
              <option value="">Универсальный (для всех приложений)</option>
              <option v-for="a in apps" :key="a.id" :value="a.id">
                {{ a.name }}
              </option>
            </select>
            <SharedFieldHint text="Универсальные промты видны всем приложениям. Привязка к приложению фильтрует промт только под него." />
          </fieldset>

          <!-- Теги -->
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Теги</legend>
            <SharedTagInput
              :model-value="tagsLocal"
              placeholder="Введите тег и Enter"
              @update:model-value="(v) => tagsLocal = v"
            />
            <SharedFieldHint text="Теги помогают AI-ранжированию. Пример: closeup, transformation, cinematic. До 10 тегов, 40 символов каждый." />
          </fieldset>

          <!-- Заметки -->
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Заметки (почему крут)</legend>
            <textarea
              v-model="notesLocal"
              class="textarea textarea-sm w-full"
              rows="3"
              placeholder="Что делает этот промт удачным. Необязательно."
              maxlength="1000"
            />
          </fieldset>

          <!-- Доп: публичность -->
          <div class="border-t border-base-300 pt-2">
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              @click="showAdvanced = !showAdvanced"
            >
              <Icon
                :name="showAdvanced ? 'mingcute:up-line' : 'mingcute:down-line'"
                class="text-xs"
              />
              Дополнительно
            </button>
            <div v-if="showAdvanced" class="mt-2">
              <label class="label cursor-pointer gap-2 justify-start">
                <input
                  v-model="isPublicLocal"
                  type="checkbox"
                  class="checkbox checkbox-sm"
                />
                <span class="label-text text-sm">Публичный (виден всем пользователям)</span>
              </label>
            </div>
          </div>

          <div v-if="errorMsg" class="alert alert-error alert-soft text-xs py-2">
            <Icon name="mingcute:alert-line" class="text-sm" />
            <span>{{ errorMsg }}</span>
          </div>
        </div>

        <div class="modal-action">
          <button
            type="button"
            class="btn btn-sm btn-ghost"
            :disabled="saving"
            @click="close"
          >
            Отмена
          </button>
          <button
            type="button"
            class="btn btn-sm btn-primary"
            :disabled="saving || (mode === 'edit' && detailPending)"
            @click="save"
          >
            <span v-if="saving" class="loading loading-spinner loading-xs" />
            <Icon v-else name="mingcute:save-line" class="text-xs" />
            Сохранить
          </button>
        </div>
      </div>
      <div class="modal-backdrop" @click="close" />
    </dialog>

    <!-- Toast уведомление -->
    <div v-if="toast" class="toast toast-end toast-bottom z-[100]">
      <div
        role="alert"
        class="alert"
        :class="toast.type === 'success' ? 'alert-success' : 'alert-error'"
      >
        <Icon
          :name="toast.type === 'success' ? 'mingcute:check-circle-line' : 'mingcute:alert-line'"
          class="size-4"
        />
        <span>{{ toast.message }}</span>
      </div>
    </div>
  </Teleport>
</template>
