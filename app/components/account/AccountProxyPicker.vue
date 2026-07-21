<script setup lang="ts">
import type { ProxyDto } from "~~/shared/types/proxy"
import type { DeepProxyCheckResult } from "~~/shared/types/deep-proxy-check"

const props = defineProps<{
  accountId: number
  currentProxyId: string | null
}>()

const emit = defineEmits<{
  saved: [proxyId: string | null]
}>()

const { setProxy, isBusy, error } = useAccountCredentials()
const { data: proxiesData, pending } = useFetch<{ data: ProxyDto[] }>(
  "/api/proxies",
)

const proxies = computed<ProxyDto[]>(() => proxiesData.value?.data ?? [])

const selected = ref<string>(props.currentProxyId ?? "")
const success = ref(false)

watch(
  () => props.currentProxyId,
  (val) => {
    selected.value = val ?? ""
  },
)

const selectedProxy = computed(() =>
  proxies.value.find((p) => p.id === selected.value),
)

async function save() {
  success.value = false
  const ok = await setProxy(props.accountId, selected.value || null)
  if (ok) {
    success.value = true
    emit("saved", selected.value || null)
  }
}

// === Deep Proxy Check (Уровень C) ===

interface CredentialsMetaResponse {
  data: { hasDeviceProfile: boolean; postingMethod: "api" | "browser_automation" }
}

const { data: metaData, refresh: refreshMeta } = useFetch<CredentialsMetaResponse>(
  () => `/api/accounts/${props.accountId}/credentials-meta`,
)
const hasDeviceProfile = computed(() =>
  Boolean(metaData.value?.data?.hasDeviceProfile),
)
const isBrowserAutomation = computed(
  () => metaData.value?.data?.postingMethod === "browser_automation",
)

// === 1:1:1 occupancy warning (PR4) ===
// Для browser_automation-аккаунта: проверяем, не занят ли выбранный прокси
// другим таким же аккаунтом (правило 1 прокси ↔ 1 browser_automation-аккаунт).
interface ProxyOccupancyResponse {
  data: {
    proxy: { occupied: boolean; occupiedBy: { accountId: number; displayName: string } | null } | null
  }
}

const proxyOccupiedBy = ref<{ accountId: number; displayName: string } | null>(null)

watch(
  [selected, isBrowserAutomation],
  async ([proxyId, isBA]) => {
    proxyOccupiedBy.value = null
    if (!isBA || !proxyId) return
    try {
      const res = await $fetch<ProxyOccupancyResponse>("/api/accounts/proxy-occupancy", {
        query: { proxyId, excludeAccountId: props.accountId },
      })
      if (res?.data?.proxy?.occupied) {
        proxyOccupiedBy.value = res.data.proxy.occupiedBy
      }
    }
    catch {
      // Warning best-effort: при ошибке проверки не блокируем UI.
      proxyOccupiedBy.value = null
    }
  },
  { immediate: true },
)

const isDeepChecking = ref(false)
const deepResult = ref<DeepProxyCheckResult | null>(null)
const deepError = ref<string | null>(null)
const deepErrorCode = ref<string | null>(null)
const deepProgress = ref("Запускаю устройство…")
let progressTimer: ReturnType<typeof setInterval> | null = null
const isForceStopping = ref(false)
const forceStopMessage = ref<string | null>(null)

const canDeepCheck = computed(
  () => Boolean(props.currentProxyId) && hasDeviceProfile.value && !isDeepChecking.value,
)

const deepCheckDisabledReason = computed(() => {
  if (isDeepChecking.value) return "Проверка уже идёт"
  if (!props.currentProxyId) return "Сначала привяжите прокси и сохраните"
  if (!hasDeviceProfile.value) return "Сначала создайте device-профиль во вкладке Профиль"
  return undefined
})

const deepResultAlertClass = computed(() => {
  if (!deepResult.value) return ""
  if (deepResult.value.verdict.proxyActuallyWorking) return "alert-success"
  if (deepResult.value.result.isLeaking === true) return "alert-error"
  return "alert-warning"
})

const deepResultIcon = computed(() => {
  if (!deepResult.value) return "mingcute:information-line"
  if (deepResult.value.verdict.proxyActuallyWorking) return "mingcute:check-circle-line"
  if (deepResult.value.result.isLeaking === true) return "mingcute:warning-line"
  return "mingcute:alert-line"
})

function startProgressTimer() {
  const startedAt = Date.now()
  deepProgress.value = "Запускаю устройство…"
  progressTimer = setInterval(() => {
    const elapsedSec = Math.floor((Date.now() - startedAt) / 1000)
    if (elapsedSec < 10) deepProgress.value = `Запускаю устройство… (${elapsedSec}s)`
    else if (elapsedSec < 25) deepProgress.value = `Подключаюсь к устройству… (${elapsedSec}s)`
    else if (elapsedSec < 50) deepProgress.value = `Проверяю IP через ifconfig.me… (${elapsedSec}s)`
    else deepProgress.value = `Завершаю и останавливаю устройство… (${elapsedSec}s)`
  }, 1000)
}

function stopProgressTimer() {
  if (progressTimer) {
    clearInterval(progressTimer)
    progressTimer = null
  }
}

onUnmounted(() => stopProgressTimer())

async function runDeepCheck() {
  if (!canDeepCheck.value) return

  isDeepChecking.value = true
  deepResult.value = null
  deepError.value = null
  deepErrorCode.value = null
  forceStopMessage.value = null
  startProgressTimer()

  try {
    deepResult.value = await $fetch<DeepProxyCheckResult>(
      `/api/accounts/${props.accountId}/deep-proxy-check`,
      { method: "POST" },
    )
  }
  catch (err) {
    const fetchErr = err as {
      statusCode?: number
      data?: { message?: string; data?: { code?: string; deviceProfileId?: string } }
      message?: string
    }
    deepError.value =
      fetchErr.data?.message ?? fetchErr.message ?? "Ошибка запроса"
    deepErrorCode.value = fetchErr.data?.data?.code ?? null
  }
  finally {
    stopProgressTimer()
    isDeepChecking.value = false
  }
}

async function handleForceStop() {
  // R6 (миграция DuoPlus): эндпоинт force-stop удалён вместе с браузерной
  // launcher-функциональностью. Принудительная остановка сессии устройства
  // станет доступна под новым провайдером в Этапе 3. Пока — информируем оператора.
  forceStopMessage.value =
    "Принудительная остановка сессии недоступна до Этапа 3 миграции на новый провайдер."
}
</script>

<template>
  <div class="space-y-3">
    <div role="alert" class="alert alert-info alert-soft text-sm">
      <Icon name="mingcute:information-line" />
      <span v-if="isBrowserAutomation">
        Прокси нужен для безопасной публикации с уникального IP. Для
        browser_automation действует правило 1:1 — один прокси обслуживает
        ровно один аккаунт.
      </span>
      <span v-else>
        Прокси нужен для безопасной публикации с уникального IP. Один прокси может
        обслуживать несколько api-аккаунтов.
      </span>
    </div>

    <!-- 1:1:1 warning: выбранный прокси занят другим browser_automation-аккаунтом -->
    <div
      v-if="proxyOccupiedBy"
      role="alert"
      class="alert alert-warning alert-soft text-sm"
    >
      <Icon name="mingcute:warning-line" />
      <span>
        Этот прокси уже закреплён за browser_automation-аккаунтом
        #{{ proxyOccupiedBy.accountId }} «{{ proxyOccupiedBy.displayName }}».
        Сохранение будет отклонено (правило 1:1). Выберите другой прокси.
      </span>
    </div>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Прокси для аккаунта</legend>
      <div v-if="pending" class="flex items-center gap-2 py-2">
        <span class="loading loading-spinner loading-sm" />
        <span class="text-sm">Загрузка прокси...</span>
      </div>
      <select
        v-else
        v-model="selected"
        class="select select-sm w-full"
      >
        <option value="">Без прокси (прямое подключение)</option>
        <option v-for="p in proxies" :key="p.id" :value="p.id">
          {{ p.label }} · {{ p.type }} · {{ p.status }}
        </option>
      </select>
    </fieldset>

    <!-- Превью выбранного прокси -->
    <div
      v-if="selectedProxy"
      class="card card-border bg-base-100 card-sm"
    >
      <div class="card-body">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <span class="font-semibold text-sm">{{ selectedProxy.label }}</span>
          <ProxyHealthBadge :status="selectedProxy.status" size="sm" />
        </div>
        <div class="text-xs text-base-content/70 flex flex-wrap gap-3">
          <span>{{ selectedProxy.type }}</span>
          <span v-if="selectedProxy.expectedCountry">
            <Icon name="mingcute:location-line" class="text-xs" />
            {{ selectedProxy.expectedCountry }}
          </span>
          <span>Аккаунтов: {{ selectedProxy.attachedAccountsCount }}</span>
        </div>
      </div>
    </div>

    <div v-if="error" role="alert" class="alert alert-error alert-soft">
      <Icon name="mingcute:warning-line" />
      <span>{{ error }}</span>
    </div>

    <div v-if="success" role="alert" class="alert alert-success alert-soft">
      <Icon name="mingcute:check-circle-line" />
      <span>Прокси сохранён</span>
    </div>

    <div class="flex justify-between items-center gap-2 flex-wrap">
      <NuxtLink to="/proxies" class="link link-primary text-sm">
        <Icon name="mingcute:external-link-line" class="inline" />
        Открыть список прокси
      </NuxtLink>
      <div
        class="tooltip tooltip-left"
        :data-tip="proxyOccupiedBy
          ? `Прокси занят аккаунтом #${proxyOccupiedBy.accountId} «${proxyOccupiedBy.displayName}» (правило 1:1)`
          : undefined"
      >
        <button
          class="btn btn-primary btn-sm"
          :disabled="isBusy || pending || proxyOccupiedBy !== null"
          @click="save"
        >
          <span v-if="isBusy" class="loading loading-spinner loading-xs" />
          Сохранить
        </button>
      </div>
    </div>

    <!-- === Deep Proxy Check === -->
    <div class="divider text-xs">Глубокая проверка</div>

    <div class="card card-border bg-base-100 card-sm">
      <div class="card-body gap-2">
        <div class="flex items-start gap-2">
          <Icon
            name="mingcute:shield-line"
            class="text-warning text-lg mt-0.5"
          />
          <div class="flex-1">
            <div class="text-sm font-medium">
              Проверка через устройство DuoPlus
            </div>
            <p class="text-xs text-base-content/60">
              Запустит устройство DuoPlus с этим прокси, откроет ifconfig.me и
              проверит какой IP реально видит сайт. Занимает 30-90 сек.
            </p>
          </div>
        </div>

        <div class="flex justify-end">
          <button
            class="btn btn-soft btn-warning btn-sm gap-1"
            :disabled="!canDeepCheck"
            :title="deepCheckDisabledReason"
            @click="runDeepCheck"
          >
            <span v-if="isDeepChecking" class="loading loading-spinner loading-xs" />
            <Icon v-else name="mingcute:shield-line" class="text-sm" />
            <span class="truncate max-w-xs">
              {{ isDeepChecking ? deepProgress : 'Запустить deep check' }}
            </span>
          </button>
        </div>

        <!-- Active session conflict (409) -->
        <div
          v-if="deepError && deepErrorCode === 'active_session_exists'"
          role="alert"
          class="alert alert-warning alert-soft text-xs"
        >
          <Icon name="mingcute:alert-line" />
          <div class="flex-1">
            <div>{{ deepError }}</div>
            <div class="mt-2 flex gap-2 flex-wrap">
              <button
                class="btn btn-xs btn-warning"
                :disabled="isForceStopping"
                @click="handleForceStop"
              >
                <span v-if="isForceStopping" class="loading loading-spinner loading-xs" />
                <Icon v-else name="mingcute:stop-circle-line" />
                Остановить зависшую сессию
              </button>
            </div>
          </div>
        </div>

        <!-- Other errors -->
        <div
          v-else-if="deepError"
          role="alert"
          class="alert alert-error alert-soft text-xs"
        >
          <Icon name="mingcute:warning-line" />
          <span>{{ deepError }}</span>
        </div>

        <!-- Force stop feedback -->
        <div
          v-if="forceStopMessage"
          role="alert"
          class="alert alert-info alert-soft text-xs"
        >
          <Icon name="mingcute:information-line" />
          <span>{{ forceStopMessage }}</span>
        </div>

        <!-- Result -->
        <div v-if="deepResult" class="space-y-2">
          <div
            role="alert"
            class="alert alert-soft text-xs"
            :class="deepResultAlertClass"
          >
            <Icon :name="deepResultIcon" />
            <span>{{ deepResult.verdict.recommendation }}</span>
          </div>
          <details class="text-xs">
            <summary class="cursor-pointer text-base-content/70 select-none">
              Подробности (steps, durations, raw)
            </summary>
            <pre class="mt-2 p-2 bg-base-200 rounded text-[11px] whitespace-pre-wrap overflow-x-auto">{{ JSON.stringify(deepResult, null, 2) }}</pre>
          </details>
        </div>
      </div>
    </div>
  </div>
</template>
