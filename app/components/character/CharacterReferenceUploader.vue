<script setup lang="ts">
/**
 * Загрузка и удаление референс-фото персонажа: drag&drop, вставка из буфера,
 * разбор внешности моделью с опросом до готовности.
 *
 * Описание внешности, которое собирает разбор, уходит в промпт генерации ролика —
 * поэтому статус разбора виден на каждой карточке, а не спрятан.
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

// Локальное зеркало нужно для опроса: разбор внешности приходит не сразу.
const localRefs = ref<CharacterReferenceImage[]>(props.character.referenceImages ?? [])
watch(() => props.character.referenceImages, (v) => { if (v) localRefs.value = v }, { immediate: true })

async function refreshRefs() {
  try {
    const res = await $fetch<{ data: Character & { referenceImages: CharacterReferenceImage[] } }>(
      `/api/characters/${props.character.id}`,
    )
    localRefs.value = res.data.referenceImages ?? []
    emit('updated', res.data)
  }
  catch { /* опрос не должен ронять страницу */ }
}

useImageAnalysisPolling({ items: localRefs, refresh: refreshRefs })

function errorText(e: unknown, fallback: string) {
  return (e as { data?: { message?: string }, message?: string })?.data?.message
    || (e as Error)?.message
    || fallback
}

async function uploadFiles(files: File[]) {
  const images = files.filter(f => f.type.startsWith('image/'))
  if (!images.length) {
    error.value = 'Нужны файлы-изображения'
    return
  }
  uploading.value = true
  error.value = ''
  try {
    const updated = await uploadReferences(props.character.id, images, kind.value)
    emit('updated', updated)
    localRefs.value = updated.referenceImages ?? []
  }
  catch (e) {
    error.value = errorText(e, 'Не удалось загрузить фото')
  }
  finally {
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

function onDragOver(event: DragEvent) {
  event.preventDefault()
  dragOver.value = true
}

function onDragLeave() {
  dragOver.value = false
}

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
  if (!files.length) return
  event.preventDefault()
  await uploadFiles(files)
}

async function onDelete(refId: string) {
  if (deletingId.value) return
  deletingId.value = refId
  try {
    const updated = await deleteReference(props.character.id, refId)
    emit('updated', updated)
    localRefs.value = updated.referenceImages ?? []
  }
  catch (e) {
    error.value = errorText(e, 'Не удалось удалить фото')
  }
  finally {
    deletingId.value = null
  }
}

async function onReanalyze(refId: string) {
  analyzingId.value = refId
  error.value = ''
  try {
    const res = await $fetch<{ data: { reference: CharacterReferenceImage } }>(
      `/api/characters/${props.character.id}/references/${refId}/analyze`,
      { method: 'POST' },
    )
    const idx = localRefs.value.findIndex(r => r.id === refId)
    if (idx >= 0 && res.data?.reference) localRefs.value.splice(idx, 1, res.data.reference)
  }
  catch (e) {
    error.value = errorText(e, 'Не удалось разобрать фото')
  }
  finally {
    analyzingId.value = null
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-sm text-muted">Тип следующих загрузок</span>
      <div class="flex overflow-hidden rounded-md border border-border">
        <button
          v-for="k in CHARACTER_REFERENCE_KINDS"
          :key="k"
          type="button"
          class="h-7 cursor-pointer px-2.5 text-sm"
          :class="kind === k ? 'bg-accent text-on-accent' : 'bg-card text-muted hover:text-fg'"
          @click="kind = k"
        >
          {{ CHARACTER_REFERENCE_KIND_LABELS[k] }}
        </button>
      </div>
    </div>

    <div
      class="cursor-pointer rounded-lg border-2 border-dashed p-4 outline-none transition-colors duration-(--duration-fast)"
      :class="dragOver ? 'border-accent bg-accent-bg' : 'border-border hover:border-subtle'"
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
      >
      <div class="flex flex-col items-center gap-1 text-center">
        <Icon
          :name="uploading ? 'mingcute:loading-3-line' : 'mingcute:pic-2-line'"
          class="text-2xl text-subtle"
          :class="uploading && 'animate-spin'"
        />
        <span class="text-sm font-medium">
          {{ uploading
            ? 'Загружаем'
            : `Перетащите фото — ${CHARACTER_REFERENCE_KIND_LABELS[kind].toLowerCase()}` }}
        </span>
        <span class="text-micro text-subtle">
          PNG, JPEG, WebP, GIF до 20 МБ. Ctrl+V прямо на зоне тоже работает.
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

    <div
      v-if="error"
      role="alert"
      class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
      <span>{{ error }}</span>
    </div>

    <div v-if="localRefs.length" class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <div
        v-for="ref in localRefs"
        :key="ref.id"
        class="flex flex-col overflow-hidden rounded-md border border-border bg-card"
      >
        <div class="group relative aspect-square bg-surface">
          <img :src="ref.fileUrl" :alt="ref.aiCaption ?? ref.kind" class="size-full object-cover">

          <span class="absolute top-1 left-1 rounded-sm border border-border bg-panel px-1.5 py-0.5 text-micro text-muted">
            {{ CHARACTER_REFERENCE_KIND_LABELS[ref.kind as CharacterReferenceKind] ?? ref.kind }}
          </span>

          <span
            v-if="ref.generationPrompt"
            class="absolute top-1 right-1 flex items-center gap-1 rounded-sm border border-accent-border bg-accent-bg px-1.5 py-0.5 text-micro text-accent"
            :title="ref.generationPrompt.slice(0, 200)"
          >
            <Icon name="mingcute:magic-2-line" />
            AI
          </span>

          <div
            class="absolute inset-0 flex items-center justify-center gap-1 bg-overlay opacity-0 transition-opacity duration-(--duration-fast) group-hover:opacity-100"
          >
            <UiButton
              v-if="ref.generationPrompt"
              icon-only
              variant="ghost"
              title="Сгенерировать снова"
              aria-label="Сгенерировать снова"
              @click.stop="emit('regenerate', ref)"
            >
              <Icon name="mingcute:refresh-2-line" />
            </UiButton>

            <UiButton
              icon-only
              variant="ghost"
              :loading="analyzingId === ref.id"
              title="Разобрать внешность заново"
              aria-label="Разобрать внешность заново"
              @click.stop="onReanalyze(ref.id)"
            >
              <Icon v-if="analyzingId !== ref.id" name="mingcute:ai-line" />
            </UiButton>

            <UiButton
              icon-only
              variant="danger"
              :loading="deletingId === ref.id"
              title="Удалить фото"
              aria-label="Удалить фото"
              @click.stop="onDelete(ref.id)"
            >
              <Icon v-if="deletingId !== ref.id" name="mingcute:delete-2-line" />
            </UiButton>
          </div>
        </div>

        <div class="flex flex-1 flex-col gap-1 p-2 text-micro">
          <div v-if="!ref.aiAnalyzedAt && !ref.aiError" class="flex items-center gap-1.5 text-muted">
            <Icon name="mingcute:loading-3-line" class="animate-spin text-accent" />
            Разбираем внешность
          </div>
          <div v-else-if="ref.aiError" class="flex items-start gap-1.5 text-danger" :title="ref.aiError">
            <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
            <span class="line-clamp-2">{{ ref.aiError }}</span>
          </div>
          <template v-else>
            <p v-if="ref.aiCaption" class="line-clamp-2 text-muted">{{ ref.aiCaption }}</p>
            <div v-if="ref.aiTags?.length" class="flex flex-wrap gap-1">
              <span
                v-for="t in ref.aiTags.slice(0, 5)"
                :key="t"
                class="rounded-sm border border-divider px-1.5 py-0.5 text-subtle"
              >
                {{ t }}
              </span>
            </div>
          </template>
        </div>
      </div>
    </div>

    <p v-else class="py-2 text-center text-sm text-subtle">
      Фото пока нет. Разбор внешности с этих кадров уходит в промпт генерации ролика.
    </p>
  </div>
</template>
