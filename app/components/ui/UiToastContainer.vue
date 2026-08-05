<script setup lang="ts">
/**
 * Тосты. Источник: design-preview/_system/blocks/Toast.html
 *
 * Один механизм на всё приложение: до перестройки тосты были реализованы
 * дважды — глобально и локально внутри страниц, и выглядели по-разному.
 * Монтируется один раз в layouts/default.vue.
 */
const { items, dismiss, runAction } = useToast()

const TONE = {
  success: { class: 'border-success-border bg-success-bg text-success', icon: 'mingcute:check-circle-line' },
  error: { class: 'border-danger-border bg-danger-bg text-danger', icon: 'mingcute:close-circle-line' },
  warning: { class: 'border-warning-border bg-warning-bg text-warning', icon: 'mingcute:alert-line' },
  info: { class: 'border-info-border bg-info-bg text-info', icon: 'mingcute:information-line' },
} as const
</script>

<template>
  <Teleport to="body">
    <div class="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
      <TransitionGroup
        enter-active-class="transition duration-(--duration-base) ease-out"
        enter-from-class="translate-y-1 opacity-0"
        leave-active-class="transition duration-(--duration-fast) ease-out"
        leave-to-class="opacity-0"
      >
        <div
          v-for="t in items"
          :key="t.id"
          class="pointer-events-auto flex items-start gap-2.5 rounded-md border p-3 shadow-md"
          :class="TONE[t.variant].class"
        >
          <Icon :name="TONE[t.variant].icon" class="mt-px shrink-0" />
          <span class="min-w-0 flex-1 text-sm text-fg">{{ t.text }}</span>

          <button
            v-if="t.action"
            type="button"
            class="shrink-0 cursor-pointer text-sm font-medium underline underline-offset-2"
            @click="runAction(t.id)"
          >
            {{ t.action.label }}
          </button>
          <button
            type="button"
            class="shrink-0 cursor-pointer text-subtle hover:text-fg"
            aria-label="Закрыть"
            @click="dismiss(t.id)"
          >
            <Icon name="mingcute:close-line" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
