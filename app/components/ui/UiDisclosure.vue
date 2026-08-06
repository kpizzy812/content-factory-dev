<script setup lang="ts">
/**
 * Раскрывающаяся секция.
 *
 * Заводится потому, что длинные разборы (план истории, отчёты, конфигурации)
 * иначе занимают экран целиком, а держать их в модалке нельзя — читают их
 * вместе с остальным содержимым страницы.
 *
 * Содержимое монтируется только раскрытым: внутри бывают тяжёлые списки, и
 * рисовать их ради спрятанного блока незачем.
 */
const props = withDefaults(defineProps<{
  title: string
  icon?: string
  /** Цвет иконки — класс токена, например `text-warning`. */
  iconTone?: string
  /** Число рядом с заголовком: сколько элементов внутри. */
  count?: number | null
  defaultOpen?: boolean
}>(), { iconTone: 'text-muted' })

const open = ref(props.defaultOpen ?? false)
</script>

<template>
  <section class="overflow-hidden rounded-md border border-border">
    <div class="flex items-center gap-2 bg-card px-2.5 py-1.5">
      <button
        type="button"
        class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-sm font-medium"
        :aria-expanded="open"
        @click="open = !open"
      >
        <Icon
          name="mingcute:right-line"
          class="shrink-0 text-subtle transition-transform duration-(--duration-fast)"
          :class="open && 'rotate-90'"
        />
        <Icon v-if="icon" :name="icon" class="shrink-0" :class="iconTone" />
        <span class="truncate">{{ title }}</span>
        <span v-if="count != null" class="tnum shrink-0 font-mono text-micro text-subtle">{{ count }}</span>
      </button>
      <slot name="header-extra" />
    </div>

    <div v-if="open" class="px-2.5 py-2">
      <slot />
    </div>
  </section>
</template>
