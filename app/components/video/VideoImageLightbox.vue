<script setup lang="ts">
/**
 * Просмотр кадра во весь экран.
 *
 * Кадр лежит на панели системы, а не на «просто чёрном»: подпись и кнопки
 * тогда берут обычные токены текста и читаются в обеих темах.
 *
 * Стрелки не прячутся на краях, а отключаются — иначе кнопка «вперёд» уезжает
 * из-под курсора в момент, когда её нажимают.
 */
const props = defineProps<{
  images: Array<{ id: number; fileUrl: string | null; prompt: string | null; order: number }>
  initialIndex?: number
}>()

const emit = defineEmits<{ close: [] }>()

const currentIndex = ref(props.initialIndex ?? 0)
const currentImage = computed(() => props.images[currentIndex.value])

/** Пропавшие файлы отмечаем сами — общий плейсхолдер нарисован светлым. */
const missing = ref(new Set<number>())

function next() { if (currentIndex.value < props.images.length - 1) currentIndex.value++ }
function prev() { if (currentIndex.value > 0) currentIndex.value-- }

function downloadImage() {
  if (!currentImage.value?.fileUrl) return
  const a = document.createElement('a')
  a.href = `/api/files/${currentImage.value.fileUrl}`
  a.download = `image_${currentImage.value.order + 1}.png`
  a.click()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
  if (e.key === 'ArrowRight') next()
  if (e.key === 'ArrowLeft') prev()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  document.body.style.overflow = 'hidden'
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
      @click.self="emit('close')"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Просмотр кадра"
        class="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg border border-border bg-panel shadow-lg"
      >
        <header class="flex shrink-0 items-center gap-2 border-b border-divider px-3 py-2">
          <span class="tnum font-mono text-sm text-subtle">
            кадр {{ currentIndex + 1 }} из {{ images.length }}
          </span>
          <span class="flex-1" />
          <UiButton icon-only variant="ghost" aria-label="Скачать кадр" @click="downloadImage">
            <Icon name="mingcute:download-2-line" />
          </UiButton>
          <UiButton icon-only variant="ghost" aria-label="Закрыть" @click="emit('close')">
            <Icon name="mingcute:close-line" />
          </UiButton>
        </header>

        <div class="flex min-h-0 flex-1 items-center gap-2 p-3">
          <UiButton icon-only variant="ghost" :disabled="currentIndex === 0" aria-label="Предыдущий кадр" @click="prev">
            <Icon name="mingcute:left-line" />
          </UiButton>

          <div class="flex min-h-0 flex-1 items-center justify-center">
            <div
              v-if="!currentImage?.fileUrl || missing.has(currentImage.id)"
              class="flex aspect-[9/16] max-h-[70vh] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-surface px-8 text-subtle"
            >
              <Icon name="mingcute:pic-line" class="text-2xl" />
              <span class="text-sm">Файла нет на сервере</span>
            </div>
            <img
              v-else
              :src="`/api/files/${currentImage.fileUrl}`"
              alt="Кадр ролика"
              class="max-h-[70vh] max-w-full rounded-md bg-surface object-contain"
              @error="missing.add(currentImage.id)"
            >
          </div>

          <UiButton
            icon-only
            variant="ghost"
            :disabled="currentIndex >= images.length - 1"
            aria-label="Следующий кадр"
            @click="next"
          >
            <Icon name="mingcute:right-line" />
          </UiButton>
        </div>

        <p
          v-if="currentImage?.prompt"
          class="max-h-24 shrink-0 overflow-y-auto border-t border-divider px-3 py-2 text-sm text-muted"
        >
          {{ currentImage.prompt }}
        </p>
      </div>
    </div>
  </Teleport>
</template>
