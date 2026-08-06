<script setup lang="ts">
import type {
  AccountHealthRow,
  AccountsHealthPlatform,
  AccountsHealthWarmupStatus,
} from '~~/shared/types/accounts-health'
import { platformMeta } from '~/components/ui/platform-meta'

/**
 * Аккаунты по убыванию проблем. Прогрев показан только здесь: в списке
 * аккаунтов его нет, потому что `/api/accounts` этого поля не отдаёт.
 */
defineProps<{ accounts: AccountHealthRow[] }>()

const emit = defineEmits<{
  edit: [{ id: number, displayName: string, proxyId: string | null, platform: AccountsHealthPlatform }]
}>()

const WARMUP_LABELS: Record<AccountsHealthWarmupStatus, string> = {
  new: 'не прогревался',
  warming: 'греется',
  ready: 'прогрет',
  cold: 'остыл',
}

const WARMUP_TONE: Record<AccountsHealthWarmupStatus, string> = {
  new: 'border-divider bg-transparent text-subtle',
  warming: 'border-info-border bg-info-bg text-info',
  ready: 'border-success-border bg-success-bg text-success',
  cold: 'border-warning-border bg-warning-bg text-warning',
}

function relativeWarmup(iso: string | null): string {
  if (!iso) return 'ни разу'
  const ts = new Date(iso).getTime()
  if (!Number.isFinite(ts)) return 'ни разу'
  const days = Math.floor((Date.now() - ts) / 86_400_000)
  if (days <= 0) return 'сегодня'
  if (days === 1) return 'вчера'
  return `${days} дней назад`
}

function onRowClick(row: AccountHealthRow) {
  emit('edit', {
    id: row.id,
    displayName: row.displayName,
    proxyId: row.proxyId,
    platform: row.platform,
  })
}
</script>

<template>
  <UiEmptyState
    v-if="!accounts.length"
    variant="first"
    title="Аккаунтов нет"
    description="Подключите аккаунт в разделе «Аккаунты» — он появится здесь вместе со своим состоянием."
  />

  <UiTable
    v-else
    columns="minmax(180px,1fr) 120px 132px minmax(150px,180px) 76px 140px 132px"
    min-width="980px"
  >
    <UiTableHead>
      <span>Аккаунт</span>
      <span>Платформа</span>
      <span>Статус</span>
      <span>Прокси</span>
      <span>Доступы</span>
      <span>Прогрев</span>
      <span>Заполненность</span>
    </UiTableHead>

    <UiTableRow v-for="row in accounts" :key="row.id" density="media" @click="onRowClick(row)">
      <span class="min-w-0">
        <span class="block truncate font-mono text-sm">{{ row.displayName }}</span>
        <span class="block truncate text-micro text-subtle">{{ row.app?.name ?? '—' }}</span>
      </span>

      <span class="flex items-center gap-1.5 text-sm text-muted">
        <span class="h-3 w-[5px] shrink-0 rounded-[2px]" :style="{ background: platformMeta(row.platform).color }" />
        {{ platformMeta(row.platform).label }}
      </span>

      <span><AccountStatusBadge :status="row.status" size="xs" /></span>

      <span class="flex min-w-0 items-center gap-1.5">
        <template v-if="row.hasProxy && row.proxyStatus">
          <span class="truncate text-sm text-muted">{{ row.proxyLabel ?? '—' }}</span>
          <ProxyHealthBadge :status="row.proxyStatus" size="xs" />
        </template>
        <span
          v-else
          class="rounded-sm border border-danger-border bg-danger-bg px-1.5 py-0.5 text-micro text-danger"
          title="Без прокси публикация и запуск устройства заблокированы"
        >
          нет прокси
        </span>
      </span>

      <span class="flex items-center gap-2">
        <UiTooltip :text="row.hasLoginCredentials ? 'Логин и пароль заданы' : 'Логин или пароль не заданы'">
          <Icon
            name="mingcute:lock-line"
            :class="row.hasLoginCredentials ? 'text-success' : 'text-subtle'"
          />
        </UiTooltip>
        <UiTooltip :text="row.has2FA ? 'Двухфакторная проверка настроена' : 'Двухфакторной проверки нет'">
          <Icon
            name="mingcute:shield-line"
            :class="row.has2FA ? 'text-success' : 'text-subtle'"
          />
        </UiTooltip>
      </span>

      <span class="flex min-w-0 flex-col gap-0.5">
        <span
          class="w-fit rounded-sm border px-1.5 text-micro"
          :class="WARMUP_TONE[row.warmupStatus]"
        >
          {{ WARMUP_LABELS[row.warmupStatus] }}
        </span>
        <span class="text-micro text-subtle">{{ relativeWarmup(row.lastWarmupAt) }}</span>
      </span>

      <span><AdminAccountCompletenessBar :percent="row.completenessPercent" size="sm" /></span>
    </UiTableRow>
  </UiTable>
</template>
