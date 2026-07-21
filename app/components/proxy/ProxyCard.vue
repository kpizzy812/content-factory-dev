<script setup lang="ts">
import type { ProxyDto } from "~~/shared/types/proxy"

const props = defineProps<{
  proxy: ProxyDto
}>()

const emit = defineEmits<{
  updated: []
  deleted: []
  edit: [proxy: ProxyDto]
  history: [proxy: ProxyDto]
  reveal: [proxy: ProxyDto]
  diagnose: [proxy: ProxyDto]
}>()

const { checkProxy, deleteProxy, isBusy, error } = useProxyActions()

const showDeleteConfirm = ref(false)
const isChecking = ref(false)

const typeConfig: Record<
  ProxyDto["type"],
  { label: string; icon: string }
> = {
  mobile: { label: "Mobile", icon: "mingcute:cellphone-line" },
  residential: { label: "Residential", icon: "mingcute:home-3-line" },
  datacenter: { label: "Datacenter", icon: "mingcute:server-line" },
}

const typeInfo = computed(() => typeConfig[props.proxy.type])

const lastCheckedLabel = computed(() => {
  if (!props.proxy.lastCheckedAt) return "не проверялся"
  const d = new Date(props.proxy.lastCheckedAt)
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
})

const expiresLabel = computed(() => {
  if (!props.proxy.expiresAt) return null
  const d = new Date(props.proxy.expiresAt)
  return d.toLocaleDateString("ru-RU")
})

const locationLabel = computed(() => {
  const parts = [props.proxy.expectedCountry, props.proxy.expectedCity].filter(
    Boolean,
  )
  return parts.length > 0 ? parts.join(", ") : null
})

const alertReasonLabels: Record<string, string> = {
  leak: "утечка IP",
  consecutive_failures_3: "3+ провала подряд",
  auth_failed: "ошибка авторизации",
  expired: "истёк срок",
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "доступен сейчас"
  const hours = Math.floor(ms / (60 * 60 * 1000))
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const remainHours = hours % 24
    return remainHours > 0 ? `через ${days}д ${remainHours}ч` : `через ${days}д`
  }
  if (hours >= 1) {
    return `через ${hours}ч`
  }
  const minutes = Math.max(1, Math.floor(ms / (60 * 1000)))
  return `через ${minutes}мин`
}

function formatAlertDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

const alertSummary = computed(() => props.proxy.alertSummary ?? [])
const hasAlerts = computed(() => alertSummary.value.length > 0)
const alertTooltip = computed(() => {
  return alertSummary.value
    .map((a) => {
      const label = alertReasonLabels[a.reason] ?? a.reason
      const next = formatRemaining(a.nextAllowedInMs)
      return `${label}: ${a.count}× (последний ${formatAlertDate(a.lastAt)}), след. ${next}`
    })
    .join("\n")
})

async function handleCheck() {
  isChecking.value = true
  try {
    const result = await checkProxy(props.proxy.id)
    if (result) emit("updated")
  } finally {
    isChecking.value = false
  }
}

async function handleDelete() {
  const ok = await deleteProxy(props.proxy.id)
  if (ok) {
    showDeleteConfirm.value = false
    emit("deleted")
  }
}
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 gap-3">
      <!-- Header: label + status badge -->
      <div class="flex items-start justify-between gap-2 flex-wrap">
        <div class="flex flex-col gap-1 min-w-0">
          <h3 class="font-semibold text-base-content truncate">
            {{ proxy.label }}
          </h3>
          <span v-if="proxy.provider" class="text-xs text-base-content/60">
            {{ proxy.provider }}
          </span>
        </div>
        <ProxyHealthBadge :status="proxy.status" size="sm" />
      </div>

      <!-- Body: type + host + meta -->
      <div class="flex flex-col gap-2 text-sm">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="badge badge-soft gap-1">
            <Icon :name="typeInfo.icon" class="text-sm" />
            {{ typeInfo.label }}
          </span>
          <span class="badge badge-outline badge-sm uppercase">
            {{ proxy.protocol }}
          </span>
          <code class="text-xs bg-base-200 px-2 py-1 rounded">
            {{ proxy.hostMasked }}:{{ proxy.port }}
          </code>
        </div>

        <div v-if="locationLabel" class="flex items-center gap-1.5 text-base-content/70">
          <Icon name="mingcute:location-line" class="text-sm" />
          <span>{{ locationLabel }}</span>
        </div>

        <div class="flex items-center gap-1.5 text-base-content/70">
          <Icon name="mingcute:group-line" class="text-sm" />
          <span>Аккаунтов: {{ proxy.attachedAccountsCount }}</span>
        </div>

        <div class="flex items-center gap-1.5 text-base-content/70">
          <Icon name="mingcute:time-line" class="text-sm" />
          <span>Проверка: {{ lastCheckedLabel }}</span>
        </div>

        <div v-if="expiresLabel" class="flex items-center gap-1.5 text-base-content/70">
          <Icon name="mingcute:calendar-line" class="text-sm" />
          <span>Истекает: {{ expiresLabel }}</span>
        </div>

        <div v-if="proxy.consecutiveFailures > 0" class="flex items-center gap-1.5 text-warning">
          <Icon name="mingcute:warning-line" class="text-sm" />
          <span>Подряд неудач: {{ proxy.consecutiveFailures }}</span>
        </div>

        <div
          v-if="hasAlerts"
          class="tooltip tooltip-left text-left"
          :data-tip="alertTooltip"
        >
          <div class="flex items-center gap-1.5 text-base-content/70">
            <Icon name="mingcute:notification-line" class="text-sm" />
            <span class="text-xs">
              Алёрты:
              <template v-for="(a, idx) in alertSummary" :key="a.reason">
                <span>{{ alertReasonLabels[a.reason] ?? a.reason }} ({{ a.count }})</span>
                <span v-if="idx < alertSummary.length - 1">, </span>
              </template>
            </span>
          </div>
        </div>
      </div>

      <!-- Footer: actions -->
      <div class="card-actions justify-end mt-2 flex-wrap gap-1">
        <button
          class="btn btn-xs btn-ghost gap-1"
          :disabled="isChecking || isBusy"
          @click="handleCheck"
        >
          <span v-if="isChecking" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:refresh-3-line" class="text-sm" />
          Проверить
        </button>
        <button
          class="btn btn-xs btn-ghost gap-1"
          @click="emit('history', proxy)"
        >
          <Icon name="mingcute:history-line" class="text-sm" />
          История
        </button>
        <button
          class="btn btn-xs btn-warning btn-soft gap-1"
          @click="emit('diagnose', proxy)"
        >
          <Icon name="mingcute:search-line" class="text-sm" />
          Diagnose
        </button>
        <button
          class="btn btn-xs btn-ghost gap-1"
          @click="emit('reveal', proxy)"
        >
          <Icon name="mingcute:eye-line" class="text-sm" />
          Креды
        </button>
        <button
          class="btn btn-xs btn-ghost gap-1"
          @click="emit('edit', proxy)"
        >
          <Icon name="mingcute:edit-line" class="text-sm" />
          Редактировать
        </button>
        <button
          class="btn btn-xs btn-error btn-outline gap-1"
          :disabled="isBusy"
          @click="showDeleteConfirm = true"
        >
          <Icon name="mingcute:delete-2-line" class="text-sm" />
          Удалить
        </button>
      </div>

      <div v-if="error" role="alert" class="alert alert-error alert-soft text-sm">
        <Icon name="mingcute:warning-line" />
        <span>{{ error }}</span>
      </div>
    </div>

    <!-- Confirm удаления -->
    <dialog class="modal" :class="{ 'modal-open': showDeleteConfirm }">
      <div class="modal-box">
        <h3 class="text-lg font-bold">Удалить прокси?</h3>
        <p class="py-4 text-base-content/70">
          Прокси <strong>{{ proxy.label }}</strong> будет удалён.
          <span v-if="proxy.attachedAccountsCount > 0" class="text-error">
            К нему привязано {{ proxy.attachedAccountsCount }} аккаунтов — сначала отвяжите их.
          </span>
        </p>
        <div class="modal-action">
          <button class="btn btn-sm" @click="showDeleteConfirm = false">Отмена</button>
          <button
            class="btn btn-sm btn-error"
            :disabled="isBusy"
            @click="handleDelete"
          >
            <span v-if="isBusy" class="loading loading-spinner loading-xs" />
            Удалить
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="showDeleteConfirm = false">close</button>
      </form>
    </dialog>
  </div>
</template>
