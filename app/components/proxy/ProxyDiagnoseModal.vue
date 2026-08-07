<script setup lang="ts">
// Глубокая диагностика прокси. Открывается через ref API .open(id, label).
// Изнутри — POST /api/proxies/[id]/diagnose, отображает raw JSON.
//
// Используется когда checkProxy показывает leak, но непонятно где собака —
// в NodeMaven или в нашем коде. Diagnostic пробует 4 разных метода и сам
// определяет suspectedRoot в verdict.

interface VerdictData {
  proxyReallyWorks: boolean
  nodeRequestWorks: boolean
  fetchWorks: boolean
  socks5hHelpsAtAll: boolean
  suspectedRoot: string
  recommendation: string
}

interface DiagnosticData {
  proxyHost: string
  proxyPort: number
  protocol: string
  timestamp: string
  containerIp: { via_v4: string | null, via_v6: string | null, error: string | null }
  tcp: { connectMs: number | null, error: string | null }
  curlBaseline: {
    command: string
    exitCode: number
    detectedIp: string | null
    isLeakingViaCurl: boolean
    durationMs: number
    stderr: string
  }
  rawNodeRequest: {
    detectedIp: string | null
    isLeaking: boolean | null
    httpStatus: number | null
    durationMs: number
    error: string | null
  }
  nativeFetch: {
    detectedIp: string | null
    isLeaking: boolean | null
    httpStatus: number | null
    durationMs: number
    error: string | null
    nodeVersion: string
  }
  socks5hVariant: {
    detectedIp: string | null
    isLeaking: boolean | null
    httpStatus: number | null
    durationMs: number
    error: string | null
  }
  verdict: VerdictData
}

const isOpen = ref(false)
const proxyLabel = ref<string>('')
const isLoading = ref(false)
const error = ref<string | null>(null)
const result = ref<DiagnosticData | null>(null)

function open(id: string, label: string) {
  proxyLabel.value = label
  result.value = null
  error.value = null
  isOpen.value = true
  void runDiagnose(id)
}

function close() {
  isOpen.value = false
}

async function runDiagnose(id: string) {
  isLoading.value = true
  error.value = null
  try {
    const res = await $fetch<{ data: DiagnosticData }>(
      `/api/proxies/${id}/diagnose`,
      { method: 'POST' },
    )
    result.value = res.data
  } catch (e: unknown) {
    const err = e as { data?: { message?: string }, message?: string }
    error.value = err?.data?.message ?? err?.message ?? 'Не удалось запустить диагностику'
  } finally {
    isLoading.value = false
  }
}

const verdictTone = computed(() => {
  if (!result.value) return 'border-border bg-card'
  const root = result.value.verdict.suspectedRoot
  if (root === 'all_methods_work') return 'border-success-border bg-success-bg'
  if (root === 'unknown') return 'border-warning-border bg-warning-bg'
  return 'border-danger-border bg-danger-bg'
})

function copyJson() {
  if (!result.value) return
  navigator.clipboard.writeText(JSON.stringify(result.value, null, 2))
}

defineExpose({ open })

const CARD = 'flex flex-col gap-1 rounded-md border border-border bg-card p-3'
const BADGE = 'inline-flex h-[18px] items-center rounded-sm border px-1.5 text-micro'
const LEAK = 'border-danger-border bg-danger-bg text-danger'
const OK = 'border-success-border bg-success-bg text-success'
</script>

<template>
  <UiModal :open="isOpen" size="lg" @close="close">
    <template #header>
      <span class="flex items-center gap-2">
        <Icon name="mingcute:search-line" />
        Глубокая диагностика прокси
      </span>
    </template>

    <div class="flex flex-col gap-4">
      <p class="text-muted">
        Прокси: <strong class="text-fg">{{ proxyLabel }}</strong>
      </p>

      <div v-if="isLoading" class="flex flex-col items-center gap-3 py-8 text-muted">
        <Icon name="mingcute:loading-line" class="animate-spin text-2xl" />
        <p>Проверяю прокси через четыре метода и curl baseline. До 60 секунд.</p>
      </div>

      <p
        v-else-if="error"
        class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-danger"
      >
        <Icon name="mingcute:warning-line" class="mt-0.5 shrink-0" />
        <span>{{ error }}</span>
      </p>

      <template v-else-if="result">
        <div class="flex items-start gap-2 rounded-md border p-3" :class="verdictTone">
          <Icon name="mingcute:information-line" class="mt-0.5 shrink-0" />
          <div class="min-w-0 flex-1">
            <h4 class="font-semibold">Корень проблемы: {{ result.verdict.suspectedRoot }}</h4>
            <p class="mt-1 text-muted">{{ result.verdict.recommendation }}</p>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div :class="CARD">
            <h5 class="font-semibold">Container IP</h5>
            <p>IPv4: <code class="font-mono text-fg">{{ result.containerIp.via_v4 ?? '—' }}</code></p>
            <p>IPv6: <code class="font-mono text-fg">{{ result.containerIp.via_v6 ?? '—' }}</code></p>
          </div>

          <div :class="CARD">
            <h5 class="font-semibold">TCP к прокси</h5>
            <p v-if="result.tcp.error" class="text-danger">Ошибка: {{ result.tcp.error }}</p>
            <p v-else>Подключилось за <strong class="tnum">{{ result.tcp.connectMs }} мс</strong></p>
          </div>

          <div :class="CARD">
            <h5 class="flex flex-wrap items-center gap-1.5 font-semibold">
              Curl baseline (ground truth)
              <span v-if="result.curlBaseline.isLeakingViaCurl" :class="[BADGE, LEAK]">утечка</span>
              <span v-else-if="result.curlBaseline.detectedIp" :class="[BADGE, OK]">OK</span>
            </h5>
            <p>IP: <code class="font-mono text-fg">{{ result.curlBaseline.detectedIp ?? '—' }}</code></p>
            <p class="tnum">Exit: {{ result.curlBaseline.exitCode }} · {{ result.curlBaseline.durationMs }} мс</p>
            <p v-if="result.curlBaseline.stderr" class="truncate text-micro text-muted">
              stderr: {{ result.curlBaseline.stderr }}
            </p>
          </div>

          <div :class="CARD">
            <h5 class="flex flex-wrap items-center gap-1.5 font-semibold">
              Raw https.request + agent
              <span v-if="result.rawNodeRequest.isLeaking" :class="[BADGE, LEAK]">утечка</span>
              <span v-else-if="result.rawNodeRequest.isLeaking === false" :class="[BADGE, OK]">OK</span>
            </h5>
            <p>IP: <code class="font-mono text-fg">{{ result.rawNodeRequest.detectedIp ?? '—' }}</code></p>
            <p class="tnum">HTTP {{ result.rawNodeRequest.httpStatus ?? '—' }} · {{ result.rawNodeRequest.durationMs }} мс</p>
            <p v-if="result.rawNodeRequest.error" class="text-micro text-danger">
              {{ result.rawNodeRequest.error }}
            </p>
          </div>

          <div :class="CARD">
            <h5 class="flex flex-wrap items-center gap-1.5 font-semibold">
              Native fetch + agent
              <span v-if="result.nativeFetch.isLeaking" :class="[BADGE, LEAK]">утечка</span>
              <span v-else-if="result.nativeFetch.isLeaking === false" :class="[BADGE, OK]">OK</span>
            </h5>
            <p>IP: <code class="font-mono text-fg">{{ result.nativeFetch.detectedIp ?? '—' }}</code></p>
            <p class="tnum">HTTP {{ result.nativeFetch.httpStatus ?? '—' }} · {{ result.nativeFetch.durationMs }} мс</p>
            <p class="text-micro text-muted">Node {{ result.nativeFetch.nodeVersion }}</p>
            <p v-if="result.nativeFetch.error" class="text-micro text-danger">
              {{ result.nativeFetch.error }}
            </p>
          </div>

          <div :class="CARD">
            <h5 class="flex flex-wrap items-center gap-1.5 font-semibold">
              socks5h:// (DNS через прокси)
              <span v-if="result.socks5hVariant.isLeaking" :class="[BADGE, LEAK]">утечка</span>
              <span v-else-if="result.socks5hVariant.isLeaking === false" :class="[BADGE, OK]">OK</span>
            </h5>
            <p>IP: <code class="font-mono text-fg">{{ result.socks5hVariant.detectedIp ?? '—' }}</code></p>
            <p v-if="result.socks5hVariant.error" class="text-micro text-muted">
              {{ result.socks5hVariant.error }}
            </p>
            <p v-else class="tnum">HTTP {{ result.socks5hVariant.httpStatus ?? '—' }} · {{ result.socks5hVariant.durationMs }} мс</p>
          </div>
        </div>

        <UiDisclosure title="Полный JSON отчёт" icon="mingcute:code-line">
          <pre class="max-h-96 overflow-auto rounded-md border border-border bg-card p-2 font-mono text-micro whitespace-pre-wrap">{{ JSON.stringify(result, null, 2) }}</pre>
        </UiDisclosure>
      </template>
    </div>

    <template #footer>
      <UiButton v-if="result" variant="ghost" size="md" @click="copyJson">
        <Icon name="mingcute:copy-2-line" />
        Скопировать JSON
      </UiButton>
      <UiButton size="md" @click="close">Закрыть</UiButton>
    </template>
  </UiModal>
</template>
