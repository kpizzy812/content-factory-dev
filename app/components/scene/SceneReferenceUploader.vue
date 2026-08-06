<script setup lang="ts">
/**
 * Эталонные кадры сцены: drag&drop, вставка из буфера, разбор кадра моделью
 * с опросом до готовности. Зеркалит CharacterReferenceUploader.
 *
 * Статус разбора виден на каждой карточке: описание кадра уходит в промпт
 * генерации, и по нему видно, готов ли кадр к отправке в конвейер.
 */
import type { SceneReferenceImage, SceneReferenceKind } from '~~/shared/types/scene'
import { SCENE_REFERENCE_KINDS, SCENE_REFERENCE_KIND_LABELS } from '~~/shared/types/scene'

const props = defineProps<{
  sceneId: string
}>()

const emit = defineEmits<{
  updated: [refs: SceneReferenceImage[]]
  regenerate: [ref: SceneReferenceImage]
}>()

const kind = ref<SceneReferenceKind>('mood')

const {
  references,
  uploading,
  deletingId,
  analyzingId,
  error,
  refresh,
  upload,
  remove,
  reanalyze,
  handlePaste,
} = useSceneReferences({ sceneId: computed(() => props.sceneId) })

onMounted(() => { refresh() })
watch(references, v => emit('updated', v), { deep: true })

// Разбор кадра занимает десятки секунд — опрашиваем, пока есть неразобранные.
useImageAnalysisPolling({ items: references, refresh })

const fileInput = ref<HTMLInputElement | null>(null)
const dragOver = ref(false)
const pasteCatcher = ref<HTMLDivElement | null>(null)

async function onFileInputChange(e: Event) {
  const target = e.target as HTMLInputElement
  const files = Array.from(target.files ?? [])
  if (files.length) await upload(files, kind.value)
  if (fileInput.value) fileInput.value.value = ''
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  dragOver.value = true
}

function onDragLeave() {
  dragOver.value = false
}

async function onDrop(e: DragEvent) {
  dragOver.value = false
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (files.length) await upload(files, kind.value)
}

async function onPaste(e: ClipboardEvent) {
  await handlePaste(e, kind.value)
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-sm text-muted">Тип следующих загрузок</span>
      <div class="flex overflow-hidden rounded-md border border-border">
        <button
          v-for="k in SCENE_REFERENCE_KINDS"
          :key="k"
          type="button"
          class="h-7 cursor-pointer px-2.5 text-sm"
          :class="kind === k ? 'bg-accent text-on-accent' : 'bg-card text-muted hover:text-fg'"
          :aria-pressed="kind === k"
          @click="kind = k"
        >
          {{ SCENE_REFERENCE_KIND_LABELS[k] }}
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
            : `Перетащите кадр — ${SCENE_REFERENCE_KIND_LABELS[kind].toLowerCase()}` }}
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

    <div v-if="references.length" class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <div
        v-for="item in references"
        :key="item.id"
        class="flex flex-col overflow-hidden rounded-md border border-border bg-card"
      >
        <div class="group relative aspect-square bg-surface">
          <img :src="item.fileUrl" :alt="item.aiCaption ?? item.kind" class="size-full object-cover">

          <span class="absolute top-1 left-1 rounded-sm border border-border bg-panel px-1.5 py-0.5 text-micro text-muted">
            {{ SCENE_REFERENCE_KIND_LABELS[item.kind as SceneReferenceKind] ?? item.kind }}
          </span>

          <span
            v-if="item.generationPrompt"
            class="absolute top-1 right-1 flex items-center gap-1 rounded-sm border border-accent-border bg-accent-bg px-1.5 py-0.5 text-micro text-accent"
            :title="item.generationPrompt.slice(0, 200)"
          >
            <Icon name="mingcute:magic-2-line" />
            AI
          </span>

          <div
            class="absolute inset-0 flex items-center justify-center gap-1 bg-overlay opacity-0 transition-opacity duration-(--duration-fast) group-hover:opacity-100"
          >
            <UiButton
              v-if="item.generationPrompt"
              icon-only
              variant="ghost"
              title="Сгенерировать снова"
              aria-label="Сгенерировать снова"
              @click.stop="emit('regenerate', item)"
            >
              <Icon name="mingcute:refresh-2-line" />
            </UiButton>

            <UiButton
              icon-only
              variant="ghost"
              :loading="analyzingId === item.id"
              title="Разобрать кадр заново"
              aria-label="Разобрать кадр заново"
              @click.stop="reanalyze(item.id)"
            >
              <Icon v-if="analyzingId !== item.id" name="mingcute:ai-line" />
            </UiButton>

            <UiButton
              icon-only
              variant="danger"
              :loading="deletingId === item.id"
              title="Удалить кадр"
              aria-label="Удалить кадр"
              @click.stop="remove(item.id)"
            >
              <Icon v-if="deletingId !== item.id" name="mingcute:delete-2-line" />
            </UiButton>
          </div>
        </div>

        <div class="flex flex-1 flex-col gap-1 p-2 text-micro">
          <div v-if="!item.aiAnalyzedAt && !item.aiError" class="flex items-center gap-1.5 text-muted">
            <Icon name="mingcute:loading-3-line" class="animate-spin text-accent" />
            Разбираем кадр
          </div>
          <div v-else-if="item.aiError" class="flex items-start gap-1.5 text-danger" :title="item.aiError">
            <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
            <span class="line-clamp-2">{{ item.aiError }}</span>
          </div>
          <template v-else>
            <p v-if="item.aiCaption" class="line-clamp-2 text-muted">{{ item.aiCaption }}</p>
            <div v-if="item.aiTags?.length" class="flex flex-wrap gap-1">
              <span
                v-for="t in item.aiTags.slice(0, 5)"
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
      Кадров пока нет. Разбор с этих кадров уходит в промпт, а сами кадры — в image-to-video.
    </p>
  </div>
</template>
