<script setup lang="ts">
/**
 * Модалка управления reference-картинками приложения.
 * Открывается по флагу open, внутри AppReferenceImagesManager с enableGlobalPaste.
 */
import type { AppReferenceImage } from '~~/shared/types/app'

const props = defineProps<{
  open: boolean
  appId: number
  appName: string
  initialUrls?: string[]
  initialReferences?: AppReferenceImage[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'updated': [urls: string[], refs: AppReferenceImage[]]
}>()

function close() {
  emit('update:open', false)
}

// Closed Manager exposes focusPasteCatcher — дёргаем при открытии, чтобы Ctrl+V
// работал сразу без клика внутри модалки.
const managerRef = ref<{ focusPasteCatcher: () => void } | null>(null)

watch(() => props.open, (v) => {
  if (v) {
    nextTick(() => managerRef.value?.focusPasteCatcher())
  }
})

// Закрытие по Escape
watchEffect((onCleanup) => {
  if (!props.open || typeof window === 'undefined') return
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }
  window.addEventListener('keydown', handler)
  onCleanup(() => window.removeEventListener('keydown', handler))
})
</script>

<template>
  <Teleport to="body">
    <dialog class="modal" :class="{ 'modal-open': open }">
      <div class="modal-box max-w-3xl">
        <div class="flex items-start justify-between gap-3 mb-3">
          <div class="min-w-0">
            <h3 class="font-bold text-lg flex items-center gap-2">
              <Icon name="mingcute:attachment-line" class="size-5 text-primary" />
              Референсы приложения
            </h3>
            <p class="text-sm text-base-content/60 truncate">
              {{ appName }}
            </p>
          </div>
          <button
            type="button"
            class="btn btn-sm btn-circle btn-ghost"
            aria-label="Закрыть"
            @click="close"
          >
            <Icon name="mingcute:close-line" class="size-4" />
          </button>
        </div>

        <p class="text-xs text-base-content/60 mb-3">
          Изображения, которые вы приложите, будут передаваться в контекст генерации сценариев и видео.
          Вставка работает через Ctrl+V, drag&drop или выбор файлов.
        </p>

        <AdminAppReferenceImagesManager
          v-if="open"
          ref="managerRef"
          :app-id="appId"
          :initial-urls="initialUrls"
          :initial-references="initialReferences"
          :enable-global-paste="true"
          @updated="(urls: string[], refs: AppReferenceImage[]) => emit('updated', urls, refs)"
        />

        <div class="modal-action">
          <button type="button" class="btn btn-sm" @click="close">
            Готово
          </button>
        </div>
      </div>
      <div class="modal-backdrop" @click="close" />
    </dialog>
  </Teleport>
</template>
