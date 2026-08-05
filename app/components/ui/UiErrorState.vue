<script setup lang="ts">
/**
 * Ошибка. Источник: design-preview/_system/blocks/ErrorInline.html
 *
 * Никогда не «Ошибка» без продолжения: человеческое сообщение, технические
 * детали под разворотом и кнопка «Повторить». Встроенный вариант не занимает
 * весь экран — соседние блоки продолжают работать.
 */
withDefaults(defineProps<{
  title?: string
  message?: string
  details?: string
  variant?: 'inline' | 'screen'
  retrying?: boolean
}>(), { variant: 'inline', title: 'Не удалось загрузить данные' })

defineEmits<{ retry: [] }>()

const showDetails = ref(false)
</script>

<template>
  <div
    class="rounded-lg border border-danger-border bg-danger-bg p-4"
    :class="variant === 'screen' && 'flex min-h-64 flex-col items-center justify-center text-center'"
  >
    <div class="flex items-start gap-2.5" :class="variant === 'screen' && 'flex-col items-center'">
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-lg text-danger" />
      <div class="min-w-0 flex-1" :class="variant === 'screen' && 'flex flex-col items-center'">
        <div class="font-medium text-danger">{{ title }}</div>
        <p v-if="message" class="mt-1 text-sm text-muted">{{ message }}</p>

        <button
          v-if="details"
          type="button"
          class="mt-1.5 cursor-pointer text-[11.5px] text-subtle hover:text-muted"
          @click="showDetails = !showDetails"
        >
          {{ showDetails ? 'Скрыть подробности' : 'Показать подробности' }}
        </button>
        <pre
          v-if="showDetails && details"
          class="mt-1.5 max-h-48 overflow-auto rounded-sm bg-surface p-2 font-mono text-[11px] text-muted"
        >{{ details }}</pre>

        <div class="mt-3 flex gap-2">
          <UiButton :loading="retrying" @click="$emit('retry')">Повторить</UiButton>
          <slot />
        </div>
      </div>
    </div>
  </div>
</template>
