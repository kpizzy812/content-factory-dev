<script setup lang="ts">
/**
 * Карточка сущности. Источник: design-preview/_system/blocks/EntityCard.html
 *
 * Режим карточек — не замена таблице, а второй режим для визуальных сущностей
 * (тренды, видео, креативы). Выделение чекбоксом работает и здесь, иначе
 * массовые действия ломаются при переключении режима.
 */
defineProps<{
  title: string
  subtitle?: string
  thumbnail?: string | null
  selected?: boolean
  selectable?: boolean
}>()

defineEmits<{ 'update:selected': [value: boolean] }>()

const thumbFailed = ref(false)
</script>

<template>
  <div
    class="group relative overflow-hidden rounded-lg border bg-card transition-colors duration-(--duration-fast) ease-out"
    :class="selected ? 'border-accent bg-accent-bg' : 'border-border hover:border-subtle'"
  >
    <div class="relative aspect-[9/16] bg-surface">
      <img
        v-if="thumbnail && !thumbFailed"
        :src="thumbnail"
        :alt="title"
        class="size-full object-cover"
        referrerpolicy="no-referrer"
        @error="thumbFailed = true"
      >
      <div v-else class="flex size-full items-center justify-center text-subtle">
        <Icon name="mingcute:pic-line" class="text-2xl" />
      </div>

      <label
        v-if="selectable"
        class="absolute top-2 left-2 flex size-6 cursor-pointer items-center justify-center rounded-sm bg-overlay"
        @click.stop
      >
        <input
          type="checkbox"
          :checked="selected"
          class="size-3.5 cursor-pointer accent-(--color-accent)"
          @change="$emit('update:selected', ($event.target as HTMLInputElement).checked)"
        >
      </label>

      <div class="absolute top-2 right-2 flex flex-col items-end gap-1">
        <slot name="badges" />
      </div>
    </div>

    <div class="flex flex-col gap-1 p-2.5">
      <div class="truncate text-sm text-fg">{{ title }}</div>
      <div v-if="subtitle" class="truncate font-mono text-micro text-subtle">{{ subtitle }}</div>
      <slot name="meta" />
    </div>

    <div
      class="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end gap-1 p-2 opacity-0 transition-opacity duration-(--duration-fast) ease-out group-hover:pointer-events-auto group-hover:opacity-100"
    >
      <slot name="actions" />
    </div>
  </div>
</template>
