<script setup lang="ts">
/**
 * Референс-изображения приложения в модалке.
 *
 * Ctrl+V ловится сразу после открытия — картинки чаще вставляют из буфера,
 * чем выбирают файлом, и лишний клик по зоне здесь мешает.
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

const managerRef = ref<{ focusPasteCatcher: () => void } | null>(null)

watch(() => props.open, (v) => {
  if (v) nextTick(() => managerRef.value?.focusPasteCatcher())
})
</script>

<template>
  <UiModal :open="open" size="lg" @close="close">
    <template #header>
      <span class="flex min-w-0 items-center gap-2">
        <Icon name="mingcute:attachment-line" class="shrink-0 text-accent" />
        <span class="truncate">Референсы · {{ appName }}</span>
      </span>
    </template>

    <div class="flex flex-col gap-3">
      <p class="text-sm text-muted">
        Эти изображения уходят в контекст генерации сценариев и роликов. Работают Ctrl+V,
        перетаскивание и выбор файлов.
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
    </div>

    <template #footer>
      <UiButton @click="close">Готово</UiButton>
    </template>
  </UiModal>
</template>
