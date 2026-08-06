<script setup lang="ts">
import type { DeviceProfileDto } from '~~/shared/types/device-profile'
import { toDiagnosticError, type AccountDiagnosticError } from '~~/shared/types/account-diagnostic'

/**
 * Профиль устройства аккаунта. Унаследованный контур: один аккаунт — один
 * профиль — один прокси.
 *
 * Отвязка спрашивала подтверждение через `confirm()`; теперь модалка, как во
 * всём остальном приложении.
 */
const props = defineProps<{
  accountId: number
  /**
   * Платформа аккаунта: YouTube работает только с desktop-профилем, мобильные
   * в списке остаются видимыми, но выбрать их нельзя.
   */
  accountPlatform?: 'tiktok' | 'youtube' | 'instagram'
}>()

const emit = defineEmits<{ updated: [] }>()

const editModalRef = ref<{ open: (p?: DeviceProfileDto) => void }>()
const unlinkRef = ref<{ open: () => void, close: () => void, setBusy: (v: boolean) => void }>()

const { data, pending, error, refresh } = useFetch<{ data: DeviceProfileDto[] }>(
  '/api/device-profiles',
  {
    query: computed(() => ({ socialAccountId: props.accountId })),
    watch: [() => props.accountId],
  },
)

// API отдаёт массив ради совместимости, но при правиле один-к-одному в нём
// всегда ноль или один элемент.
const profile = computed<DeviceProfileDto | null>(() => (data.value?.data ?? [])[0] ?? null)

const { unlinkAccount, isBusy, error: actionError } = useDeviceActions()

const diagnosticError = ref<AccountDiagnosticError | null>(null)

const showSelector = ref(false)
const { data: allProfilesData, pending: allPending } = useFetch<{ data: DeviceProfileDto[] }>(
  '/api/device-profiles',
  { lazy: true, server: false },
)

/** Свободный профиль — тот, к которому не привязан ни один аккаунт. */
const unlinkedProfiles = computed(
  () => (allProfilesData.value?.data ?? []).filter(p => p.accounts.length === 0),
)

function isProfileIncompatible(p: DeviceProfileDto): boolean {
  if (props.accountPlatform !== 'youtube') return false
  return p.platformType === 'mobile_ios' || p.platformType === 'mobile_android'
}

const selectedProfileId = ref<string>('')

const profileOptions = computed(() => [
  { value: '', label: 'Выберите профиль' },
  ...unlinkedProfiles.value.map(p => ({
    value: p.id,
    label: [
      p.name,
      p.indigoId ? 'синхронизирован' : 'только локальный',
      isProfileIncompatible(p) ? `${p.platformType} — не подходит для YouTube` : null,
    ].filter(Boolean).join(' · '),
  })),
])

const selectedIncompatible = computed(() => {
  const p = unlinkedProfiles.value.find(x => x.id === selectedProfileId.value)
  return p ? isProfileIncompatible(p) : false
})

const linkedProfileIncompatible = computed(
  () => (profile.value ? isProfileIncompatible(profile.value) : false),
)

async function linkExisting() {
  if (!selectedProfileId.value || selectedIncompatible.value) return
  diagnosticError.value = null
  try {
    const result = await $fetch<{ data: DeviceProfileDto }>(
      `/api/device-profiles/${selectedProfileId.value}/accounts`,
      { method: 'POST', body: { socialAccountId: props.accountId } },
    )
    if (result?.data) {
      showSelector.value = false
      selectedProfileId.value = ''
      await refresh()
      emit('updated')
    }
  }
  catch (e: unknown) {
    diagnosticError.value = toDiagnosticError(e, {
      phase: 'device_link',
      url: `/api/device-profiles/${selectedProfileId.value}/accounts`,
    })
  }
}

async function confirmUnlink() {
  if (!profile.value) return
  unlinkRef.value?.setBusy(true)
  await unlinkAccount(profile.value.id)
  unlinkRef.value?.setBusy(false)
  unlinkRef.value?.close()
  await refresh()
  emit('updated')
}

async function onProfileSaved() {
  await refresh()
  emit('updated')
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <p class="flex gap-2 rounded-md border border-info-border bg-info-bg p-2.5 text-sm">
      <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
      <span>
        Профиль устройства даёт аккаунту собственный отпечаток. Правило —
        один аккаунт, один профиль, один прокси.
      </span>
    </p>

    <UiSkeleton v-if="pending" variant="details" :count="3" />

    <UiErrorState
      v-else-if="error"
      message="Не удалось загрузить профиль устройства."
      :details="error.message"
      @retry="refresh()"
    />

    <template v-else-if="profile">
      <p v-if="linkedProfileIncompatible" class="flex gap-2 rounded-md border border-warning-border bg-warning-bg p-2.5 text-sm">
        <Icon name="mingcute:warning-line" class="mt-0.5 shrink-0 text-warning" />
        <span>
          <b>YouTube требует desktop-профиль.</b>
          Привязан мобильный ({{ profile.platformType }}), а studio.youtube.com не работает
          с мобильным браузером — публикация не пройдёт. Отвяжите и создайте desktop-профиль.
        </span>
      </p>

      <div class="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
        <div class="flex flex-wrap items-center gap-2">
          <h4 class="min-w-0 flex-1 truncate font-medium">{{ profile.name }}</h4>
          <DeviceSyncStatusBadge :status="profile.syncStatus" :indigo-id="profile.indigoId" size="xs" />
        </div>

        <UiKeyValue
          :items="[
            ...(profile.indigoId ? [{ label: 'Идентификатор', value: profile.indigoId }] : []),
            { label: 'Тип', value: [profile.platformType, profile.os].filter(Boolean).join(' · '), mono: false },
            ...(profile.proxy ? [{ label: 'Прокси', value: `${profile.proxy.label} · ${profile.proxy.status}`, mono: false }] : []),
            { label: 'Сессий', value: profile.totalSessions },
          ]"
          label-width="130px"
        />

        <div class="flex flex-wrap justify-end gap-2">
          <UiButton @click="navigateTo('/devices')">
            <Icon name="mingcute:external-link-line" />
            Открыть устройства
          </UiButton>
          <UiButton variant="danger" :disabled="isBusy" @click="unlinkRef?.open()">
            <Icon name="mingcute:unlink-line" />
            Отвязать
          </UiButton>
        </div>

        <p v-if="actionError" class="flex items-center gap-2 rounded-md border border-danger-border bg-danger-bg p-2 text-sm text-danger">
          <Icon name="mingcute:warning-line" class="shrink-0" />
          {{ actionError }}
        </p>
      </div>
    </template>

    <template v-else>
      <div v-if="!showSelector" class="flex flex-wrap gap-2">
        <UiButton variant="primary" @click="editModalRef?.open()">
          <Icon name="mingcute:add-line" />
          Создать профиль устройства
        </UiButton>
        <UiButton @click="showSelector = true">
          <Icon name="mingcute:link-line" />
          Привязать существующий
        </UiButton>
      </div>

      <div v-else class="flex flex-col gap-2.5">
        <p v-if="accountPlatform === 'youtube'" class="flex gap-2 rounded-md border border-warning-border bg-warning-bg p-2.5 text-sm">
          <Icon name="mingcute:warning-line" class="mt-0.5 shrink-0 text-warning" />
          <span>
            Для YouTube нужен desktop-профиль. Мобильные в списке помечены — выбрать их нельзя.
          </span>
        </p>

        <UiField label="Свободный профиль устройства">
          <UiSkeleton v-if="allPending" variant="details" :count="1" />
          <UiSelect v-else v-model="selectedProfileId" :options="profileOptions" />
        </UiField>

        <p v-if="actionError" class="flex items-center gap-2 rounded-md border border-danger-border bg-danger-bg p-2 text-sm text-danger">
          <Icon name="mingcute:warning-line" class="shrink-0" />
          {{ actionError }}
        </p>

        <AccountDiagnosticPanel :error="diagnosticError" />

        <div class="flex justify-end gap-2">
          <UiButton variant="ghost" @click="showSelector = false">Отмена</UiButton>
          <UiButton
            variant="primary"
            :loading="isBusy"
            :disabled="!selectedProfileId || selectedIncompatible"
            @click="linkExisting"
          >
            Привязать
          </UiButton>
        </div>
      </div>
    </template>

    <DeviceProfileEditModal ref="editModalRef" @saved="onProfileSaved" />

    <SharedConfirmModal
      ref="unlinkRef"
      title="Отвязать профиль устройства?"
      :message="profile
        ? `Профиль «${profile.name}» перестанет обслуживать этот аккаунт. Сам профиль останется на месте.`
        : ''"
      confirm-label="Отвязать"
      @confirm="confirmUnlink"
    />
  </div>
</template>
