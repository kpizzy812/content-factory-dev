<script setup lang="ts">
/**
 * Боковая панель деталей. Источник: design-preview/_system/blocks/Drawer.html
 *
 * Открывается по клику на строку и не уводит со списка. Навигация «← →» по
 * соседям обязательна: оператор просматривает пачками и не должен возвращаться
 * в список после каждого объекта.
 */
const props = withDefaults(defineProps<{
  open: boolean
  title?: string
  subtitle?: string
  width?: string
  /** Позиция в списке — «12 из 240». */
  position?: string
  hasPrev?: boolean
  hasNext?: boolean
}>(), { width: '480px' })

const emit = defineEmits<{ close: [], prev: [], next: [] }>()

function onKey(e: KeyboardEvent) {
  if (!props.open) return
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

  if (e.key === 'Escape') emit('close')
  else if (e.key === 'ArrowLeft' && props.hasPrev) emit('prev')
  else if (e.key === 'ArrowRight' && props.hasNext) emit('next')
}

onMounted(() => document.addEventListener('keydown', onKey))
onUnmounted(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-40 flex justify-end" @click.self="emit('close')">
      <div class="absolute inset-0 bg-overlay" />
      <aside
        class="relative flex h-full flex-col border-l border-border bg-panel shadow-lg"
        :style="{ width: `min(${width}, 100vw)` }"
      >
        <header class="flex items-center gap-2 border-b border-divider px-4 py-3">
          <div class="min-w-0 flex-1">
            <div class="truncate font-medium">{{ title }}</div>
            <div v-if="subtitle" class="truncate font-mono text-micro text-subtle">{{ subtitle }}</div>
          </div>

          <div class="flex shrink-0 items-center gap-1">
            <UiButton icon-only variant="ghost" :disabled="!hasPrev" aria-label="Предыдущий" @click="emit('prev')">
              <Icon name="mingcute:left-line" />
            </UiButton>
            <span v-if="position" class="tnum px-1 text-micro text-subtle">{{ position }}</span>
            <UiButton icon-only variant="ghost" :disabled="!hasNext" aria-label="Следующий" @click="emit('next')">
              <Icon name="mingcute:right-line" />
            </UiButton>
            <UiButton icon-only variant="ghost" aria-label="Закрыть" @click="emit('close')">
              <Icon name="mingcute:close-line" />
            </UiButton>
          </div>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
          <slot />
        </div>

        <footer v-if="$slots.footer" class="flex gap-2 border-t border-divider px-4 py-3">
          <slot name="footer" />
        </footer>
      </aside>
    </div>
  </Teleport>
</template>
