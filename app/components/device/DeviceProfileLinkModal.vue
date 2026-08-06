<script setup lang="ts">
/**
 * Привязка социального аккаунта к профилю устройства.
 *
 * Уже привязанные аккаунты в списке не показываются — повторная привязка
 * вернула бы конфликт. Проверка страны прокси стоит выше выбора: если она не
 * пройдена, привязывать нечего и объяснение важнее формы.
 */
import type { DeviceProfileDto } from '~~/shared/types/device-profile'

interface SocialAccountSummary {
  id: number
  appId: number
  platform: string
  displayName: string
}

const emit = defineEmits<{ saved: [] }>()

const isOpen = ref(false)
const profile = ref<DeviceProfileDto | null>(null)
const selected = ref<number | ''>('')
const makePrimary = ref(false)

const { addAccount, isBusy, error } = useDeviceActions()

const { data: accountsData, pending } = useFetch<{ data: SocialAccountSummary[] }>(
  '/api/accounts',
  { lazy: true, server: false },
)

const availableAccounts = computed<SocialAccountSummary[]>(() => {
  const linkedIds = new Set((profile.value?.accounts ?? []).map(a => a.id))
  return (accountsData.value?.data ?? []).filter(a => !linkedIds.has(a.id))
})

const guardOk = computed(() => profile.value?.proxyCountryGuard === 'us_proxy_ok')
const guardMessage = computed(() => {
  if (!profile.value) return ''
  switch (profile.value.proxyCountryGuard) {
    case 'us_proxy_ok': return 'Прокси US — привязка разрешена.'
    case 'no_proxy': return 'У профиля не задан прокси. Сначала задайте US-прокси.'
    case 'wrong_country': return `Прокси не US (${profile.value.proxy?.expectedCountry ?? '?'}) — привязка заблокирована.`
    case 'unknown': return 'У прокси не задана ожидаемая страна — проставьте её в разделе «Прокси».'
    default: return ''
  }
})

function open(p: DeviceProfileDto) {
  profile.value = p
  selected.value = ''
  // Первый аккаунт профиля всегда основной — выбирать не из чего.
  makePrimary.value = p.accounts.length === 0
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
    emit('saved')
    close()
  }
}
</script>

<template>
  <UiModal :open="isOpen" title="Привязать аккаунт к профилю" @close="close">
    <div class="flex flex-col gap-3">
      <p v-if="profile" class="text-sm text-muted">
        Профиль <span class="font-medium text-fg">{{ profile.name }}</span>
        <template v-if="profile.accounts.length">· уже привязано {{ profile.accounts.length }}</template>
      </p>

      <p
        v-if="profile"
        :role="guardOk ? 'note' : 'alert'"
        class="flex items-start gap-2 rounded-md border px-2.5 py-2 text-sm"
        :class="guardOk
          ? 'border-success-border bg-success-bg text-success'
          : 'border-danger-border bg-danger-bg text-danger'"
      >
        <Icon
          :name="guardOk ? 'mingcute:check-circle-line' : 'mingcute:alert-line'"
          class="mt-0.5 shrink-0"
        />
        <span>{{ guardMessage }}</span>
      </p>

      <UiField
        label="Социальный аккаунт"
        :hint="!pending && !availableAccounts.length && guardOk
          ? 'Все доступные аккаунты уже привязаны'
          : undefined"
      >
        <div v-if="pending" class="flex items-center gap-2 text-sm text-muted">
          <Icon name="mingcute:loading-line" class="animate-spin" />
          Загружаем аккаунты
        </div>
        <UiSelect
          v-else
          v-model="selected"
          :disabled="!guardOk"
          placeholder="Выберите аккаунт"
          :options="availableAccounts.map(a => ({ value: a.id, label: `${a.displayName} · ${a.platform}` }))"
        />
      </UiField>

      <UiField
        v-if="guardOk && profile && profile.accounts.length > 0"
        hint="Основной аккаунт используется унаследованным прогревом и загрузкой. Прежний основной станет обычным."
      >
        <UiCheckbox v-model="makePrimary" label="Сделать основным" />
      </UiField>

      <p
        v-if="error"
        role="alert"
        class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
      >
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
        <span>{{ error }}</span>
      </p>
    </div>

    <template #footer>
      <UiButton variant="ghost" :disabled="isBusy" @click="close">Отмена</UiButton>
      <UiButton
        variant="primary"
        :disabled="!selected || !guardOk"
        :loading="isBusy"
        @click="submit"
      >
        Привязать
      </UiButton>
    </template>
  </UiModal>
</template>
