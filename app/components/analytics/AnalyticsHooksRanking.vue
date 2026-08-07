<script setup lang="ts">
/**
 * Топ хуков и сценарных приёмов по CTR перехода.
 *
 * Хук берётся у выбранного варианта сценария: он есть у каждого ролика, в
 * отличие от гипотезы фабричного контура. Один цвет на все полосы, отклонение
 * вниз — красным: пять категориальных цветов здесь не нужны.
 */
import type { RankedHook } from '#shared/types/analytics-funnel'
import { formatRate } from './AnalyticsFormat'

const props = defineProps<{
  hooks: RankedHook[]
}>()

const peak = computed(() => Math.max(...props.hooks.map(hook => hook.ctr), 0.000001))

/** Худший приём подсвечивается, только когда есть с чем сравнивать. */
const worstKey = computed(() => {
  if (props.hooks.length < 3) return null
  return [...props.hooks].sort((a, b) => a.ctr - b.ctr)[0]?.key ?? null
})
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-border bg-panel">
    <header class="border-b border-border bg-card px-3 py-2.5 text-sm font-semibold">
      Топ хуков и сценарных приёмов
    </header>

    <UiEmptyState
      v-if="!hooks.length"
      title="Хуков за период нет"
      description="Считается по опубликованным роликам с выбранным вариантом сценария."
    />

    <div v-else class="flex flex-col gap-2.5 px-3 py-2.5">
      <div
        v-for="hook in hooks"
        :key="hook.key"
        class="grid grid-cols-[minmax(0,1fr)_108px_58px] items-center gap-x-2.5 text-sm"
        :class="hook.key === worstKey ? 'text-danger' : ''"
      >
        <span class="truncate" :title="hook.label">{{ hook.label }}</span>
        <span class="h-2 overflow-hidden rounded-[2px] bg-card">
          <span
            class="block h-full"
            :class="hook.key === worstKey ? 'bg-danger' : 'bg-accent'"
            :style="{ width: `${Math.max((hook.ctr / peak) * 100, 3)}%` }"
          />
        </span>
        <span class="tnum text-right font-mono">{{ formatRate(hook.ctr, 2) }}</span>
      </div>
      <p class="border-t border-divider pt-1.5 text-[11px] text-subtle">
        CTR перехода по токену. Один цвет на все приёмы, худший из пяти —
        красным.
      </p>
    </div>
  </section>
</template>
