<script setup lang="ts">
import { needsAttention, type ReadinessAccount } from './AccountReadinessMap'

/**
 * Сводка над списком аккаунтов. Источник: `AccountsSummary` из макета 06.
 *
 * В макете первой плиткой стоит свободная ёмкость на сутки. Её здесь нет:
 * лимит публикаций платформа отдаёт только в момент отправки
 * (`content_publishing_limit` в адаптере Instagram), в базу он не пишется и ни в
 * один endpoint не выведен. Считать ёмкость по своей истории — выдумывать число.
 */
interface SummaryAccount extends ReadinessAccount {
  platform: string
  _count?: { uploads: number, groups: number }
}

const props = defineProps<{ accounts: SummaryAccount[] }>()

const emit = defineEmits<{ 'show-attention': [] }>()

const total = computed(() => props.accounts.length)
const active = computed(() => props.accounts.filter(a => a.status === 'active').length)
const expired = computed(() => props.accounts.filter(a => a.status === 'expired').length)
const revoked = computed(() => props.accounts.filter(a => a.status === 'revoked').length)
const attention = computed(() => props.accounts.filter(a => needsAttention(a)).length)

const byPlatform = computed(() => {
  const out: Record<string, number> = {}
  for (const a of props.accounts) out[a.platform] = (out[a.platform] ?? 0) + 1
  return out
})

const uploads = computed(() =>
  props.accounts.reduce((sum, a) => sum + (a._count?.uploads ?? 0), 0),
)

const browserAccounts = computed(
  () => props.accounts.filter(a => a.postingMethod === 'browser_automation').length,
)

const activePercent = computed(() => (total.value ? Math.round((active.value / total.value) * 100) : 0))

const PLATFORM_SHORT: Record<string, string> = {
  instagram: 'IG',
  tiktok: 'TT',
  youtube: 'YT',
}
</script>

<template>
  <div class="grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-panel xl:grid-cols-4">
    <div class="flex flex-col gap-1 border-r border-divider p-2.5 px-3.5">
      <span class="text-micro tracking-[.06em] text-subtle uppercase">Активны</span>
      <span class="flex items-baseline gap-[7px]">
        <span class="tnum text-2xl font-semibold tracking-[-.02em]">{{ active }}</span>
        <span class="text-sm text-subtle">из {{ total }}</span>
      </span>
      <span class="h-1 overflow-hidden rounded-full bg-card">
        <span class="block h-full bg-accent" :style="{ width: `${activePercent}%` }" />
      </span>
    </div>

    <div class="flex flex-col gap-1 border-divider p-2.5 px-3.5 xl:border-r">
      <span class="text-micro tracking-[.06em] text-subtle uppercase">Требуют внимания</span>
      <span class="flex items-baseline gap-[7px]">
        <span class="tnum text-2xl font-semibold tracking-[-.02em]" :class="attention ? 'text-warning' : ''">{{ attention }}</span>
        <span class="text-sm text-subtle">токен, прокси, устройство</span>
      </span>
      <button
        v-if="attention"
        type="button"
        class="w-fit cursor-pointer text-micro text-accent-text hover:underline"
        @click="emit('show-attention')"
      >
        Показать только их
      </button>
      <span v-else class="text-micro text-subtle">Все отметки зелёные</span>
    </div>

    <div class="flex flex-col gap-1 border-t border-r border-divider p-2.5 px-3.5 xl:border-t-0">
      <span class="text-micro tracking-[.06em] text-subtle uppercase">Платформы</span>
      <span class="flex items-baseline gap-3">
        <span v-for="(count, platform) in byPlatform" :key="platform" class="flex items-baseline gap-1.5">
          <span class="text-sm text-subtle">{{ PLATFORM_SHORT[platform] ?? platform }}</span>
          <span class="tnum font-mono text-lg font-semibold">{{ count }}</span>
        </span>
        <span v-if="!total" class="text-sm text-subtle">—</span>
      </span>
      <span class="text-micro text-subtle">
        через устройство <span class="tnum font-mono">{{ browserAccounts }}</span>
      </span>
    </div>

    <div class="flex flex-col gap-1 border-t border-divider p-2.5 px-3.5 xl:border-t-0">
      <span class="text-micro tracking-[.06em] text-subtle uppercase">Публикаций всего</span>
      <span class="tnum text-2xl font-semibold tracking-[-.02em]">{{ uploads.toLocaleString('ru-RU') }}</span>
      <span class="text-micro text-subtle">за всё время, по загрузкам</span>
    </div>
  </div>
</template>
