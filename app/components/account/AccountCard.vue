<script setup lang="ts">
const props = defineProps<{
  account: {
    id: number
    platform: string
    displayName: string
    status: string
    expiresAt: string | null
    createdAt: string
    _count?: { uploads: number; groups: number }
    styleProfile?: { id: number; status: string; version: number } | null
    hasLoginCredentials?: boolean
    proxyId?: string | null
    proxy?: { id: string; label: string; status: string } | null
    postingMethod?: string
    loginCheckedAt?: string | null
    loginCheckedStatus?: boolean | null
    loginCheckedUsername?: string | null
  }
}>()

const emit = defineEmits<{
  disconnected: []
  'open-style': [accountId: number]
  'edit': [account: { id: number; displayName: string; proxyId: string | null; platform: string }]
}>()

const { disconnectAccount, isDisconnecting, error } = useAccountActions()

const platformConfig: Record<string, { label: string; icon: string; badgeClass: string }> = {
  youtube: { label: 'YouTube', icon: 'mingcute:youtube-line', badgeClass: 'badge-error badge-soft' },
  tiktok: { label: 'TikTok', icon: 'mingcute:tiktok-line', badgeClass: 'badge-neutral badge-soft' },
  instagram: { label: 'Instagram', icon: 'mingcute:instagram-line', badgeClass: 'badge-secondary badge-soft' },
}

const statusConfig: Record<string, { label: string; badgeClass: string }> = {
  active: { label: 'Активен', badgeClass: 'badge-success' },
  expired: { label: 'Истёк', badgeClass: 'badge-warning' },
  revoked: { label: 'Отключён', badgeClass: 'badge-error' },
}

const platform = computed(() => platformConfig[props.account.platform] ?? {
  label: props.account.platform,
  icon: 'mingcute:share-2-line',
  badgeClass: 'badge-ghost',
})

const status = computed(() => statusConfig[props.account.status] ?? {
  label: props.account.status,
  badgeClass: 'badge-ghost',
})

const showConfirm = ref(false)

async function handleDisconnect() {
  const result = await disconnectAccount(props.account.id)
  if (result) {
    showConfirm.value = false
    emit('disconnected')
  }
}
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 gap-3">
      <!-- Платформа и статус -->
      <div class="flex items-center gap-2 flex-wrap">
        <span class="badge gap-1" :class="platform.badgeClass">
          <Icon :name="platform.icon" class="text-sm" />
          {{ platform.label }}
        </span>
        <span class="badge badge-sm" :class="status.badgeClass">
          {{ status.label }}
        </span>
        <span
          v-if="account.postingMethod === 'browser_automation'"
          class="badge badge-sm badge-warning gap-1"
          title="Этот аккаунт постит через автоматизацию устройства DuoPlus (не API)"
        >
          <Icon name="mingcute:robot-line" class="text-xs" />
          Auto-Browser
        </span>
        <AccountLoginStatusBadge
          v-if="account.postingMethod === 'browser_automation'"
          :login-checked-at="account.loginCheckedAt"
          :login-checked-status="account.loginCheckedStatus"
          :login-checked-username="account.loginCheckedUsername"
        />
        <AccountReadinessBadge
          v-if="account.postingMethod === 'browser_automation'"
          :account="account"
        />
      </div>

      <!-- Proxy gating: blocking badge если нет прокси / прокси не healthy -->
      <div
        v-if="!account.proxyId"
        role="alert"
        class="alert alert-error alert-soft py-2 text-xs gap-2"
        title="Постинг и запуск устройства DuoPlus заблокированы до привязки рабочего прокси"
      >
        <Icon name="mingcute:warning-line" class="text-sm" />
        <span>Нет прокси — постинг заблокирован</span>
      </div>
      <div
        v-else-if="account.proxy && account.proxy.status !== 'healthy'"
        role="alert"
        class="alert alert-warning alert-soft py-2 text-xs gap-2"
        :title="`Постинг разрешён только при healthy. Текущий статус: ${account.proxy.status}`"
      >
        <Icon name="mingcute:warning-line" class="text-sm" />
        <span>Прокси {{ account.proxy.status }} — постинг заблокирован</span>
      </div>

      <!-- Имя -->
      <h3 class="font-semibold text-base-content">
        {{ account.displayName }}
      </h3>

      <!-- Style badge + Статистика -->
      <div class="flex items-center gap-2 flex-wrap">
        <AccountStyleStatusBadge :status="(account.styleProfile?.status as 'not_set' | 'partial' | 'complete') ?? 'not_set'" />
        <div v-if="account._count" class="flex gap-3 text-xs text-base-content/60">
          <span>{{ account._count.uploads }} загрузок</span>
          <span>{{ account._count.groups }} групп</span>
        </div>
      </div>

      <!-- Прокси и логин-флаг -->
      <div class="flex items-center gap-2 flex-wrap text-xs">
        <div class="flex items-center gap-1.5">
          <Icon name="mingcute:wifi-line" class="text-base-content/50" />
          <template v-if="account.proxy">
            <span class="text-base-content/70">{{ account.proxy.label }}</span>
            <ProxyHealthBadge
              :status="account.proxy.status as 'unverified' | 'healthy' | 'degraded' | 'dead' | 'expired'"
              size="sm"
            />
          </template>
          <span v-else class="text-base-content/50">Без прокси</span>
        </div>
        <div class="flex items-center gap-1.5">
          <Icon name="mingcute:lock-line" class="text-base-content/50" />
          <span v-if="account.hasLoginCredentials" class="text-success">
            Логин: задан
          </span>
          <span v-else class="text-base-content/50">
            Логин: не задан
          </span>
        </div>
      </div>

      <!-- Кнопки -->
      <div class="card-actions justify-end">
        <button
          class="btn btn-sm btn-ghost gap-1"
          @click="emit('open-style', account.id)"
        >
          <Icon name="mingcute:palette-line" class="text-sm" />
          Стиль
        </button>
        <button
          class="btn btn-sm btn-ghost gap-1"
          @click="emit('edit', { id: account.id, displayName: account.displayName, proxyId: account.proxyId ?? null, platform: account.platform })"
        >
          <Icon name="mingcute:edit-line" class="text-sm" />
          Редактировать
        </button>
        <button
          class="btn btn-sm btn-error btn-outline gap-1"
          :disabled="isDisconnecting"
          @click="showConfirm = true"
        >
          <span v-if="isDisconnecting" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:unlink-line" class="text-sm" />
          Отключить
        </button>
      </div>

      <!-- Ошибка -->
      <div v-if="error" role="alert" class="alert alert-error alert-soft text-sm">
        <Icon name="mingcute:warning-line" />
        <span>{{ error }}</span>
      </div>
    </div>

    <!-- Modal подтверждения.
         TODO: DaisyUI 5 рекомендует переход на native dialog.showModal()/close() вместо
         class:modal-open — текущий вариант остаётся для backward-compat с остальной
         кодовой базой. См. comments в backlog. -->
    <dialog class="modal" :class="{ 'modal-open': showConfirm }">
      <div class="modal-box">
        <h3 class="text-lg font-bold">Отключить аккаунт?</h3>
        <p class="py-4 text-base-content/70">
          Аккаунт <strong>{{ account.displayName }}</strong> будет отвязан. Активные загрузки будут отменены.
        </p>
        <div class="modal-action">
          <button class="btn" @click="showConfirm = false">Отмена</button>
          <button
            class="btn btn-error"
            :disabled="isDisconnecting"
            @click="handleDisconnect"
          >
            <span v-if="isDisconnecting" class="loading loading-spinner loading-xs" />
            Отключить
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="showConfirm = false">close</button>
      </form>
    </dialog>
  </div>
</template>
