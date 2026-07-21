<script setup lang="ts">
/**
 * Account-level readiness tab (6-й таб в AccountEditModal).
 *
 * Показывает 4-точечный чек-лист (proxy/indigo/deep-check signal/login) с
 * радиальным прогрессом и actionable buttons. Если 4/4 → success alert + кнопка
 * "Создать posting job".
 *
 * Caption — per-video, не входит в score аккаунта. Выводится отдельным info-блоком
 * с указанием что Caption проверяется при создании posting job.
 */
import type { PreflightAccount } from "~~/app/composables/useYoutubePreflight"
import { useAccountReadiness } from "~~/app/composables/useAccountReadiness"
import { useLoginCheck } from "~~/app/composables/useLoginCheck"
import type { AccountDeepCheckStatus } from "~~/shared/types/deep-proxy-check"
import type { DeviceProfileDto, DeviceTestPushResult } from "~~/shared/types/device-profile"

const props = defineProps<{
  accountId: number
}>()

const emit = defineEmits<{
  "open-create-modal": [accountId: number]
  /** Оператор хочет открыть Indigo X desktop профиль (для login вручную). */
  "open-indigo": []
}>()

interface AccountResponse {
  data: PreflightAccount[]
}

const account = ref<PreflightAccount | null>(null)
const deepCheckStatus = ref<AccountDeepCheckStatus | null>(null)
const loading = ref(false)
const fetchError = ref<string | null>(null)

async function fetchAccount() {
  loading.value = true
  fetchError.value = null
  try {
    // /api/accounts возвращает список — фильтруем по id. Отдельного /api/accounts/:id
    // GET нет (см. server/api/accounts/), поэтому минимальный лишний трафик в обмен
    // на ноль новых endpoint'ов.
    const res = await $fetch<AccountResponse>("/api/accounts")
    const found = res.data.find((a) => a.id === props.accountId)
    account.value = found ?? null
    if (!found) fetchError.value = `Аккаунт #${props.accountId} не найден`
  } catch (err: unknown) {
    const e = err as { data?: { message?: string }; message?: string }
    fetchError.value = e?.data?.message ?? e?.message ?? "Не удалось загрузить аккаунт"
  } finally {
    loading.value = false
  }
}

// One-shot загрузка профиля для warmup-бейджа/кнопки. PreflightAccount несёт
// только deviceProfileId (без sessionState/platformType), поэтому +1 fetch в табе.
const deviceProfile = ref<DeviceProfileDto | null>(null)

async function fetchIndigoProfile() {
  const id = account.value?.deviceProfileId
  if (!id) {
    deviceProfile.value = null
    return
  }
  try {
    const res = await $fetch<{ data: DeviceProfileDto }>(`/api/device-profiles/${id}`)
    deviceProfile.value = res.data
  } catch {
    // Best-effort — без профиля просто не показываем warmup-контролы.
    deviceProfile.value = null
  }
}

async function fetchDeepCheckStatus() {
  try {
    const res = await $fetch<{ data: AccountDeepCheckStatus }>(
      `/api/accounts/${props.accountId}/deep-check-status`,
    )
    deepCheckStatus.value = res.data
  } catch {
    // Best-effort — composable работает в legacy mode когда status=null
    deepCheckStatus.value = null
  }
}

watch(
  () => props.accountId,
  async () => {
    // fetchIndigoProfile зависит от account.deviceProfileId → после fetchAccount.
    await Promise.all([fetchAccount(), fetchDeepCheckStatus()])
    await fetchIndigoProfile()
  },
  { immediate: true },
)

// Детали ошибки прогрева — показываем в info-блоке (отдельной диагностической
// модалки в этом табе нет).
const warmupErrorDetail = ref<DeviceTestPushResult | null>(null)

async function onWarmed() {
  warmupErrorDetail.value = null
  // Перечитываем профиль (sessionState → running) и аккаунт (на случай изменений).
  // Последовательно: fetchIndigoProfile читает account.value?.deviceProfileId в
  // начале — при параллельном запуске мог бы прочитать устаревший account.
  await fetchAccount()
  await fetchIndigoProfile()
}

const accountRef = computed<PreflightAccount | null>(() => account.value)
const deepCheckRef = computed<AccountDeepCheckStatus | null>(() => deepCheckStatus.value)
const { state } = useAccountReadiness(accountRef, deepCheckRef)

const historyModalRef = ref<{ open: (proxyId: string) => void }>()

function openHistory() {
  if (account.value?.proxyId) {
    historyModalRef.value?.open(account.value.proxyId)
  }
}

const { runCheck, isBusy: loginCheckBusy } = useLoginCheck()

async function runLoginCheck() {
  await runCheck(props.accountId)
  await fetchAccount()
}

const deepCheckBusy = ref(false)
const deepCheckResult = ref<string | null>(null)

async function runDeepCheck() {
  deepCheckBusy.value = true
  deepCheckResult.value = null
  try {
    const res = await $fetch<{
      result: { verdict: { recommendation: string } }
      logId: string | null
    }>(
      `/api/accounts/${props.accountId}/deep-proxy-check`,
      { method: "POST" },
    )
    deepCheckResult.value = res.result.verdict.recommendation
    // Обновляем оба source — fetchAccount (на случай если статус прокси изменился),
    // fetchDeepCheckStatus (новый log должен попасть в state).
    await Promise.all([fetchAccount(), fetchDeepCheckStatus()])
  } catch (err: unknown) {
    const e = err as { data?: { message?: string }; message?: string }
    deepCheckResult.value =
      e?.data?.message ?? e?.message ?? "Deep-check не запустился"
  } finally {
    deepCheckBusy.value = false
  }
}

const progressClass = computed(() => {
  if (state.value.ready) return "text-success"
  if (state.value.score >= 2) return "text-warning"
  return "text-error"
})

const progressPercent = computed(() => (state.value.score / state.value.total) * 100)
</script>

<template>
  <div class="space-y-4">
    <div v-if="loading" class="flex justify-center py-4">
      <span class="loading loading-dots loading-md" />
    </div>

    <div v-else-if="fetchError" role="alert" class="alert alert-error alert-soft">
      <Icon name="mingcute:warning-line" class="text-sm shrink-0" />
      <span>{{ fetchError }}</span>
    </div>

    <template v-else-if="account">
      <!-- Radial progress + caption -->
      <div class="flex items-center gap-4">
        <div
          class="radial-progress"
          :class="progressClass"
          :style="{
            '--value': progressPercent,
            '--size': '5rem',
            '--thickness': '6px',
          }"
          role="progressbar"
        >
          <span class="text-lg font-bold">{{ state.score }}/{{ state.total }}</span>
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-medium text-sm">
            {{ state.ready ? "Аккаунт готов к публикации" : "Аккаунт не готов" }}
          </div>
          <div class="text-xs text-base-content/60 mt-0.5">
            {{
              state.ready
                ? "Все 4 проверки пройдены. Можно создавать posting job."
                : `Пройдено ${state.score} из ${state.total}. Исправьте красные пункты ниже.`
            }}
          </div>
        </div>
      </div>

      <!-- Checklist -->
      <ul class="menu menu-sm bg-base-200/30 rounded-box">
        <li
          v-for="check in state.checks"
          :key="check.key"
          class="border-b last:border-b-0 border-base-300/40"
        >
          <div class="flex items-start gap-2 py-2 hover:bg-transparent cursor-default">
            <Icon
              :name="check.frozen ? 'mingcute:pause-circle-fill' : check.passed ? 'mingcute:check-circle-fill' : 'mingcute:close-circle-fill'"
              class="text-base shrink-0 mt-0.5"
              :class="check.frozen ? 'text-base-content/40' : check.passed ? 'text-success' : 'text-error'"
            />
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium">{{ check.label }}</div>
              <div v-if="check.detail" class="text-xs text-base-content/60 mt-0.5 break-words">
                {{ check.detail }}
              </div>
            </div>
            <button
              v-if="check.key === 'login' && !check.passed && !check.frozen"
              type="button"
              class="btn btn-xs btn-ghost shrink-0"
              :disabled="loginCheckBusy"
              @click="runLoginCheck"
            >
              <span v-if="loginCheckBusy" class="loading loading-spinner loading-xs" />
              <Icon v-else name="mingcute:refresh-line" class="text-xs" />
              Login-check
            </button>
            <div
              v-else-if="check.key === 'deep_check'"
              class="flex items-center gap-1 shrink-0"
            >
              <button
                v-if="!check.passed && !check.frozen"
                type="button"
                class="btn btn-xs btn-ghost"
                :disabled="deepCheckBusy"
                @click="runDeepCheck"
              >
                <span
                  v-if="deepCheckBusy"
                  class="loading loading-spinner loading-xs"
                />
                <Icon v-else name="mingcute:safari-line" class="text-xs" />
                Deep-check
              </button>
              <button
                v-if="account?.proxyId"
                type="button"
                class="btn btn-xs btn-ghost"
                @click="openHistory"
              >
                <Icon name="mingcute:history-line" class="text-xs" />
                История
              </button>
            </div>
            <div
              v-else-if="check.key === 'indigo'"
              class="flex items-center gap-1 shrink-0"
            >
              <!-- Готовность для постинга: «Прогрет ✓» / «Не прогрет». -->
              <DeviceSessionStatusBadge
                v-if="deviceProfile"
                variant="warmup"
                size="sm"
                :state="deviceProfile.sessionState"
                :port="deviceProfile.lastSessionPort"
              />
              <!-- Прогрев на сервере — поднимает профиль заранее, чтобы постинг
                   не падал на загрузке ядра. Скрыта для mobile (selenium-транспорт). -->
              <DeviceWarmupForPostingButton
                v-if="account?.deviceProfileId"
                :profile-id="account.deviceProfileId"
                :pushed-to-cloud="Boolean(deviceProfile?.indigoId)"
                :platform-type="deviceProfile?.platformType ?? null"
                compact
                @warmed="onWarmed"
                @error-detail="(r: DeviceTestPushResult) => warmupErrorDetail = r"
              />
              <!-- Открыть desktop-профиль вручную (для логина руками). -->
              <button
                v-if="account?.deviceProfileId"
                type="button"
                class="btn btn-xs btn-ghost"
                @click="emit('open-indigo')"
              >
                <Icon name="mingcute:external-link-line" class="text-xs" />
                Открыть
              </button>
            </div>
          </div>
        </li>
      </ul>

      <div
        v-if="deepCheckResult"
        role="alert"
        class="alert alert-info alert-soft text-xs"
      >
        <Icon name="mingcute:information-line" class="text-sm shrink-0" />
        <span class="whitespace-pre-wrap">{{ deepCheckResult }}</span>
      </div>

      <!-- Детали ошибки прогрева (raw response от /start) — для саппорта. -->
      <div
        v-if="warmupErrorDetail"
        role="alert"
        class="alert alert-error alert-soft text-xs flex-col items-start"
      >
        <div class="flex items-center gap-1 font-medium">
          <Icon name="mingcute:warning-line" class="text-sm shrink-0" />
          <span>Прогрев не удался: {{ warmupErrorDetail.error }}</span>
          <button class="btn btn-xs btn-ghost ml-auto" @click="warmupErrorDetail = null">
            <Icon name="mingcute:close-line" class="text-xs" />
          </button>
        </div>
        <pre
          v-if="warmupErrorDetail.responseBody"
          class="mt-1 w-full whitespace-pre-wrap break-all bg-base-200/40 rounded p-2 overflow-x-auto"
        >{{ JSON.stringify(warmupErrorDetail.responseBody, null, 2) }}</pre>
      </div>

      <!-- Caption hint -->
      <div role="alert" class="alert alert-info alert-soft text-xs">
        <Icon name="mingcute:information-line" class="text-sm shrink-0" />
        <span>
          Caption для конкретного видео проверяется в момент создания posting job.
          Готовность аккаунта не зависит от caption.
        </span>
      </div>

      <!-- Action: create posting job -->
      <div v-if="state.ready" role="alert" class="alert alert-success alert-soft">
        <Icon name="mingcute:check-circle-line" class="text-sm shrink-0" />
        <div class="flex-1">
          <div class="text-sm font-medium">Готов к публикации</div>
          <div class="text-xs text-base-content/60 mt-0.5">
            Все технические проверки пройдены. Создайте задачу постинга.
          </div>
        </div>
        <button
          type="button"
          class="btn btn-sm btn-success"
          @click="emit('open-create-modal', accountId)"
        >
          <Icon name="mingcute:send-line" />
          Создать задачу
        </button>
      </div>
    </template>

    <DeepCheckHistoryModal ref="historyModalRef" />
  </div>
</template>
