<script setup lang="ts">
/**
 * Модальное окно. Источник: design-preview/_system/blocks/Modal.html
 *
 * Модалка — для того, что требует решения здесь и сейчас. Для просмотра
 * деталей есть UiDrawer: он не отрезает от списка.
 * Фокус ловится внутри, Escape закрывает, фон не скроллится.
 */
const props = withDefaults(defineProps<{
  open: boolean
  title?: string
  size?: 'sm' | 'md' | 'lg'
  /** Запретить закрытие по фону и Escape — для операций, которые нельзя бросить. */
  persistent?: boolean
}>(), { size: 'md' })

const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLElement | null>(null)

function close() {
  if (!props.persistent) emit('close')
}

function onKey(e: KeyboardEvent) {
  if (!props.open) return
  if (e.key === 'Escape') {
    e.stopPropagation()
    close()
    return
  }
  if (e.key !== 'Tab' || !panel.value) return

  // Ловушка фокуса: Tab по кругу внутри модалки.
  const focusable = panel.value.querySelectorAll<HTMLElement>(
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
  )
  if (!focusable.length) return
  const first = focusable[0]!
  const last = focusable[focusable.length - 1]!
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  }
  else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

watch(() => props.open, async (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
  if (open) {
    await nextTick()
    panel.value?.querySelector<HTMLElement>('[autofocus],button,input')?.focus()
  }
})

onMounted(() => document.addEventListener('keydown', onKey, true))
onUnmounted(() => {
  document.removeEventListener('keydown', onKey, true)
  document.body.style.overflow = ''
})

const width = computed(() => ({ sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl' }[props.size]))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
      @click.self="close"
    >
      <div
        ref="panel"
        role="dialog"
        aria-modal="true"
        class="flex max-h-[85vh] w-full flex-col rounded-lg border border-border bg-raised shadow-lg"
        :class="width"
      >
        <div v-if="title || $slots.header" class="flex items-center gap-3 border-b border-divider px-4 py-3">
          <h2 class="flex-1 text-lg font-medium">
            <slot name="header">{{ title }}</slot>
          </h2>
          <UiButton v-if="!persistent" icon-only variant="ghost" aria-label="Закрыть" @click="close">
            <Icon name="mingcute:close-line" />
          </UiButton>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
          <slot />
        </div>

        <div v-if="$slots.footer" class="flex justify-end gap-2 border-t border-divider px-4 py-3">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
