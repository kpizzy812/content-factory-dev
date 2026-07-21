<script setup lang="ts">
defineProps<{
  /** Текст подсказки */
  text: string
  /** Пример значения (необязательно) */
  example?: string
}>()

const expanded = ref(false)
</script>

<template>
  <div class="mt-0.5">
    <button
      type="button"
      class="inline-flex items-center gap-0.5 text-[10px] text-base-content/40 hover:text-base-content/60 transition-colors"
      @click="expanded = !expanded"
    >
      <Icon
        name="mingcute:question-line"
        class="text-[10px] shrink-0"
      />
      <span>{{ expanded ? 'Скрыть подсказку' : 'Подсказка' }}</span>
    </button>

    <Transition name="hint">
      <div
        v-if="expanded"
        class="mt-1 p-1.5 rounded bg-base-200/60 text-[10px] text-base-content/60 leading-relaxed"
      >
        <p>{{ text }}</p>
        <p v-if="example" class="mt-0.5 text-base-content/40">
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
