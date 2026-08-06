<script setup lang="ts">
/**
 * Настройка аккаунта: доступы, прокси, устройство, прогрев, статистика, готовность.
 *
 * Вкладка устройства звалась `AccountIndigoTab`, а файл называется
 * `AccountDeviceTab.vue` — компонент молча не резолвился, и вкладка была пустой.
 * Вкладки унаследованного контура по-прежнему показываются только при
 * включённой зоне: без неё их API отдают 404.
 */
const emit = defineEmits<{
  updated: []
  close: []
  /** Сигнал странице открыть создание задачи постинга с уже выбранным аккаунтом. */
  'open-create-posting-job': [accountId: number]
}>()

const isOpen = ref(false)
const accountId = ref<number | null>(null)
const accountName = ref('')
const currentProxyId = ref<string | null>(null)
const accountPlatform = ref<'tiktok' | 'youtube' | 'instagram' | null>(null)

type TabKey = 'credentials' | 'proxy' | 'device' | 'warmup' | 'metrics' | 'readiness'
const activeTab = ref<TabKey>('credentials')

const { legacyModules, loadLegacyModules } = useLegacyModules()
loadLegacyModules()

const tabs = computed(() => [
  { key: 'credentials' as const, label: 'Доступы', icon: 'mingcute:lock-line', on: true },
  { key: 'proxy' as const, label: 'Прокси', icon: 'mingcute:wifi-line', on: legacyModules.value.proxyPool },
  { key: 'device' as const, label: 'Устройство', icon: 'mingcute:fingerprint-line', on: legacyModules.value.deviceAutomation },
  { key: 'warmup' as const, label: 'Прогрев', icon: 'mingcute:fire-line', on: legacyModules.value.deviceAutomation },
  { key: 'metrics' as const, label: 'Статистика', icon: 'mingcute:chart-line-line', on: true },
  { key: 'readiness' as const, label: 'Готовность', icon: 'mingcute:check-circle-line', on: legacyModules.value.deviceAutomation },
].filter(t => t.on))

function open(payload: {
  id: number
  displayName: string
  proxyId: string | null
  platform?: 'tiktok' | 'youtube' | 'instagram'
}) {
  accountId.value = payload.id
  accountName.value = payload.displayName
  currentProxyId.value = payload.proxyId
  accountPlatform.value = payload.platform ?? null
  activeTab.value = 'credentials'
  isOpen.value = true
}

function close() {
  isOpen.value = false
  emit('close')
}

function onProxySaved(newId: string | null) {
  currentProxyId.value = newId
  emit('updated')
}

defineExpose({ open, close })
</script>

<template>
  <UiModal :open="isOpen" size="lg" @close="close">
    <template #header>
      <span class="flex items-baseline gap-2">
        Настройка аккаунта
        <span class="truncate font-mono text-sm font-normal text-subtle">{{ accountName }}</span>
      </span>
    </template>

    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap gap-1 rounded-md border border-border bg-card p-1">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          class="flex h-7 cursor-pointer items-center gap-1.5 rounded-sm px-2.5 text-sm"
          :class="activeTab === tab.key ? 'bg-accent text-on-accent' : 'text-muted hover:text-fg'"
          @click="activeTab = tab.key"
        >
          <Icon :name="tab.icon" />
          {{ tab.label }}
        </button>
      </div>

      <AccountCredentialsForm
        v-if="activeTab === 'credentials' && accountId"
        :account-id="accountId"
        @saved="emit('updated')"
      />

      <AccountProxyPicker
        v-else-if="activeTab === 'proxy' && accountId"
        :account-id="accountId"
        :current-proxy-id="currentProxyId"
        @saved="onProxySaved"
      />

      <AccountDeviceTab
        v-else-if="activeTab === 'device' && accountId"
        :account-id="accountId"
        :account-platform="accountPlatform ?? undefined"
        @updated="emit('updated')"
      />

      <AccountWarmupTab
        v-else-if="activeTab === 'warmup' && accountId"
        :account-id="accountId"
        @updated="emit('updated')"
      />

      <AccountMetricsTab v-else-if="activeTab === 'metrics' && accountId" :account-id="accountId" />

      <AccountReadinessTab
        v-else-if="activeTab === 'readiness' && accountId"
        :account-id="accountId"
        @open-create-modal="emit('open-create-posting-job', accountId!)"
        @open-indigo="navigateTo('/devices')"
      />
    </div>

    <template #footer>
      <UiButton variant="ghost" @click="close">Закрыть</UiButton>
    </template>
  </UiModal>
</template>
