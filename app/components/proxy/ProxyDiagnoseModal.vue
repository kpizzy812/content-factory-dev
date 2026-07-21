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
  containerIp: { via_v4: string | null; via_v6: string | null; error: string | null }
  tcp: { connectMs: number | null; error: string | null }
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

const dialogRef = ref<HTMLDialogElement | null>(null)
const proxyLabel = ref<string>("")
const isLoading = ref(false)
const error = ref<string | null>(null)
const result = ref<DiagnosticData | null>(null)

function open(id: string, label: string) {
  proxyLabel.value = label
  result.value = null
  error.value = null
  dialogRef.value?.showModal()
  void runDiagnose(id)
}

function close() {
  dialogRef.value?.close()
}

async function runDiagnose(id: string) {
  isLoading.value = true
  error.value = null
  try {
    const res = await $fetch<{ data: DiagnosticData }>(
      `/api/proxies/${id}/diagnose`,
      { method: "POST" },
    )
    result.value = res.data
  } catch (e: unknown) {
    const err = e as { data?: { message?: string }; message?: string }
    error.value =
      err?.data?.message ?? err?.message ?? "Не удалось запустить диагностику"
  } finally {
    isLoading.value = false
  }
}

const verdictColorClass = computed(() => {
  if (!result.value) return ""
  const root = result.value.verdict.suspectedRoot
  if (root === "all_methods_work") return "alert-success alert-soft"
  if (root === "unknown") return "alert-warning alert-soft"
  return "alert-error alert-soft"
})

function copyJson() {
  if (!result.value) return
  navigator.clipboard.writeText(JSON.stringify(result.value, null, 2))
}

defineExpose({ open })
</script>

<template>
  <dialog ref="dialogRef" class="modal">
    <div class="modal-box max-w-5xl max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between gap-2 mb-3">
        <h3 class="font-bold text-lg">
          <Icon name="mingcute:search-line" class="inline-block mr-1" />
          Глубокая диагностика прокси
        </h3>
        <button
          class="btn btn-sm btn-ghost"
          aria-label="Закрыть"
          @click="close"
        >
          <Icon name="mingcute:close-line" />
        </button>
      </div>

      <p class="text-sm text-base-content/60 mb-4">
        Прокси: <strong>{{ proxyLabel }}</strong>
      </p>

      <div v-if="isLoading" class="flex flex-col items-center py-8 gap-3">
        <span class="loading loading-spinner loading-lg" />
        <p class="text-sm text-base-content/70">
          Проверяю прокси через 4 метода + curl baseline. До 60 секунд.
        </p>
      </div>

      <div v-else-if="error" role="alert" class="alert alert-error">
        <Icon name="mingcute:warning-line" />
        <span>{{ error }}</span>
      </div>

      <div v-else-if="result" class="space-y-4">
        <div role="alert" class="alert" :class="verdictColorClass">
          <Icon name="mingcute:information-line" />
          <div class="flex-1">
            <h4 class="font-semibold">
              Корень проблемы: {{ result.verdict.suspectedRoot }}
            </h4>
            <p class="text-sm mt-1">{{ result.verdict.recommendation }}</p>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div class="card card-border bg-base-100">
            <div class="card-body p-3 gap-1">
              <h5 class="font-semibold">Container IP</h5>
              <p>IPv4: <code>{{ result.containerIp.via_v4 ?? "—" }}</code></p>
              <p>IPv6: <code>{{ result.containerIp.via_v6 ?? "—" }}</code></p>
            </div>
          </div>

          <div class="card card-border bg-base-100">
            <div class="card-body p-3 gap-1">
              <h5 class="font-semibold">TCP к прокси</h5>
              <p v-if="result.tcp.error" class="text-error">
                Ошибка: {{ result.tcp.error }}
              </p>
              <p v-else>
                Подключилось за <strong>{{ result.tcp.connectMs }}ms</strong>
              </p>
            </div>
          </div>

          <div class="card card-border bg-base-100">
            <div class="card-body p-3 gap-1">
              <h5 class="font-semibold">
                Curl baseline (ground truth)
                <span
                  v-if="result.curlBaseline.isLeakingViaCurl"
                  class="badge badge-error badge-sm"
                >LEAK</span>
                <span
                  v-else-if="result.curlBaseline.detectedIp"
                  class="badge badge-success badge-sm"
                >OK</span>
              </h5>
              <p>IP: <code>{{ result.curlBaseline.detectedIp ?? "—" }}</code></p>
              <p>Exit: {{ result.curlBaseline.exitCode }} · {{ result.curlBaseline.durationMs }}ms</p>
              <p v-if="result.curlBaseline.stderr" class="text-xs text-base-content/60 truncate">
                stderr: {{ result.curlBaseline.stderr }}
              </p>
            </div>
          </div>

          <div class="card card-border bg-base-100">
            <div class="card-body p-3 gap-1">
              <h5 class="font-semibold">
                Raw https.request + agent
                <span
                  v-if="result.rawNodeRequest.isLeaking"
                  class="badge badge-error badge-sm"
                >LEAK</span>
                <span
                  v-else-if="result.rawNodeRequest.isLeaking === false"
                  class="badge badge-success badge-sm"
                >OK</span>
              </h5>
              <p>IP: <code>{{ result.rawNodeRequest.detectedIp ?? "—" }}</code></p>
              <p>HTTP {{ result.rawNodeRequest.httpStatus ?? "—" }} · {{ result.rawNodeRequest.durationMs }}ms</p>
              <p v-if="result.rawNodeRequest.error" class="text-xs text-error">
                {{ result.rawNodeRequest.error }}
              </p>
            </div>
          </div>

          <div class="card card-border bg-base-100">
            <div class="card-body p-3 gap-1">
              <h5 class="font-semibold">
                Native fetch + agent
                <span
                  v-if="result.nativeFetch.isLeaking"
                  class="badge badge-error badge-sm"
                >LEAK</span>
                <span
                  v-else-if="result.nativeFetch.isLeaking === false"
                  class="badge badge-success badge-sm"
                >OK</span>
              </h5>
              <p>IP: <code>{{ result.nativeFetch.detectedIp ?? "—" }}</code></p>
              <p>HTTP {{ result.nativeFetch.httpStatus ?? "—" }} · {{ result.nativeFetch.durationMs }}ms</p>
              <p class="text-xs text-base-content/60">Node {{ result.nativeFetch.nodeVersion }}</p>
              <p v-if="result.nativeFetch.error" class="text-xs text-error">
                {{ result.nativeFetch.error }}
              </p>
            </div>
          </div>

          <div class="card card-border bg-base-100">
            <div class="card-body p-3 gap-1">
              <h5 class="font-semibold">
                socks5h:// (DNS через proxy)
                <span
                  v-if="result.socks5hVariant.isLeaking"
                  class="badge badge-error badge-sm"
                >LEAK</span>
                <span
                  v-else-if="result.socks5hVariant.isLeaking === false"
                  class="badge badge-success badge-sm"
                >OK</span>
              </h5>
              <p>IP: <code>{{ result.socks5hVariant.detectedIp ?? "—" }}</code></p>
              <p v-if="result.socks5hVariant.error" class="text-xs text-base-content/60">
                {{ result.socks5hVariant.error }}
              </p>
              <p v-else>HTTP {{ result.socks5hVariant.httpStatus ?? "—" }} · {{ result.socks5hVariant.durationMs }}ms</p>
            </div>
          </div>
        </div>

        <details class="collapse collapse-arrow bg-base-200">
          <summary class="collapse-title text-sm font-medium">
            Полный JSON отчёт (raw)
          </summary>
          <div class="collapse-content">
            <pre class="text-xs whitespace-pre-wrap overflow-auto max-h-96">{{ JSON.stringify(result, null, 2) }}</pre>
          </div>
        </details>
      </div>

      <div class="modal-action">
        <button
          v-if="result"
          class="btn btn-sm btn-ghost gap-1"
          @click="copyJson"
        >
          <Icon name="mingcute:copy-line" />
          Скопировать JSON
        </button>
        <button class="btn btn-sm" @click="close">Закрыть</button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="close">close</button>
    </form>
  </dialog>
</template>
