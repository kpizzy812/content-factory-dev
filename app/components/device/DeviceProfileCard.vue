<script setup lang="ts">
import type { DeviceProfileDto } from "~~/shared/types/device-profile"

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

// Start flow с visible stepper (заменяет точечный startProfile + lastStartResult alert).
// CORE_DOWNLOADING_STARTED больше не error - визуальный шаг с polling каждые 5s.
const {
  state: startFlowState,
  start: startFlow,
  cancel: cancelStartFlow,
  reset: resetStartFlow,
} = useDeviceStartFlow()

const showDeleteConfirm = ref(false)
const isStarting = ref(false)
const isStopping = ref(false)
const isResyncing = ref(false)
const isTesting = ref(false)
const resyncToast = ref<{ kind: "success" | "error"; message: string } | null>(null)
const testModalRef = ref<{ open: (r: import("~~/shared/types/device-profile").DeviceTestPushResult) => void } | null>(null)

const platformLabels: Record<string, string> = {
  desktop: "Desktop",
  mobile_android: "Android",
  mobile_ios: "iOS",
}

// US-proxy guard (M.4) — UI решение можно ли показать "Привязать ещё".
// Server строго валидирует на POST /accounts тоже (412), но в UI блокируем заранее
// чтобы оператор не получал runtime 412 за каждый клик.
const canAddAccount = computed(() => props.profile.proxyCountryGuard === "us_proxy_ok")
const cannotLinkReason = computed(() => {
  switch (props.profile.proxyCountryGuard) {
    case "no_proxy":
      return "Сначала задайте прокси для профиля"
    case "wrong_country":
      return `Прокси не US (${props.profile.proxy?.expectedCountry ?? "?"}) — привязка запрещена`
    case "unknown":
      return "У прокси не задан expectedCountry — установите 'US' в /proxies"
    default:
      return ""
  }
})

const lastSessionLabel = computed(() => {
  if (props.profile.lastSessionStartedAt) {
    const d = new Date(props.profile.lastSessionStartedAt)
    return d.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }
  return "никогда"
})

async function handleStart() {
  // useDeviceStartFlow управляет stepper'ом и polling'ом - CORE_DOWNLOADING_STARTED
  // больше не error модалка, а normal шаг 'downloading_core' с auto-retry каждые 5s.
  isStarting.value = true
  try {
    await startFlow(props.profile.id, false)
    if (startFlowState.value.step === "running") {
      emit("updated")
    }
  } finally {
    isStarting.value = false
  }
}

async function handleStop() {
  isStopping.value = true
  try {
    const ok = await stopProfile(props.profile.id)
    resetStartFlow()
    // Эмитим updated ВСЕГДА: server-side stopProfile теперь обновляет БД
    // даже при launcher fail (см. client.ts:stopProfile). Без refetch
    // UI продолжал бы видеть профиль running и кнопка Stop оставалась бы
    // disabled - оператор не мог бы выйти из этого состояния.
    emit("updated")
    if (!ok && lastActionError.value) {
      testModalRef.value?.open(lastActionError.value)
    }
  } finally {
    isStopping.value = false
  }
}

function handleStartFlowErrorDetail() {
  const err = startFlowState.value.error
  if (!err) return
  testModalRef.value?.open({
    ok: false,
    status: 0,
    method: "start",
    url: "",
    requestBody: {},
    responseBody: err.indigoBody ?? null,
    error: err.message,
    phase: err.phase,
  })
}

async function handleRemoveAccount(accountId: number) {
  // Защита от случайного клика. confirm на primary последний оставшийся —
  // оператор должен понимать что профиль останется без primary.
  const account = props.profile.accounts.find((a) => a.id === accountId)
  if (!account) return
  const isLast = props.profile.accounts.length === 1
  const msg = account.isPrimary
    ? isLast
      ? `Отвязать primary-аккаунт "${account.displayName}"? Профиль останется без аккаунтов.`
      : `Отвязать primary "${account.displayName}"? Сначала переназначьте primary на другой.`
    : `Отвязать "${account.displayName}"?`
  if (!confirm(msg)) return
  const ok = await removeAccount(props.profile.id, accountId)
  if (ok) emit("updated")
}

async function handleSetPrimary(accountId: number) {
  const ok = await setPrimaryAccount(props.profile.id, accountId)
  if (ok) emit("updated")
}

async function handleResync() {
  isResyncing.value = true
  resyncToast.value = null
  try {
    const res = await resyncProfile(props.profile.id)
    if (res) {
      resyncToast.value = { kind: "success", message: "Профиль перепушен в облако" }
      emit("updated")
    } else {
      resyncToast.value = {
        kind: "error",
        message: error.value ?? "Не удалось запушить в облако",
      }
    }
  } finally {
    isResyncing.value = false
    setTimeout(() => {
      resyncToast.value = null
    }, 4000)
  }
}

async function handleTest() {
  isTesting.value = true
  try {
    const res = await testProfilePush(props.profile.id)
    if (res) {
      testModalRef.value?.open(res)
    }
  } finally {
    isTesting.value = false
  }
}

async function handleDelete() {
  const ok = await deleteProfile(props.profile.id)
  if (ok) {
    showDeleteConfirm.value = false
    emit("deleted")
  }
}
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 gap-3">
      <!-- Header -->
      <div class="flex items-start justify-between gap-2 flex-wrap">
        <div class="flex flex-col gap-1 min-w-0">
          <NuxtLink
            :to="`/devices/${profile.id}`"
            class="font-semibold text-base-content truncate hover:text-primary transition-colors"
            :title="`Открыть детали профиля ${profile.name}`"
          >
            {{ profile.name }}
          </NuxtLink>
          <span v-if="profile.indigoId" class="text-xs text-base-content/50 font-mono truncate">
            {{ profile.indigoId }}
          </span>
        </div>
        <div class="flex flex-col items-end gap-1">
          <DeviceSyncStatusBadge :status="profile.syncStatus" :indigo-id="profile.indigoId" size="sm" />
          <DeviceStatusBadge
            v-if="profile.duoplus"
            :status="profile.duoplus.deviceStatus"
            size="sm"
          />
          <DeviceSessionStatusBadge
            :state="profile.sessionState"
            :port="profile.lastSessionPort"
            size="sm"
          />
        </div>
      </div>

      <!-- Body -->
      <div class="flex flex-col gap-2 text-sm">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="badge badge-soft gap-1">
            <Icon name="mingcute:device-line" class="text-sm" />
            {{ platformLabels[profile.platformType] ?? profile.platformType }}
          </span>
          <span v-if="profile.os" class="badge badge-outline badge-sm">
            {{ profile.os }}
          </span>
          <span v-if="profile.timezone" class="badge badge-outline badge-sm">
            {{ profile.timezone }}
          </span>
        </div>

        <!-- Multi-account block (M.5). Список linked accounts с primary badge + actions -->
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between gap-1.5">
            <span class="text-xs text-base-content/60">
              Аккаунты ({{ profile.accounts.length }})
            </span>
            <button
              v-if="canAddAccount"
              class="btn btn-xs btn-ghost gap-1"
              title="Привязать ещё аккаунт"
              :disabled="isBusy"
              @click="emit('link', profile)"
            >
              <Icon name="mingcute:add-line" class="text-xs" />
              Привязать
            </button>
            <span
              v-else
              class="badge badge-warning badge-xs gap-1"
              :title="cannotLinkReason"
            >
              <Icon name="mingcute:lock-line" class="text-[10px]" />
              Не US-proxy
            </span>
          </div>

          <div
            v-if="profile.accounts.length === 0"
            class="text-base-content/50 italic text-xs flex items-center gap-1.5"
          >
            <Icon name="mingcute:user-x-line" class="text-sm" />
            <span>Не привязан к аккаунту</span>
          </div>

          <div v-else class="flex flex-col gap-1">
            <div
              v-for="acc in profile.accounts"
              :key="acc.id"
              class="flex items-center gap-1.5 text-sm text-base-content/70 group"
            >
              <Icon
                :name="acc.isPrimary ? 'mingcute:star-fill' : 'mingcute:user-3-line'"
                :class="acc.isPrimary ? 'text-warning text-sm' : 'text-sm'"
                :title="acc.isPrimary ? 'Primary account' : ''"
              />
              <span class="truncate flex-1">
                {{ acc.displayName }}
                <span class="opacity-60">· {{ acc.platform }}</span>
                <span v-if="acc.appName" class="opacity-60">({{ acc.appName }})</span>
              </span>
              <button
                v-if="!acc.isPrimary && profile.accounts.length > 1"
                class="btn btn-xs btn-ghost opacity-0 group-hover:opacity-100"
                title="Сделать primary"
                :disabled="isBusy"
                @click="handleSetPrimary(acc.id)"
              >
                <Icon name="mingcute:star-line" class="text-xs" />
              </button>
              <button
                class="btn btn-xs btn-ghost opacity-0 group-hover:opacity-100"
                :title="acc.isPrimary && profile.accounts.length > 1 ? 'Сначала переназначьте primary' : 'Отвязать'"
                :disabled="isBusy || (acc.isPrimary && profile.accounts.length > 1)"
                @click="handleRemoveAccount(acc.id)"
              >
                <Icon name="mingcute:close-line" class="text-xs" />
              </button>
            </div>
          </div>
        </div>

        <div v-if="profile.proxy" class="flex items-center gap-1.5 text-base-content/70">
          <Icon name="mingcute:wifi-line" class="text-sm" />
          <span class="truncate">
            {{ profile.proxy.label }}
            <span class="opacity-70">· {{ profile.proxy.type }} · {{ profile.proxy.status }}</span>
          </span>
        </div>

        <!-- Proxy gating: blocking badge (1:1:1 hard-block старта) -->
        <div
          v-if="!profile.proxyId"
          role="alert"
          class="alert alert-error alert-soft py-2 text-xs gap-2"
          title="Запуск устройства DuoPlus заблокирован до привязки прокси (защита от утечки реального IP)"
        >
          <Icon name="mingcute:warning-line" class="text-sm" />
          <span>Нет прокси — старт заблокирован</span>
        </div>
        <div
          v-else-if="profile.proxy && ['dead', 'expired'].includes(profile.proxy.status)"
          role="alert"
          class="alert alert-error alert-soft py-2 text-xs gap-2"
          :title="`Старт запрещён. Статус прокси: ${profile.proxy.status}`"
        >
          <Icon name="mingcute:warning-line" class="text-sm" />
          <span>Прокси {{ profile.proxy.status }} — старт заблокирован</span>
        </div>

        <div class="flex items-center gap-1.5 text-base-content/70">
          <Icon name="mingcute:time-line" class="text-sm" />
          <span>Сессия: {{ lastSessionLabel }} · всего: {{ profile.totalSessions }}</span>
        </div>

        <div
          v-if="profile.tags.length"
          class="flex items-center gap-1 flex-wrap text-xs"
        >
          <span
            v-for="t in profile.tags"
            :key="t"
            class="badge badge-ghost badge-xs"
          >
            {{ t }}
          </span>
        </div>

        <div
          v-if="profile.lastSyncError"
          class="text-xs text-error truncate"
          :title="profile.lastSyncError"
        >
          <Icon name="mingcute:warning-line" class="text-xs" />
          {{ profile.lastSyncError }}
        </div>

        <!-- Start flow progress (visible stepper compact) - заменяет точечный
             alert. CORE_DOWNLOADING_STARTED не error, а нормальный шаг с timer. -->
        <div v-if="startFlowState.step !== 'idle'" class="my-1">
          <DeviceStartProgressStepper
            :state="startFlowState"
            size="sm"
            @cancel="cancelStartFlow"
            @error-detail="handleStartFlowErrorDetail"
          />
          <div
            v-if="startFlowState.step === 'running' || startFlowState.step === 'failed'"
            class="mt-1 flex justify-end"
          >
            <button class="btn btn-xs btn-ghost" @click="resetStartFlow">ОК</button>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <!-- Start/Stop логика:
           - Start виден когда sessionState !== 'running'. Disabled без indigoId
             (local_only профиль нельзя запустить).
           - Stop виден всегда когда profile.indigoId есть, не только в running.
             Это recovery pathway: если БД desync'нулась с Indigo (профиль реально
             running но БД думает stopped), оператор всё равно может остановить.
             client.stopProfile catch'ит PROFILE_NOT_RUNNING-подобные ошибки и
             делает sync БД через update lastSessionEndedAt. -->
      <!-- ⚠️ Предупреждение о платности: включённое устройство DuoPlus
           тарифицируется поминутно. Показываем когда устройство можно включить. -->
      <div
        v-if="profile.indigoId && profile.sessionState !== 'running'"
        class="flex justify-end"
      >
        <DeviceCostWarning variant="inline" />
      </div>

      <div class="card-actions justify-end mt-2 flex-wrap gap-1">
        <!-- Start hidden если indigoId отсутствует (устройство не привязано к DuoPlus).
             Оператор увидит "Запушить" кнопку ниже. -->
        <button
          v-if="profile.sessionState !== 'running' && startFlowState.step === 'idle' && profile.indigoId"
          class="btn btn-xs btn-success btn-outline gap-1"
          :disabled="isStarting || isBusy"
          title="Включить устройство DuoPlus — платно, тарифицируется поминутно"
          @click="handleStart"
        >
          <span v-if="isStarting" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:play-circle-line" class="text-sm" />
          Включить
        </button>
        <button
          v-if="profile.indigoId"
          class="btn btn-xs btn-warning btn-outline gap-1"
          :disabled="isStopping || isBusy"
          :title="profile.sessionState === 'running' ? 'Выключить устройство (останавливает тарификацию)' : 'Выключить — синхронизация если БД рассинхронизирована'"
          @click="handleStop"
        >
          <span v-if="isStopping" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:pause-circle-line" class="text-sm" />
          Выключить
        </button>

        <button
          class="btn btn-xs btn-ghost gap-1"
          :disabled="isTesting || isBusy"
          title="Dry-run push в облако - покажет request/response без изменения локального state"
          @click="handleTest"
        >
          <span v-if="isTesting" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:test-tube-line" class="text-sm" />
          Тест
        </button>

        <!-- Re-sync / Push кнопка - всегда видима. Dynamic label:
             - indigoId есть → "Re-sync" (partial_update в Indigo)
             - indigoId null → "Запушить" (create в Indigo через тот же endpoint).
             resync.post.ts уже умеет оба случая. -->
        <button
          class="btn btn-xs btn-ghost gap-1"
          :disabled="isResyncing || isBusy"
          :title="profile.indigoId ? 'Перепушить актуальное состояние в облако' : 'Создать профиль в облаке (push local → remote)'"
          @click="handleResync"
        >
          <span v-if="isResyncing" class="loading loading-spinner loading-xs" />
          <Icon
            v-else
            :name="profile.indigoId ? 'mingcute:refresh-2-line' : 'mingcute:upload-line'"
            class="text-sm"
          />
          {{ profile.indigoId ? "Re-sync" : "Запушить" }}
        </button>

        <NuxtLink
          :to="`/devices/${profile.id}`"
          class="btn btn-xs btn-ghost gap-1"
          title="Открыть детали профиля"
        >
          <Icon name="mingcute:external-link-line" class="text-sm" />
          Подробнее
        </NuxtLink>

        <button
          class="btn btn-xs btn-ghost gap-1"
          @click="emit('edit', profile)"
        >
          <Icon name="mingcute:edit-line" class="text-sm" />
          Редактировать
        </button>

        <button
          class="btn btn-xs btn-error btn-outline gap-1"
          :disabled="isBusy"
          @click="showDeleteConfirm = true"
        >
          <Icon name="mingcute:delete-2-line" class="text-sm" />
          Удалить
        </button>
      </div>

      <div v-if="error" role="alert" class="alert alert-error alert-soft text-sm">
        <Icon name="mingcute:warning-line" />
        <span>{{ error }}</span>
      </div>
    </div>

    <!-- Persistent running indicator - full-width зеленая плашка снизу карточки
         когда профиль запущен. Не зависит от startFlowState (показывается даже
         после ОК клика на success stepper). -->
    <div
      v-if="profile.sessionState === 'running'"
      class="bg-success text-success-content px-4 py-2 flex items-center gap-2 text-xs font-semibold rounded-b-box"
    >
      <Icon name="mingcute:play-circle-fill" class="text-sm animate-pulse" />
      <span>Устройство работает</span>
      <Icon name="mingcute:wallet-line" class="text-sm ml-auto" />
      <span class="opacity-80 font-normal">тарифицируется — выключите после</span>
    </div>

    <div
      v-if="resyncToast"
      role="alert"
      class="alert alert-soft text-xs py-2 m-2"
      :class="resyncToast.kind === 'success' ? 'alert-success' : 'alert-error'"
    >
      <Icon
        :name="resyncToast.kind === 'success' ? 'mingcute:check-circle-line' : 'mingcute:warning-line'"
      />
      <span>{{ resyncToast.message }}</span>
    </div>

    <dialog class="modal" :class="{ 'modal-open': showDeleteConfirm }">
      <div class="modal-box">
        <h3 class="text-lg font-bold">Удалить профиль устройства?</h3>
        <p class="py-4 text-base-content/70">
          Профиль <strong>{{ profile.name }}</strong> будет удалён локально.
          <span v-if="profile.indigoId">
            Также будет удалён в облаке (best-effort).
          </span>
          <span v-if="profile.accounts.length > 0" class="block mt-2 text-warning">
            Привязанные аккаунты ({{ profile.accounts.length }}) останутся, но потеряют связь с этим профилем устройства.
          </span>
        </p>
        <div class="modal-action">
          <button class="btn btn-sm" @click="showDeleteConfirm = false">Отмена</button>
          <button
            class="btn btn-sm btn-error"
            :disabled="isBusy"
            @click="handleDelete"
          >
            <span v-if="isBusy" class="loading loading-spinner loading-xs" />
            Удалить
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="showDeleteConfirm = false">close</button>
      </form>
    </dialog>

    <DeviceTestResultModal ref="testModalRef" />
  </div>
</template>
