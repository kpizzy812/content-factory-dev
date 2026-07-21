<script setup lang="ts">
import type { DeviceProfileDto } from "~~/shared/types/device-profile"

defineProps<{
  profile: DeviceProfileDto
}>()

const statusBadgeClass: Record<string, string> = {
  ok: "badge-success",
  warning: "badge-warning",
  failed: "badge-error",
  unknown: "badge-ghost",
}
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 gap-3">
      <h3 class="font-semibold flex items-center gap-2">
        <Icon name="mingcute:wifi-line" />
        Прокси
      </h3>

      <div v-if="!profile.proxy" role="alert" class="alert alert-warning alert-soft text-sm">
        <Icon name="mingcute:warning-line" />
        <span>Прокси не задан. Через "Редактировать" выберите proxy для этого профиля.</span>
      </div>

      <div v-else class="space-y-2">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-semibold">{{ profile.proxy.label }}</span>
          <span class="badge badge-soft badge-sm">{{ profile.proxy.type }}</span>
          <span
            class="badge badge-sm"
            :class="statusBadgeClass[profile.proxy.status] ?? 'badge-ghost'"
          >
            {{ profile.proxy.status }}
          </span>
          <span v-if="profile.proxy.expectedCountry" class="badge badge-outline badge-sm gap-1">
            <Icon name="mingcute:earth-line" class="text-xs" />
            {{ profile.proxy.expectedCountry }}
          </span>
        </div>

        <div class="flex items-center gap-2 flex-wrap">
          <NuxtLink
            :to="`/proxies`"
            class="btn btn-xs btn-ghost gap-1"
            :title="`Открыть proxy ${profile.proxy.label} в управлении`"
          >
            <Icon name="mingcute:external-link-line" />
            Открыть в /proxies
          </NuxtLink>
        </div>

        <div
          v-if="profile.proxyCountryGuard !== 'us_proxy_ok'"
          role="alert"
          class="alert alert-warning alert-soft text-xs"
        >
          <Icon name="mingcute:warning-line" />
          <span>
            <template v-if="profile.proxyCountryGuard === 'wrong_country'">
              Прокси помечен как {{ profile.proxy.expectedCountry }}. Привязка аккаунтов запрещена (защита от банов).
            </template>
            <template v-else-if="profile.proxyCountryGuard === 'unknown'">
              У прокси не задан expectedCountry. Установите "US" в /proxies для разрешения привязки.
            </template>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
