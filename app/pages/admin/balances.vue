<script setup lang="ts">
/**
 * Балансы сервисов. Макет: design-preview/catalog/08-settings-admin.dc.html
 *
 * Карточка на сервис: остаток, прогноз «хватит на N дней», источник значения и
 * порог алерта. Прогноз считает сервер (`balance.metadata.burnRate`), мы его
 * только показываем — свой расчёт по чужим числам был бы выдумкой.
 *
 * Разбивки расхода по типам операций из макета нет: `/api/admin/balances`
 * отдаёт остатки по сервисам, а не траты по операциям.
 */
import type { AdminServiceBalanceRow } from '~/composables/useAdminBalances'
import { isAutoUnavailable } from '~/composables/useAdminBalances'
import { balanceStatus, BALANCE_SOURCE_LABELS } from '~/components/admin/BalanceStatusMap'

definePageMeta({ middleware: ['admin-access'] })
useHead({ title: 'Балансы сервисов' })

const { data, pending, refresh } = useAdminBalances()
const services = computed<AdminServiceBalanceRow[]>(() => data.value?.data?.services ?? [])

const modalRef = ref<{ open: (row: AdminServiceBalanceRow) => void } | null>(null)

/** Ни у одного сервиса нет осмысленного остатка — объясняем это отдельно. */
const allEmpty = computed(() =>
  services.value.length > 0
  && services.value.every(s => !s.balance || s.balance.status === 'unknown'),
)

const lowCount = computed(() =>
  services.value.filter(s => ['low', 'critical'].includes(s.balance?.status ?? '')).length,
)

function amount(row: AdminServiceBalanceRow): string {
  const b = row.balance?.balance
  if (b) return `${b.amount.toFixed(2)} ${b.currency}`
  const q = row.balance?.quota
  if (q) return `${q.used.toFixed(1)} / ${q.limit.toFixed(1)} ${q.unit}`
  const e = row.balance?.expiry
  if (e) return `${e.daysRemaining} дн.`
  return '—'
}

function burnRate(row: AdminServiceBalanceRow): string | null {
  const br = row.balance?.metadata?.burnRate
  if (!br || br.dailyAvgUsd === 0) return null
  return `$${br.dailyAvgUsd.toFixed(2)} в сутки`
}

function daysLeft(row: AdminServiceBalanceRow): string | null {
  const br = row.balance?.metadata?.burnRate
  const baseline = row.balance?.balance?.amount
  if (!br || !baseline || br.dailyAvgUsd === 0) return null
  const days = baseline / br.dailyAvgUsd
  if (!Number.isFinite(days)) return null
  return `хватит на ~${Math.floor(days)} дн.`
}

function sourceLabel(row: AdminServiceBalanceRow): string {
  if (isAutoUnavailable(row.key)) return 'автосбора нет'
  return BALANCE_SOURCE_LABELS[row.balance?.source ?? ''] ?? '—'
}

function enteredAt(row: AdminServiceBalanceRow): string | null {
  const iso = row.balance?.enteredAt
  if (!iso) return null
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-semibold">Балансы сервисов</h1>
      <span class="tnum font-mono text-sm text-subtle">{{ services.length }}</span>
      <span v-if="lowCount" class="tnum font-mono text-sm text-warning">{{ lowCount }} на исходе</span>
      <span class="flex-1" />
      <UiButton :loading="pending" @click="refresh()">
        <Icon v-if="!pending" name="mingcute:refresh-2-line" />
        Обновить
      </UiButton>
    </div>

    <p class="max-w-3xl text-sm text-muted">
      Прогноз «хватит на N дней» считает сервер по среднему расходу. Малый остаток —
      это предупреждение, а не авария: генерация продолжится, пока деньги не кончатся.
    </p>

    <p
      v-if="!pending && allEmpty"
      class="flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-sm text-fg"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-warning" />
      <span>
        Остатки ни по одному сервису не введены. Откройте карточку и впишите текущий
        остаток из личного кабинета сервиса — без него прогноза не будет.
      </span>
    </p>

    <UiSkeleton v-if="pending && !services.length" variant="details" :count="6" />

    <div v-else class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <section
        v-for="row in services"
        :key="row.key"
        class="overflow-hidden rounded-lg border bg-panel"
        :class="balanceStatus(row.balance?.status).entity === 'review'
          ? 'border-warning-border'
          : balanceStatus(row.balance?.status).entity === 'failed'
            ? 'border-danger-border'
            : 'border-border'"
      >
        <div class="flex flex-wrap items-center gap-2 border-b border-divider bg-card px-3 py-2.5">
          <span class="min-w-0 flex-1 truncate font-medium">{{ row.label }}</span>
          <span
            class="inline-flex h-5 shrink-0 items-center rounded-sm border px-[7px] text-sm"
            :class="balanceStatus(row.balance?.status).tone"
          >{{ balanceStatus(row.balance?.status).label }}</span>
        </div>

        <div class="flex flex-col gap-2 px-3 py-3">
          <div class="flex flex-wrap items-baseline gap-2">
            <span class="tnum font-mono text-2xl font-semibold tracking-tight">{{ amount(row) }}</span>
            <span v-if="burnRate(row)" class="tnum font-mono text-sm text-muted">{{ burnRate(row) }}</span>
          </div>

          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-subtle">
            <span v-if="daysLeft(row)" class="tnum">{{ daysLeft(row) }}</span>
            <span>{{ sourceLabel(row) }}</span>
            <ClientOnly>
              <span v-if="enteredAt(row)" class="tnum">обновлено {{ enteredAt(row) }}</span>
            </ClientOnly>
          </div>

          <p v-if="row.balance?.notes" class="text-sm text-muted">{{ row.balance.notes }}</p>

          <div class="flex flex-wrap items-center gap-2 border-t border-divider pt-2 text-sm text-subtle">
            <span class="tnum font-mono">
              порог {{ row.lowThreshold }} / {{ row.criticalThreshold }} {{ row.defaultCurrency }}
            </span>
            <span class="flex-1" />
            <UiButton variant="ghost" @click="modalRef?.open(row)">
              <Icon name="mingcute:edit-line" />
              Изменить
            </UiButton>
          </div>

          <p v-if="row.dashboardHint" class="truncate text-micro text-subtle" :title="row.dashboardHint">
            {{ row.dashboardHint }}
          </p>
        </div>
      </section>
    </div>

    <p class="max-w-3xl text-micro text-subtle">
      Пороги алерта задаются в конфигурации сервера, а не здесь: они одинаковы для
      всех и меняются вместе с поставкой. В Telegram доступна команда /balance.
    </p>

    <AdminBalanceEditModal ref="modalRef" @saved="refresh()" />
  </div>
</template>
