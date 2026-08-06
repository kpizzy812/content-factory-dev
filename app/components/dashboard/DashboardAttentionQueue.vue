<script setup lang="ts">
import type { AttentionRow } from '~~/shared/types/dashboard-summary'

/**
 * Очередь решений оператора. Источник: `AttentionQueue` из макета 01.
 *
 * Порядок задаёт сервер — по возрасту самого старого объекта, а не по типу
 * причины: три сценария, ждущие вторые сутки, хуже двенадцати часовой давности.
 *
 * Второй строки с разбором причины («2 × lip-sync, 1 × таймаут») в макете
 * нет чем заполнить: сводка отдаёт количество и возраст, а не состав.
 */
const props = defineProps<{
  rows: AttentionRow[]
  pending?: boolean
}>()

const ICONS: Record<string, string> = {
  scenariosOnReview: 'mingcute:document-line',
  videosFailed: 'mingcute:video-line',
  postingQueued: 'mingcute:send-line',
  accountsAttention: 'mingcute:user-3-line',
}

const ACTION_LABELS: Record<string, string> = {
  scenariosOnReview: 'Открыть очередь ревью',
  videosFailed: 'Разобрать упавшие',
  postingQueued: 'Открыть очередь',
  accountsAttention: 'Открыть аккаунты',
}

const total = computed(() => props.rows.reduce((sum, r) => sum + r.count, 0))

function formatAge(ms: number | null): string {
  if (ms == null) return '—'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} ч`
  return `${Math.floor(hours / 24)} дней`
}

const TONE = {
  warning: { border: 'border-l-warning', chip: 'border-warning-border bg-warning-bg text-warning', text: 'text-warning' },
  danger: { border: 'border-l-danger', chip: 'border-danger-border bg-danger-bg text-danger', text: 'text-danger' },
} as const
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-border bg-panel">
    <header class="flex flex-wrap items-center gap-2.5 border-b border-border px-3.5 py-2.5">
      <h2 class="text-base font-semibold">Требует внимания</h2>
      <span
        v-if="rows.length"
        class="tnum flex h-5 items-center rounded-sm border border-danger-border bg-danger-bg px-1.5 font-mono text-micro text-danger"
      >
        {{ rows.length }} причин · {{ total }} объектов
      </span>
      <span class="flex-1" />
      <span class="text-micro text-subtle">сгруппировано по причине, отсортировано по возрасту</span>
    </header>

    <UiSkeleton v-if="pending && !rows.length" variant="details" :count="3" />

    <div v-else-if="!rows.length" class="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
      <Icon name="mingcute:check-circle-line" class="text-2xl text-success" />
      <div class="text-sm font-medium">Решать нечего</div>
      <p class="text-sm text-muted">Ни один раздел не ждёт человека.</p>
    </div>

    <div
      v-for="row in rows"
      v-else
      :key="row.key"
      class="grid grid-cols-[34px_minmax(0,1fr)_72px_110px_max-content] items-center gap-3 border-b border-l-2 border-divider px-3.5 py-2.5 last:border-b-0 hover:bg-card"
      :class="TONE[row.severity].border"
    >
      <span
        class="flex size-[26px] items-center justify-center rounded-md border"
        :class="TONE[row.severity].chip"
      >
        <Icon :name="ICONS[row.key] ?? 'mingcute:alert-line'" />
      </span>

      <span class="min-w-0 text-sm">{{ row.label }}</span>

      <span class="tnum font-mono text-base">{{ row.count }}</span>

      <span class="tnum font-mono text-sm" :class="TONE[row.severity].text">
        старший {{ formatAge(row.oldestAgeMs) }}
      </span>

      <UiButton variant="primary" @click="navigateTo(row.to)">
        {{ ACTION_LABELS[row.key] ?? 'Разобрать' }}
      </UiButton>
    </div>
  </section>
</template>
