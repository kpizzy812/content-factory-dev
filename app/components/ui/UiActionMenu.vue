<script setup lang="ts">
/**
 * Меню действий (три точки). Источник: design-preview/_system/blocks/ActionMenu.html
 *
 * Частые действия сюда не прячутся — они живут в строке. Здесь редкое,
 * разрушающее и оплачиваемое; у оплачиваемых пунктов показывается цена.
 */
export interface ActionMenuItem {
  key: string
  label: string
  icon?: string
  /** Цена операции — обязательна для всего, что дёргает платные модели. */
  cost?: string
  danger?: boolean
  disabled?: boolean
  /** Заголовок группы перед пунктом. */
  group?: string
}

const props = defineProps<{
  items: ActionMenuItem[]
  align?: 'left' | 'right'
}>()

const emit = defineEmits<{ select: [key: string] }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)

function pick(item: ActionMenuItem) {
  if (item.disabled) return
  open.value = false
  emit('select', item.key)
}

function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})

// Заголовок группы рисуется перед первым пунктом этой группы.
const withHeadings = computed(() =>
  props.items.map((item, i) => ({
    item,
    heading: item.group && item.group !== props.items[i - 1]?.group ? item.group : null,
  })),
)
</script>

<template>
  <div ref="root" class="relative">
    <UiButton icon-only variant="ghost" aria-haspopup="menu" :aria-expanded="open" @click.stop="open = !open">
      <Icon name="mingcute:more-2-line" />
    </UiButton>

    <div
      v-if="open"
      role="menu"
      class="absolute top-full z-30 mt-1 w-[220px] rounded-md border border-border bg-raised p-1 shadow-md"
      :class="align === 'left' ? 'left-0' : 'right-0'"
    >
      <template v-for="({ item, heading }) in withHeadings" :key="item.key">
        <div v-if="heading" class="px-[9px] pt-1.5 pb-1 text-micro tracking-[.06em] text-subtle uppercase">
          {{ heading }}
        </div>
        <button
          type="button"
          role="menuitem"
          :disabled="item.disabled"
          class="flex h-7 w-full items-center gap-[9px] rounded-sm px-[9px] text-sm"
          :class="item.disabled
            ? 'cursor-not-allowed text-subtle'
            : item.danger
              ? 'cursor-pointer text-danger hover:bg-danger-bg'
              : 'cursor-pointer text-muted hover:bg-card hover:text-fg'"
          @click="pick(item)"
        >
          <Icon v-if="item.icon" :name="item.icon" class="shrink-0" />
          <span class="truncate">{{ item.label }}</span>
          <span v-if="item.cost" class="ml-auto shrink-0 font-mono text-micro text-subtle">{{ item.cost }}</span>
        </button>
      </template>
    </div>
  </div>
</template>
