<script setup lang="ts">
/**
 * Заявки по аккаунтам и разрез по странам.
 *
 * Страна берётся у тренда-источника: у публикации своей страны нет, а
 * подписывать «RU» по площадке значило бы выдумывать.
 */
import type { GeoSlice, RankedAccount } from '#shared/types/analytics-funnel'

const props = defineProps<{
  accounts: RankedAccount[]
  geo: GeoSlice[]
  periodLabel: string
}>()

const peak = computed(() => Math.max(...props.accounts.map(account => account.leads), 1))
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-border bg-panel">
    <header class="flex items-center gap-2.5 border-b border-border bg-card px-3 py-2.5">
      <span class="text-sm font-semibold">Заявки по аккаунтам</span>
      <span class="ml-auto text-[11px] text-subtle">{{ periodLabel }}</span>
    </header>

    <UiEmptyState
      v-if="!accounts.length"
      title="Заявок за период нет"
      description="Разрез появится, как только придут события атрибуции."
    />

    <div v-else class="flex flex-col gap-2 px-3 py-2.5">
      <div
        v-for="account in accounts"
        :key="account.socialAccountId"
        class="grid grid-cols-[minmax(0,1fr)_120px_44px] items-center gap-x-2.5 text-sm"
      >
        <span class="truncate font-mono">{{ account.name }}</span>
        <span class="h-2 overflow-hidden rounded-[2px] bg-card">
          <span
            class="block h-full bg-accent"
            :style="{ width: `${Math.max((account.leads / peak) * 100, 3)}%` }"
          />
        </span>
        <span class="tnum text-right font-mono">{{ account.leads }}</span>
      </div>

      <template v-if="geo.length">
        <div class="my-0.5 h-px bg-divider" />
        <div class="tnum flex flex-wrap gap-3 text-micro text-muted">
          <span v-for="slice in geo" :key="slice.geo">{{ slice.geo }} · {{ slice.leads }}</span>
        </div>
      </template>
    </div>
  </section>
</template>
