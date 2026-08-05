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

/** Готовность — не статус сущности, поэтому свой тон, а не UiStatusBadge. */
const tone = computed(() => {
  if (state.value.ready) return "border-success-border bg-success-bg text-success"
  if (state.value.score >= 2) return "border-warning-border bg-warning-bg text-warning"
  return "border-danger-border bg-danger-bg text-danger"
})

const tooltip = computed(() => {
  if (state.value.loading) return "Проверяю готовность аккаунта…"
  return state.value.checks
    .map((c) => `${c.frozen ? "⏸" : c.passed ? "✓" : "✗"} ${c.label}`)
    .join("\n")
})
</script>

<template>
  <UiTooltip :text="tooltip" placement="bottom">
    <span
      class="tnum inline-flex h-[18px] shrink-0 items-center gap-1 rounded-sm border px-1.5 text-micro whitespace-nowrap"
      :class="tone"
      :aria-label="tooltip"
    >
      <Icon :name="state.ready ? 'mingcute:check-line' : 'mingcute:alert-line'" />
      готовность {{ state.score }} из {{ state.total }}
    </span>
  </UiTooltip>
</template>
