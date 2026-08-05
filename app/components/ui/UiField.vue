<script setup lang="ts">
/**
 * Обёртка поля формы: подпись, подсказка, ошибка.
 * Источник: design-preview/_system/blocks/Field.html
 *
 * Подсказка и ошибка не показываются одновременно: ошибка вытесняет подсказку,
 * иначе под полем набирается два предложения мелким кеглем.
 */
defineProps<{
  label?: string
  hint?: string
  error?: string
  for?: string
}>()
</script>

<template>
  <div>
    <label v-if="label" :for="for" class="mb-[5px] block text-[11.5px] text-muted">
      {{ label }}
    </label>

    <slot />

    <div v-if="error" class="mt-1 flex items-center gap-[5px] text-[11.5px] text-danger">
      <Icon name="mingcute:alert-line" class="shrink-0" />
      <span>{{ error }}</span>
    </div>
    <div v-else-if="hint" class="mt-1 text-[11.5px] text-subtle">
      {{ hint }}
    </div>
  </div>
</template>
