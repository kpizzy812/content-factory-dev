<script setup lang="ts">
import type { AdminServiceBalanceRow, BalanceSource } from "~/composables/useAdminBalances"
import { isAutoUnavailable } from "~/composables/useAdminBalances"

definePageMeta({
  middleware: ["admin-access"],
})

useHead({ title: "Балансы сервисов" })

const { data, pending, refresh } = useAdminBalances()
const services = computed<AdminServiceBalanceRow[]>(() => data.value?.data?.services ?? [])

const modalRef = ref<{ open: (row: AdminServiceBalanceRow) => void; close: () => void } | null>(null)

function openEdit(row: AdminServiceBalanceRow) {
  modalRef.value?.open(row)
}

async function onSaved() {
  await refresh()
}

function statusBadgeClass(status: string | undefined): string {
  switch (status) {
    case "ok": return "badge-success"
    case "low": return "badge-warning"
    case "critical": return "badge-error"
    case "error": return "badge-error"
    default: return "badge-ghost"
  }
}

function statusLabel(status: string | undefined): string {
  switch (status) {
    case "ok": return "OK"
    case "low": return "Низкий"
    case "critical": return "Критический"
    case "error": return "Ошибка"
    case "unknown": return "Нет данных"
    default: return "—"
  }
}

function formatAmount(row: AdminServiceBalanceRow): string {
  const b = row.balance?.balance
  if (b) return `${b.amount.toFixed(2)} ${b.currency}`
  const q = row.balance?.quota
  if (q) return `${q.used.toFixed(1)} / ${q.limit.toFixed(1)} ${q.unit}`
  const e = row.balance?.expiry
  if (e) return `${e.daysRemaining} дн.`
  return "—"
}

const SOURCE_META: Record<BalanceSource, { icon: string; label: string; badge: string }> = {
  api: { icon: "🤖", label: "Auto", badge: "badge-soft badge-success" },
  manual: { icon: "📝", label: "Manual", badge: "badge-soft badge-ghost" },
  estimate: { icon: "🧮", label: "Estimate", badge: "badge-soft badge-warning" },
  fallback: { icon: "⚠️", label: "Fallback", badge: "badge-soft badge-error" },
}

function sourceMeta(source: BalanceSource | undefined) {
  return source ? SOURCE_META[source] : null
}

function formatAge(iso: string | undefined): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })
}

// ── burn-rate (balance_v2) ──────────────────────────────────────────────
function formatBurnRate(row: AdminServiceBalanceRow): string {
  const br = row.balance?.metadata?.burnRate
  if (!br || br.dailyAvgUsd === 0) return "—"
  return `$${br.dailyAvgUsd.toFixed(2)}/д`
}

function formatDaysLeft(row: AdminServiceBalanceRow): string {
  const br = row.balance?.metadata?.burnRate
  const baseline = row.balance?.balance?.amount
  if (!br || !baseline || br.dailyAvgUsd === 0) return "—"
  const days = baseline / br.dailyAvgUsd
  if (!Number.isFinite(days)) return "∞"
  return `~${Math.floor(days)} дн.`
}

function burnRateColorClass(row: AdminServiceBalanceRow): string {
  const br = row.balance?.metadata?.burnRate
  if (!br?.projectedZeroDate) return "text-base-content/60"
  const daysLeft = (new Date(br.projectedZeroDate).getTime() - Date.now()) / 86_400_000
  if (daysLeft < 2) return "text-error"
  if (daysLeft < 7) return "text-warning"
  return "text-base-content/60"
}

// Пустое состояние — нет ни одной осмысленной записи баланса.
const allEmpty = computed(() =>
  services.value.length > 0 &&
  services.value.every(s => !s.balance || s.balance.status === "unknown"),
)

// Vue парсер съедает {{ }} в template, поэтому собираем имена переменных через unicode-escape
const VAR_BALANCE = "{{balance}}"
const VAR_BALANCE_LOW = "{{balance_low_services}}"
const VAR_BALANCE_TOTAL = "{{balance_total_usd}}"
</script>

<template>
  <div class="space-y-4">
    <div class="breadcrumbs text-sm">
      <ul>
        <li><NuxtLink to="/admin">Админ</NuxtLink></li>
        <li>Балансы</li>
      </ul>
    </div>

    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold text-base-content">Балансы сервисов</h1>
      <button class="btn btn-sm btn-ghost" :disabled="pending" @click="refresh()">
        <Icon name="mingcute:refresh-2-line" />
        Обновить
      </button>
    </div>

    <div class="alert alert-info">
      <Icon name="mingcute:information-line" />
      <div class="text-sm">
        Балансы вводятся вручную: откройте dashboard сервиса, скопируйте текущее значение и обновите запись.
        В Telegram доступна команда <code class="kbd kbd-xs">/balance</code> и переменные шаблонов
        <code class="kbd kbd-xs">{{ VAR_BALANCE }}</code>,
        <code class="kbd kbd-xs">{{ VAR_BALANCE_LOW }}</code>,
        <code class="kbd kbd-xs">{{ VAR_BALANCE_TOTAL }}</code>.
      </div>
    </div>

    <div v-if="pending" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <div v-if="!pending && allEmpty" class="alert alert-warning mb-4">
      <Icon name="mingcute:warning-line" />
      <div>
        Балансы не введены. Откройте каждый сервис кнопкой <b>Изменить</b> и введите текущий остаток с dashboard.
        Для fal.ai/apify/nodemaven попробуйте также добавить API-ключ в <code>.env</code> для автоматического фетча.
      </div>
    </div>

    <div v-if="!pending" class="card card-border bg-base-100">
      <div class="card-body p-0">
        <div class="overflow-x-auto">
          <table class="table table-zebra">
            <thead>
              <tr>
                <th>Сервис</th>
                <th>Текущий баланс</th>
                <th>Статус</th>
                <th>Источник</th>
                <th>Расход / день</th>
                <th>Дней до 0</th>
                <th>Пороги (low / critical)</th>
                <th>Обновлено</th>
                <th>Заметки</th>
                <th class="text-right" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in services" :key="row.key">
                <td>
                  <div class="font-semibold">{{ row.label }}</div>
                  <div v-if="row.dashboardHint" class="text-xs text-base-content/50">
                    {{ row.dashboardHint }}
                  </div>
                </td>
                <td class="font-mono">{{ formatAmount(row) }}</td>
                <td>
                  <div class="badge badge-soft" :class="statusBadgeClass(row.balance?.status)">
                    {{ statusLabel(row.balance?.status) }}
                  </div>
                </td>
                <td>
                  <!-- F-6: бейдж «Авто недоступно» для сервисов без публичного billing API -->
                  <div
                    v-if="isAutoUnavailable(row.key)"
                    class="badge badge-sm badge-soft badge-neutral"
                    title="У сервиса нет публичного billing API — обновляйте вручную"
                  >
                    <Icon name="mingcute:lock-line" class="text-xs" />
                    Авто недоступно
                  </div>
                  <div
                    v-else-if="sourceMeta(row.balance?.source)"
                    class="badge badge-sm"
                    :class="sourceMeta(row.balance?.source)!.badge"
                  >
                    {{ sourceMeta(row.balance?.source)!.icon }} {{ sourceMeta(row.balance?.source)!.label }}
                  </div>
                  <span v-else class="text-xs text-base-content/40">—</span>
                </td>
                <td class="text-xs font-mono" :class="burnRateColorClass(row)">
                  {{ formatBurnRate(row) }}
                </td>
                <td class="text-xs" :class="burnRateColorClass(row)">
                  {{ formatDaysLeft(row) }}
                </td>
                <td class="text-xs text-base-content/60">
                  {{ row.lowThreshold }} / {{ row.criticalThreshold }} {{ row.defaultCurrency }}
                </td>
                <td class="text-xs text-base-content/60">
                  {{ formatAge(row.balance?.enteredAt) }}
                </td>
                <td class="text-xs text-base-content/60 max-w-xs truncate">
                  {{ row.balance?.notes ?? '—' }}
                </td>
                <td class="text-right">
                  <button class="btn btn-xs btn-ghost" @click="openEdit(row)">
                    <Icon name="mingcute:edit-line" />
                    Изменить
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <BalanceEditModal ref="modalRef" @saved="onSaved" />
  </div>
</template>
