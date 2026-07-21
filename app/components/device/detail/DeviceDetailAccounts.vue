<script setup lang="ts">
import type { DeviceProfileDto } from "~~/shared/types/device-profile"

const props = defineProps<{
  profile: DeviceProfileDto
}>()

const emit = defineEmits<{
  updated: []
  link: []
}>()

const { removeAccount, setPrimaryAccount, isBusy } = useDeviceActions()

const canAddAccount = computed(() => props.profile.proxyCountryGuard === "us_proxy_ok")
const cannotLinkReason = computed(() => {
  switch (props.profile.proxyCountryGuard) {
    case "no_proxy": return "Сначала задайте прокси для профиля"
    case "wrong_country": return `Прокси не US (${props.profile.proxy?.expectedCountry ?? "?"}) — привязка запрещена`
    case "unknown": return "У прокси не задан expectedCountry — установите 'US' в /proxies"
    default: return ""
  }
})

async function handleSetPrimary(accountId: number) {
  const ok = await setPrimaryAccount(props.profile.id, accountId)
  if (ok) emit("updated")
}

async function handleRemove(accountId: number) {
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
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 gap-3">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <h3 class="font-semibold flex items-center gap-2">
          <Icon name="mingcute:user-3-line" />
          Привязанные аккаунты ({{ profile.accounts.length }})
        </h3>
        <div class="flex items-center gap-1.5">
          <button
            v-if="canAddAccount"
            class="btn btn-xs btn-primary btn-outline gap-1"
            :disabled="isBusy"
            @click="emit('link')"
          >
            <Icon name="mingcute:add-line" />
            Привязать аккаунт
          </button>
          <span
            v-else
            class="badge badge-warning gap-1"
            :title="cannotLinkReason"
          >
            <Icon name="mingcute:lock-line" class="text-xs" />
            Не US-proxy
          </span>
        </div>
      </div>

      <div v-if="profile.accounts.length === 0" class="text-sm text-base-content/60 italic flex items-center gap-2 py-4 justify-center">
        <Icon name="mingcute:user-x-line" class="text-lg" />
        <span>К профилю не привязан ни один аккаунт</span>
      </div>

      <ul v-else class="list bg-base-200/30 rounded-box">
        <li
          v-for="acc in profile.accounts"
          :key="acc.id"
          class="list-row items-center"
        >
          <Icon
            :name="acc.isPrimary ? 'mingcute:star-fill' : 'mingcute:user-3-line'"
            :class="acc.isPrimary ? 'text-warning text-lg' : 'text-base-content/60 text-lg'"
            :title="acc.isPrimary ? 'Primary account' : ''"
          />
          <div class="flex-1 min-w-0">
            <div class="font-semibold truncate">{{ acc.displayName }}</div>
            <div class="text-xs text-base-content/60 truncate">
              {{ acc.platform }}
              <span v-if="acc.appName">· {{ acc.appName }}</span>
              <span v-if="acc.status !== 'active'" class="ml-1 badge badge-xs badge-soft badge-warning">{{ acc.status }}</span>
              <span v-if="acc.warmupStatus && acc.warmupStatus !== 'warmed'" class="ml-1 badge badge-xs badge-ghost">
                warmup: {{ acc.warmupStatus }}
              </span>
            </div>
          </div>
          <div class="flex items-center gap-1">
            <button
              v-if="!acc.isPrimary && profile.accounts.length > 1"
              class="btn btn-xs btn-ghost gap-1"
              title="Сделать primary"
              :disabled="isBusy"
              @click="handleSetPrimary(acc.id)"
            >
              <Icon name="mingcute:star-line" />
              Primary
            </button>
            <button
              class="btn btn-xs btn-ghost btn-square text-error"
              :title="acc.isPrimary && profile.accounts.length > 1 ? 'Сначала переназначьте primary' : 'Отвязать'"
              :disabled="isBusy || (acc.isPrimary && profile.accounts.length > 1)"
              @click="handleRemove(acc.id)"
            >
              <Icon name="mingcute:close-line" />
            </button>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
