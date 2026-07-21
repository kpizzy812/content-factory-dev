<script setup lang="ts">
import type { DeviceProfileDto } from "~~/shared/types/device-profile"

// Цикл M.5 — модалка multi-account link. Фильтрует уже привязанные accounts,
// показывает US-proxy баннер, делает POST /api/device-profiles/[id]/accounts.

interface SocialAccountSummary {
  id: number
  appId: number
  platform: string
  displayName: string
}

const emit = defineEmits<{ saved: [] }>()

const isOpen = ref(false)
const profile = ref<DeviceProfileDto | null>(null)
const selected = ref<number | "">("")
const makePrimary = ref(false)

const { addAccount, isBusy, error } = useDeviceActions()

const { data: accountsData, pending } = useFetch<{ data: SocialAccountSummary[] }>(
  "/api/accounts",
  { lazy: true, server: false },
)

// Скрываем уже привязанные к этому профилю аккаунты — повторный POST вернёт 409.
const availableAccounts = computed<SocialAccountSummary[]>(() => {
  const linkedIds = new Set((profile.value?.accounts ?? []).map((a) => a.id))
  return (accountsData.value?.data ?? []).filter((a) => !linkedIds.has(a.id))
})

const guardOk = computed(() => profile.value?.proxyCountryGuard === "us_proxy_ok")
const guardMessage = computed(() => {
  if (!profile.value) return ""
  switch (profile.value.proxyCountryGuard) {
    case "us_proxy_ok":
      return "Профиль с US-proxy — привязка разрешена."
    case "no_proxy":
      return "У профиля не задан прокси. Сначала задайте US-proxy."
    case "wrong_country":
      return `Прокси не US (${profile.value.proxy?.expectedCountry ?? "?"}). Привязка заблокирована.`
    case "unknown":
      return "У прокси не задан expectedCountry. Установите 'US' в /proxies перед привязкой."
    default:
      return ""
  }
})

function open(p: DeviceProfileDto) {
  profile.value = p
  selected.value = ""
  makePrimary.value = p.accounts.length === 0 // первый → автоматически primary
  isOpen.value = true
}

function close() {
  isOpen.value = false
}

defineExpose({ open, close })

async function submit() {
  if (!profile.value || !selected.value || !guardOk.value) return
  const result = await addAccount(profile.value.id, Number(selected.value), {
    isPrimary: makePrimary.value,
  })
  if (result) {
    emit("saved")
    close()
  }
}
</script>

<template>
  <dialog class="modal" :class="{ 'modal-open': isOpen }">
    <div class="modal-box">
      <h3 class="text-lg font-bold mb-3">Привязать аккаунт к профилю</h3>

      <p v-if="profile" class="text-sm text-base-content/70 mb-3">
        Профиль:
        <span class="font-semibold">{{ profile.name }}</span>
        <span v-if="profile.accounts.length > 0" class="opacity-70 ml-2">
          (уже привязано: {{ profile.accounts.length }})
        </span>
      </p>

      <div
        v-if="profile"
        role="alert"
        class="alert alert-soft text-sm mb-3"
        :class="guardOk ? 'alert-success' : 'alert-error'"
      >
        <Icon
          :name="guardOk ? 'mingcute:check-circle-line' : 'mingcute:warning-line'"
        />
        <span>{{ guardMessage }}</span>
      </div>

      <fieldset class="fieldset" :disabled="!guardOk">
        <legend class="fieldset-legend">Социальный аккаунт *</legend>
        <div v-if="pending" class="flex items-center gap-2 py-2">
          <span class="loading loading-spinner loading-sm" />
          <span class="text-sm">Загрузка...</span>
        </div>
        <select v-else v-model="selected" class="select select-sm w-full">
          <option value="">Выберите аккаунт</option>
          <option v-for="a in availableAccounts" :key="a.id" :value="a.id">
            {{ a.displayName }} · {{ a.platform }}
          </option>
        </select>
        <p
          v-if="!pending && availableAccounts.length === 0 && guardOk"
          class="fieldset-label text-xs"
        >
          Все доступные аккаунты уже привязаны.
        </p>
      </fieldset>

      <fieldset v-if="guardOk && profile && profile.accounts.length > 0" class="fieldset">
        <label class="label cursor-pointer gap-2 justify-start">
          <input v-model="makePrimary" type="checkbox" class="checkbox checkbox-sm" />
          <span class="label-text text-sm">Сделать primary</span>
        </label>
        <p class="fieldset-label text-xs">
          Primary дублируется в SocialAccount.deviceProfileId — используется для legacy
          warmup/upload dispatch. При смене primary текущий primary становится обычным.
        </p>
      </fieldset>

      <div v-if="error" role="alert" class="alert alert-error alert-soft text-sm mt-3">
        <Icon name="mingcute:warning-line" />
        <span>{{ error }}</span>
      </div>

      <div class="modal-action">
        <button class="btn btn-sm" :disabled="isBusy" @click="close">Отмена</button>
        <button
          class="btn btn-sm btn-primary"
          :disabled="isBusy || !selected || !guardOk"
          @click="submit"
        >
          <span v-if="isBusy" class="loading loading-spinner loading-xs" />
          Привязать
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="close">close</button>
    </form>
  </dialog>
</template>
