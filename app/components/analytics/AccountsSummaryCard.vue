<script setup lang="ts">
/**
 * Одна карточка аккаунта в /analytics → таб «Аккаунты».
 * Переиспользует AccountMetricsStatCards и AccountMetricsSparkline из accounts —
 * там уже корректная сериализация BigInt → string и тот же визуальный язык.
 *
 * Состояния:
 *   - latestOkSnapshot есть     → StatCards + Sparkline + бейдж свежести
 *   - latestOkSnapshot null     → empty state с подсказкой «соберите статистику»
 *   - всё провалилось (только error-снапшоты) → alert + ссылка на детали аккаунта
 */
import type { AccountsSummaryItem } from "~~/shared/types/analytics"

const props = defineProps<{
  item: AccountsSummaryItem
}>()

const platformLabel: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
}

const platformIcon: Record<string, string> = {
  tiktok: "mingcute:tiktok-line",
  instagram: "mingcute:ins-line",
  youtube: "mingcute:youtube-line",
}

const statusBadge: Record<string, { label: string; cls: string }> = {
  active: { label: "Активен", cls: "badge-success" },
  expired: { label: "Истёк", cls: "badge-warning" },
  revoked: { label: "Отключён", cls: "badge-error" },
}

const status = computed(
  () =>
    statusBadge[props.item.account.status] ?? {
      label: props.item.account.status,
      cls: "badge-ghost",
    },
)

// Бейдж свежести: «обновлено N часов назад» / «N минут назад» / «N дней назад».
// Источник — lastFetchedAt (любой статус снапшота).
const freshness = computed(() => {
  const ts = props.item.lastFetchedAt
  if (!ts) return null
  const diffMs = Date.now() - new Date(ts).getTime()
  if (!Number.isFinite(diffMs) || diffMs < 0) return null
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return { label: "только что", warn: false }
  if (mins < 60) return { label: `${mins} мин назад`, warn: false }
  const hours = Math.floor(mins / 60)
  if (hours < 24) return { label: `${hours} ч назад`, warn: false }
  const days = Math.floor(hours / 24)
  // Apify-метрики собираются раз в 24 часа (idempotent), старше 2 дней —
  // повод обновить.
  return { label: `${days} д назад`, warn: days >= 2 }
})

const latestOk = computed(() => props.item.latestOkSnapshot)
const recent = computed(() => props.item.recentSnapshots)
const hasOnlyErrors = computed(
  () => recent.value.length > 0 && !latestOk.value,
)
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 gap-3">
      <!-- Header -->
      <div class="flex items-start justify-between gap-2 flex-wrap">
        <div class="flex items-center gap-2 min-w-0">
          <Icon
            :name="platformIcon[item.account.platform] ?? 'mingcute:share-2-line'"
            class="text-xl text-base-content/70 shrink-0"
          />
          <div class="flex flex-col gap-0.5 min-w-0">
            <span class="text-sm font-semibold text-base-content truncate">
              {{ item.account.displayName }}
            </span>
            <span
              v-if="item.account.platformHandle"
              class="text-xs text-base-content/60 font-mono"
            >
              @{{ item.account.platformHandle }}
            </span>
            <span v-else class="text-xs text-base-content/40 italic">
              handle не указан
            </span>
          </div>
        </div>
        <div class="flex items-center gap-1.5 flex-wrap">
          <span class="badge badge-sm" :class="status.cls">
            {{ status.label }}
          </span>
          <!-- Платформа уже показана крупной иконкой в хедере (строка ~76),
               дублировать её бейджем нет смысла — только визуальный шум. -->
          <span
            v-if="freshness"
            class="badge badge-xs gap-1"
            :class="freshness.warn ? 'badge-warning' : 'badge-ghost'"
            title="Последний снимок Apify"
          >
            <Icon name="mingcute:time-line" class="text-xs" />
            {{ freshness.label }}
          </span>
        </div>
      </div>

      <!-- Empty: handle нет → собрать нельзя -->
      <div
        v-if="!item.account.platformHandle"
        role="alert"
        class="alert alert-info alert-soft text-xs gap-2"
      >
        <Icon name="mingcute:information-line" class="text-sm shrink-0" />
        <span>
          Для сбора метрик нужен handle. Откройте аккаунт → «Доступы» и заполните.
        </span>
      </div>

      <!-- Empty: handle есть, но снимков нет -->
      <div
        v-else-if="recent.length === 0"
        class="text-center py-4 space-y-2"
      >
        <Icon name="mingcute:chart-line-line" class="text-3xl text-base-content/30" />
        <p class="text-xs text-base-content/60">
          Статистика ещё не собрана.
        </p>
        <p class="text-[10px] text-base-content/40">
          Перейдите в аккаунт → таб «Статистика» и нажмите «Собрать впервые».
        </p>
      </div>

      <!-- Все попытки = error -->
      <div
        v-else-if="hasOnlyErrors"
        role="alert"
        class="alert alert-error alert-soft text-xs"
      >
        <Icon name="mingcute:close-circle-line" class="text-sm shrink-0" />
        <div class="flex-1">
          <div class="font-semibold">Apify не смог собрать данные</div>
          <div class="opacity-70">
            {{ recent[0]?.errorMessage ?? "Без деталей" }}
          </div>
        </div>
      </div>

      <!-- Happy path -->
      <template v-else-if="latestOk">
        <AccountMetricsStatCards :snapshot="latestOk" />
        <AccountMetricsSparkline :snapshots="recent" />
      </template>
    </div>
  </div>
</template>
