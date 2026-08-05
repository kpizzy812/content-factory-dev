<script setup lang="ts">
/**
 * Ячейка шапки с сортировкой. Направление показывается стрелкой, а не
 * подразумевается: без неё оператор не понимает, что список уже отсортирован.
 */
const props = defineProps<{
  sortKey?: string
  /** Текущая сортировка таблицы, например '-viewCount'. */
  sort?: string
  align?: 'left' | 'right'
}>()

const emit = defineEmits<{ sort: [value: string] }>()

const active = computed(() => props.sortKey && props.sort?.replace(/^-/, '') === props.sortKey)
const desc = computed(() => props.sort?.startsWith('-'))

function toggle() {
  if (!props.sortKey) return
  emit('sort', active.value && !desc.value ? `-${props.sortKey}` : props.sortKey)
}
</script>

<template>
  <span
    class="flex items-center gap-1"
    :class="[
      align === 'right' ? 'justify-end' : '',
      sortKey ? 'cursor-pointer hover:text-fg' : '',
      active ? 'text-fg' : '',
    ]"
    @click="toggle"
  >
    <slot />
    <Icon v-if="active" :name="desc ? 'mingcute:arrow-down-line' : 'mingcute:arrow-up-line'" class="shrink-0" />
  </span>
</template>
