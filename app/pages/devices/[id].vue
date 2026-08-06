<script setup lang="ts">
import type { DeviceProfileDto, DeviceTestPushResult } from '~~/shared/types/device-profile'

definePageMeta({
  layout: 'default',
  middleware: 'module-access',
  moduleSlug: 'social-upload',
})

const route = useRoute()
const id = computed(() => route.params.id as string)

// Автоматизация устройств — унаследованный контур: при выключенной зоне её API
// отдаёт 404, и это конфигурация, а не поломка.
const { legacyModules, loadLegacyModules } = useLegacyModules()
loadLegacyModules()
const zoneOff = computed(() => !legacyModules.value.deviceAutomation)

const { data, pending, error, refresh } = useFetch<{ data: DeviceProfileDto }>(
  () => `/api/device-profiles/${id.value}`,
  { watch: [id] },
)

const profile = computed(() => data.value?.data ?? null)
useHead({ title: () => (profile.value ? `${profile.value.name} — устройство` : 'Устройство') })

const toast = useToast()

const {
  stopProfile,
  deleteProfile,
  resyncProfile,
  testProfilePush,
  syncProfileState,
  isBusy,
  error: actionError,
  lastActionError,
} = useDeviceActions()

const {
  state: startFlowState,
  start: startFlow,
  cancel: cancelStartFlow,
  reset: resetStartFlow,
} = useDeviceStartFlow()

// ─── Опрос состояния ─────────────────────────────────────────────────────────
// Запущенный профиль опрашивается часто — меняется счётчик сессий и порт.
// Остановленный реже и через провайдера: оператор мог включить устройство мимо
// нашего интерфейса, и об этом надо узнать.
let pollTimer: ReturnType<typeof setInterval> | null = null

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function backgroundSync() {
  if (!id.value) return
  await syncProfileState(id.value)
  await refresh()
}

onMounted(() => {
  watch(() => profile.value?.sessionState, (state) => {
    stopPolling()
    if (zoneOff.value) return
    pollTimer = state === 'running'
      ? setInterval(refresh, 5000)
      : setInterval(backgroundSync, 30000)
  }, { immediate: true })

  let initialSyncDone = false
  watch(profile, async (p) => {
    if (p && !initialSyncDone) {
      initialSyncDone = true
      await backgroundSync()
    }
  })
})
onBeforeUnmount(stopPolling)

// ─── Модалки ─────────────────────────────────────────────────────────────────
const editModalRef = ref<{ open: (p?: DeviceProfileDto) => void }>()
const linkModalRef = ref<{ open: (p: DeviceProfileDto) => void }>()
const testModalRef = ref<{ open: (r: DeviceTestPushResult) => void } | null>(null)

const showStart = ref(false)
const showDelete = ref(false)

// ─── Действия ────────────────────────────────────────────────────────────────
const automation = ref(false)
const isStarting = ref(false)
const isStopping = ref(false)

async function handleStart() {
  if (!profile.value) return
  showStart.value = false
  isStarting.value = true
  try {
    await startFlow(profile.value.id, automation.value)
    if (startFlowState.value.step === 'running') await refresh()
  }
  finally {
    isStarting.value = false
  }
}

async function handleStop() {
  if (!profile.value) return
  isStopping.value = true
  try {
    const ok = await stopProfile(profile.value.id)
    // Состояние в базе меняется даже при неудаче на стороне провайдера,
    // поэтому перечитываем профиль в любом случае.
    await refresh()
    if (!ok && lastActionError.value) testModalRef.value?.open(lastActionError.value)
  }
  finally {
    isStopping.value = false
  }
}

async function handleResync() {
  if (!profile.value) return
  const res = await resyncProfile(profile.value.id)
  if (res) {
    toast.success(profile.value.indigoId ? 'Профиль перепушен в облако' : 'Профиль создан в облаке')
    await refresh()
  }
}

async function handleTest() {
  if (!profile.value) return
  const res = await testProfilePush(profile.value.id)
  if (res) testModalRef.value?.open(res)
}

async function handleDelete() {
  if (!profile.value) return
  if (await deleteProfile(profile.value.id)) {
    showDelete.value = false
    await navigateTo('/devices')
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

const canStart = computed(() =>
  Boolean(profile.value?.indigoId)
  && profile.value?.sessionState !== 'running'
  && startFlowState.value.step === 'idle')

const menuItems = computed(() => {
  const p = profile.value
  return [
    {
      key: 'resync',
      label: p?.indigoId ? 'Перепушить в облако' : 'Запушить в облако',
      icon: p?.indigoId ? 'mingcute:refresh-2-line' : 'mingcute:upload-line',
    },
    { key: 'test', label: 'Проверить связь', icon: 'mingcute:test-tube-line' },
    { key: 'edit', label: 'Редактировать', icon: 'mingcute:edit-line' },
    { key: 'delete', label: 'Удалить профиль', icon: 'mingcute:delete-2-line', danger: true },
  ]
})

function onMenuSelect(key: string) {
  if (key === 'resync') handleResync()
  if (key === 'test') handleTest()
  if (key === 'edit' && profile.value) editModalRef.value?.open(profile.value)
  if (key === 'delete') showDelete.value = true
}

// ─── Навигация по соседям ────────────────────────────────────────────────────
const { data: listData } = useDeviceProfiles()

// У /api/device-profiles нет постраничной выдачи — позиция считается по
// загруженному списку.
const siblings = computed(() => listData.value?.data?.map((p: { id: string }) => p.id) ?? [])
const currentIndex = computed(() => siblings.value.indexOf(id.value))
const inList = computed(() => currentIndex.value >= 0)

const hasPrev = computed(() => inList.value && currentIndex.value > 0)
const hasNext = computed(() => inList.value && currentIndex.value < siblings.value.length - 1)
const position = computed(() =>
  inList.value ? `${currentIndex.value + 1} из ${siblings.value.length}` : undefined)

async function goSibling(delta: -1 | 1) {
  const next = siblings.value[currentIndex.value + delta]
  if (next != null) await navigateTo(`/devices/${next}`)
}
</script>

<template>
  <div>
    <UiEmptyState
      v-if="zoneOff"
      variant="denied"
      title="Автоматизация устройств выключена"
      description="Зона относится к унаследованному контуру и включается флагом LEGACY_DEVICE_AUTOMATION_ENABLED в окружении. Пока флаг снят, API профилей отвечает 404."
    >
      <NuxtLink to="/devices">
        <UiButton>К списку устройств</UiButton>
      </NuxtLink>
    </UiEmptyState>

    <UiSkeleton v-else-if="pending && !profile" variant="details" :count="5" />

    <UiErrorState
      v-else-if="error"
      title="Не удалось загрузить профиль"
      :message="error.message"
      @retry="refresh"
    />

    <template v-else-if="profile">
      <DetailHeader
        :title="profile.name"
        :code="`dev_${profile.id.slice(0, 8)}`"
        back-to="/devices"
        back-label="К устройствам"
        :position="position"
        :has-prev="hasPrev"
        :has-next="hasNext"
        @prev="goSibling(-1)"
        @next="goSibling(1)"
      >
        <template #badges>
          <DeviceSyncStatusBadge :status="profile.syncStatus" :indigo-id="profile.indigoId" />
          <DeviceSessionStatusBadge :state="profile.sessionState" :port="profile.lastSessionPort" />
          <DeviceStatusBadge :status="profile.duoplus?.deviceStatus ?? null" size="xs" />
        </template>

        <template #actions>
          <UiButton
            v-if="canStart"
            variant="primary"
            :loading="isStarting"
            title="Включить устройство — тарифицируется поминутно"
            @click="showStart = true"
          >
            <Icon v-if="!isStarting" name="mingcute:play-circle-line" />
            Включить · поминутно
          </UiButton>
          <UiButton
            v-if="profile.indigoId"
            :loading="isStopping"
            :title="profile.sessionState === 'running'
              ? 'Выключить устройство и остановить тарификацию'
              : 'Выключить — синхронизирует состояние, если база разошлась с облаком'"
            @click="handleStop"
          >
            <Icon v-if="!isStopping" name="mingcute:pause-circle-line" />
            Выключить
          </UiButton>
          <DeviceWarmupForPostingButton
            v-if="profile.sessionState !== 'running' && startFlowState.step === 'idle'"
            :profile-id="profile.id"
            :pushed-to-cloud="Boolean(profile.indigoId)"
            :platform-type="profile.platformType"
            compact
            @warmed="refresh"
            @updated="refresh"
            @error-detail="(r: DeviceTestPushResult) => testModalRef?.open(r)"
          />
          <UiActionMenu :items="menuItems" @select="onMenuSelect" />
        </template>
      </DetailHeader>

      <div class="grid items-start gap-3.5 lg:grid-cols-2">
        <DeviceDetailStartPanel
          v-model:automation="automation"
          class="lg:col-span-2"
          :profile="profile"
          :flow-state="startFlowState"
          :error="actionError"
          @cancel="cancelStartFlow"
          @reset="resetStartFlow"
          @error-detail="handleStartFlowErrorDetail"
        />

        <DeviceDetailIdentity :profile="profile" />
        <DeviceDetailSessions :profile="profile" />
        <DeviceDetailProxy :profile="profile" />
        <DeviceDetailAdbStatus :profile="profile" />
        <DeviceDetailAccounts
          class="lg:col-span-2"
          :profile="profile"
          @updated="refresh"
          @link="linkModalRef?.open(profile)"
        />
        <DeviceDetailTagsNotes :profile="profile" @updated="refresh" />
        <DeviceDetailHardware :profile="profile" />
      </div>

      <DeviceProfileEditModal ref="editModalRef" @saved="refresh" />
      <DeviceProfileLinkModal ref="linkModalRef" @saved="refresh" />
      <DeviceTestResultModal ref="testModalRef" />

      <UiModal :open="showStart" title="Включить устройство?" size="sm" @close="showStart = false">
        <p class="text-sm text-muted">
          Включённое устройство тарифицируется провайдером поминутно, пока его не выключат.
          <template v-if="automation">Запуск пойдёт с автоматизацией — вернётся порт WebDriver.</template>
        </p>
        <template #footer>
          <UiButton variant="ghost" @click="showStart = false">Отмена</UiButton>
          <UiButton variant="primary" :loading="isStarting" @click="handleStart">
            Включить · поминутно
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
          связь с этим профилем.
        </p>
        <template #footer>
          <UiButton variant="ghost" @click="showDelete = false">Отмена</UiButton>
          <UiButton variant="danger" :loading="isBusy" @click="handleDelete">Удалить</UiButton>
        </template>
      </UiModal>
    </template>
  </div>
</template>
