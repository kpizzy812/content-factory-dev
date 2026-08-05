<script setup lang="ts">
/**
 * Активные фильтры чипами. Источник: design-preview/_system/blocks/FilterBar.html
 *
 * Ссылку на текущий вид можно скопировать явной кнопкой: пересылка коллеге —
 * это функция, а не побочный эффект того, что фильтры попали в URL.
 */
export interface FilterChip {
  key: string
  label: string
  value: string
}

defineProps<{ chips: FilterChip[] }>()
const emit = defineEmits<{ clear: [key: string], clearAll: [] }>()

const toast = useToast()

async function copyLink() {
  try {
    await navigator.clipboard.writeText(window.location.href)
    toast.success('Ссылка на этот вид скопирована')
  }
  catch {
    toast.error('Браузер не дал доступ к буферу обмена')
  }
}
</script>

<template>
  <div v-if="chips.length" class="flex flex-wrap items-center gap-1.5">
    <span
      v-for="chip in chips"
      :key="chip.key"
      class="inline-flex h-[22px] items-center gap-1.5 rounded-sm border border-border bg-card px-2 text-sm"
    >
      <span class="text-subtle">{{ chip.label }}:</span>
      <span>{{ chip.value }}</span>
      <button
        type="button"
        class="cursor-pointer text-subtle hover:text-danger"
        :aria-label="`Снять фильтр ${chip.label}`"
        @click="emit('clear', chip.key)"
      >
        <Icon name="mingcute:close-line" />
      </button>
    </span>

    <button
      type="button"
      class="cursor-pointer text-sm text-subtle underline underline-offset-2 hover:text-muted"
      @click="emit('clearAll')"
    >
      Сбросить всё
    </button>

    <button
      type="button"
      class="ml-auto flex cursor-pointer items-center gap-1.5 text-sm text-subtle hover:text-muted"
      @click="copyLink"
    >
      <Icon name="mingcute:link-line" />
      Скопировать ссылку на этот вид
    </button>
  </div>
</template>
