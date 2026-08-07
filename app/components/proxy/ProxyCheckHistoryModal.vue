<script setup lang="ts">
import type { ProxyHealthCheckDto } from '~~/shared/types/proxy'

const emit = defineEmits<{
  close: []
}>()

// Открывается императивно из строки списка прокси.
const isOpen = ref(false)
const history = ref<ProxyHealthCheckDto[]>([])
const proxyLabel = ref('')
const loading = ref(false)
const error = ref('')

const { getCheckHistory } = useProxyActions()

const triggerLabels: Record<string, string> = {
  manual: 'Ручная',
  scheduled: 'Авто',
  pre_session: 'Перед сессией',
}

async function open(proxyId: string, label: string) {
  proxyLabel.value = label
  history.value = []
  error.value = ''
  loading.value = true
  isOpen.value = true
  try {
    history.value = await getCheckHistory(proxyId)
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Ошибка загрузки истории'
  } finally {
    loading.value = false
  }
}

function close() {
  isOpen.value = false
  history.value = []
  emit('close')
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

defineExpose({ open, close })

const TH = 'px-2 py-1 text-left font-medium whitespace-nowrap'
const TD = 'px-2 py-1 align-top'
const BADGE = 'inline-flex h-[18px] items-center rounded-sm border px-1.5 text-micro'
</script>

<template>
  <UiModal :open="isOpen" title="История проверок" size="lg" @close="close">
    <div class="flex flex-col gap-3">
      <p class="text-muted">
        Прокси: <strong class="text-fg">{{ proxyLabel }}</strong>
      </p>

      <div v-if="loading" class="flex justify-center py-8 text-muted">
        <Icon name="mingcute:loading-line" class="animate-spin text-2xl" />
      </div>

      <p
        v-else-if="error"
        class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-danger"
      >
        <Icon name="mingcute:warning-line" class="mt-0.5 shrink-0" />
        <span>{{ error }}</span>
      </p>

      <div v-else-if="history.length === 0" class="flex flex-col items-center gap-2 py-8 text-muted">
        <Icon name="mingcute:history-line" class="text-3xl text-subtle" />
        <p>Проверок ещё не было</p>
      </div>

      <div v-else class="overflow-x-auto rounded-md border border-border">
        <table class="w-full text-sm">
          <thead class="border-b border-divider text-micro text-subtle">
            <tr>
              <th :class="TH">Когда</th>
              <th :class="TH">Триггер</th>
              <th :class="TH">TCP</th>
              <th :class="TH">HTTP</th>
              <th :class="TH">IP</th>
              <th :class="TH">Локация</th>
              <th :class="TH">Латенси</th>
              <th :class="TH">Утечка</th>
              <th :class="TH">Ошибка</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="check in history" :key="check.id" class="border-b border-divider last:border-0">
              <td :class="[TD, 'whitespace-nowrap']">{{ formatDate(check.checkedAt) }}</td>
              <td :class="TD">
                <span :class="[BADGE, 'border-neutral-border bg-neutral-bg text-neutral']">
                  {{ triggerLabels[check.triggeredBy] ?? check.triggeredBy }}
                </span>
              </td>
              <td :class="TD">
                <Icon
                  :name="check.tcpConnectOk ? 'mingcute:check-circle-fill' : 'mingcute:close-circle-fill'"
                  :class="check.tcpConnectOk ? 'text-success' : 'text-danger'"
                />
              </td>
              <td :class="TD">
                <Icon
                  :name="check.httpProbeOk ? 'mingcute:check-circle-fill' : 'mingcute:close-circle-fill'"
                  :class="check.httpProbeOk ? 'text-success' : 'text-danger'"
                />
              </td>
              <td :class="[TD, 'font-mono']">{{ check.detectedIp ?? '—' }}</td>
              <td :class="TD">
                {{ [check.detectedCountry, check.detectedCity].filter(Boolean).join(', ') || '—' }}
              </td>
              <td :class="[TD, 'tnum']">{{ check.latencyMs !== null ? `${check.latencyMs} мс` : '—' }}</td>
              <td :class="TD">
                <span
                  v-if="check.isLeaking === true"
                  :class="[BADGE, 'border-danger-border bg-danger-bg text-danger']"
                >есть</span>
                <span
                  v-else-if="check.isLeaking === false"
                  :class="[BADGE, 'border-success-border bg-success-bg text-success']"
                >нет</span>
                <span v-else class="text-subtle">—</span>
              </td>
              <td :class="[TD, 'max-w-xs text-danger']">
                <details v-if="check.errorMessage" class="group">
                  <summary class="flex cursor-pointer list-none items-start gap-1" :title="check.errorMessage">
                    <Icon
                      name="mingcute:right-line"
                      class="mt-0.5 shrink-0 transition-transform group-open:rotate-90"
                    />
                    <span class="truncate group-open:hidden">{{ check.errorMessage }}</span>
                    <span class="hidden break-words whitespace-pre-wrap group-open:inline">{{ check.errorMessage }}</span>
                  </summary>
                  <div
                    v-if="check.errorCategory"
                    class="mt-1 hidden pl-5 text-micro tracking-wide text-muted uppercase group-open:block"
                  >
                    {{ check.errorCategory }}
                  </div>
                </details>
                <span v-else class="text-subtle">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <template #footer>
      <UiButton size="md" @click="close">Закрыть</UiButton>
    </template>
  </UiModal>
</template>
