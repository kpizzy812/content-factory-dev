<script setup lang="ts">
/**
 * Готовность аккаунта к публикации через устройство: четыре проверки —
 * прокси, профиль устройства, работа прокси на устройстве и вход в платформу.
 *
 * Подпись под видео сюда не входит: она проверяется в момент создания задачи
 * постинга и зависит от ролика, а не от аккаунта.
 */
import type { PreflightAccount } from '~~/app/composables/useYoutubePreflight'
import { useAccountReadiness } from '~~/app/composables/useAccountReadiness'
import { useLoginCheck } from '~~/app/composables/useLoginCheck'
import type { AccountDeepCheckStatus } from '~~/shared/types/deep-proxy-check'
import type { DeviceProfileDto, DeviceTestPushResult } from '~~/shared/types/device-profile'

const props = defineProps<{ accountId: number }>()

const emit = defineEmits<{
  'open-create-modal': [accountId: number]
  /** Открыть список устройств, чтобы войти в аккаунт руками. */
  'open-indigo': []
}>()

const account = ref<PreflightAccount | null>(null)
const deepCheckStatus = ref<AccountDeepCheckStatus | null>(null)
const loading = ref(false)
const fetchError = ref<string | null>(null)

async function fetchAccount() {
  loading.value = true
  fetchError.value = null
  try {
    // Отдельного `GET /api/accounts/:id` нет, поэтому берём список и ищем в нём.
    const res = await $fetch<{ data: PreflightAccount[] }>('/api/accounts')
    const found = res.data.find(a => a.id === props.accountId)
    account.value = found ?? null
    if (!found) fetchError.value = `Аккаунт #${props.accountId} не найден`
  }
  catch (err: unknown) {
    const e = err as { data?: { message?: string }, message?: string }
    fetchError.value = e?.data?.message ?? e?.message ?? 'Не удалось загрузить аккаунт'
  }
  finally {
    loading.value = false
  }
}

// Профиль устройства нужен ради состояния сессии — в списке аккаунтов его нет.
const deviceProfile = ref<DeviceProfileDto | null>(null)

async function fetchDeviceProfile() {
  const id = account.value?.deviceProfileId
  if (!id) {
    deviceProfile.value = null
    return
  }
  try {
    const res = await $fetch<{ data: DeviceProfileDto }>(`/api/device-profiles/${id}`)
    deviceProfile.value = res.data
  }
  catch {
    deviceProfile.value = null
  }
}

async function fetchDeepCheckStatus() {
  try {
    const res = await $fetch<{ data: AccountDeepCheckStatus }>(
      `/api/accounts/${props.accountId}/deep-check-status`,
    )
    deepCheckStatus.value = res.data
  }
  catch {
    // Без статуса composable считает проверку по косвенному признаку.
    deepCheckStatus.value = null
  }
}

watch(() => props.accountId, async () => {
  await Promise.all([fetchAccount(), fetchDeepCheckStatus()])
  await fetchDeviceProfile()
}, { immediate: true })

const warmupErrorDetail = ref<DeviceTestPushResult | null>(null)

async function onWarmed() {
  warmupErrorDetail.value = null
  await fetchAccount()
  await fetchDeviceProfile()
}

const accountRef = computed<PreflightAccount | null>(() => account.value)
const deepCheckRef = computed<AccountDeepCheckStatus | null>(() => deepCheckStatus.value)
const { state } = useAccountReadiness(accountRef, deepCheckRef)

const historyModalRef = ref<{ open: (proxyId: string) => void }>()

function openHistory() {
  if (account.value?.proxyId) historyModalRef.value?.open(account.value.proxyId)
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
    const res = await $fetch<{ result: { verdict: { recommendation: string } } }>(
      `/api/accounts/${props.accountId}/deep-proxy-check`,
      { method: 'POST' },
    )
    deepCheckResult.value = res.result.verdict.recommendation
    await Promise.all([fetchAccount(), fetchDeepCheckStatus()])
  }
  catch (err: unknown) {
    const e = err as { data?: { message?: string }, message?: string }
    deepCheckResult.value = e?.data?.message ?? e?.message ?? 'Проверка не запустилась'
  }
  finally {
    deepCheckBusy.value = false
  }
}

const scoreTone = computed(() => {
  if (state.value.ready) return 'text-success'
  if (state.value.score >= 2) return 'text-warning'
  return 'text-danger'
})

const barTone = computed(() => {
  if (state.value.ready) return 'bg-success'
  if (state.value.score >= 2) return 'bg-warning'
  return 'bg-danger'
})

const progressPercent = computed(() =>
  state.value.total ? (state.value.score / state.value.total) * 100 : 0,
)
</script>

<template>
  <div class="flex flex-col gap-4">
    <UiSkeleton v-if="loading" variant="details" :count="4" />

    <UiErrorState v-else-if="fetchError" message="Не удалось загрузить аккаунт." :details="fetchError" @retry="fetchAccount" />

    <template v-else-if="account">
      <div class="flex items-center gap-4 rounded-md border border-border bg-card p-3">
        <div class="flex flex-col items-center gap-1">
          <span class="tnum text-2xl font-semibold" :class="scoreTone">
            {{ state.score }}/{{ state.total }}
          </span>
          <span class="h-1 w-16 overflow-hidden rounded-full bg-neutral-bg">
            <span class="block h-full" :class="barTone" :style="{ width: `${progressPercent}%` }" />
          </span>
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium">
            {{ state.ready ? 'Аккаунт готов публиковать' : 'Аккаунт не готов' }}
          </div>
          <p class="text-sm text-muted">
            {{ state.ready
              ? 'Все проверки пройдены — можно ставить задачу постинга.'
              : `Пройдено ${state.score} из ${state.total}. Ниже видно, что чинить.` }}
          </p>
        </div>
      </div>

      <ul class="overflow-hidden rounded-md border border-border">
        <li
          v-for="check in state.checks"
          :key="check.key"
          class="flex items-start gap-2.5 border-b border-divider bg-panel px-2.5 py-2 last:border-b-0"
        >
          <Icon
            :name="check.frozen
              ? 'mingcute:pause-circle-fill'
              : check.passed ? 'mingcute:check-circle-fill' : 'mingcute:close-circle-fill'"
            class="mt-0.5 shrink-0"
            :class="check.frozen ? 'text-subtle' : check.passed ? 'text-success' : 'text-danger'"
          />
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium">{{ check.label }}</div>
            <p v-if="check.detail" class="text-sm break-words text-muted">{{ check.detail }}</p>
          </div>

          <UiButton
            v-if="check.key === 'login' && !check.passed && !check.frozen"
            variant="ghost"
            :loading="loginCheckBusy"
            @click="runLoginCheck"
          >
            <Icon v-if="!loginCheckBusy" name="mingcute:refresh-3-line" />
            Проверить вход
          </UiButton>

          <div v-else-if="check.key === 'deep_check'" class="flex shrink-0 items-center gap-1">
            <UiButton
              v-if="!check.passed && !check.frozen"
              variant="ghost"
              :loading="deepCheckBusy"
              @click="runDeepCheck"
            >
              <Icon v-if="!deepCheckBusy" name="mingcute:shield-line" />
              Проверить прокси
            </UiButton>
            <UiButton v-if="account?.proxyId" variant="ghost" @click="openHistory">
              <Icon name="mingcute:history-line" />
              История
            </UiButton>
          </div>

          <div v-else-if="check.key === 'indigo'" class="flex shrink-0 items-center gap-1">
            <DeviceSessionStatusBadge
              v-if="deviceProfile"
              variant="warmup"
              size="xs"
              :state="deviceProfile.sessionState"
              :port="deviceProfile.lastSessionPort"
            />
            <DeviceWarmupForPostingButton
              v-if="account?.deviceProfileId"
              :profile-id="account.deviceProfileId"
              :pushed-to-cloud="Boolean(deviceProfile?.indigoId)"
              :platform-type="deviceProfile?.platformType ?? null"
              compact
              @warmed="onWarmed"
              @error-detail="(r: DeviceTestPushResult) => warmupErrorDetail = r"
            />
            <UiButton v-if="account?.deviceProfileId" variant="ghost" @click="emit('open-indigo')">
              <Icon name="mingcute:external-link-line" />
              Открыть
            </UiButton>
          </div>
        </li>
      </ul>

      <p v-if="deepCheckResult" class="flex gap-2 rounded-md border border-info-border bg-info-bg p-2.5 text-sm">
        <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
        <span class="whitespace-pre-wrap">{{ deepCheckResult }}</span>
      </p>

      <div v-if="warmupErrorDetail" class="flex flex-col gap-1.5 rounded-md border border-danger-border bg-danger-bg p-2.5 text-sm">
        <div class="flex items-center gap-2">
          <Icon name="mingcute:warning-line" class="shrink-0 text-danger" />
          <span class="min-w-0 flex-1 font-medium">Прогрев не удался: {{ warmupErrorDetail.error }}</span>
          <UiButton icon-only variant="ghost" aria-label="Скрыть" @click="warmupErrorDetail = null">
            <Icon name="mingcute:close-line" />
          </UiButton>
        </div>
        <pre
          v-if="warmupErrorDetail.responseBody"
          class="overflow-x-auto rounded-md border border-border bg-surface p-2 font-mono text-micro break-all whitespace-pre-wrap"
        >{{ JSON.stringify(warmupErrorDetail.responseBody, null, 2) }}</pre>
      </div>

      <p class="flex gap-2 rounded-md border border-border bg-card p-2.5 text-sm text-muted">
        <Icon name="mingcute:information-line" class="mt-0.5 shrink-0" />
        <span>
          Подпись под конкретным роликом проверяется при создании задачи постинга —
          готовность аккаунта от неё не зависит.
        </span>
      </p>

      <div
        v-if="state.ready"
        class="flex flex-wrap items-center gap-2 rounded-md border border-success-border bg-success-bg p-2.5"
      >
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium">Готов к публикации</div>
          <p class="text-sm text-muted">Технические проверки пройдены — можно ставить задачу.</p>
        </div>
        <UiButton variant="primary" @click="emit('open-create-modal', accountId)">
          <Icon name="mingcute:send-line" />
          Создать задачу
        </UiButton>
      </div>
    </template>

    <AccountDeepCheckHistoryModal ref="historyModalRef" />
  </div>
</template>
