<script setup lang="ts">
/**
 * Панель массовых действий. Источник: design-preview/_system/blocks/BulkActionBar.html
 *
 * Выезжает снизу при выделении. «Выделить все N» отдельной кнопкой: выделение
 * страницы и выделение всей выборки — разные операции, и путать их дорого.
 */
defineProps<{
  selected: number
  total: number
  /** Выделены все строки текущей страницы, но не вся выборка. */
  pageSelected?: boolean
}>()

defineEmits<{ selectAll: [], clear: [] }>()
</script>

<template>
  <Transition
    enter-active-class="transition duration-(--duration-base) ease-out"
    enter-from-class="translate-y-2 opacity-0"
    leave-active-class="transition duration-(--duration-fast) ease-out"
    leave-to-class="translate-y-2 opacity-0"
  >
    <div
      v-if="selected > 0"
      class="sticky bottom-0 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-raised px-3 py-2 shadow-lg"
    >
      <span class="tnum text-sm">
        Выбрано <b>{{ selected }}</b> из {{ total }}
      </span>

      <button
        v-if="pageSelected && selected < total"
        type="button"
        class="cursor-pointer text-sm text-accent-text underline underline-offset-2"
        @click="$emit('selectAll')"
      >
        Выделить все {{ total }}
      </button>

      <span class="mx-1 h-4 w-px bg-divider" />

      <div class="flex flex-wrap items-center gap-1.5">
        <slot />
      </div>

      <UiButton variant="ghost" class="ml-auto" @click="$emit('clear')">Снять выделение</UiButton>
    </div>
  </Transition>
</template>
