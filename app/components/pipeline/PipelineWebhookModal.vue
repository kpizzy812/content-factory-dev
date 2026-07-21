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

async function generateToken() {
  isGenerating.value = true
  try {
    const res = await $fetch<{ data: { token: string; secret: string } }>(
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
  if (!confirm('Отозвать токен? Все интеграции, использующие этот URL, перестанут работать.')) return
  isRevoking.value = true
  try {
    await $fetch(`/api/pipelines/${props.pipelineId}/webhook`, { method: 'DELETE' })
    emit('tokenUpdated', null)
    signingSecret.value = null
    showSecret.value = false
  } catch {
    // Error handled by UI
  } finally {
    isRevoking.value = false
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
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

// Abuse stats
const abuseStats = ref<{ totalCount: number; errorCount: number; suspiciousIps: string[] } | null>(null)

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

watch(() => props.visible, (v) => {
  if (v && props.currentToken) {
    loadLogs()
    loadAbuseStats()
  }
})
</script>

<template>
  <dialog class="modal" :class="{ 'modal-open': visible }">
    <div class="modal-box max-w-lg">
      <h3 class="text-lg font-bold flex items-center gap-2">
        <Icon name="mingcute:link-line" class="text-primary" />
        Webhook
      </h3>

      <p class="text-sm text-base-content/60 mt-2">
        Webhook позволяет запускать конвейер через HTTP POST-запрос из внешних сервисов.
      </p>

      <!-- No token -->
      <div v-if="!currentToken" class="mt-4">
        <div class="rounded-box border border-base-300 bg-base-200/50 p-4 text-center">
          <Icon name="mingcute:link-line" class="text-3xl text-base-content/30 mb-2" />
          <p class="text-sm text-base-content/50">Webhook не настроен</p>
        </div>

        <button
          class="btn btn-primary btn-sm btn-block mt-3"
          :disabled="isGenerating"
          @click="generateToken"
        >
          <span v-if="isGenerating" class="loading loading-spinner loading-sm" />
          <Icon v-else name="mingcute:key-1-line" />
          Сгенерировать токен
        </button>
      </div>

      <!-- Has token -->
      <div v-else class="mt-4 space-y-3">
        <fieldset class="fieldset">
          <legend class="fieldset-legend">URL для вызова (POST)</legend>
          <div class="flex gap-1">
            <input
              :value="webhookUrl"
              type="text"
              class="input input-sm flex-1 font-mono text-xs"
              readonly
            />
            <div class="tooltip tooltip-left" :data-tip="copied ? 'Скопировано!' : 'Копировать URL'">
              <button
                class="btn btn-sm btn-ghost btn-square"
                :class="{ 'text-success': copied }"
                @click="copyUrl"
              >
                <Icon :name="copied ? 'mingcute:check-line' : 'mingcute:copy-2-line'" />
              </button>
            </div>
          </div>
        </fieldset>

        <!-- Signing secret -->
        <div v-if="signingSecret && showSecret" class="rounded-box border border-warning/30 bg-warning/5 p-3 space-y-2">
          <div class="flex items-center gap-1.5 text-xs font-semibold text-warning">
            <Icon name="mingcute:shield-line" />
            Signing Secret (HMAC-SHA256)
          </div>
          <p class="text-[10px] text-base-content/50">
            Сохраните этот секрет — он показывается только один раз. Используйте для подписи запросов.
          </p>
          <div class="flex gap-1">
            <input
              :value="signingSecret"
              type="text"
              class="input input-sm flex-1 font-mono text-[10px]"
              readonly
            />
            <div class="tooltip tooltip-left" :data-tip="secretCopied ? 'Скопировано!' : 'Копировать секрет'">
              <button
                class="btn btn-sm btn-ghost btn-square"
                :class="{ 'text-success': secretCopied }"
                @click="copySecret"
              >
                <Icon :name="secretCopied ? 'mingcute:check-line' : 'mingcute:copy-2-line'" />
              </button>
            </div>
          </div>
          <details class="text-[10px] text-base-content/40">
            <summary class="cursor-pointer">Как подписывать запросы</summary>
            <pre class="mt-1 p-2 bg-base-200 rounded text-[9px] whitespace-pre-wrap">Headers:
  X-Webhook-Timestamp: {unix_ms}
  X-Webhook-Signature: HMAC-SHA256("{timestamp}.{body}", secret)
  X-Webhook-Nonce: {unique_id} (опционально)</pre>
          </details>
        </div>

        <!-- Enable/disable toggle -->
        <div class="flex items-center justify-between">
          <span class="text-sm">Webhook активен</span>
          <input
            type="checkbox"
            class="toggle toggle-sm toggle-primary"
            :checked="store.webhookEnabled"
            @change="toggleWebhookEnabled"
          />
        </div>

        <div v-if="!store.webhookEnabled" class="alert alert-warning alert-soft text-xs">
          <Icon name="mingcute:warning-line" />
          Webhook отключён. Запросы будут отклонены с кодом 403.
        </div>

        <div class="flex gap-2">
          <button
            class="btn btn-outline btn-sm flex-1"
            :disabled="isGenerating"
            @click="generateToken"
          >
            <span v-if="isGenerating" class="loading loading-spinner loading-sm" />
            <Icon v-else name="mingcute:refresh-1-line" />
            Перегенерировать
          </button>
          <button
            class="btn btn-error btn-outline btn-sm"
            :disabled="isRevoking"
            @click="revokeToken"
          >
            <span v-if="isRevoking" class="loading loading-spinner loading-sm" />
            <Icon v-else name="mingcute:delete-2-line" />
            Отозвать
          </button>
        </div>

        <!-- Security posture panel -->
        <div class="divider text-xs">Безопасность</div>

        <div
          v-if="abuseStats"
          class="rounded-box text-xs p-2.5 space-y-1.5"
          :class="{
            'bg-error/10 border border-error/20': securityLevel === 'critical',
            'bg-warning/10 border border-warning/20': securityLevel === 'warning',
            'bg-success/5 border border-success/10': securityLevel === 'ok',
          }"
        >
          <div
            class="flex items-center gap-1.5 font-semibold"
            :class="{
              'text-error': securityLevel === 'critical',
              'text-warning': securityLevel === 'warning',
              'text-success': securityLevel === 'ok',
            }"
          >
            <Icon
              :name="securityLevel === 'ok'
                ? 'mingcute:shield-line'
                : 'mingcute:warning-line'"
            />
            <span v-if="securityLevel === 'critical'">Высокий риск злоупотребления</span>
            <span v-else-if="securityLevel === 'warning'">Подозрительная активность</span>
            <span v-else>Без угроз</span>
          </div>
          <div class="text-[10px] text-base-content/60">
            24ч: {{ abuseStats.totalCount }} запросов, {{ abuseStats.errorCount }} ошибок
          </div>
          <div v-if="abuseStats.suspiciousIps.length > 0" class="text-[10px] text-base-content/50">
            Подозрительные IP: {{ abuseStats.suspiciousIps.join(', ') }}
          </div>

          <div class="text-[10px] text-base-content/40 space-y-0.5 mt-1">
            <div class="flex items-center gap-1">
              <Icon name="mingcute:check-circle-line" class="text-success text-[10px]" />
              <span>Multi-layer rate limiting (pipeline + IP + global)</span>
            </div>
            <div class="flex items-center gap-1">
              <Icon name="mingcute:check-circle-line" class="text-success text-[10px]" />
              <span>HMAC-SHA256 подпись (при настроенном secret)</span>
            </div>
            <div class="flex items-center gap-1">
              <Icon name="mingcute:check-circle-line" class="text-success text-[10px]" />
              <span>Replay protection (timestamp + nonce)</span>
            </div>
            <div class="flex items-center gap-1">
              <Icon name="mingcute:check-circle-line" class="text-success text-[10px]" />
              <span>Авто-отключение при массовом abuse</span>
            </div>
          </div>
        </div>

        <!-- Webhook logs -->
        <div class="divider text-xs">Журнал запросов</div>

        <div v-if="isLoadingLogs" class="flex justify-center py-3">
          <span class="loading loading-spinner loading-sm" />
        </div>

        <div v-else-if="logs.length === 0" class="text-center py-3 text-xs text-base-content/40">
          Запросов пока нет
        </div>

        <div v-else class="space-y-1 max-h-48 overflow-y-auto">
          <div
            v-for="log in logs"
            :key="log.id"
            class="flex items-center gap-2 text-xs p-1.5 rounded-box"
            :class="log.statusCode === 200 ? 'bg-success/5' : 'bg-error/5'"
          >
            <span
              class="badge badge-xs"
              :class="log.statusCode === 200 ? 'badge-success' : 'badge-error'"
            >
              {{ log.statusCode }}
            </span>
            <span class="font-mono text-[10px] text-base-content/40">
              {{ formatDate(log.createdAt) }}
            </span>
            <span v-if="log.runId" class="text-base-content/50">run #{{ log.runId }}</span>
            <span v-if="log.errorMsg" class="text-error truncate max-w-40">{{ log.errorMsg }}</span>
            <span class="text-base-content/30 ml-auto text-[10px]">{{ log.sourceIp }}</span>
          </div>
        </div>
      </div>

      <div class="modal-action">
        <button class="btn btn-sm" @click="emit('close')">Закрыть</button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop" @click="emit('close')">
      <button>close</button>
    </form>
  </dialog>
</template>
