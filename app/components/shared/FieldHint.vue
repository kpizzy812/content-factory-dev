<script setup lang="ts">
defineProps<{
  /** Текст подсказки */
  text: string
  /** Пример значения (необязательно) */
  example?: string
  /** Лимит длины поля — счётчик рисуется рядом с кнопкой подсказки. */
  maxLength?: number
  currentLength?: number
}>()

const expanded = ref(false)
</script>

<template>
  <div class="mt-0.5">
    <div class="flex items-center justify-between gap-2">
      <button
        type="button"
        class="inline-flex cursor-pointer items-center gap-0.5 text-micro text-subtle transition-colors duration-(--duration-fast) ease-out hover:text-muted"
        @click="expanded = !expanded"
      >
        <Icon name="mingcute:question-line" class="shrink-0" />
        <span>{{ expanded ? 'Скрыть подсказку' : 'Подсказка' }}</span>
      </button>

      <span
        v-if="maxLength"
        class="tnum text-micro"
        :class="(currentLength ?? 0) > maxLength ? 'text-danger' : 'text-subtle'"
      >{{ currentLength ?? 0 }} / {{ maxLength }}</span>
    </div>

    <Transition name="hint">
      <div
        v-if="expanded"
        class="mt-1 rounded-sm border border-divider bg-card px-1.5 py-1 text-micro leading-relaxed text-muted"
      >
        <p>{{ text }}</p>
        <p v-if="example" class="mt-0.5 text-subtle">
          <span class="font-medium">Пример:</span> {{ example }}
        </p>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.hint-enter-active,
.hint-leave-active {
  transition: opacity 0.15s ease, max-height 0.15s ease;
}
.hint-enter-from,
.hint-leave-to {
  opacity: 0;
  max-height: 0;
}
.hint-enter-to,
.hint-leave-from {
  max-height: 100px;
}
</style>
