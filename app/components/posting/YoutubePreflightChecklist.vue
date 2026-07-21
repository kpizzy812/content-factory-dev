<script setup lang="ts">
/**
 * Визуализация pre-flight проверок YouTube постинга.
 *
 * Получает PreflightState от useYoutubePreflight, рендерит menu со статусом
 * каждой проверки + actionable кнопки для исправления (run-login-check,
 * open-caption-editor, и т.д.).
 *
 * actionType emit'ится наверх — родитель решает как обработать (открыть модалку,
 * вызвать composable, перейти на страницу).
 */
import type {
  PreflightCheck,
  PreflightState,
} from "~~/shared/types/posting-youtube"

defineProps<{
  state: PreflightState
}>()

const emit = defineEmits<{
  action: [check: PreflightCheck]
}>()

const STATUS_ICON: Record<PreflightCheck["status"], string> = {
  ok: "mingcute:check-circle-fill",
  warn: "mingcute:warning-fill",
  blocker: "mingcute:close-circle-fill",
  loading: "mingcute:loading-line",
}

const STATUS_CLASS: Record<PreflightCheck["status"], string> = {
  ok: "text-success",
  warn: "text-warning",
  blocker: "text-error",
  loading: "text-base-content/40 animate-spin",
}
</script>

<template>
  <ul class="menu menu-sm bg-base-200/30 rounded-box w-full">
    <li v-for="check in state.checks" :key="check.key" class="border-b last:border-b-0 border-base-300/40">
      <div class="flex items-start gap-2 py-2 hover:bg-transparent cursor-default">
        <Icon
          :name="STATUS_ICON[check.status]"
          class="text-base shrink-0 mt-0.5"
          :class="STATUS_CLASS[check.status]"
        />
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium">{{ check.label }}</div>
          <div
            v-if="check.detail"
            class="text-xs text-base-content/60 mt-0.5 break-words"
          >
            {{ check.detail }}
          </div>
        </div>
        <button
          v-if="check.actionLabel && check.status !== 'ok' && check.status !== 'loading'"
          type="button"
          class="btn btn-xs btn-ghost shrink-0"
          @click.stop="emit('action', check)"
        >
          {{ check.actionLabel }}
        </button>
      </div>
    </li>

    <li v-if="state.checks.length === 0 && state.loading" class="py-3">
      <span class="text-xs text-base-content/60 loading loading-dots loading-sm">
        Проверяю…
      </span>
    </li>
  </ul>
</template>
