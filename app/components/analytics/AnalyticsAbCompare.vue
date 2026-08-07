<script setup lang="ts">
/**
 * A/B по вариантам одного сценария.
 *
 * Сравнение честно только внутри сценария: тренд, персонаж и аккаунты у
 * вариантов общие, отличается хук. Победитель отмечается, только когда он
 * один и заявки у него есть — иначе галочка обещает вывод, которого нет.
 */
import type { AbComparison } from '#shared/types/analytics-funnel'
import { formatCount, formatRate } from './AnalyticsFormat'

const props = defineProps<{
  comparison: AbComparison
}>()

/** «B даёт в 3,4 раза больше заявок» — только когда делить есть на что. */
const verdict = computed(() => {
  const { variants, winnerIndex } = props.comparison
  if (winnerIndex == null) {
    return 'Разница между вариантами не читается: заявок поровну или их нет вовсе.'
  }
  const winner = variants[winnerIndex]!
  const others = variants.filter((_, index) => index !== winnerIndex)
  const best = others.reduce((top, item) => (item.leads > top.leads ? item : top), others[0]!)
  const letter = String.fromCharCode(65 + winnerIndex)
  if (!best || best.leads === 0) {
    return `Заявки принёс только вариант ${letter}. Различие между версиями — хук.`
  }
  const times = (winner.leads / best.leads).toFixed(1).replace('.', ',')
  return `Вариант ${letter} даёт в ${times} раза больше заявок при равных условиях показа. Различие только в хуке.`
})
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-accent-border bg-panel">
    <header class="flex items-center gap-2 border-b border-accent-border bg-accent-bg px-3 py-2.5">
      <span class="text-sm font-semibold">A/B · сценарий {{ comparison.code }}</span>
      <span class="ml-auto truncate text-[11px] text-muted">{{ comparison.title }}</span>
    </header>

    <div class="grid border-b border-divider sm:grid-cols-2">
      <div
        v-for="(variant, index) in comparison.variants"
        :key="variant.variantIndex"
        class="border-r border-divider px-3 py-2.5 last:border-r-0"
        :class="comparison.winnerIndex === index ? 'bg-success-bg' : ''"
      >
        <div class="flex items-center gap-2">
          <span class="font-mono text-sm font-semibold">
            {{ String.fromCharCode(65 + index) }}
          </span>
          <span class="truncate text-[11px] text-muted">хук: {{ variant.hook }}</span>
          <Icon
            v-if="comparison.winnerIndex === index"
            name="mingcute:check-line"
            class="ml-auto shrink-0 text-success"
          />
        </div>
        <dl class="mt-2 flex flex-col gap-1 text-sm">
          <div class="flex justify-between">
            <dt class="text-muted">Просмотры</dt>
            <dd class="tnum font-mono">{{ formatCount(variant.views) }}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted">CTR</dt>
            <dd class="tnum font-mono">{{ formatRate(variant.ctr, 2) }}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted">Заявки</dt>
            <dd class="tnum font-mono" :class="comparison.winnerIndex === index ? 'font-semibold' : ''">
              {{ variant.leads }}
            </dd>
          </div>
        </dl>
      </div>
    </div>

    <p class="px-3 py-2.5 text-micro text-muted">{{ verdict }}</p>
  </section>
</template>
