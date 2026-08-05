<script setup lang="ts">
/**
 * Меню колонок. Источник: design-preview/_system/blocks/EntityTableHead.html
 *
 * Состав и порядок колонок пишутся в сохранённое представление, а не в
 * глобальную настройку: у трендвотчера и у оператора публикации разные наборы
 * в одном разделе.
 */
export interface ColumnDef {
  key: string
  label: string
  /** Колонку нельзя скрыть — без неё строка перестаёт быть опознаваемой. */
  locked?: boolean
}

const props = defineProps<{
  columns: ColumnDef[]
  visible: string[]
}>()

const emit = defineEmits<{ 'update:visible': [value: string[]] }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const dragKey = ref<string | null>(null)

function isOn(key: string) {
  return props.visible.includes(key)
}

function toggle(col: ColumnDef) {
  if (col.locked) return
  emit('update:visible', isOn(col.key)
    ? props.visible.filter(k => k !== col.key)
    : [...props.visible, col.key])
}

function onDrop(target: string) {
  if (!dragKey.value || dragKey.value === target) return
  const next = [...props.visible]
  const from = next.indexOf(dragKey.value)
  const to = next.indexOf(target)
  if (from === -1 || to === -1) return
  next.splice(to, 0, ...next.splice(from, 1))
  emit('update:visible', next)
  dragKey.value = null
}

function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}

onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div ref="root" class="relative">
    <button
      type="button"
      class="flex cursor-pointer items-center gap-1 text-micro tracking-[.06em] text-subtle uppercase hover:text-fg"
      @click.stop="open = !open"
    >
      Колонки
      <Icon name="mingcute:down-line" />
    </button>

    <div
      v-if="open"
      class="absolute top-full right-0 z-30 mt-1 w-56 rounded-md border border-border bg-raised p-1 shadow-md"
    >
      <div class="px-[9px] pt-1.5 pb-1 text-[10.5px] tracking-[.07em] text-subtle uppercase">
        Перетащите, чтобы поменять порядок
      </div>
      <div
        v-for="col in columns"
        :key="col.key"
        :draggable="isOn(col.key) && !col.locked"
        class="flex h-7 items-center gap-2 rounded-sm px-[9px] text-sm normal-case"
        :class="col.locked ? 'text-subtle' : 'cursor-pointer text-muted hover:bg-card hover:text-fg'"
        @dragstart="dragKey = col.key"
        @dragover.prevent
        @drop="onDrop(col.key)"
        @click="toggle(col)"
      >
        <input
          type="checkbox"
          :checked="isOn(col.key)"
          :disabled="col.locked"
          class="size-3.5 accent-(--color-accent)"
          @click.stop="toggle(col)"
        >
        <span class="truncate">{{ col.label }}</span>
        <Icon v-if="isOn(col.key) && !col.locked" name="mingcute:menu-line" class="ml-auto shrink-0 text-subtle" />
      </div>
    </div>
  </div>
</template>
