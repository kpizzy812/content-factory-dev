<script setup lang="ts">
import type { ProxyDto } from '~~/shared/types/proxy'
import type { DeepProxyCheckResult } from '~~/shared/types/deep-proxy-check'

/**
 * Привязка прокси к аккаунту и глубокая проверка через устройство.
 * Обе части — унаследованный контур, вкладка живёт под флагом `LEGACY_PROXY_POOL_ENABLED`.
 */
const props = defineProps<{
  accountId: number
  currentProxyId: string | null
}>()

const emit = defineEmits<{ saved: [proxyId: string | null] }>()

const toast = useToast()
const { setProxy, isBusy, error } = useAccountCredentials()
const { data: proxiesData, pending, error: listError } = useFetch<{ data: ProxyDto[] }>('/api/proxies')

const proxies = computed<ProxyDto[]>(() => proxiesData.value?.data ?? [])

const selected = ref<string>(props.currentProxyId ?? '')

watch(() => props.currentProxyId, (val) => { selected.value = val ?? '' })

const selectedProxy = computed(() => proxies.value.find(p => p.id === selected.value))

const proxyOptions = computed(() => [
  { value: '', label: 'Без прокси — прямое подключение' },
  ...proxies.value.map(p => ({ value: p.id, label: `${p.label} · ${p.type} · ${p.status}` })),
])

async function save() {
  const ok = await setProxy(props.accountId, selected.value || null)
  if (ok) {
    toast.success(selected.value ? 'Прокси привязан' : 'Прокси отвязан')
    emit('saved', selected.value || null)
  }
}

interface CredentialsMetaResponse {
  data: { hasDeviceProfile: boolean, postingMethod: 'api' | 'browser_automation' }
}

const { data: metaData } = useFetch<CredentialsMetaResponse>(
  () => `/api/accounts/${props.accountId}/credentials-meta`,
)
const hasDeviceProfile = computed(() => Boolean(metaData.value?.data?.hasDeviceProfile))
const isBrowserAutomation = computed(() => metaData.value?.data?.postingMethod === 'browser_automation')

/**
 * Правило один прокси — один аккаунт с постингом через устройство. Сервер
 * отклонит сохранение, поэтому предупреждаем до нажатия, а не после.
 */
interface ProxyOccupancyResponse {
  data: {
    proxy: { occupied: boolean, occupiedBy: { accountId: number, displayName: string } | null } | null
  }
}

const proxyOccupiedBy = ref<{ accountId: number, displayName: string } | null>(null)

watch([selected, isBrowserAutomation], async ([proxyId, isBA]) => {
  proxyOccupiedBy.value = null
  if (!isBA || !proxyId) return
  try {
    const res = await $fetch<ProxyOccupancyResponse>('/api/accounts/proxy-occupancy', {
      query: { proxyId, excludeAccountId: props.accountId },
    })
    if (res?.data?.proxy?.occupied) proxyOccupiedBy.value = res.data.proxy.occupiedBy
  }
  catch {
    // Предупреждение необязательное: при сбое проверки не блокируем сохранение.
    proxyOccupiedBy.value = null
  }
}, { immediate: true })

const isDeepChecking = ref(false)
const deepResult = ref<DeepProxyCheckResult | null>(null)
const deepError = ref<string | null>(null)
const deepErrorCode = ref<string | null>(null)
const deepProgress = ref('Запускаю устройство…')
let progressTimer: ReturnType<typeof setInterval> | null = null
const forceStopMessage = ref<string | null>(null)

const canDeepCheck = computed(
  () => Boolean(props.currentProxyId) && hasDeviceProfile.value && !isDeepChecking.value,
)

const deepCheckDisabledReason = computed(() => {
  if (isDeepChecking.value) return 'Проверка уже идёт'
  if (!props.currentProxyId) return 'Сначала привяжите прокси и сохраните'
  if (!hasDeviceProfile.value) return 'Сначала создайте профиль устройства'
  return undefined
})

const deepResultTone = computed(() => {
  if (!deepResult.value) return ''
  if (deepResult.value.verdict.proxyActuallyWorking) return 'border-success-border bg-success-bg text-success'
  if (deepResult.value.result.isLeaking === true) return 'border-danger-border bg-danger-bg text-danger'
  return 'border-warning-border bg-warning-bg text-warning'
})

const deepResultIcon = computed(() => {
  if (!deepResult.value) return 'mingcute:information-line'
  if (deepResult.value.verdict.proxyActuallyWorking) return 'mingcute:check-circle-line'
  if (deepResult.value.result.isLeaking === true) return 'mingcute:warning-line'
  return 'mingcute:alert-line'
})

function startProgressTimer() {
  const startedAt = Date.now()
  deepProgress.value = 'Запускаю устройство…'
  progressTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000)
    if (elapsed < 10) deepProgress.value = `Запускаю устройство… ${elapsed} с`
    else if (elapsed < 25) deepProgress.value = `Подключаюсь к устройству… ${elapsed} с`
    else if (elapsed < 50) deepProgress.value = `Проверяю адрес через ifconfig.me… ${elapsed} с`
    else deepProgress.value = `Останавливаю устройство… ${elapsed} с`
  }, 1000)
}

function stopProgressTimer() {
  if (progressTimer) {
    clearInterval(progressTimer)
    progressTimer = null
  }
}

onUnmounted(stopProgressTimer)

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
      { method: 'POST' },
    )
  }
  catch (err) {
    const fetchErr = err as {
      data?: { message?: string, data?: { code?: string } }
      message?: string
    }
    deepError.value = fetchErr.data?.message ?? fetchErr.message ?? 'Проверка не выполнилась'
    deepErrorCode.value = fetchErr.data?.data?.code ?? null
  }
  finally {
    stopProgressTimer()
    isDeepChecking.value = false
  }
}

function handleForceStop() {
  // Эндпоинт принудительной остановки удалён вместе со старым лаунчером;
  // под новым провайдером он появится отдельно. Говорим прямо, а не молчим.
  forceStopMessage.value = 'Принудительная остановка сессии недоступна до перехода на новый провайдер устройств.'
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <p class="flex gap-2 rounded-md border border-info-border bg-info-bg p-2.5 text-sm">
      <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
      <span v-if="isBrowserAutomation">
        Прокси даёт публикации уникальный адрес. При постинге через устройство
        действует правило один к одному: прокси обслуживает ровно один аккаунт.
      </span>
      <span v-else>
        Прокси даёт публикации уникальный адрес. Один прокси может обслуживать
        несколько аккаунтов на официальном API.
      </span>
    </p>

    <p v-if="proxyOccupiedBy" class="flex gap-2 rounded-md border border-warning-border bg-warning-bg p-2.5 text-sm">
      <Icon name="mingcute:warning-line" class="mt-0.5 shrink-0 text-warning" />
      <span>
        Прокси уже закреплён за аккаунтом #{{ proxyOccupiedBy.accountId }}
        «{{ proxyOccupiedBy.displayName }}». Сервер отклонит сохранение — выберите другой.
      </span>
    </p>

    <p
      v-if="listError"
      class="flex items-center gap-2 rounded-md border border-danger-border bg-danger-bg p-2.5 text-sm text-danger"
    >
      <Icon name="mingcute:warning-line" class="shrink-0" />
      Список прокси не загрузился: {{ listError.message }}
    </p>

    <UiField v-else label="Прокси аккаунта">
      <UiSkeleton v-if="pending" variant="details" :count="1" />
      <UiSelect v-else v-model="selected" :options="proxyOptions" />
    </UiField>

    <div v-if="selectedProxy" class="flex flex-col gap-1.5 rounded-md border border-border bg-card p-2.5">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-sm font-medium">{{ selectedProxy.label }}</span>
        <ProxyHealthBadge :status="selectedProxy.status" size="xs" />
      </div>
      <div class="flex flex-wrap gap-3 text-micro text-muted">
        <span>{{ selectedProxy.type }}</span>
        <span v-if="selectedProxy.expectedCountry">{{ selectedProxy.expectedCountry }}</span>
        <span class="tnum">аккаунтов {{ selectedProxy.attachedAccountsCount }}</span>
      </div>
    </div>

    <p v-if="error" class="flex items-center gap-2 rounded-md border border-danger-border bg-danger-bg p-2.5 text-sm text-danger">
      <Icon name="mingcute:warning-line" class="shrink-0" />
      {{ error }}
    </p>

    <div class="flex flex-wrap items-center gap-2">
      <NuxtLink to="/proxies" class="flex items-center gap-1.5 text-sm">
        <Icon name="mingcute:external-link-line" />
        Открыть список прокси
      </NuxtLink>
      <span class="flex-1" />
      <UiButton
        variant="primary"
        :loading="isBusy"
        :disabled="pending || proxyOccupiedBy !== null"
        :title="proxyOccupiedBy
          ? `Прокси занят аккаунтом #${proxyOccupiedBy.accountId} «${proxyOccupiedBy.displayName}»`
          : undefined"
        @click="save"
      >
        Сохранить
      </UiButton>
    </div>

    <section class="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
      <div class="flex items-start gap-2">
        <Icon name="mingcute:shield-line" class="mt-0.5 shrink-0 text-warning" />
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium">Глубокая проверка через устройство</div>
          <p class="text-sm text-muted">
            Запустит устройство с этим прокси, откроет ifconfig.me и покажет, какой адрес
            реально видит сайт. Занимает от 30 до 90 секунд и тарифицируется поминутно.
          </p>
        </div>
      </div>

      <div class="flex justify-end">
        <UiButton
          :loading="isDeepChecking"
          :disabled="!canDeepCheck"
          :title="deepCheckDisabledReason"
          @click="runDeepCheck"
        >
          <Icon v-if="!isDeepChecking" name="mingcute:shield-line" />
          <span class="max-w-64 truncate">{{ isDeepChecking ? deepProgress : 'Запустить проверку' }}</span>
        </UiButton>
      </div>

      <div
        v-if="deepError && deepErrorCode === 'active_session_exists'"
        class="flex flex-col gap-2 rounded-md border border-warning-border bg-warning-bg p-2.5 text-sm"
      >
        <span class="flex gap-2">
          <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-warning" />
          {{ deepError }}
        </span>
        <UiButton class="w-fit" @click="handleForceStop">Остановить зависшую сессию</UiButton>
      </div>

      <p
        v-else-if="deepError"
        class="flex items-center gap-2 rounded-md border border-danger-border bg-danger-bg p-2.5 text-sm text-danger"
      >
        <Icon name="mingcute:warning-line" class="shrink-0" />
        {{ deepError }}
      </p>

      <p
        v-if="forceStopMessage"
        class="flex gap-2 rounded-md border border-info-border bg-info-bg p-2.5 text-sm"
      >
        <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
        {{ forceStopMessage }}
      </p>

      <div v-if="deepResult" class="flex flex-col gap-2">
        <p class="flex gap-2 rounded-md border p-2.5 text-sm" :class="deepResultTone">
          <Icon :name="deepResultIcon" class="mt-0.5 shrink-0" />
          {{ deepResult.verdict.recommendation }}
        </p>
        <UiDisclosure title="Подробности проверки" icon="mingcute:list-check-line">
          <pre class="overflow-x-auto rounded-md border border-border bg-surface p-2 font-mono text-micro whitespace-pre-wrap">{{ JSON.stringify(deepResult, null, 2) }}</pre>
        </UiDisclosure>
      </div>
    </section>
  </div>
</template>
