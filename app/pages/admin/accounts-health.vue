<script setup lang="ts">
definePageMeta({ middleware: ['admin-access'] })
useHead({ title: 'Здоровье аккаунтов' })

const { data, pending, error, refresh } = useAccountsHealth()
const dashboard = computed(() => data.value?.data ?? null)

const accountEditModalRef = ref<{
  open: (payload: {
    id: number
    displayName: string
    proxyId: string | null
    platform?: 'tiktok' | 'youtube' | 'instagram'
  }) => void
}>()

function onEdit(payload: {
  id: number
  displayName: string
  proxyId: string | null
  platform: 'tiktok' | 'youtube' | 'instagram'
}) {
  accountEditModalRef.value?.open(payload)
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-semibold">Здоровье аккаунтов</h1>
      <span v-if="dashboard" class="tnum text-sm text-subtle">{{ dashboard.summary.total }}</span>
      <span class="flex-1" />
      <UiButton :loading="pending" @click="refresh()">
        <Icon v-if="!pending" name="mingcute:refresh-3-line" />
        Обновить
      </UiButton>
    </div>

    <UiSkeleton v-if="pending && !dashboard" variant="table" :count="8" />

    <UiErrorState
      v-else-if="error"
      message="Не удалось загрузить состояние аккаунтов."
      :details="error.message"
      @retry="refresh()"
    />

    <template v-else-if="dashboard">
      <AdminAccountsHealthSummary :summary="dashboard.summary" />

      <AdminAccountsHealthByPlatform :by-platform="dashboard.byPlatform" />

      <div class="flex min-w-0 flex-col gap-2">
        <h2 class="text-micro tracking-[.06em] text-subtle uppercase">
          Аккаунты по убыванию проблем
        </h2>
        <AdminAccountsHealthTable :accounts="dashboard.accounts" @edit="onEdit" />
      </div>

      <p class="text-micro text-subtle">
        Строка открывает настройку аккаунта. Прогрев и двухфакторная проверка видны
        только здесь: в списке аккаунтов этих полей нет.
      </p>
    </template>

    <AccountEditModal ref="accountEditModalRef" @updated="refresh()" />
  </div>
</template>
