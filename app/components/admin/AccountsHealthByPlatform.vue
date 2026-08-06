<script setup lang="ts">
import type { AccountsHealthByPlatform } from '~~/shared/types/accounts-health'
import { platformMeta } from '~/components/ui/platform-meta'

/** Сколько аккаунтов на каждой платформе. Полоса — доля от самой большой. */
const props = defineProps<{ byPlatform: AccountsHealthByPlatform }>()

const rows = computed(() => {
  const bp = props.byPlatform
  const max = Math.max(bp.tiktok, bp.youtube, bp.instagram, 1)
  return (['tiktok', 'youtube', 'instagram'] as const).map(platform => ({
    platform,
    label: platformMeta(platform).label,
    color: platformMeta(platform).color,
    count: bp[platform],
    percent: (bp[platform] / max) * 100,
  }))
})
</script>

<template>
  <div class="flex flex-col gap-3 rounded-lg border border-border bg-panel p-3.5">
    <h3 class="text-micro tracking-[.06em] text-subtle uppercase">По платформам</h3>
    <div class="grid gap-2 md:grid-cols-3 md:gap-6">
      <div v-for="row in rows" :key="row.platform" class="flex items-center gap-3">
        <span class="flex w-24 shrink-0 items-center gap-2 text-sm">
          <span class="h-3 w-[5px] shrink-0 rounded-[2px]" :style="{ background: row.color }" />
          {{ row.label }}
        </span>
        <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-bg">
          <span class="block h-full rounded-full" :style="{ width: `${row.percent}%`, background: row.color }" />
        </span>
        <span class="tnum w-8 shrink-0 text-right font-mono text-sm">{{ row.count }}</span>
      </div>
    </div>
  </div>
</template>
