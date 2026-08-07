<script setup lang="ts">
const props = defineProps<{
  pipelineId: number
  visible: boolean
  currentToken: string | null
}>()

const emit = defineEmits<{
  close: []
  tokenUpdated: [token: string | null]
}>()

const store = usePipelineEditorStore()
const isGenerating = ref(false)
const isRevoking = ref(false)

// Webhook logs
const logs = ref<any[]>([])
const isLoadingLogs = ref(false)

// Signing secret
const signingSecret = ref<string | null>(null)
const showSecret = ref(false)
const secretCopied = ref(false)

const webhookUrl = computed(() => {
  if (!props.currentToken) return ''
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/api/webhooks/${props.currentToken}`
})

const copied = ref(false)

// Отзыв токена ломает все внешние интеграции — спрашиваем модалкой, а не confirm().
const revokeConfirmRef = ref<{ open: () => void, close: () => void, setBusy: (v: boolean) => void } | null>(null)

async function generateToken() {
  isGenerating.value = true
  try {
    const res = await $fetch<{ data: { token: string, secret: string } }>(
      `/api/pipelines/${props.pipelineId}/webhook`,
      { method: 'POST' },
    )
    emit('tokenUpdated', res.data.token)
    signingSecret.value = res.data.secret
    showSecret.value = true
  } catch {
    // Error handled by UI
  } finally {
    isGenerating.value = false
  }
}

async function revokeToken() {
  isRevoking.value = true
  revokeConfirmRef.value?.setBusy(true)
  try {
    await $fetch(`/api/pipelines/${props.pipelineId}/webhook`, { method: 'DELETE' })
    emit('tokenUpdated', null)
    signingSecret.value = null
    showSecret.value = false
    revokeConfirmRef.value?.close()
  } catch {
    // Error handled by UI
  } finally {
    isRevoking.value = false
    revokeConfirmRef.value?.setBusy(false)
  }
}

async function copyUrl() {
  if (!webhookUrl.value) return
  await navigator.clipboard.writeText(webhookUrl.value)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}

async function copySecret() {
  if (!signingSecret.value) return
  await navigator.clipboard.writeText(signingSecret.value)
  secretCopied.value = true
  setTimeout(() => { secretCopied.value = false }, 2000)
}

async function toggleWebhookEnabled() {
  try {
    await $fetch(`/api/pipelines/${props.pipelineId}`, {
      method: 'PUT',
      body: { webhookEnabled: !store.webhookEnabled },
    })
    store.webhookEnabled = !store.webhookEnabled
  } catch {
    // Error
  }
}

async function loadLogs() {
  isLoadingLogs.value = true
  try {
    const res = await $fetch<{ data: any[] }>(`/api/pipelines/${props.pipelineId}/webhook-logs`, {
      params: { perPage: 20 },
    })
    logs.value = res.data ?? []
  } catch {
    logs.value = []
  } finally {
    isLoadingLogs.value = false
  }
}

function formatDate(date: string) {
  return new Date(date).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

// Abuse stats
const abuseStats = ref<{ totalCount: number, errorCount: number, suspiciousIps: string[] } | null>(null)

async function loadAbuseStats() {
  try {
    const res = await $fetch<{ data: any[] }>(`/api/pipelines/${props.pipelineId}/webhook-logs`, {
      params: { perPage: 100 },
    })
    const allLogs = res.data ?? []
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    const recent = allLogs.filter((l: any) => new Date(l.createdAt).getTime() > cutoff)
    const errorLogs = recent.filter((l: any) => l.statusCode !== 200)

    // Find suspicious IPs (most error-producing)
    const ipErrors = new Map<string, number>()
    for (const log of errorLogs) {
      const ip = log.sourceIp || 'unknown'
      ipErrors.set(ip, (ipErrors.get(ip) || 0) + 1)
    }
    const suspiciousIps = Array.from(ipErrors.entries())
      .filter(([, count]) => count >= 5)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([ip, count]) => `${ip} (${count})`)

    abuseStats.value = {
      totalCount: recent.length,
      errorCount: errorLogs.length,
      suspiciousIps,
    }
  } catch {
    abuseStats.value = null
  }
}

const securityLevel = computed(() => {
  if (!abuseStats.value) return 'unknown'
  if (abuseStats.value.errorCount > 50) return 'critical'
  if (abuseStats.value.errorCount > 20) return 'warning'
  return 'ok'
})

const securityTone = computed(() => ({
  critical: { box: 'border-danger-border bg-danger-bg', text: 'text-danger', label: 'Высокий риск злоупотребления' },
  warning: { box: 'border-warning-border bg-warning-bg', text: 'text-warning', label: 'Подозрительная активность' },
  ok: { box: 'border-success-border bg-success-bg', text: 'text-success', label: 'Без угроз' },
  unknown: { box: 'border-border bg-card', text: 'text-muted', label: 'Данных нет' },
}[securityLevel.value]))

const SIGNING_EXAMPLE = `Headers:
  X-Webhook-Timestamp: {unix_ms}
  X-Webhook-Signature: HMAC-SHA256("{timestamp}.{body}", secret)
  X-Webhook-Nonce: {unique_id} (опционально)`

const GUARANTEES = [
  'Многоуровневый rate limiting (конвейер, IP, глобальный)',
  'Подпись HMAC-SHA256 при настроенном секрете',
  'Защита от повторов (timestamp и nonce)',
  'Авто-отключение при массовом злоупотреблении',
]

watch(() => props.visible, (v) => {
  if (v && props.currentToken) {
    loadLogs()
    loadAbuseStats()
  }
})
</script>

<template>
  <UiModal :open="visible" @close="emit('close')">
    <template #header>
      <span class="flex items-center gap-2">
        <Icon name="mingcute:link-line" class="text-accent-text" />
        Webhook
      </span>
    </template>

    <div class="flex flex-col gap-3">
      <p class="text-muted">
        Webhook позволяет запускать конвейер через HTTP POST-запрос из внешних сервисов.
      </p>

      <!-- Токена нет -->
      <template v-if="!currentToken">
        <div class="flex flex-col items-center gap-2 rounded-md border border-border bg-card p-4 text-center">
          <Icon name="mingcute:link-line" class="text-2xl text-subtle" />
          <p class="text-muted">Webhook не настроен</p>
        </div>

        <UiButton variant="primary" size="md" class="w-full justify-center" :loading="isGenerating" @click="generateToken">
          <Icon v-if="!isGenerating" name="mingcute:key-1-line" />
          Сгенерировать токен
        </UiButton>
      </template>

      <!-- Токен есть -->
      <template v-else>
        <UiField label="URL для вызова (POST)">
          <div class="flex gap-1">
            <UiInput :model-value="webhookUrl" mono readonly class="min-w-0 flex-1" />
            <UiTooltip :text="copied ? 'Скопировано' : 'Копировать URL'" placement="left">
              <UiButton variant="ghost" icon-only size="md" @click="copyUrl">
                <Icon
                  :name="copied ? 'mingcute:check-line' : 'mingcute:copy-2-line'"
                  :class="copied && 'text-success'"
                />
              </UiButton>
            </UiTooltip>
          </div>
        </UiField>

        <!-- Секрет подписи -->
        <div
          v-if="signingSecret && showSecret"
          class="flex flex-col gap-2 rounded-md border border-warning-border bg-warning-bg p-3"
        >
          <div class="flex items-center gap-1.5 font-semibold text-warning">
            <Icon name="mingcute:shield-line" />
            Signing Secret (HMAC-SHA256)
          </div>
          <p class="text-micro text-muted">
            Сохраните этот секрет — он показывается только один раз. Используйте для подписи запросов.
          </p>
          <div class="flex gap-1">
            <UiInput :model-value="signingSecret" mono readonly class="min-w-0 flex-1" />
            <UiTooltip :text="secretCopied ? 'Скопировано' : 'Копировать секрет'" placement="left">
              <UiButton variant="ghost" icon-only size="md" @click="copySecret">
                <Icon
                  :name="secretCopied ? 'mingcute:check-line' : 'mingcute:copy-2-line'"
                  :class="secretCopied && 'text-success'"
                />
              </UiButton>
            </UiTooltip>
          </div>
          <details class="text-micro text-subtle">
            <summary class="cursor-pointer">Как подписывать запросы</summary>
            <pre class="mt-1 rounded-sm border border-divider bg-card p-2 font-mono text-micro whitespace-pre-wrap">{{ SIGNING_EXAMPLE }}</pre>
          </details>
        </div>

        <div class="flex items-center justify-between gap-3">
          <span>Webhook активен</span>
          <UiToggle :model-value="store.webhookEnabled" @update:model-value="toggleWebhookEnabled" />
        </div>

        <p
          v-if="!store.webhookEnabled"
          class="flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-muted"
        >
          <Icon name="mingcute:warning-line" class="mt-0.5 shrink-0 text-warning" />
          Webhook отключён. Запросы будут отклонены с кодом 403.
        </p>

        <div class="flex gap-2">
          <UiButton size="md" class="flex-1 justify-center" :loading="isGenerating" @click="generateToken">
            <Icon v-if="!isGenerating" name="mingcute:refresh-1-line" />
            Перегенерировать
          </UiButton>
          <UiButton variant="danger" size="md" :loading="isRevoking" @click="revokeConfirmRef?.open()">
            <Icon v-if="!isRevoking" name="mingcute:delete-2-line" />
            Отозвать
          </UiButton>
        </div>

        <!-- Безопасность -->
        <div class="flex items-center gap-2 text-micro text-subtle">
          <span class="h-px flex-1 bg-divider" />
          Безопасность
          <span class="h-px flex-1 bg-divider" />
        </div>

        <div v-if="abuseStats" class="flex flex-col gap-1.5 rounded-md border p-2.5" :class="securityTone.box">
          <div class="flex items-center gap-1.5 font-semibold" :class="securityTone.text">
            <Icon :name="securityLevel === 'ok' ? 'mingcute:shield-line' : 'mingcute:warning-line'" />
            {{ securityTone.label }}
          </div>
          <div class="text-micro text-muted">
            24 ч: {{ abuseStats.totalCount }} запросов, {{ abuseStats.errorCount }} ошибок
          </div>
          <div v-if="abuseStats.suspiciousIps.length > 0" class="text-micro text-muted">
            Подозрительные IP: {{ abuseStats.suspiciousIps.join(', ') }}
          </div>

          <div class="mt-1 flex flex-col gap-0.5 text-micro text-subtle">
            <div v-for="g in GUARANTEES" :key="g" class="flex items-center gap-1">
              <Icon name="mingcute:check-circle-line" class="shrink-0 text-success" />
              <span>{{ g }}</span>
            </div>
          </div>
        </div>

        <!-- Журнал запросов -->
        <div class="flex items-center gap-2 text-micro text-subtle">
          <span class="h-px flex-1 bg-divider" />
          Журнал запросов
          <span class="h-px flex-1 bg-divider" />
        </div>

        <div v-if="isLoadingLogs" class="flex justify-center py-3 text-muted">
          <Icon name="mingcute:loading-line" class="animate-spin text-lg" />
        </div>

        <p v-else-if="logs.length === 0" class="py-3 text-center text-sm text-subtle">
          Запросов пока нет
        </p>

        <div v-else class="flex max-h-48 flex-col gap-1 overflow-y-auto">
          <div
            v-for="log in logs"
            :key="log.id"
            class="flex items-center gap-2 rounded-md border px-1.5 py-1 text-sm"
            :class="log.statusCode === 200
              ? 'border-success-border bg-success-bg'
              : 'border-danger-border bg-danger-bg'"
          >
            <span
              class="tnum inline-flex h-[18px] shrink-0 items-center rounded-sm border px-1.5 text-micro"
              :class="log.statusCode === 200
                ? 'border-success-border text-success'
                : 'border-danger-border text-danger'"
            >{{ log.statusCode }}</span>
            <span class="shrink-0 font-mono text-micro text-subtle">{{ formatDate(log.createdAt) }}</span>
            <span v-if="log.runId" class="shrink-0 text-muted">запуск #{{ log.runId }}</span>
            <span v-if="log.errorMsg" class="max-w-40 truncate text-danger">{{ log.errorMsg }}</span>
            <span class="ml-auto shrink-0 text-micro text-subtle">{{ log.sourceIp }}</span>
          </div>
        </div>
      </template>
    </div>

    <template #footer>
      <UiButton size="md" @click="emit('close')">Закрыть</UiButton>
    </template>
  </UiModal>

  <SharedConfirmModal
    ref="revokeConfirmRef"
    title="Отозвать токен?"
    message="Все интеграции, использующие этот URL, перестанут работать. Отменить отзыв нельзя — понадобится новый токен и новый секрет."
    confirm-label="Отозвать"
    variant="danger"
    @confirm="revokeToken"
  />
</template>
