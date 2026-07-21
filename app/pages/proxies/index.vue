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
  <div class="space-y-6">
    <!-- Заголовок -->
    <div class="flex items-center justify-between flex-wrap gap-3">
      <div>
        <h1 class="text-2xl font-bold text-base-content">Прокси</h1>
        <p class="text-sm text-base-content/60 mt-1">
          Всего: {{ totalCount }} · Здоровых: {{ healthyCount }} · С проблемами: {{ problemCount }}
        </p>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <button
          class="btn btn-sm btn-ghost gap-1"
          :disabled="bulkChecking || totalCount === 0"
          @click="checkAll"
        >
          <span v-if="bulkChecking" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:refresh-3-line" />
          {{ bulkChecking ? "Проверяю прокси..." : "Проверить все" }}
        </button>
        <button class="btn btn-primary btn-sm gap-1" @click="openAddModal">
          <Icon name="mingcute:add-line" />
          Добавить прокси
        </button>
      </div>
    </div>

    <div
      v-if="bulkSummary"
      role="alert"
      class="alert text-sm"
      :class="bulkSummary.failed === 0 ? 'alert-success alert-soft' : 'alert-warning alert-soft'"
    >
      <Icon
        :name="bulkSummary.failed === 0 ? 'mingcute:check-circle-line' : 'mingcute:warning-line'"
      />
      <span>
        Проверено {{ bulkSummary.total }}: {{ bulkSummary.successful }} OK,
        {{ bulkSummary.failed }} с проблемами
      </span>
      <button
        class="btn btn-xs btn-ghost ml-auto"
        @click="bulkSummary = null"
      >
        <Icon name="mingcute:close-line" />
      </button>
    </div>

    <SharedPageGuide
      guide-key="proxies"
      :title="pageGuides.proxies.title"
      :steps="pageGuides.proxies.steps"
      :tips="pageGuides.proxies.tips"
    />

    <!-- Фильтры -->
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body p-4 gap-3">
        <div class="grid grid-cols-1 md:grid-cols-4 gap-2">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Поиск</legend>
            <input
              v-model="searchInput"
              type="text"
              class="input input-sm w-full"
              placeholder="label, провайдер, страна"
            />
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Статус</legend>
            <select v-model="filters.status" class="select select-sm w-full">
              <option v-for="opt in statusOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Тип</legend>
            <select v-model="filters.type" class="select select-sm w-full">
              <option v-for="opt in typeOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">&nbsp;</legend>
            <button class="btn btn-sm btn-ghost" @click="filters.reset(); searchInput = ''">
              <Icon name="mingcute:close-line" />
              Сбросить
            </button>
          </fieldset>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="pending" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <!-- Error -->
    <div v-else-if="error" role="alert" class="alert alert-error">
      <Icon name="mingcute:warning-line" />
      <span>Ошибка загрузки: {{ error.message }}</span>
    </div>

    <!-- Empty -->
    <SharedEmptyState
      v-else-if="proxies.length === 0"
      icon="mingcute:wifi-line"
      title="Нет добавленных прокси"
      description="Добавьте прокси, чтобы привязать их к социальным аккаунтам и публиковать контент через них."
    />

    <!-- Сетка карточек -->
    <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
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
