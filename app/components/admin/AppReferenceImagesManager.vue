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
  <div class="flex flex-col gap-3">
    <!-- Зона загрузки. Ctrl+V работает, если сюда кликнуть: элемент получает фокус. -->
    <div
      class="cursor-pointer rounded-lg border-2 border-dashed p-4 outline-none transition-colors duration-(--duration-fast)"
      :class="dragOver ? 'border-accent bg-accent-bg' : 'border-border hover:border-subtle'"
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
          class="text-2xl text-subtle"
          :class="uploading && 'animate-spin'"
        />
        <span class="text-sm font-medium">
          {{ uploading ? 'Загружаем' : 'Перетащите, вставьте или выберите файлы' }}
        </span>
        <span class="text-micro text-subtle">
          PNG, JPEG, WebP, GIF до 20 МБ. После загрузки модель определит тип экрана и теги.
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

    <!--
      Поддержка чтения буфера известна только в браузере, поэтому блок
      рисуется клиентом: на сервере его нет, и Vue иначе ругается на расхождение.
    -->
    <ClientOnly>
      <div v-if="clipboardReadSupported" class="flex flex-wrap items-center gap-2">
        <UiButton variant="ghost" :disabled="uploading" title="Прочитать изображение из буфера" @click="onPasteButton">
          <Icon name="mingcute:paste-line" />
          Вставить из буфера
        </UiButton>
        <span v-if="isFirefox" class="text-micro text-subtle">
          В Firefox кнопке нужен флаг dom.events.asyncClipboard.clipboardItem — или просто Ctrl+V.
        </span>
        <span v-else class="text-micro text-subtle">
          При первом клике браузер спросит разрешение на чтение буфера.
        </span>
      </div>
    </ClientOnly>

    <div
      v-if="error"
      role="alert"
      class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
      <span>{{ error }}</span>
    </div>

    <div v-if="cards.length" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div
        v-for="card in cards"
        :key="card.url"
        class="flex flex-col overflow-hidden rounded-md border border-border bg-card"
      >
        <div class="group relative aspect-video bg-surface">
          <img :src="card.url" :alt="card.ref?.aiCaption || card.url" class="size-full object-cover">

          <div
            class="absolute inset-0 flex items-center justify-center gap-1.5 bg-overlay opacity-0 transition-opacity duration-(--duration-fast) group-hover:opacity-100"
          >
            <UiButton
              variant="ghost"
              :title="copiedUrl === card.url ? 'Скопировано' : 'Скопировать ссылку'"
              @click.stop="onCopy(card.url)"
            >
              <Icon :name="copiedUrl === card.url ? 'mingcute:check-line' : 'mingcute:copy-2-line'" />
              {{ copiedUrl === card.url ? 'Скопировано' : 'Ссылка' }}
            </UiButton>

            <UiButton
              v-if="card.ref"
              icon-only
              variant="ghost"
              :loading="analyzingRefId === card.ref.id"
              title="Разобрать заново"
              aria-label="Разобрать заново"
              @click.stop="onReanalyze(card.ref)"
            >
              <Icon v-if="analyzingRefId !== card.ref.id" name="mingcute:ai-line" />
            </UiButton>

            <UiButton
              icon-only
              variant="danger"
              :loading="deletingUrl === card.url"
              title="Удалить"
              aria-label="Удалить"
              @click.stop="onRemove(card)"
            >
              <Icon v-if="deletingUrl !== card.url" name="mingcute:delete-2-line" />
            </UiButton>
          </div>
        </div>

        <div class="flex flex-1 flex-col gap-1.5 p-2.5 text-micro">
          <div
            v-if="card.ref && !card.ref.aiAnalyzedAt && !card.ref.aiError"
            class="flex items-center gap-1.5 text-muted"
          >
            <Icon name="mingcute:loading-3-line" class="animate-spin text-accent" />
            Разбираем скриншот
          </div>

          <div
            v-else-if="card.ref?.aiError"
            class="flex items-start gap-1.5 text-danger"
            :title="card.ref.aiError"
          >
            <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
            <span class="line-clamp-2">{{ card.ref.aiError }}</span>
          </div>

          <template v-else-if="card.ref?.aiAnalyzedAt">
            <p v-if="card.ref.aiCaption" class="line-clamp-2 text-muted">{{ card.ref.aiCaption }}</p>

            <div v-if="card.ref.aiTags?.length" class="flex flex-wrap gap-1">
              <span
                v-for="tag in card.ref.aiTags"
                :key="tag"
                class="rounded-sm border border-divider px-1.5 py-0.5 text-subtle"
              >
                {{ tag }}
              </span>
            </div>

            <div v-if="card.ref.aiPrimaryAction" class="flex items-center gap-1 text-subtle">
              <Icon name="mingcute:cursor-2-line" />
              <span class="truncate">{{ card.ref.aiPrimaryAction }}</span>
            </div>

            <div
              v-if="card.ref.aiHasUI === false"
              class="flex items-center gap-1 text-warning"
              title="Похоже, это не экран приложения — генерация по такому кадру даст неожиданный результат"
            >
              <Icon name="mingcute:information-line" />
              не экран приложения
            </div>
          </template>

          <p v-else class="text-subtle italic">
            Старая картинка без разметки. Загрузите заново, чтобы появились теги.
          </p>
        </div>
      </div>
    </div>

    <p v-else class="py-2 text-center text-sm text-subtle">
      Референсов нет. Загруженные кадры уходят в контекст генерации сценариев и роликов.
    </p>
  </div>
</template>
