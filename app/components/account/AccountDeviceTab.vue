<script setup lang="ts">
import type { DeviceProfileDto } from "~~/shared/types/device-profile"
import {
  toDiagnosticError,
  type AccountDiagnosticError,
} from "~~/shared/types/account-diagnostic"

const props = defineProps<{
  accountId: number
  /**
   * Платформа аккаунта. Нужна для guard: YouTube требует desktop device-профиль
   * (studio.youtube.com работает только с desktop UA), mobile-профили (iOS/Android)
   * для YT отключаются в селекторе. Если не передана - guard выключен (legacy callers).
   */
  accountPlatform?: "tiktok" | "youtube" | "instagram"
}>()

const emit = defineEmits<{ updated: [] }>()

const editModalRef = ref<{ open: (p?: DeviceProfileDto) => void }>()

const { data, pending, error, refresh } = useFetch<{ data: DeviceProfileDto[] }>(
  "/api/device-profiles",
  {
    query: computed(() => ({ socialAccountId: props.accountId })),
    watch: [() => props.accountId],
  },
)

// 1:1:1: один аккаунт привязан максимум к одному device-профилю. API возвращает
// массив для backward compat, но при 1:1:1 в нём всегда 0 или 1 элемент.
const allMatchingProfiles = computed<DeviceProfileDto[]>(() => data.value?.data ?? [])
const profile = computed<DeviceProfileDto | null>(() => allMatchingProfiles.value[0] ?? null)

const { unlinkAccount, isBusy, error: actionError } = useDeviceActions()

// Structured 409/412 ошибки (profile_occupied / account_already_linked / no_proxy)
// рендерятся через AccountDiagnosticPanel — human/JSON toggle.
const diagnosticError = ref<AccountDiagnosticError | null>(null)

const showSelector = ref(false)
const { data: allProfilesData, pending: allPending } = useFetch<{
  data: DeviceProfileDto[]
}>("/api/device-profiles", { lazy: true, server: false })
// "Свободный" профиль = тот, у которого вообще нет linked accounts (после M.1
// multi-account профиль может не иметь socialAccountId но иметь accounts[]
// non-primary, что не делает его свободным). Используем accounts.length === 0
// чтобы legacy linkAccount endpoint не упирался в 409 "already linked".
const unlinkedProfiles = computed(() => {
  return (allProfilesData.value?.data ?? []).filter((p) => p.accounts.length === 0)
})

// YouTube требует desktop device-профиль (studio.youtube.com mobile-incompatible).
// Mobile-профили в селекторе показываем disabled с пометкой - оператор видит
// что они есть, но понимает что заведомо нерабочие. Backend guard в
// poster-runner.ts тоже блокирует postingJob для youtube+mobile_*.
function isProfileIncompatible(p: DeviceProfileDto): boolean {
  if (props.accountPlatform !== "youtube") return false
  return p.platformType === "mobile_ios" || p.platformType === "mobile_android"
}

const selectedProfileId = ref<string>("")

// Если уже привязанный профиль mobile + аккаунт YouTube - warning над карточкой.
const linkedProfileIncompatible = computed(() => {
  if (!profile.value) return false
  return isProfileIncompatible(profile.value)
})

const { linkAccount } = useDeviceActions()

async function linkExisting() {
  if (!selectedProfileId.value) return
  diagnosticError.value = null
  try {
    const result = await $fetch<{ data: DeviceProfileDto }>(
      `/api/device-profiles/${selectedProfileId.value}/accounts`,
      {
        method: "POST",
        body: { socialAccountId: props.accountId },
      },
    )
    if (result?.data) {
      showSelector.value = false
      selectedProfileId.value = ""
      await refresh()
      emit("updated")
    }
  } catch (e: unknown) {
    diagnosticError.value = toDiagnosticError(e, {
      phase: "device_link",
      url: `/api/device-profiles/${selectedProfileId.value}/accounts`,
    })
  }
}

async function createNew() {
  // Открываем edit-modal с предзаполненной привязкой через query state
  editModalRef.value?.open()
}

async function handleUnlink() {
  if (!profile.value) return
  if (!confirm("Отвязать профиль устройства от аккаунта?")) return
  await unlinkAccount(profile.value.id)
  await refresh()
  emit("updated")
}

async function onProfileSaved() {
  await refresh()
  emit("updated")
}
</script>

<template>
  <div class="space-y-3">
    <div role="alert" class="alert alert-info alert-soft text-sm">
      <Icon name="mingcute:information-line" />
      <span>
        Профиль устройства DuoPlus обеспечивает уникальный fingerprint. Модель 1:1:1 —
        один аккаунт = один профиль = один прокси. Защита от банов из-за общего fingerprint.
      </span>
    </div>

    <div v-if="pending" class="flex justify-center py-8">
      <span class="loading loading-spinner loading-md" />
    </div>

    <div v-else-if="error" role="alert" class="alert alert-error alert-soft">
      <Icon name="mingcute:warning-line" />
      <span>{{ error.message }}</span>
    </div>

    <!-- Уже привязан -->
    <div v-else-if="profile" class="space-y-2">
      <!-- A: warning над карточкой если привязан mobile-профиль к YouTube -->
      <div
        v-if="linkedProfileIncompatible"
        role="alert"
        class="alert alert-warning alert-soft text-sm"
      >
        <Icon name="mingcute:warning-line" />
        <div class="flex flex-col gap-1">
          <span class="font-semibold">
            YouTube требует desktop профиль устройства
          </span>
          <span class="text-xs opacity-90">
            Привязанный профиль mobile ({{ profile.platformType }}), studio.youtube.com работает
            только с desktop UA. Отвяжите профиль и создайте новый с platformType=desktop
            (Редактировать профиль устройства → Platform type → Desktop), либо постинг через нашу
            автоматизацию не сработает.
          </span>
        </div>
      </div>

      <div class="card card-border bg-base-100">
      <div class="card-body p-4 gap-2">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <h4 class="font-semibold">{{ profile.name }}</h4>
          <DeviceSyncStatusBadge :status="profile.syncStatus" :indigo-id="profile.indigoId" size="sm" />
        </div>

        <div class="text-sm space-y-1 text-base-content/70">
          <div v-if="profile.indigoId" class="font-mono text-xs truncate">
            {{ profile.indigoId }}
          </div>
          <div>
            <Icon name="mingcute:device-line" class="text-xs" />
            {{ profile.platformType }}
            <template v-if="profile.os">· {{ profile.os }}</template>
          </div>
          <div v-if="profile.proxy">
            <Icon name="mingcute:wifi-line" class="text-xs" />
            Прокси: {{ profile.proxy.label }} ({{ profile.proxy.status }})
          </div>
          <div>
            <Icon name="mingcute:time-line" class="text-xs" />
            Сессий: {{ profile.totalSessions }}
          </div>
        </div>

        <div class="card-actions justify-end mt-2 flex-wrap gap-1">
          <NuxtLink :to="`/devices`" class="btn btn-xs btn-ghost gap-1">
            <Icon name="mingcute:external-link-line" class="text-xs" />
            Открыть в браузере
          </NuxtLink>
          <button
            class="btn btn-xs btn-error btn-outline gap-1"
            :disabled="isBusy"
            @click="handleUnlink"
          >
            <Icon name="mingcute:link-2-fill" class="text-xs" />
            Отвязать
          </button>
        </div>

        <div
          v-if="actionError"
          role="alert"
          class="alert alert-error alert-soft text-xs"
        >
          <Icon name="mingcute:warning-line" />
          <span>{{ actionError }}</span>
        </div>
      </div>
      </div>
    </div>

    <!-- Не привязан -->
    <div v-else>
      <div v-if="!showSelector" class="flex flex-col gap-2">
        <button class="btn btn-sm btn-primary gap-1" @click="createNew">
          <Icon name="mingcute:add-line" />
          Создать новый профиль устройства
        </button>
        <button class="btn btn-sm btn-ghost gap-1" @click="showSelector = true">
          <Icon name="mingcute:link-line" />
          Привязать существующий
        </button>
      </div>

      <div v-else class="space-y-2">
        <!-- B: warning для YouTube аккаунта - объясняет почему mobile профили
             в селекторе disabled (избегает confusion "почему я не могу выбрать"). -->
        <div
          v-if="accountPlatform === 'youtube'"
          role="alert"
          class="alert alert-warning alert-soft text-xs"
        >
          <Icon name="mingcute:warning-line" />
          <span>
            YouTube требует desktop профиль устройства. Mobile-профили (iOS/Android)
            недоступны для выбора - studio.youtube.com не работает с mobile UA.
          </span>
        </div>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Свободный профиль устройства</legend>
          <div v-if="allPending" class="flex items-center gap-2 py-2">
            <span class="loading loading-spinner loading-sm" />
            <span class="text-sm">Загрузка...</span>
          </div>
          <select
            v-else
            v-model="selectedProfileId"
            class="select select-sm w-full"
          >
            <option value="">Выберите профиль</option>
            <option
              v-for="p in unlinkedProfiles"
              :key="p.id"
              :value="p.id"
              :disabled="isProfileIncompatible(p)"
            >
              {{ p.name }}
              <template v-if="p.indigoId">· synced</template>
              <template v-else>· local_only</template>
              <template v-if="isProfileIncompatible(p)">
                · {{ p.platformType }} (несовместим с YouTube)
              </template>
            </option>
          </select>
        </fieldset>

        <div
          v-if="actionError"
          role="alert"
          class="alert alert-error alert-soft text-xs"
        >
          <Icon name="mingcute:warning-line" />
          <span>{{ actionError }}</span>
        </div>

        <AccountDiagnosticPanel :error="diagnosticError" />

        <div class="flex justify-end gap-2">
          <button class="btn btn-sm btn-ghost" @click="showSelector = false">
            Отмена
          </button>
          <button
            class="btn btn-sm btn-primary"
            :disabled="isBusy || !selectedProfileId"
            @click="linkExisting"
          >
            <span v-if="isBusy" class="loading loading-spinner loading-xs" />
            Привязать
          </button>
        </div>
      </div>
    </div>

    <DeviceProfileEditModal ref="editModalRef" @saved="onProfileSaved" />
  </div>
</template>
