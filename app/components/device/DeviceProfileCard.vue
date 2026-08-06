<script setup lang="ts">
/**
 * Карточка профиля устройства в списке.
 *
 * Частое и бесплатное — в строке (включить, выключить, открыть), редкое,
 * платное и разрушающее — в меню. Прогресс запуска показывается прямо в
 * карточке: оператор запускает пачками и не должен для этого уходить в деталь.
 */
import type { DeviceProfileDto, DeviceTestPushResult } from '~~/shared/types/device-profile'

const props = defineProps<{
  profile: DeviceProfileDto
}>()

const emit = defineEmits<{
  updated: []
  deleted: []
  edit: [profile: DeviceProfileDto]
  link: [profile: DeviceProfileDto]
}>()

const {
  stopProfile,
  removeAccount,
  setPrimaryAccount,
  deleteProfile,
  resyncProfile,
  testProfilePush,
  isBusy,
  error,
  lastActionError,
} = useDeviceActions()

const {
  state: startFlowState,
  start: startFlow,
  cancel: cancelStartFlow,
  reset: resetStartFlow,
} = useDeviceStartFlow()

const toast = useToast()

const showStart = ref(false)
const showDelete = ref(false)
const isStarting = ref(false)
const isStopping = ref(false)
const testModalRef = ref<{ open: (r: DeviceTestPushResult) => void } | null>(null)

const platformLabels: Record<string, string> = {
  desktop: 'Компьютер',
  mobile_android: 'Android',
  mobile_ios: 'iOS',
}

// Страну прокси проверяет и сервер, но кнопку прячем заранее — иначе оператор
// ловит отказ на каждый клик.
const canAddAccount = computed(() => props.profile.proxyCountryGuard === 'us_proxy_ok')
const cannotLinkReason = computed(() => {
  switch (props.profile.proxyCountryGuard) {
    case 'no_proxy': return 'Сначала задайте прокси'
    case 'wrong_country': return `Прокси не US (${props.profile.proxy?.expectedCountry ?? '?'})`
    case 'unknown': return 'У прокси не задана страна'
    default: return ''
  }
})

const lastSessionLabel = computed(() => {
  if (!props.profile.lastSessionStartedAt) return 'никогда'
  return new Date(props.profile.lastSessionStartedAt).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
})

const startBlocked = computed(() => {
  const p = props.profile
  if (!p.proxyId) return 'Нет прокси — запуск заблокирован, иначе утечёт реальный адрес'
  if (p.proxy && ['dead', 'expired'].includes(p.proxy.status)) {
    return `Прокси ${p.proxy.status} — запуск заблокирован`
  }
  return null
})

async function handleStart() {
  showStart.value = false
  isStarting.value = true
  try {
    await startFlow(props.profile.id, false)
    if (startFlowState.value.step === 'running') emit('updated')
  }
  finally {
    isStarting.value = false
  }
}

async function handleStop() {
  isStopping.value = true
  try {
    const ok = await stopProfile(props.profile.id)
    resetStartFlow()
    // Состояние в базе меняется даже при отказе провайдера — перечитываем всегда,
    // иначе кнопка «Выключить» останется единственной и заблокированной.
    emit('updated')
    if (!ok && lastActionError.value) testModalRef.value?.open(lastActionError.value)
  }
  finally {
    isStopping.value = false
  }
}

function handleStartFlowErrorDetail() {
  const err = startFlowState.value.error
  if (!err) return
  testModalRef.value?.open({
    ok: false,
    status: 0,
    method: 'start',
    url: '',
    requestBody: {},
    responseBody: err.indigoBody ?? null,
    error: err.message,
    phase: err.phase,
  })
}

const removeTarget = ref<{ id: number, displayName: string, isPrimary: boolean } | null>(null)

const removeMessage = computed(() => {
  const acc = removeTarget.value
  if (!acc) return ''
  if (!acc.isPrimary) return `Аккаунт «${acc.displayName}» потеряет связь с профилем.`
  return props.profile.accounts.length === 1
    ? `«${acc.displayName}» — основной и единственный. Профиль останется без аккаунтов.`
    : `«${acc.displayName}» — основной. Сначала назначьте основным другой аккаунт.`
})

const removeBlocked = computed(() =>
  Boolean(removeTarget.value?.isPrimary) && props.profile.accounts.length > 1)

async function confirmRemoveAccount() {
  const acc = removeTarget.value
  if (!acc || removeBlocked.value) return
  if (await removeAccount(props.profile.id, acc.id)) emit('updated')
  removeTarget.value = null
}

async function handleSetPrimary(accountId: number) {
  if (await setPrimaryAccount(props.profile.id, accountId)) emit('updated')
}

async function handleResync() {
  const res = await resyncProfile(props.profile.id)
  if (res) {
    toast.success(props.profile.indigoId ? 'Профиль перепушен в облако' : 'Профиль создан в облаке')
    emit('updated')
  }
  else {
    toast.error(error.value ?? 'Не удалось запушить в облако')
  }
}

async function handleTest() {
  const res = await testProfilePush(props.profile.id)
  if (res) testModalRef.value?.open(res)
}

async function handleDelete() {
  if (await deleteProfile(props.profile.id)) {
    showDelete.value = false
    emit('deleted')
  }
}

const menuItems = computed(() => [
  {
    key: 'resync',
    label: props.profile.indigoId ? 'Перепушить в облако' : 'Запушить в облако',
    icon: props.profile.indigoId ? 'mingcute:refresh-2-line' : 'mingcute:upload-line',
  },
  { key: 'test', label: 'Проверить связь', icon: 'mingcute:test-tube-line' },
  { key: 'edit', label: 'Редактировать', icon: 'mingcute:edit-line' },
  { key: 'delete', label: 'Удалить профиль', icon: 'mingcute:delete-2-line', danger: true },
])

function onMenuSelect(key: string) {
  if (key === 'resync') handleResync()
  if (key === 'test') handleTest()
  if (key === 'edit') emit('edit', props.profile)
  if (key === 'delete') showDelete.value = true
}
</script>

<template>
  <article class="flex flex-col gap-2.5 overflow-hidden rounded-lg border border-border bg-card p-3">
    <div class="flex items-start gap-2">
      <div class="flex min-w-0 flex-1 flex-col">
        <NuxtLink
          :to="`/devices/${profile.id}`"
          class="truncate font-medium hover:underline"
          :title="`Открыть профиль ${profile.name}`"
        >
          {{ profile.name }}
        </NuxtLink>
        <span v-if="profile.indigoId" class="truncate font-mono text-micro text-subtle">
          {{ profile.indigoId }}
        </span>
      </div>
      <div class="flex shrink-0 flex-col items-end gap-1">
        <DeviceSyncStatusBadge :status="profile.syncStatus" :indigo-id="profile.indigoId" size="xs" />
        <DeviceSessionStatusBadge :state="profile.sessionState" :port="profile.lastSessionPort" size="xs" />
        <DeviceStatusBadge v-if="profile.duoplus" :status="profile.duoplus.deviceStatus" size="xs" />
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-1.5 text-micro text-muted">
      <span class="rounded-sm border border-divider px-1.5 py-0.5">
        {{ platformLabels[profile.platformType] ?? profile.platformType }}
      </span>
      <span v-if="profile.os" class="rounded-sm border border-divider px-1.5 py-0.5">{{ profile.os }}</span>
      <span v-if="profile.timezone" class="rounded-sm border border-divider px-1.5 py-0.5">
        {{ profile.timezone }}
      </span>
    </div>

    <!-- Аккаунты -->
    <div class="flex flex-col gap-1">
      <div class="flex items-center gap-2">
        <span class="text-micro text-subtle">Аккаунты</span>
        <span class="tnum font-mono text-micro text-subtle">{{ profile.accounts.length }}</span>
        <span class="flex-1" />
        <UiButton v-if="canAddAccount" variant="ghost" :disabled="isBusy" @click="emit('link', profile)">
          <Icon name="mingcute:add-line" />
          Привязать
        </UiButton>
        <span
          v-else
          class="inline-flex items-center gap-1 rounded-sm border border-warning-border bg-warning-bg px-1.5 py-0.5 text-micro text-warning"
          :title="cannotLinkReason"
        >
          <Icon name="mingcute:lock-line" />
          {{ cannotLinkReason }}
        </span>
      </div>

      <p v-if="!profile.accounts.length" class="text-micro text-subtle">
        Не привязан ни один аккаунт.
      </p>

      <div
        v-for="acc in profile.accounts"
        :key="acc.id"
        class="group flex items-center gap-1.5 text-sm text-muted"
      >
        <Icon
          :name="acc.isPrimary ? 'mingcute:star-fill' : 'mingcute:user-3-line'"
          :class="acc.isPrimary ? 'text-warning' : 'text-subtle'"
          :title="acc.isPrimary ? 'Основной аккаунт' : undefined"
        />
        <span class="min-w-0 flex-1 truncate">
          {{ acc.displayName }}
          <span class="text-subtle">· {{ acc.platform }}</span>
        </span>
        <UiButton
          v-if="!acc.isPrimary && profile.accounts.length > 1"
          icon-only
          variant="ghost"
          class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          title="Сделать основным"
          aria-label="Сделать основным"
          :disabled="isBusy"
          @click="handleSetPrimary(acc.id)"
        >
          <Icon name="mingcute:star-line" />
        </UiButton>
        <UiButton
          icon-only
          variant="ghost"
          class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          title="Отвязать аккаунт"
          aria-label="Отвязать аккаунт"
          :disabled="isBusy"
          @click="removeTarget = { id: acc.id, displayName: acc.displayName, isPrimary: acc.isPrimary }"
        >
          <Icon name="mingcute:close-line" />
        </UiButton>
      </div>
    </div>

    <p v-if="profile.proxy" class="flex items-center gap-1.5 text-sm text-muted">
      <Icon name="mingcute:wifi-line" class="shrink-0 text-subtle" />
      <span class="truncate">
        {{ profile.proxy.label }}
        <span class="text-subtle">· {{ profile.proxy.type }} · {{ profile.proxy.status }}</span>
      </span>
    </p>

    <p
      v-if="startBlocked"
      role="alert"
      class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2 py-1.5 text-micro text-danger"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
      <span>{{ startBlocked }}</span>
    </p>

    <p class="flex items-center gap-1.5 text-micro text-subtle">
      <Icon name="mingcute:time-line" class="shrink-0" />
      Последняя сессия {{ lastSessionLabel }} · всего {{ profile.totalSessions }}
    </p>

    <div v-if="profile.tags.length" class="flex flex-wrap gap-1">
      <span
        v-for="t in profile.tags"
        :key="t"
        class="rounded-sm border border-divider px-1.5 text-micro text-subtle"
      >
        {{ t }}
      </span>
    </div>

    <p
      v-if="profile.lastSyncError"
      class="truncate text-micro text-danger"
      :title="profile.lastSyncError"
    >
      {{ profile.lastSyncError }}
    </p>

    <div v-if="startFlowState.step !== 'idle'" class="flex flex-col gap-1">
      <DeviceStartProgressStepper
        :state="startFlowState"
        size="sm"
        @cancel="cancelStartFlow"
        @error-detail="handleStartFlowErrorDetail"
      />
      <div
        v-if="startFlowState.step === 'running' || startFlowState.step === 'failed'"
        class="flex justify-end"
      >
        <UiButton variant="ghost" @click="resetStartFlow">Понятно</UiButton>
      </div>
    </div>

    <div class="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
      <UiButton
        v-if="profile.sessionState !== 'running' && startFlowState.step === 'idle' && profile.indigoId"
        :loading="isStarting"
        :disabled="Boolean(startBlocked)"
        title="Включить устройство — тарифицируется поминутно"
        @click="showStart = true"
      >
        <Icon v-if="!isStarting" name="mingcute:play-circle-line" />
        Включить
      </UiButton>
      <UiButton
        v-if="profile.indigoId"
        :loading="isStopping"
        title="Выключить устройство"
        @click="handleStop"
      >
        <Icon v-if="!isStopping" name="mingcute:pause-circle-line" />
        Выключить
      </UiButton>

      <DeviceCostWarning
        v-if="profile.indigoId && profile.sessionState !== 'running'"
        variant="inline"
      />

      <span class="flex-1" />

      <NuxtLink :to="`/devices/${profile.id}`">
        <UiButton variant="ghost">Подробнее</UiButton>
      </NuxtLink>
      <UiActionMenu :items="menuItems" @select="onMenuSelect" />
    </div>

    <p
      v-if="profile.sessionState === 'running'"
      role="status"
      class="-mx-3 -mb-3 mt-1 flex items-center gap-2 border-t border-success-border bg-success-bg px-3 py-1.5 text-micro text-success"
    >
      <Icon name="mingcute:play-circle-line" class="shrink-0" />
      Устройство работает
      <span class="ml-auto">тарифицируется — выключите после</span>
    </p>

    <p
      v-if="error"
      role="alert"
      class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2 py-1.5 text-micro text-danger"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
      <span>{{ error }}</span>
    </p>

    <UiModal :open="showStart" title="Включить устройство?" size="sm" @close="showStart = false">
      <p class="text-sm text-muted">
        Включённое устройство тарифицируется провайдером поминутно, пока его не выключат.
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="showStart = false">Отмена</UiButton>
        <UiButton variant="primary" :loading="isStarting" @click="handleStart">
          Включить · поминутно
        </UiButton>
      </template>
    </UiModal>

    <UiModal
      :open="Boolean(removeTarget)"
      title="Отвязать аккаунт от профиля?"
      size="sm"
      @close="removeTarget = null"
    >
      <p class="text-sm text-muted">{{ removeMessage }}</p>
      <template #footer>
        <UiButton variant="ghost" @click="removeTarget = null">Отмена</UiButton>
        <UiButton variant="danger" :disabled="removeBlocked" :loading="isBusy" @click="confirmRemoveAccount">
          Отвязать
        </UiButton>
      </template>
    </UiModal>

    <UiModal :open="showDelete" title="Удалить профиль устройства?" size="sm" @close="showDelete = false">
      <p class="text-sm text-muted">
        Профиль «{{ profile.name }}» будет удалён локально<template v-if="profile.indigoId">
          и, по возможности, в облаке</template>.
      </p>
      <p v-if="profile.accounts.length" class="mt-2 text-sm text-warning">
        Привязанные аккаунты ({{ profile.accounts.length }}) останутся в системе, но потеряют
        связь с профилем.
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="showDelete = false">Отмена</UiButton>
        <UiButton variant="danger" :loading="isBusy" @click="handleDelete">Удалить</UiButton>
      </template>
    </UiModal>

    <DeviceTestResultModal ref="testModalRef" />
  </article>
</template>
