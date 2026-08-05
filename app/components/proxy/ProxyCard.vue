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
  <div class="flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3">
    <div class="flex items-start gap-2">
      <div class="flex min-w-0 flex-col">
        <h3 class="truncate font-medium">{{ proxy.label }}</h3>
        <span v-if="proxy.provider" class="truncate text-micro text-subtle">{{ proxy.provider }}</span>
      </div>
      <ProxyHealthBadge :status="proxy.status" size="sm" class="ml-auto shrink-0" />
    </div>

    <div class="flex flex-wrap items-center gap-1.5">
      <span class="inline-flex h-[22px] items-center gap-1.5 rounded-sm border border-border bg-panel px-2 text-sm text-muted">
        <Icon :name="typeInfo.icon" />
        {{ typeInfo.label }}
      </span>
      <span class="inline-flex h-[22px] items-center rounded-sm border border-border bg-panel px-2 font-mono text-micro text-subtle uppercase">
        {{ proxy.protocol }}
      </span>
      <code class="tnum rounded-sm bg-surface px-2 py-0.5 font-mono text-micro text-muted">
        {{ proxy.hostMasked }}:{{ proxy.port }}
      </code>
    </div>

    <UiKeyValue
      label-width="104px"
      :items="[
        ...(locationLabel ? [{ label: 'Расположение', value: locationLabel, mono: false }] : []),
        { label: 'Аккаунтов', value: proxy.attachedAccountsCount },
        { label: 'Проверен', value: lastCheckedLabel },
        ...(expiresLabel ? [{ label: 'Истекает', value: expiresLabel }] : []),
      ]"
    />

    <p v-if="proxy.consecutiveFailures > 0" class="text-sm text-warning">
      Неудач подряд: <span class="tnum font-mono">{{ proxy.consecutiveFailures }}</span>
    </p>

    <UiTooltip v-if="hasAlerts" :text="alertTooltip" placement="top">
      <span class="flex items-center gap-1.5 text-sm text-muted">
        <Icon name="mingcute:notification-line" class="text-subtle" />
        <span>
          <template v-for="(a, idx) in alertSummary" :key="a.reason">
            {{ alertReasonLabels[a.reason] ?? a.reason }} ({{ a.count }})<span v-if="idx < alertSummary.length - 1">, </span>
          </template>
        </span>
      </span>
    </UiTooltip>

    <div class="flex flex-wrap justify-end gap-1">
      <UiButton variant="ghost" :loading="isChecking" :disabled="isBusy" @click="handleCheck">
        Проверить
      </UiButton>
      <UiButton variant="ghost" @click="emit('history', proxy)">История</UiButton>
      <UiButton variant="ghost" @click="emit('diagnose', proxy)">Диагностика</UiButton>
      <UiButton variant="ghost" @click="emit('reveal', proxy)">Доступы</UiButton>
      <UiButton variant="ghost" @click="emit('edit', proxy)">Изменить</UiButton>
      <UiButton variant="danger" :disabled="isBusy" @click="showDeleteConfirm = true">Удалить</UiButton>
    </div>

    <p v-if="error" class="rounded-md border border-danger-border bg-danger-bg p-2.5 text-sm text-danger">
      {{ error }}
    </p>

    <UiModal :open="showDeleteConfirm" title="Удалить прокси?" size="sm" @close="showDeleteConfirm = false">
      <p class="text-sm text-muted">
        Прокси «{{ proxy.label }}» будет удалён.
      </p>
      <p v-if="proxy.attachedAccountsCount > 0" class="mt-2 text-sm text-danger">
        К нему привязано аккаунтов: {{ proxy.attachedAccountsCount }} — сначала отвяжите их.
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="showDeleteConfirm = false">Отмена</UiButton>
        <UiButton variant="danger" :loading="isBusy" @click="handleDelete">Удалить</UiButton>
      </template>
    </UiModal>
  </div>
</template>
