<script setup lang="ts">
definePageMeta({ middleware: ["admin-access"] })
useHead({ title: "Здоровье аккаунтов" })

const { data, pending, error, refresh } = useAccountsHealth()
const dashboard = computed(() => data.value?.data ?? null)

const accountEditModalRef = ref<{
  open: (payload: {
    id: number
    displayName: string
    proxyId: string | null
    platform?: "tiktok" | "youtube" | "instagram"
  }) => void
}>()

function onEdit(payload: {
  id: number
  displayName: string
  proxyId: string | null
  platform: "tiktok" | "youtube" | "instagram"
}) {
  accountEditModalRef.value?.open(payload)
}

async function onAccountUpdated() {
  await refresh()
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between flex-wrap gap-3">
      <h1 class="text-2xl font-bold text-base-content">Здоровье аккаунтов</h1>
      <button
        class="btn btn-sm btn-ghost"
        :disabled="pending"
        @click="refresh()"
      >
        <Icon name="mingcute:refresh-2-line" />
        Обновить
      </button>
    </div>

    <SharedPageGuide
      guide-key="accounts-health"
      :title="pageGuides['accounts-health'].title"
      :steps="pageGuides['accounts-health'].steps"
      :tips="pageGuides['accounts-health'].tips"
    />

    <div v-if="pending" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <div v-else-if="error" role="alert" class="alert alert-error">
      <Icon name="mingcute:warning-line" />
      <span>Не удалось загрузить данные: {{ error.message }}</span>
    </div>

    <template v-else-if="dashboard">
      <AccountsHealthSummary :summary="dashboard.summary" />

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div class="lg:col-span-1">
          <AccountsHealthByPlatform :by-platform="dashboard.byPlatform" />
        </div>
        <div class="lg:col-span-2">
          <div class="card bg-base-100 shadow-sm">
            <div class="card-body p-4 gap-3">
              <h3 class="card-title text-sm">
                <Icon name="mingcute:list-check-line" />
                Аккаунты по убыванию проблем
              </h3>
              <AccountsHealthTable
                :accounts="dashboard.accounts"
                @edit="onEdit"
              />
            </div>
          </div>
        </div>
      </div>
    </template>

    <AccountEditModal ref="accountEditModalRef" @updated="onAccountUpdated" />
  </div>
</template>
