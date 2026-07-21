<script setup lang="ts">
import type {
  AccountHealthRow,
  AccountsHealthPlatform,
  AccountsHealthAccountStatus,
  AccountsHealthProxyStatus,
  AccountsHealthWarmupStatus,
} from "~~/shared/types/accounts-health"

defineProps<{ accounts: AccountHealthRow[] }>()

const emit = defineEmits<{
  edit: [{ id: number; displayName: string; proxyId: string | null; platform: AccountsHealthPlatform }]
}>()

const platformIcons: Record<AccountsHealthPlatform, string> = {
  tiktok: "mingcute:tiktok-line",
  instagram: "mingcute:instagram-line",
  youtube: "mingcute:youtube-line",
}

const platformLabels: Record<AccountsHealthPlatform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
}

const statusBadgeClass: Record<AccountsHealthAccountStatus, string> = {
  active: "badge-success",
  expired: "badge-warning",
  revoked: "badge-error",
}

const statusLabel: Record<AccountsHealthAccountStatus, string> = {
  active: "активен",
  expired: "истёк",
  revoked: "отозван",
}

const proxyStatusBadgeClass: Record<AccountsHealthProxyStatus, string> = {
  healthy: "badge-success",
  degraded: "badge-warning",
  dead: "badge-error",
  unverified: "badge-ghost",
  expired: "badge-warning",
}

const proxyStatusLabel: Record<AccountsHealthProxyStatus, string> = {
  healthy: "ок",
  degraded: "деград.",
  dead: "мёртв",
  unverified: "не проверен",
  expired: "истёк",
}

const warmupBadgeClass: Record<AccountsHealthWarmupStatus, string> = {
  new: "badge-ghost",
  warming: "badge-info",
  ready: "badge-success",
  cold: "badge-warning",
}

const warmupLabel: Record<AccountsHealthWarmupStatus, string> = {
  new: "новый",
  warming: "греется",
  ready: "готов",
  cold: "остыл",
}

function relativeWarmup(iso: string | null): string {
  if (!iso) return "никогда"
  const ts = new Date(iso).getTime()
  if (!Number.isFinite(ts)) return "никогда"
  const days = Math.floor((Date.now() - ts) / 86400000)
  if (days <= 0) return "сегодня"
  if (days === 1) return "1 д назад"
  return `${days} д назад`
}

function onRowClick(row: AccountHealthRow) {
  emit("edit", {
    id: row.id,
    displayName: row.displayName,
    proxyId: row.proxyId,
    platform: row.platform,
  })
}
</script>

<template>
  <div v-if="accounts.length === 0">
    <SharedEmptyState
      icon="mingcute:group-line"
      title="Нет подключённых аккаунтов"
      description="Подключите аккаунт через раздел «Аккаунты», чтобы увидеть его здесь."
    />
  </div>

  <div v-else class="overflow-x-auto">
    <table class="table table-zebra table-sm">
      <thead>
        <tr>
          <th>Аккаунт</th>
          <th>Платформа</th>
          <th>Статус</th>
          <th>Прокси</th>
          <th>Креды</th>
          <th>Прогрев</th>
          <th class="min-w-32">Полнота</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in accounts"
          :key="row.id"
          class="hover cursor-pointer"
          @click="onRowClick(row)"
        >
          <td>
            <div class="font-medium text-sm truncate max-w-44">{{ row.displayName }}</div>
            <div class="text-xs text-base-content/50 truncate max-w-44">
              {{ row.app?.name ?? "—" }}
            </div>
          </td>
          <td>
            <span class="badge badge-soft badge-sm gap-1">
              <Icon :name="platformIcons[row.platform]" class="text-sm" />
              {{ platformLabels[row.platform] }}
            </span>
          </td>
          <td>
            <span class="badge badge-soft badge-sm" :class="statusBadgeClass[row.status]">
              {{ statusLabel[row.status] }}
            </span>
          </td>
          <td>
            <template v-if="row.hasProxy && row.proxyStatus">
              <div class="flex items-center gap-1.5">
                <span class="text-xs truncate max-w-28">{{ row.proxyLabel ?? "—" }}</span>
                <span
                  class="badge badge-soft badge-xs"
                  :class="proxyStatusBadgeClass[row.proxyStatus]"
                >
                  {{ proxyStatusLabel[row.proxyStatus] }}
                </span>
              </div>
            </template>
            <span
              v-else
              class="badge badge-error badge-xs gap-1"
              title="У аккаунта нет прокси — постинг и запуск устройства DuoPlus заблокированы"
            >
              <Icon name="mingcute:forbid-circle-line" class="text-xs" />
              Постинг заблокирован
            </span>
          </td>
          <td>
            <div class="flex items-center gap-2">
              <span
                class="tooltip"
                :data-tip="row.hasLoginCredentials ? 'Логин и пароль есть' : 'Нет логина или пароля'"
              >
                <Icon
                  name="mingcute:lock-line"
                  class="text-base"
                  :class="row.hasLoginCredentials ? 'text-success' : 'text-base-content/30'"
                />
              </span>
              <span
                class="tooltip"
                :data-tip="row.has2FA ? '2FA настроен' : 'Нет 2FA'"
              >
                <Icon
                  name="mingcute:shield-line"
                  class="text-base"
                  :class="row.has2FA ? 'text-success' : 'text-base-content/30'"
                />
              </span>
            </div>
          </td>
          <td>
            <div class="flex flex-col gap-0.5">
              <span class="badge badge-soft badge-xs" :class="warmupBadgeClass[row.warmupStatus]">
                {{ warmupLabel[row.warmupStatus] }}
              </span>
              <span class="text-xs text-base-content/50">
                {{ relativeWarmup(row.lastWarmupAt) }}
              </span>
            </div>
          </td>
          <td>
            <AccountCompletenessBar :percent="row.completenessPercent" />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
