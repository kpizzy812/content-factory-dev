<script setup lang="ts">
/**
 * Менеджер reference-картинок приложения.
 * Поддерживает drag&drop, выбор через input, paste (Ctrl+V), копирование URL, удаление.
 * Под каждой картинкой показывает AI-теги (controlled vocabulary) и caption,
 * spinner если AI-анализ ещё не завершён, кнопку перезапуска при ошибке/устаревании.
 */
import type { AppReferenceImage } from '~~/shared/types/app'

const props = defineProps<{
  appId: number
  initialUrls?: string[]
  initialReferences?: AppReferenceImage[]
  /** Включить paste listener на window (true для модалки). Для inline-варианта false. */
  enableGlobalPaste?: boolean
}>()

const emit = defineEmits<{
  updated: [urls: string[], refs: AppReferenceImage[]]
}>()

const {
  urls,
  references,
  uploading,
  deletingUrl,
  analyzingRefId,
  error,
  refresh,
  upload,
  remove,
  reanalyze,
  handlePaste,
  pasteFromClipboard,
  copyUrl,
} = useAppReferenceImages({
  appId: computed(() => props.appId),
  initial: props.initialUrls ?? [],
  initialReferences: props.initialReferences ?? [],
})

const clipboardReadSupported = computed(() => {
  return typeof navigator !== 'undefined' && !!navigator.clipboard?.read
})

const isFirefox = computed(() => {
  return typeof navigator !== 'undefined' && /firefox|zen/i.test(navigator.userAgent)
})

// Карточки берут источник из references (богатые данные); если backend ещё не отдал
// — fallback на urls (рендерим только превью без AI-инфы).
const cards = computed<Array<{ ref: AppReferenceImage | null; url: string }>>(() => {
  if (references.value.length > 0) {
    return references.value.map(r => ({ ref: r, url: r.fileUrl }))
  }
  return urls.value.map(u => ({ ref: null, url: u }))
})

// Фоновый polling, пока есть картинки без aiAnalyzedAt и без aiError. Обновляем
// каждые 4с — анализ vision API занимает 10-30с, чаще не нужно.
let pollTimer: ReturnType<typeof setInterval> | null = null
const hasPending = computed(() =>
  references.value.some(r => !r.aiAnalyzedAt && !r.aiError),
)

watch(hasPending, (pending) => {
  if (pending && !pollTimer) {
    pollTimer = setInterval(() => { refresh() }, 4000)
  } else if (!pending && pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}, { immediate: true })

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
})

watch([urls, references], () => emit('updated', urls.value, references.value), { deep: true })

async function onPasteButton() {
  const result = await pasteFromClipboard()
  if (result.count === 0) {
    nextTick(() => pasteCatcher.value?.focus())
  } else {
    nextTick(() => pasteCatcher.value?.focus())
  }
}

const fileInput = ref<HTMLInputElement | null>(null)
const dragOver = ref(false)
const copiedUrl = ref<string | null>(null)
const pasteCatcher = ref<HTMLDivElement | null>(null)

function focusPasteCatcher() {
  pasteCatcher.value?.focus()
}

async function onPasteCatcherPaste(event: ClipboardEvent) {
  await handlePaste(event)
  nextTick(() => pasteCatcher.value?.focus())
}

defineExpose({ focusPasteCatcher })

async function onFileInputChange(event: Event) {
  const target = event.target as HTMLInputElement
  const files = Array.from(target.files ?? [])
  if (files.length) {
    await upload(files)
  }
  if (fileInput.value) fileInput.value.value = ''
}

async function onDrop(event: DragEvent) {
  dragOver.value = false
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (files.length) {
    await upload(files)
  }
}

function onDragOver(event: DragEvent) {
  event.preventDefault()
  dragOver.value = true
}

function onDragLeave() {
  dragOver.value = false
}

async function onCopy(url: string) {
  const ok = await copyUrl(url)
  if (ok) {
    copiedUrl.value = url
    setTimeout(() => {
      if (copiedUrl.value === url) copiedUrl.value = null
    }, 1500)
  }
}

async function onRemove(card: { ref: AppReferenceImage | null; url: string }) {
  if (card.ref) {
    await remove({ id: card.ref.id, url: card.url })
  } else {
    await remove(card.url)
  }
}

async function onReanalyze(ref: AppReferenceImage) {
  await reanalyze(ref.id)
}

if (props.enableGlobalPaste) {
  onMounted(() => {
    window.addEventListener('paste', handlePaste)
  })
  onUnmounted(() => {
    window.removeEventListener('paste', handlePaste)
  })
}
</script>

<template>
  <div class="space-y-3">
    <!-- Drop zone / upload trigger. Ctrl+V работает если сюда кликнуть (получит focus через tabindex). -->
    <div
      class="border-2 border-dashed rounded-lg p-4 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary"
      :class="dragOver ? 'border-primary bg-primary/5' : 'border-base-300 hover:border-base-content/40'"
      role="button"
      tabindex="0"
      @click="() => { fileInput?.click(); focusPasteCatcher() }"
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
          {{ uploading ? 'Загрузка...' : 'Перетащите, вставьте (Ctrl+V) или кликните' }}
        </span>
        <span class="text-xs text-base-content/50">
          PNG, JPEG, WebP, GIF - до 20 MB. После загрузки AI определит тип экрана и теги.
        </span>
      </div>
    </div>

    <div
      ref="pasteCatcher"
      contenteditable="true"
      tabindex="-1"
      aria-hidden="true"
      class="sr-only"
      @paste.prevent="onPasteCatcherPaste"
      @input.prevent="(e: Event) => { (e.target as HTMLElement).innerHTML = '' }"
    />

    <div v-if="clipboardReadSupported" class="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        class="btn btn-sm btn-ghost"
        :disabled="uploading"
        title="Прочитать изображение из буфера обмена"
        @click="onPasteButton"
      >
        <Icon name="mingcute:paste-line" class="size-4" />
        Вставить из буфера
      </button>
      <span v-if="isFirefox" class="text-xs text-base-content/50">
        в Firefox/другой браузер для работы кнопки нужно включить dom.events.asyncClipboard.clipboardItem в about:config - иначе используйте Ctrl+V
      </span>
      <span v-else class="text-xs text-base-content/50">
        при первом клике браузер попросит разрешение - нажмите «Разрешить»
      </span>
    </div>

    <div v-if="error" role="alert" class="alert alert-error alert-soft text-sm py-2">
      <Icon name="mingcute:warning-line" class="size-4" />
      <span>{{ error }}</span>
    </div>

    <!-- Grid карточек -->
    <div v-if="cards.length > 0" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <div
        v-for="card in cards"
        :key="card.url"
        class="rounded-lg border border-base-300 bg-base-100 overflow-hidden flex flex-col"
      >
        <!-- Превью + actions -->
        <div class="group relative aspect-video bg-base-200">
          <img :src="card.url" :alt="card.ref?.aiCaption || card.url" class="w-full h-full object-cover" />

          <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
            <button
              type="button"
              class="btn btn-xs btn-ghost text-white hover:bg-white/20"
              :title="copiedUrl === card.url ? 'Скопировано!' : 'Копировать URL'"
              @click.stop="onCopy(card.url)"
            >
              <Icon
                :name="copiedUrl === card.url ? 'mingcute:check-line' : 'mingcute:copy-2-line'"
                class="size-3.5"
              />
              <span class="text-xs">{{ copiedUrl === card.url ? 'Скопировано' : 'URL' }}</span>
            </button>
            <button
              v-if="card.ref"
              type="button"
              class="btn btn-xs btn-ghost text-white hover:bg-white/20"
              :disabled="analyzingRefId === card.ref.id"
              title="Перезапустить AI-анализ"
              @click.stop="onReanalyze(card.ref)"
            >
              <Icon
                :name="analyzingRefId === card.ref.id ? 'mingcute:loading-3-line' : 'mingcute:ai-line'"
                class="size-3.5"
                :class="{ 'animate-spin': analyzingRefId === card.ref.id }"
              />
              <span class="text-xs">AI</span>
            </button>
            <button
              type="button"
              class="btn btn-xs btn-error"
              :disabled="deletingUrl === card.url"
              title="Удалить"
              @click.stop="onRemove(card)"
            >
              <Icon
                :name="deletingUrl === card.url ? 'mingcute:loading-3-line' : 'mingcute:delete-2-line'"
                class="size-3.5"
                :class="{ 'animate-spin': deletingUrl === card.url }"
              />
            </button>
          </div>
        </div>

        <!-- AI-метаданные -->
        <div class="p-2.5 space-y-1.5 text-xs flex-1 flex flex-col">
          <!-- Pending -->
          <div
            v-if="card.ref && !card.ref.aiAnalyzedAt && !card.ref.aiError"
            class="flex items-center gap-1.5 text-base-content/60"
          >
            <Icon name="mingcute:loading-3-line" class="animate-spin size-3.5 text-primary" />
            <span>AI анализирует скриншот...</span>
          </div>

          <!-- Error -->
          <div
            v-else-if="card.ref?.aiError"
            class="flex items-start gap-1.5 text-error"
            :title="card.ref.aiError"
          >
            <Icon name="mingcute:warning-line" class="size-3.5 mt-0.5 shrink-0" />
            <span class="line-clamp-2">{{ card.ref.aiError }}</span>
          </div>

          <!-- Analyzed -->
          <template v-else-if="card.ref?.aiAnalyzedAt">
            <p v-if="card.ref.aiCaption" class="text-base-content/80 line-clamp-2">
              {{ card.ref.aiCaption }}
            </p>
            <div v-if="card.ref.aiTags?.length" class="flex flex-wrap gap-1">
              <span
                v-for="tag in card.ref.aiTags"
                :key="tag"
                class="badge badge-xs badge-ghost"
              >
                {{ tag }}
              </span>
            </div>
            <div
              v-if="card.ref.aiPrimaryAction"
              class="flex items-center gap-1 text-base-content/60"
            >
              <Icon name="mingcute:cursor-2-line" class="size-3" />
              <span class="truncate">{{ card.ref.aiPrimaryAction }}</span>
            </div>
            <div
              v-if="card.ref.aiHasUI === false"
              class="flex items-center gap-1 text-warning"
              title="AI считает, что это не UI приложения — image-to-video может выдать неожиданный результат"
            >
              <Icon name="mingcute:information-line" class="size-3" />
              <span>не UI</span>
            </div>
          </template>

          <!-- Legacy (без AppReferenceImage record) -->
          <p v-else class="text-base-content/40 italic">
            Старая картинка без AI-разметки. Удалите и загрузите снова, чтобы получить теги.
          </p>
        </div>
      </div>
    </div>

    <p v-else class="text-xs text-base-content/50 text-center py-2">
      Пока нет референсов. Добавленные картинки появятся здесь, AI определит тип экрана и теги, и они будут использоваться при генерации сценариев и видео.
    </p>
  </div>
</template>
