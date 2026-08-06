<script setup lang="ts">
/**
 * Проверки перед отправкой ролика на YouTube.
 *
 * Каждая проверка, которую можно починить, приносит с собой действие — оператор
 * чинит прямо здесь, а не уходит искать нужный экран.
 */
import type { PreflightCheck, PreflightState } from '~~/shared/types/posting-youtube'

defineProps<{ state: PreflightState }>()

const emit = defineEmits<{ action: [check: PreflightCheck] }>()

const STATUS_ICON: Record<PreflightCheck['status'], string> = {
  ok: 'mingcute:check-circle-fill',
  warn: 'mingcute:warning-fill',
  blocker: 'mingcute:close-circle-fill',
  loading: 'mingcute:loading-3-line',
}

const STATUS_TONE: Record<PreflightCheck['status'], string> = {
  ok: 'text-success',
  warn: 'text-warning',
  blocker: 'text-danger',
  loading: 'text-subtle motion-safe:animate-spin',
}
</script>

<template>
  <ul class="overflow-hidden rounded-md border border-border">
    <li
      v-for="check in state.checks"
      :key="check.key"
      class="flex items-start gap-2.5 border-b border-divider bg-panel px-2.5 py-2 last:border-b-0"
    >
      <Icon
        :name="STATUS_ICON[check.status]"
        class="mt-0.5 shrink-0"
        :class="STATUS_TONE[check.status]"
      />
      <div class="min-w-0 flex-1">
        <div class="text-sm font-medium">{{ check.label }}</div>
        <p v-if="check.detail" class="text-sm break-words text-muted">{{ check.detail }}</p>
      </div>
      <UiButton
        v-if="check.actionLabel && check.status !== 'ok' && check.status !== 'loading'"
        variant="ghost"
        @click.stop="emit('action', check)"
      >
        {{ check.actionLabel }}
      </UiButton>
    </li>

    <li v-if="!state.checks.length && state.loading" class="bg-panel px-2.5 py-3 text-sm text-subtle">
      Проверяю…
    </li>
  </ul>
</template>
