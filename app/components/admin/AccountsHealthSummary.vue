<script setup lang="ts">
import type { AccountsHealthSummary } from '~~/shared/types/accounts-health'

/**
 * Сводка здоровья аккаунтов. Источник: `AccountsSummary` из макета 06.
 *
 * Плитки идут по убыванию срочности: сколько всего, сколько работает, сколько
 * не работает и почему именно.
 */
const props = defineProps<{ summary: AccountsHealthSummary }>()

interface Tile {
  label: string
  value: number
  caption?: string
  tone?: 'warning' | 'danger'
}

const tiles = computed<Tile[]>(() => {
  const s = props.summary
  const problems = Math.max(0, s.total - s.activeCount)
  return [
    { label: 'Всего аккаунтов', value: s.total, caption: `активных ${s.activeCount}` },
    {
      label: 'Не работают',
      value: problems,
      caption: `истёк токен ${s.expiredCount} · отозван ${s.revokedCount}`,
      tone: problems ? 'danger' : undefined,
    },
    {
      label: 'Постинг заблокирован',
      value: s.withoutProxy,
      caption: 'нет прокси',
      tone: s.withoutProxy ? 'danger' : undefined,
    },
    {
      label: 'Прокси не отвечает',
      value: s.withDeadProxy,
      caption: `деградирует ${s.withDegradedProxy}`,
      tone: s.withDeadProxy ? 'danger' : undefined,
    },
    {
      label: 'Без прогрева неделю',
      value: s.withoutWarmup7d,
      caption: `остывших ${s.coldAccounts}`,
      tone: s.withoutWarmup7d ? 'warning' : undefined,
    },
    {
      label: 'Без доступов',
      value: s.withoutCredentials,
      caption: `без 2FA ${s.without2FA}`,
      tone: s.withoutCredentials ? 'warning' : undefined,
    },
  ]
})

const TONE = {
  warning: 'text-warning',
  danger: 'text-danger',
} as const
</script>

<template>
  <div class="grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-panel md:grid-cols-3 xl:grid-cols-6">
    <div
      v-for="tile in tiles"
      :key="tile.label"
      class="flex flex-col gap-1 border-t border-r border-divider p-2.5 px-3.5 first:border-t-0 last:border-r-0 md:border-t-0"
    >
      <span class="text-micro tracking-[.06em] text-subtle uppercase">{{ tile.label }}</span>
      <span class="tnum text-2xl font-semibold tracking-[-.02em]" :class="tile.tone ? TONE[tile.tone] : ''">
        {{ tile.value }}
      </span>
      <span v-if="tile.caption" class="tnum text-micro text-subtle">{{ tile.caption }}</span>
    </div>
  </div>
</template>
