<script setup lang="ts">
/**
 * Аккаунты, привязанные к профилю.
 *
 * Привязка открыта только при прокси нужной страны — иначе вместо кнопки
 * объясняем, что именно мешает. Основной аккаунт нельзя отвязать, пока он
 * основной: сначала переназначить.
 */
import type { DeviceProfileDto } from '~~/shared/types/device-profile'

const props = defineProps<{
  profile: DeviceProfileDto
}>()

const emit = defineEmits<{
  updated: []
  link: []
}>()

const { removeAccount, setPrimaryAccount, isBusy } = useDeviceActions()

const canAddAccount = computed(() => props.profile.proxyCountryGuard === 'us_proxy_ok')
const cannotLinkReason = computed(() => {
  switch (props.profile.proxyCountryGuard) {
    case 'no_proxy': return 'Сначала задайте прокси профилю'
    case 'wrong_country': return `Прокси не US (${props.profile.proxy?.expectedCountry ?? '?'}) — привязка запрещена`
    case 'unknown': return 'У прокси не задана ожидаемая страна'
    default: return ''
  }
})

async function handleSetPrimary(accountId: number) {
  if (await setPrimaryAccount(props.profile.id, accountId)) emit('updated')
}

const removeTarget = ref<{ id: number, displayName: string, isPrimary: boolean } | null>(null)

const removeMessage = computed(() => {
  const acc = removeTarget.value
  if (!acc) return ''
  if (!acc.isPrimary) return `Аккаунт «${acc.displayName}» останется в системе, но потеряет связь с профилем.`
  return props.profile.accounts.length === 1
    ? `«${acc.displayName}» — основной и единственный. После отвязки профиль останется без аккаунтов.`
    : `«${acc.displayName}» — основной. Сначала назначьте основным другой аккаунт.`
})

const removeBlocked = computed(() =>
  Boolean(removeTarget.value?.isPrimary) && props.profile.accounts.length > 1)

async function confirmRemove() {
  const acc = removeTarget.value
  if (!acc || removeBlocked.value) return
  if (await removeAccount(props.profile.id, acc.id)) emit('updated')
  removeTarget.value = null
}
</script>

<template>
  <section class="flex flex-col gap-2.5 rounded-lg border border-border bg-panel p-3.5">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="text-micro tracking-[.06em] text-subtle uppercase">Аккаунты</h2>
      <span class="tnum font-mono text-micro text-subtle">{{ profile.accounts.length }}</span>
      <span class="flex-1" />
      <UiButton v-if="canAddAccount" :disabled="isBusy" @click="emit('link')">
        <Icon name="mingcute:add-line" />
        Привязать
      </UiButton>
      <span
        v-else
        class="inline-flex items-center gap-1.5 rounded-sm border border-warning-border bg-warning-bg px-2 py-0.5 text-micro text-warning"
        :title="cannotLinkReason"
      >
        <Icon name="mingcute:lock-line" />
        {{ cannotLinkReason }}
      </span>
    </div>

    <p v-if="!profile.accounts.length" class="py-2 text-center text-sm text-subtle">
      К профилю не привязан ни один аккаунт.
    </p>

    <div v-else class="flex flex-col">
      <div
        v-for="acc in profile.accounts"
        :key="acc.id"
        class="flex items-center gap-2.5 border-b border-divider py-2 last:border-b-0"
      >
        <Icon
          :name="acc.isPrimary ? 'mingcute:star-fill' : 'mingcute:user-3-line'"
          :class="acc.isPrimary ? 'text-warning' : 'text-subtle'"
          :title="acc.isPrimary ? 'Основной аккаунт' : undefined"
        />
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium">{{ acc.displayName }}</div>
          <div class="flex flex-wrap items-center gap-1.5 text-micro text-subtle">
            <span>{{ acc.platform }}</span>
            <span v-if="acc.appName">· {{ acc.appName }}</span>
            <span
              v-if="acc.status !== 'active'"
              class="rounded-sm border border-warning-border bg-warning-bg px-1.5 text-warning"
            >
              {{ acc.status }}
            </span>
            <span
              v-if="acc.warmupStatus && acc.warmupStatus !== 'warmed'"
              class="rounded-sm border border-divider px-1.5"
            >
              прогрев: {{ acc.warmupStatus }}
            </span>
          </div>
        </div>

        <UiButton
          v-if="!acc.isPrimary && profile.accounts.length > 1"
          variant="ghost"
          :disabled="isBusy"
          title="Сделать основным"
          @click="handleSetPrimary(acc.id)"
        >
          <Icon name="mingcute:star-line" />
          Основной
        </UiButton>
        <UiButton
          icon-only
          variant="ghost"
          :disabled="isBusy"
          title="Отвязать аккаунт"
          aria-label="Отвязать аккаунт"
          @click="removeTarget = { id: acc.id, displayName: acc.displayName, isPrimary: acc.isPrimary }"
        >
          <Icon name="mingcute:close-line" />
        </UiButton>
      </div>
    </div>

    <UiModal
      :open="Boolean(removeTarget)"
      title="Отвязать аккаунт от профиля?"
      size="sm"
      @close="removeTarget = null"
    >
      <p class="text-sm text-muted">{{ removeMessage }}</p>
      <template #footer>
        <UiButton variant="ghost" @click="removeTarget = null">Отмена</UiButton>
        <UiButton
          variant="danger"
          :disabled="removeBlocked"
          :loading="isBusy"
          @click="confirmRemove"
        >
          Отвязать
        </UiButton>
      </template>
    </UiModal>
  </section>
</template>
