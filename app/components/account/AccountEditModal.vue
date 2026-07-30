<script setup lang="ts">
const emit = defineEmits<{
  updated: []
  close: []
  /** Сигнал родительской странице открыть PostingJobCreateModal с pre-filled accountId. */
  "open-create-posting-job": [accountId: number]
}>()

function onOpenIndigo() {
  window.open("/devices", "_blank")
}

const modalRef = ref<HTMLDialogElement>()
const accountId = ref<number | null>(null)
const accountName = ref("")
const currentProxyId = ref<string | null>(null)
const accountPlatform = ref<"tiktok" | "youtube" | "instagram" | null>(null)

const activeTab = ref<
  "credentials" | "proxy" | "indigo" | "warmup" | "metrics" | "readiness"
>("credentials")

// Вкладки прокси, устройства, прогрева и готовности принадлежат унаследованному
// контуру. Он выключен по умолчанию, а его API отдают 404 — показывать вкладки нельзя.
const { legacyModules, loadLegacyModules } = useLegacyModules()
loadLegacyModules()

function open(payload: {
  id: number
  displayName: string
  proxyId: string | null
  /** Платформа аккаунта - нужна для guard в AccountIndigoTab (YouTube требует desktop). */
  platform?: "tiktok" | "youtube" | "instagram"
}) {
  accountId.value = payload.id
  accountName.value = payload.displayName
  currentProxyId.value = payload.proxyId
  accountPlatform.value = payload.platform ?? null
  activeTab.value = "credentials"
  modalRef.value?.showModal()
}

function close() {
  modalRef.value?.close()
  emit("close")
}

function onSaved() {
  emit("updated")
}

function onProxySaved(newId: string | null) {
  currentProxyId.value = newId
  emit("updated")
}

defineExpose({ open, close })
</script>

<template>
  <dialog ref="modalRef" class="modal">
    <div class="modal-box max-w-2xl max-h-[90vh] flex flex-col">
      <h3 class="font-bold text-lg mb-1">Редактирование аккаунта</h3>
      <p class="text-xs text-base-content/60 mb-4">{{ accountName }}</p>

      <div role="tablist" class="tabs tabs-box mb-4 shrink-0 flex-wrap">
        <button
          role="tab"
          class="tab"
          :class="{ 'tab-active': activeTab === 'credentials' }"
          @click="activeTab = 'credentials'"
        >
          <Icon name="mingcute:lock-line" class="text-sm" />
          Доступы
        </button>
        <button
          v-if="legacyModules.proxyPool"
          role="tab"
          class="tab"
          :class="{ 'tab-active': activeTab === 'proxy' }"
          @click="activeTab = 'proxy'"
        >
          <Icon name="mingcute:wifi-line" class="text-sm" />
          Прокси
        </button>
        <button
          v-if="legacyModules.deviceAutomation"
          role="tab"
          class="tab"
          :class="{ 'tab-active': activeTab === 'indigo' }"
          @click="activeTab = 'indigo'"
        >
          <Icon name="mingcute:fingerprint-line" class="text-sm" />
          Устройство
        </button>
        <button
          v-if="legacyModules.deviceAutomation"
          role="tab"
          class="tab"
          :class="{ 'tab-active': activeTab === 'warmup' }"
          @click="activeTab = 'warmup'"
        >
          <Icon name="mingcute:fire-line" class="text-sm" />
          Прогрев
        </button>
        <button
          role="tab"
          class="tab"
          :class="{ 'tab-active': activeTab === 'metrics' }"
          @click="activeTab = 'metrics'"
        >
          <Icon name="mingcute:chart-line-line" class="text-sm" />
          Статистика
        </button>
        <button
          v-if="legacyModules.deviceAutomation"
          role="tab"
          class="tab"
          :class="{ 'tab-active': activeTab === 'readiness' }"
          @click="activeTab = 'readiness'"
        >
          <Icon name="mingcute:check-circle-line" class="text-sm" />
          Готовность
        </button>
      </div>

      <div class="flex-1 overflow-y-auto pr-1">
        <div v-if="activeTab === 'credentials' && accountId">
          <AccountCredentialsForm
            :account-id="accountId"
            @saved="onSaved"
          />
        </div>

        <div v-else-if="activeTab === 'proxy' && accountId && legacyModules.proxyPool">
          <AccountProxyPicker
            :account-id="accountId"
            :current-proxy-id="currentProxyId"
            @saved="onProxySaved"
          />
        </div>

        <div v-else-if="activeTab === 'indigo' && accountId && legacyModules.deviceAutomation">
          <AccountIndigoTab
            :account-id="accountId"
            :account-platform="accountPlatform ?? undefined"
            @updated="onSaved"
          />
        </div>

        <div v-else-if="activeTab === 'warmup' && accountId && legacyModules.deviceAutomation">
          <AccountWarmupTab :account-id="accountId" @updated="onSaved" />
        </div>

        <div v-else-if="activeTab === 'metrics' && accountId">
          <AccountMetricsTab :account-id="accountId" />
        </div>

        <div v-else-if="activeTab === 'readiness' && accountId && legacyModules.deviceAutomation">
          <AccountReadinessTab
            :account-id="accountId"
            @open-create-modal="emit('open-create-posting-job', accountId)"
            @open-indigo="onOpenIndigo"
          />
        </div>
      </div>

      <div class="modal-action mt-4 pt-3 border-t border-base-300 sticky bottom-0 bg-base-100">
        <button class="btn btn-sm btn-ghost" @click="close">Закрыть</button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="close">close</button>
    </form>
  </dialog>
</template>
