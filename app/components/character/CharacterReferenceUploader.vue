<script setup lang="ts">
/**
 * Загрузка/удаление референсов персонажа. UX зеркалит AppReferenceImagesManager
 * (/admin/apps): drag&drop, paste, переключатель kind, AI vision badges с polling'ом,
 * кнопка ручного re-run. Каждый ref имеет aiTags/aiCaption/aiVisualDescription,
 * последнее — это та строка, которая инжектится в video prompt для consistent character.
 */
import type { Character, CharacterReferenceImage, CharacterReferenceKind } from '~~/shared/types/character'
import { CHARACTER_REFERENCE_KINDS, CHARACTER_REFERENCE_KIND_LABELS } from '~~/shared/types/character'

const props = defineProps<{
  character: Character & { referenceImages: CharacterReferenceImage[] }
}>()

const emit = defineEmits<{
  updated: [character: Character & { referenceImages: CharacterReferenceImage[] }]
  regenerate: [ref: CharacterReferenceImage]
}>()

const { uploadReferences, deleteReference } = useCharacterActions()

const kind = ref<CharacterReferenceKind>('face')
const uploading = ref(false)
const deletingId = ref<string | null>(null)
const analyzingId = ref<string | null>(null)
const error = ref('')

const fileInput = ref<HTMLInputElement | null>(null)
const dragOver = ref(false)
const pasteCatcher = ref<HTMLDivElement | null>(null)

// Локальное зеркало referenceImages для polling'a после AI vision.
const localRefs = ref<CharacterReferenceImage[]>(props.character.referenceImages ?? [])
watch(() => props.character.referenceImages, (v) => { if (v) localRefs.value = v }, { immediate: true })

async function refreshRefs() {
  try {
    const res = await $fetch<{ data: Character & { referenceImages: CharacterReferenceImage[] } }>(`/api/characters/${props.character.id}`)
    localRefs.value = res.data.referenceImages ?? []
    emit('updated', res.data as any)
  } catch { /* ignore */ }
}

useImageAnalysisPolling({ items: localRefs, refresh: refreshRefs })

async function uploadFiles(files: File[]) {
  const images = files.filter(f => f.type.startsWith('image/'))
  if (!images.length) { error.value = 'Нужны файлы-изображения'; return }
  uploading.value = true
  error.value = ''
  try {
    const updated = await uploadReferences(props.character.id, images, kind.value)
    emit('updated', updated as any)
    localRefs.value = updated.referenceImages ?? []
  } catch (e: any) {
    error.value = e?.data?.message || e?.message || 'Ошибка загрузки'
  } finally {
    uploading.value = false
  }
}

async function onFileInputChange(event: Event) {
  const target = event.target as HTMLInputElement
  const files = Array.from(target.files ?? [])
  if (files.length) await uploadFiles(files)
  if (fileInput.value) fileInput.value.value = ''
}

function onDrop(event: DragEvent) {
  dragOver.value = false
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (files.length) uploadFiles(files)
}
function onDragOver(event: DragEvent) { event.preventDefault(); dragOver.value = true }
function onDragLeave() { dragOver.value = false }

async function onPaste(event: ClipboardEvent) {
  const items = event.clipboardData?.items
  if (!items) return
  const files: File[] = []
  for (const item of Array.from(items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile()
      if (f) files.push(f)
    }
  }
  if (files.length === 0) return
  event.preventDefault()
  await uploadFiles(files)
}

async function onDelete(refId: string) {
  if (deletingId.value) return
  deletingId.value = refId
  try {
    const updated = await deleteReference(props.character.id, refId)
    emit('updated', updated as any)
    localRefs.value = updated.referenceImages ?? []
  } catch (e: any) {
    error.value = e?.data?.message || e?.message || 'Ошибка удаления'
  } finally {
    deletingId.value = null
  }
}

async function onReanalyze(refId: string) {
  analyzingId.value = refId
  error.value = ''
  try {
    const res = await $fetch<{ data: { reference: CharacterReferenceImage } }>(`/api/characters/${props.character.id}/references/${refId}/analyze`, { method: 'POST' })
    const idx = localRefs.value.findIndex(r => r.id === refId)
    if (idx >= 0 && res.data?.reference) localRefs.value.splice(idx, 1, res.data.reference)
  } catch (e: any) {
    error.value = e?.data?.message || e?.message || 'Ошибка AI-анализа'
  } finally {
    analyzingId.value = null
  }
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center gap-2 flex-wrap">
      <span class="text-sm text-base-content/70">Тип следующих загрузок:</span>
      <div class="join">
        <button
          v-for="k in CHARACTER_REFERENCE_KINDS"
          :key="k"
          type="button"
          class="join-item btn btn-xs"
          :class="kind === k ? 'btn-primary' : 'btn-ghost'"
          @click="kind = k"
        >
          {{ CHARACTER_REFERENCE_KIND_LABELS[k] }}
        </button>
      </div>
    </div>

    <div
      class="border-2 border-dashed rounded-lg p-4 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary"
      :class="dragOver ? 'border-primary bg-primary/5' : 'border-base-300 hover:border-base-content/40'"
      role="button"
      tabindex="0"
      @click="() => { fileInput?.click(); pasteCatcher?.focus() }"
      @keydown.enter="fileInput?.click()"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
    >
      <input
        ref="fileInput"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        class="hidden"
        @change="onFileInputChange"
      />
      <div class="flex flex-col items-center gap-1 text-center">
        <Icon
          :name="uploading ? 'mingcute:loading-3-line' : 'mingcute:pic-2-line'"
          class="size-7 text-base-content/50"
          :class="{ 'animate-spin': uploading }"
        />
        <span class="text-sm font-medium">
          {{ uploading ? 'Загрузка…' : `Перетащите фото (${CHARACTER_REFERENCE_KIND_LABELS[kind].toLowerCase()})` }}
        </span>
        <span class="text-xs text-base-content/50">
          PNG, JPEG, WebP, GIF — до 20 MB. Ctrl+V на зоне тоже работает. AI выявит внешность и инжектит её в prompt видео.
        </span>
      </div>
    </div>

    <div
      ref="pasteCatcher"
      contenteditable="true"
      tabindex="-1"
      aria-hidden="true"
      class="sr-only"
      @paste.prevent="onPaste"
      @input.prevent="(e) => { (e.target as HTMLElement).innerHTML = '' }"
    />

    <div v-if="error" role="alert" class="alert alert-error alert-soft text-sm py-2">
      <Icon name="mingcute:warning-line" />
      <span>{{ error }}</span>
    </div>

    <div v-if="localRefs.length" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      <div
        v-for="ref in localRefs"
        :key="ref.id"
        class="rounded-lg border border-base-300 bg-base-100 overflow-hidden flex flex-col"
      >
        <div class="group relative aspect-square bg-base-200">
          <img :src="ref.fileUrl" :alt="ref.aiCaption ?? ref.kind" class="w-full h-full object-cover" />
          <span class="absolute top-1 left-1 badge badge-xs badge-neutral">
            {{ CHARACTER_REFERENCE_KIND_LABELS[ref.kind as CharacterReferenceKind] ?? ref.kind }}
          </span>
          <span
            v-if="ref.generationPrompt"
            class="absolute top-1 right-1 badge badge-xs badge-soft badge-secondary"
            :title="ref.generationPrompt.length > 200 ? ref.generationPrompt.slice(0, 200) + '…' : ref.generationPrompt"
          >
            <Icon name="mingcute:magic-2-line" class="size-3" />
            AI
          </span>
          <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
            <button
              v-if="ref.generationPrompt"
              type="button"
              class="btn btn-xs btn-ghost text-white hover:bg-white/20"
              title="Сгенерировать снова"
              @click.stop="emit('regenerate', ref)"
            >
              <Icon name="mingcute:refresh-2-line" class="size-3.5" />
            </button>
            <button
              type="button"
              class="btn btn-xs btn-ghost text-white hover:bg-white/20"
              :disabled="analyzingId === ref.id"
              title="Перезапустить AI vision"
              @click.stop="onReanalyze(ref.id)"
            >
              <Icon
                :name="analyzingId === ref.id ? 'mingcute:loading-3-line' : 'mingcute:ai-line'"
                class="size-3.5"
                :class="{ 'animate-spin': analyzingId === ref.id }"
              />
              <span class="text-xs">AI</span>
            </button>
            <button
              type="button"
              class="btn btn-xs btn-error"
              :disabled="deletingId === ref.id"
              title="Удалить"
              @click.stop="onDelete(ref.id)"
            >
              <Icon
                :name="deletingId === ref.id ? 'mingcute:loading-3-line' : 'mingcute:delete-2-line'"
                class="size-3.5"
                :class="{ 'animate-spin': deletingId === ref.id }"
              />
            </button>
          </div>
        </div>

        <div class="p-2 space-y-1 text-xs flex-1 flex flex-col">
          <div v-if="!ref.aiAnalyzedAt && !ref.aiError" class="flex items-center gap-1.5 text-base-content/60">
            <Icon name="mingcute:loading-3-line" class="animate-spin size-3.5 text-primary" />
            <span>AI разбирает внешность…</span>
          </div>
          <div v-else-if="ref.aiError" class="flex items-start gap-1.5 text-error" :title="ref.aiError">
            <Icon name="mingcute:warning-line" class="size-3.5 mt-0.5 shrink-0" />
            <span class="line-clamp-2">{{ ref.aiError }}</span>
          </div>
          <template v-else>
            <p v-if="ref.aiCaption" class="text-base-content/80 line-clamp-2">{{ ref.aiCaption }}</p>
            <div v-if="ref.aiTags?.length" class="flex flex-wrap gap-1">
              <span v-for="t in ref.aiTags.slice(0, 5)" :key="t" class="badge badge-xs badge-ghost">{{ t }}</span>
            </div>
          </template>
        </div>
      </div>
    </div>
    <p v-else class="text-xs text-base-content/50 text-center py-2">
      Пока нет фото. Эти референсы реально пробрасываются в pipeline — AI vision разбирает внешность, и описание инжектится в финальный prompt видео-генерации.
    </p>
  </div>
</template>
