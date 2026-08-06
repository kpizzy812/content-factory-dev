<script setup lang="ts">
/**
 * Прокси профиля.
 *
 * Проверка страны решает, можно ли привязывать аккаунты, поэтому её результат
 * объясняется словами, а не только цветом бейджа.
 */
import type { DeviceProfileDto } from '~~/shared/types/device-profile'
import { deviceProxyGuardMeta } from '../DeviceStatusMap'

const props = defineProps<{
  profile: DeviceProfileDto
}>()

const PROXY_STATUS_TONE: Record<string, string> = {
  ok: 'border-success-border bg-success-bg text-success',
  warning: 'border-warning-border bg-warning-bg text-warning',
  failed: 'border-danger-border bg-danger-bg text-danger',
  unknown: 'border-divider bg-card text-subtle',
}

const guardMeta = computed(() =>
  deviceProxyGuardMeta(props.profile.proxyCountryGuard, props.profile.proxy?.expectedCountry))
</script>

<template>
  <section class="flex flex-col gap-2.5 rounded-lg border border-border bg-panel p-3.5">
    <h2 class="text-micro tracking-[.06em] text-subtle uppercase">Прокси</h2>

    <p
      v-if="!profile.proxy"
      role="note"
      class="flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-sm text-warning"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
      <span>Прокси не задан — выберите его в «Редактировать».</span>
    </p>

    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-medium">{{ profile.proxy.label }}</span>
        <span class="rounded-sm border border-divider px-1.5 py-0.5 text-micro text-subtle">
          {{ profile.proxy.type }}
        </span>
        <span
          class="rounded-sm border px-1.5 py-0.5 text-micro"
          :class="PROXY_STATUS_TONE[profile.proxy.status] ?? PROXY_STATUS_TONE.unknown"
        >
          {{ profile.proxy.status }}
        </span>
        <DeviceBadge :meta="guardMeta" size="xs" />
      </div>

      <p
        v-if="profile.proxyCountryGuard !== 'us_proxy_ok'"
        role="note"
        class="flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-sm text-warning"
      >
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
        <span v-if="profile.proxyCountryGuard === 'wrong_country'">
          Прокси помечен как {{ profile.proxy.expectedCountry }} — привязка аккаунтов
          запрещена, это защита от банов.
        </span>
        <span v-else>
          У прокси не задана ожидаемая страна. Проставьте её в разделе «Прокси», иначе
          привязка аккаунтов не откроется.
        </span>
      </p>

      <NuxtLink to="/proxies" class="w-fit">
        <UiButton variant="ghost">
          Открыть в прокси
          <Icon name="mingcute:right-line" />
        </UiButton>
      </NuxtLink>
    </template>
  </section>
</template>
