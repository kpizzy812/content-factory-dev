<script setup lang="ts">
/**
 * Эталонные кадры сцены. UX зеркалит AppReferenceImagesManager (/admin/apps):
 * drag&drop, paste (Ctrl+V), переключатель kind, AI vision badges с polling'ом,
 * кнопка ручного re-run.
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
watch(references, (v) => emit('updated', v), { deep: true })

// Фоновый polling пока есть фото без aiAnalyzedAt и без aiError (vision 10-30c).
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
function onDragOver(e: DragEvent) { e.preventDefault(); dragOver.value = true }
function onDragLeave() { dragOver.value = false }
async function onDrop(e: DragEvent) {
  dragOver.value = false
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (files.length) await upload(files, kind.value)
}
async function onPaste(e: ClipboardEvent) { await handlePaste(e, kind.value) }
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center gap-2 flex-wrap">
      <span class="text-sm text-base-content/70">Тип следующих загрузок:</span>
      <div class="join">
        <button
          v-for="k in SCENE_REFERENCE_KINDS"
          :key="k"
          type="button"
          class="join-item btn btn-xs"
          :class="kind === k ? 'btn-primary' : 'btn-ghost'"
          @click="kind = k"
        >
          {{ SCENE_REFERENCE_KIND_LABELS[k] }}
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
          {{ uploading ? 'Загрузка…' : `Перетащите эталонный кадр (${SCENE_REFERENCE_KIND_LABELS[kind].toLowerCase()})` }}
        </span>
        <span class="text-xs text-base-content/50">
          PNG, JPEG, WebP, GIF — до 20 MB. После загрузки AI разберёт mood/lighting/композицию и инжектит в prompt.
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

    <div v-if="references.length" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      <div
        v-for="ref in references"
        :key="ref.id"
        class="rounded-lg border border-base-300 bg-base-100 overflow-hidden flex flex-col"
      >
        <div class="group relative aspect-square bg-base-200">
          <img :src="ref.fileUrl" :alt="ref.aiCaption ?? ref.kind" class="w-full h-full object-cover" />
          <span class="absolute top-1 left-1 badge badge-xs badge-neutral">
            {{ SCENE_REFERENCE_KIND_LABELS[ref.kind as SceneReferenceKind] ?? ref.kind }}
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
              title="Перезапустить AI-анализ"
              @click.stop="reanalyze(ref.id)"
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
              @click.stop="remove(ref.id)"
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
            <span>AI разбирает кадр…</span>
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
      Пока нет эталонных кадров. Эти картинки реально пробрасываются в video-генерацию через image-to-video.
    </p>
  </div>
</template>
