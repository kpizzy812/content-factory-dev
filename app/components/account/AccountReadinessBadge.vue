<script setup lang="ts">
/**
 * Quick-glance badge "Готовность: N/4" — отображает score из useAccountReadiness.
 *
 * 4/4 → success
 * 2-3/4 → warning
 * 0-1/4 → error
 *
 * Tooltip с детализацией каждой проверки.
 */
import { useAccountReadiness } from "~~/app/composables/useAccountReadiness"
import type { PreflightAccount } from "~~/app/composables/useYoutubePreflight"
import type { LoginCheckResult } from "~~/shared/types/login-check"

const props = defineProps<{
  account: PreflightAccount | null
  /** Live-результат login-check: transient/confirmed чинят login+deep_check бейдж. */
  liveLoginResult?: LoginCheckResult | null
}>()

const accountRef = computed<PreflightAccount | null>(() => props.account)
const liveLoginRef = computed<LoginCheckResult | null>(() => props.liveLoginResult ?? null)
const { state } = useAccountReadiness(accountRef, undefined, liveLoginRef)

const badgeClass = computed(() => {
  if (state.value.ready) return "badge-success"
  if (state.value.score >= 2) return "badge-warning"
  return "badge-error"
})

const tooltip = computed(() => {
  if (state.value.loading) return "Проверяю готовность аккаунта…"
  return state.value.checks
    .map((c) => `${c.frozen ? "⏸" : c.passed ? "✓" : "✗"} ${c.label}`)
    .join("\n")
})
</script>

<template>
  <span class="tooltip tooltip-bottom whitespace-pre-line" :data-tip="tooltip">
    <span
      class="badge badge-xs gap-1"
      :class="badgeClass"
      :aria-label="tooltip"
    >
      <Icon
        :name="state.ready ? 'mingcute:check-circle-line' : 'mingcute:alert-line'"
        class="text-xs"
      />
      Готовность: {{ state.score }}/{{ state.total }}
    </span>
  </span>
</template>
