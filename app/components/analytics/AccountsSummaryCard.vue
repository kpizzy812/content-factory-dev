<script setup lang="ts">
/**
 * Карточка аккаунта на вкладке «Аккаунты».
 *
 * Переиспользует `AccountMetricsStatCards` и `AccountMetricsSparkline` из
 * раздела аккаунтов: там уже правильная сериализация BigInt и тот же язык.
 *
 * Состояния: нет handle — собирать нечем; снимков нет — не собирали; все
 * попытки с ошибкой — Apify не смог; иначе метрики со спарклайном.
 */
import type { AccountsSummaryItem } from '~~/shared/types/analytics'

const props = defineProps<{
  item: AccountsSummaryItem
}>()

const STATUS_LABELS: Record<string, string> = {
  active: 'Активен',
  expired: 'Истёк',
  revoked: 'Отключён',
}

const STATUS_TONE: Record<string, string> = {
  active: 'border-success-border bg-success-bg text-success',
  expired: 'border-warning-border bg-warning-bg text-warning',
  revoked: 'border-danger-border bg-danger-bg text-danger',
}

const status = computed(() => ({
  label: STATUS_LABELS[props.item.account.status] ?? props.item.account.status,
  tone: STATUS_TONE[props.item.account.status] ?? 'border-neutral-border bg-neutral-bg text-neutral',
}))

/**
 * Свежесть снимка зависит от «сейчас», поэтому считается только в браузере —
 * на сервере она разошлась бы с первым клиентским рендером.
 */
const freshness = computed(() => {
  const stamp = props.item.lastFetchedAt
  if (!stamp) return null
  const diff = Date.now() - new Date(stamp).getTime()
  if (!Number.isFinite(diff) || diff < 0) return null
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return { label: 'только что', warn: false }
  if (minutes < 60) return { label: `${minutes} мин назад`, warn: false }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { label: `${hours} ч назад`, warn: false }
  const days = Math.floor(hours / 24)
  // Apify собирается раз в сутки: старше двух дней — повод обновить.
  return { label: `${days} д назад`, warn: days >= 2 }
})

const latestOk = computed(() => props.item.latestOkSnapshot)
const recent = computed(() => props.item.recentSnapshots)
const hasOnlyErrors = computed(() => recent.value.length > 0 && !latestOk.value)
</script>

<template>
  <section class="flex flex-col gap-3 rounded-lg border border-border bg-panel p-3.5">
    <header class="flex flex-wrap items-start justify-between gap-2">
      <div class="flex min-w-0 items-center gap-2">
        <UiPlatformBadge :platform="item.account.platform" />
        <div class="flex min-w-0 flex-col">
          <span class="truncate text-sm font-semibold">{{ item.account.displayName }}</span>
          <span v-if="item.account.platformHandle" class="truncate font-mono text-micro text-muted">
            @{{ item.account.platformHandle }}
          </span>
          <span v-else class="text-micro text-subtle">handle не указан</span>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-1.5">
        <span
          class="inline-flex h-[18px] items-center rounded-sm border px-1.5 text-micro"
          :class="status.tone"
        >
          {{ status.label }}
        </span>
        <ClientOnly>
          <span
            v-if="freshness"
            class="inline-flex h-[18px] items-center gap-1 rounded-sm border px-1.5 text-micro"
            :class="freshness.warn
              ? 'border-warning-border bg-warning-bg text-warning'
              : 'border-border bg-card text-muted'"
            title="Последний снимок Apify"
          >
            <Icon name="mingcute:time-line" />
            {{ freshness.label }}
          </span>
        </ClientOnly>
      </div>
    </header>

    <div
      v-if="!item.account.platformHandle"
      role="note"
      class="flex items-start gap-2 rounded-md border border-info-border bg-info-bg px-2.5 py-2 text-sm"
    >
      <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
      <span>Для сбора нужен handle: откройте аккаунт → «Доступы» и заполните его.</span>
    </div>

    <UiEmptyState
      v-else-if="!recent.length"
      title="Статистика ещё не собрана"
      description="Откройте аккаунт → вкладка «Статистика» и соберите первый снимок."
    />

    <div
      v-else-if="hasOnlyErrors"
      role="alert"
      class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm"
    >
      <Icon name="mingcute:close-circle-line" class="mt-0.5 shrink-0 text-danger" />
      <span>
        <span class="font-medium text-danger">Apify не смог собрать данные.</span>
        {{ recent[0]?.errorMessage ?? 'Без деталей' }}
      </span>
    </div>

    <template v-else-if="latestOk">
      <AccountMetricsStatCards :snapshot="latestOk" />
      <AccountMetricsSparkline :snapshots="recent" />
    </template>
  </section>
</template>
