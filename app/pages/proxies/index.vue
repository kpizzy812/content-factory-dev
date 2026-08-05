<script setup lang="ts">
import type { ProxyDto, ProxyStatus, ProxyType } from "~~/shared/types/proxy"

definePageMeta({
  layout: "default",
  middleware: "module-access",
  moduleSlug: "social-upload",
})
useHead({ title: "Прокси" })

const filters = useProxyFiltersStore()
const { data: proxiesData, pending, error, refresh } = useProxies()

// Пул прокси относится к унаследованному контуру: при выключенной зоне его API
// отдаёт 404, и это не поломка, а конфигурация. Говорим об этом прямо.
const { legacyModules, loadLegacyModules } = useLegacyModules()
loadLegacyModules()
const zoneOff = computed(() => !legacyModules.value.proxyPool)

const proxies = computed<ProxyDto[]>(() => proxiesData.value?.data ?? [])

const { checkAllProxies } = useProxyActions()

const addModalRef = ref<{ open: (proxy?: ProxyDto) => void }>()
const historyModalRef = ref<{ open: (id: string, label: string) => void }>()
const revealModalRef = ref<{ open: (id: string, label: string) => void }>()
const diagnoseModalRef = ref<{ open: (id: string, label: string) => void }>()

// Debounced search
const searchInput = ref(filters.search)
let searchTimeout: ReturnType<typeof setTimeout> | null = null
watch(searchInput, (val) => {
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    filters.search = val
  }, 300)
})

const statusOptions: { value: ProxyStatus | ""; label: string }[] = [
  { value: "", label: "Все статусы" },
  { value: "unverified", label: "Не проверены" },
  { value: "healthy", label: "Здоровые" },
  { value: "degraded", label: "Деградирующие" },
  { value: "dead", label: "Мёртвые" },
  { value: "expired", label: "Истёкшие" },
]

const typeOptions: { value: ProxyType | ""; label: string }[] = [
  { value: "", label: "Все типы" },
  { value: "mobile", label: "Mobile" },
  { value: "residential", label: "Residential" },
  { value: "datacenter", label: "Datacenter" },
]

function openAddModal() {
  addModalRef.value?.open()
}

function onEdit(proxy: ProxyDto) {
  addModalRef.value?.open(proxy)
}

function onHistory(proxy: ProxyDto) {
  historyModalRef.value?.open(proxy.id, proxy.label)
}

function onReveal(proxy: ProxyDto) {
  revealModalRef.value?.open(proxy.id, proxy.label)
}

function onDiagnose(proxy: ProxyDto) {
  diagnoseModalRef.value?.open(proxy.id, proxy.label)
}

async function onSaved() {
  await refresh()
}

async function onUpdated() {
  await refresh()
}

async function onDeleted() {
  await refresh()
}

const bulkChecking = ref(false)
const bulkSummary = ref<{
  total: number
  successful: number
  failed: number
} | null>(null)
const bulkSummaryTimer = ref<ReturnType<typeof setTimeout> | null>(null)

async function checkAll() {
  if (proxies.value.length === 0) return
  bulkChecking.value = true
  bulkSummary.value = null
  if (bulkSummaryTimer.value) {
    clearTimeout(bulkSummaryTimer.value)
    bulkSummaryTimer.value = null
  }
  try {
    const result = await checkAllProxies()
    if (result) {
      bulkSummary.value = {
        total: result.total,
        successful: result.successful,
        failed: result.failed,
      }
      bulkSummaryTimer.value = setTimeout(() => {
        bulkSummary.value = null
      }, 8000)
    }
    await refresh()
  } finally {
    bulkChecking.value = false
  }
}

onBeforeUnmount(() => {
  if (bulkSummaryTimer.value) clearTimeout(bulkSummaryTimer.value)
})

const totalCount = computed(() => proxies.value.length)
const healthyCount = computed(
  () => proxies.value.filter((p) => p.status === "healthy").length,
)
const problemCount = computed(
  () =>
    proxies.value.filter((p) => p.status === "dead" || p.status === "degraded")
      .length,
)
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-semibold">Прокси</h1>
      <span class="tnum text-sm text-subtle">{{ totalCount }}</span>
      <span class="flex-1" />
      <UiButton v-if="!zoneOff" :loading="bulkChecking" :disabled="totalCount === 0" @click="checkAll">
        <Icon v-if="!bulkChecking" name="mingcute:refresh-3-line" />
        Проверить все
      </UiButton>
      <UiButton v-if="!zoneOff" variant="primary" @click="openAddModal">
        <Icon name="mingcute:add-line" />
        Добавить прокси
      </UiButton>
    </div>

    <!-- Сводка стоит рядом с заголовком: сколько прокси мертво — это первое,
         что смотрят, заходя в раздел. -->
    <div v-if="!zoneOff" class="flex flex-wrap gap-4 text-sm text-muted">
      <span>Здоровых <span class="tnum font-mono text-success">{{ healthyCount }}</span></span>
      <span>С проблемами <span class="tnum font-mono" :class="problemCount ? 'text-danger' : 'text-fg'">{{ problemCount }}</span></span>
    </div>

    <p
      v-if="bulkSummary"
      class="flex items-center gap-2 rounded-md border p-2.5 text-sm"
      :class="bulkSummary.failed === 0
        ? 'border-success-border bg-success-bg text-success'
        : 'border-warning-border bg-warning-bg text-warning'"
    >
      Проверено {{ bulkSummary.total }}: рабочих {{ bulkSummary.successful }},
      с проблемами {{ bulkSummary.failed }}
      <UiButton icon-only variant="ghost" aria-label="Скрыть" class="ml-auto" @click="bulkSummary = null">
        <Icon name="mingcute:close-line" />
      </UiButton>
    </p>

    <div v-if="!zoneOff" class="flex flex-wrap items-center gap-2">
      <UiInput v-model="searchInput" class="max-w-64 flex-1" placeholder="Метка, провайдер, страна" />
      <UiSelect v-model="filters.status" class="w-48" :options="statusOptions" />
      <UiSelect v-model="filters.type" class="w-44" :options="typeOptions" />
      <UiButton variant="ghost" @click="filters.reset(); searchInput = ''">Сбросить</UiButton>
    </div>

    <UiEmptyState
      v-if="zoneOff"
      variant="denied"
      title="Пул прокси выключен"
      description="Зона относится к унаследованному контуру и включается флагом LEGACY_PROXY_POOL_ENABLED в окружении."
    />

    <UiSkeleton v-else-if="pending && !proxies.length" variant="cards" :count="6" />

    <UiErrorState
      v-else-if="error"
      message="Не удалось загрузить прокси."
      :details="error.message"
      @retry="refresh()"
    />

    <UiEmptyState
      v-else-if="!proxies.length"
      variant="first"
      title="Прокси пока нет"
      description="Добавьте прокси, чтобы привязать их к аккаунтам: публикация с адреса сервера быстро приводит к бану."
    />

    <div v-else class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <ProxyCard
        v-for="proxy in proxies"
        :key="proxy.id"
        :proxy="proxy"
        @updated="onUpdated"
        @deleted="onDeleted"
        @edit="onEdit"
        @history="onHistory"
        @reveal="onReveal"
        @diagnose="onDiagnose"
      />
    </div>

    <ProxyAddModal ref="addModalRef" @saved="onSaved" />
    <ProxyCheckHistoryModal ref="historyModalRef" />
    <ProxyRevealCredentialsModal ref="revealModalRef" />
    <ProxyDiagnoseModal ref="diagnoseModalRef" />
  </div>
</template>
