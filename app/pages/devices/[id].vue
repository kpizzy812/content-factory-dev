<script setup lang="ts">
import type { DeviceProfileDto, DeviceTestPushResult } from "~~/shared/types/device-profile"

definePageMeta({
  layout: "default",
  middleware: "module-access",
  moduleSlug: "social-upload",
})

const route = useRoute()
const router = useRouter()
const id = computed(() => route.params.id as string)

const { data, pending, error, refresh } = useFetch<{ data: DeviceProfileDto }>(
  () => `/api/device-profiles/${id.value}`,
  { watch: [id] },
)

const profile = computed(() => data.value?.data ?? null)
const { syncProfileState } = useDeviceActions()

useHead({ title: () => `DuoPlus: ${profile.value?.name ?? "..."}` })

// State-driven polling:
//   running: быстрый refresh (5s) - state stable, просто обновляем session info
//             (totalSessions, lastSessionStartedAt и т.д.)
//   stopped: медленный backgroundSync (30s) - probe provider info endpoint,
//             catches external start (когда оператор стартует через desktop
//             приложение провайдера или другое место в обход нашего UI).
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

// setInterval только в browser — иначе SSR падает с
// "[nuxt] setInterval should not be used on the server".
onMounted(() => {
  watch(
    () => profile.value?.sessionState,
    (state) => {
      stopPolling()
      if (state === "running") {
        pollTimer = setInterval(refresh, 5000)
      } else {
        pollTimer = setInterval(backgroundSync, 30000)
      }
    },
    { immediate: true },
  )

  // One-shot sync при первом mount profile - catches external start который
  // случился ДО открытия страницы (desktop-приложение провайдера и т.п.). Silent, без UI feedback.
  let initialSyncDone = false
  watch(profile, async (p) => {
    if (p && !initialSyncDone) {
      initialSyncDone = true
      await backgroundSync()
    }
  })
})
onBeforeUnmount(stopPolling)

// Modals
const editModalRef = ref<{ open: (p?: DeviceProfileDto) => void }>()
const linkModalRef = ref<{ open: (p: DeviceProfileDto) => void }>()
const testModalRef = ref<{ open: (r: DeviceTestPushResult) => void } | null>(null)

// Success alert после старта показывает сам DeviceStartProgressStepper
// (через useDeviceStartFlow) - parent page больше не дублирует это сообщение.
// onLaunched просто refresh профиля для обновления sessionState badge.

async function onUpdated() {
  await refresh()
}

function onEdit() {
  if (profile.value) editModalRef.value?.open(profile.value)
}

function onLink() {
  if (profile.value) linkModalRef.value?.open(profile.value)
}

function onDeleted() {
  // Профиль удалён — возвращаемся к списку.
  router.push("/devices")
}

function onTestResult(result: DeviceTestPushResult) {
  testModalRef.value?.open(result)
}

function onLaunched(_port: number | null) {
  refresh()
}

function goBack() {
  router.push("/devices")
}

</script>

<template>
  <div class="space-y-4">
    <div v-if="pending && !profile" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <div v-else-if="error" role="alert" class="alert alert-error">
      <Icon name="mingcute:warning-line" />
      <div>
        <h3 class="font-bold">Ошибка загрузки</h3>
        <p class="text-sm">{{ error.message }}</p>
      </div>
      <button class="btn btn-sm btn-ghost" @click="goBack">
        <Icon name="mingcute:left-line" />
        К списку
      </button>
    </div>

    <template v-else-if="profile">
      <DeviceDetailHeader :profile="profile" @back="goBack" />

      <DeviceDetailActions
        :profile="profile"
        @updated="onUpdated"
        @deleted="onDeleted"
        @edit="onEdit"
        @test-result="onTestResult"
        @launched="onLaunched"
      />

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DeviceDetailSessions :profile="profile" />
        <DeviceDetailProxy :profile="profile" />
        <DeviceDetailAccounts
          class="lg:col-span-2"
          :profile="profile"
          @updated="onUpdated"
          @link="onLink"
        />
        <DeviceDetailTagsNotes :profile="profile" @updated="onUpdated" />
        <DeviceDetailHardware :profile="profile" />
        <DeviceDetailAdbStatus :profile="profile" />
      </div>

      <DeviceProfileEditModal ref="editModalRef" @saved="onUpdated" />
      <DeviceProfileLinkModal ref="linkModalRef" @saved="onUpdated" />
      <DeviceTestResultModal ref="testModalRef" />
    </template>
  </div>
</template>
