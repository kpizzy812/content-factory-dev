<script setup lang="ts">
import type { ProxyHealthCheckDto } from "~~/shared/types/proxy"

const emit = defineEmits<{
  close: []
}>()

const modalRef = ref<HTMLDialogElement>()
const history = ref<ProxyHealthCheckDto[]>([])
const proxyLabel = ref("")
const loading = ref(false)
const error = ref("")

const { getCheckHistory } = useProxyActions()

const triggerLabels: Record<string, string> = {
  manual: "Ручная",
  scheduled: "Авто",
  pre_session: "Перед сессией",
}

async function open(proxyId: string, label: string) {
  proxyLabel.value = label
  history.value = []
  error.value = ""
  loading.value = true
  modalRef.value?.showModal()
  try {
    history.value = await getCheckHistory(proxyId)
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "Ошибка загрузки истории"
  } finally {
    loading.value = false
  }
}

function close() {
  modalRef.value?.close()
  history.value = []
  emit("close")
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

defineExpose({ open, close })
</script>

<template>
  <dialog ref="modalRef" class="modal">
    <div class="modal-box max-w-4xl max-h-[90vh] overflow-y-auto">
      <h3 class="text-lg font-bold mb-2">История проверок</h3>
      <p class="text-sm text-base-content/60 mb-4">
        Прокси: <strong>{{ proxyLabel }}</strong>
      </p>

      <div v-if="loading" class="flex justify-center py-8">
        <span class="loading loading-spinner loading-lg" />
      </div>

      <div v-else-if="error" role="alert" class="alert alert-error alert-soft">
        <Icon name="mingcute:warning-line" />
        <span>{{ error }}</span>
      </div>

      <div v-else-if="history.length === 0" class="py-8 text-center text-base-content/60">
        <Icon name="mingcute:history-line" class="text-4xl mb-2" />
        <p>Проверок ещё не было</p>
      </div>

      <div v-else class="overflow-x-auto">
        <table class="table table-sm">
          <thead>
            <tr>
              <th>Когда</th>
              <th>Триггер</th>
              <th>TCP</th>
              <th>HTTP</th>
              <th>IP</th>
              <th>Локация</th>
              <th>Латенси</th>
              <th>Лик</th>
              <th>Ошибка</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="check in history" :key="check.id">
              <td class="whitespace-nowrap">{{ formatDate(check.checkedAt) }}</td>
              <td>
                <span class="badge badge-xs badge-ghost">
                  {{ triggerLabels[check.triggeredBy] ?? check.triggeredBy }}
                </span>
              </td>
              <td>
                <Icon
                  v-if="check.tcpConnectOk"
                  name="mingcute:check-circle-fill"
                  class="text-success"
                />
                <Icon
                  v-else
                  name="mingcute:close-circle-fill"
                  class="text-error"
                />
              </td>
              <td>
                <Icon
                  v-if="check.httpProbeOk"
                  name="mingcute:check-circle-fill"
                  class="text-success"
                />
                <Icon
                  v-else
                  name="mingcute:close-circle-fill"
                  class="text-error"
                />
              </td>
              <td class="font-mono text-xs">{{ check.detectedIp ?? "—" }}</td>
              <td class="text-xs">
                {{
                  [check.detectedCountry, check.detectedCity].filter(Boolean).join(", ") || "—"
                }}
              </td>
              <td>{{ check.latencyMs !== null ? `${check.latencyMs} мс` : "—" }}</td>
              <td>
                <span v-if="check.isLeaking === true" class="badge badge-error badge-xs">
                  есть
                </span>
                <span v-else-if="check.isLeaking === false" class="badge badge-success badge-xs">
                  нет
                </span>
                <span v-else class="text-base-content/40">—</span>
              </td>
              <td class="text-xs text-error max-w-xs align-top">
                <details v-if="check.errorMessage" class="group">
                  <summary
                    class="cursor-pointer list-none flex items-start gap-1"
                    :title="check.errorMessage"
                  >
                    <Icon
                      name="mingcute:right-line"
                      class="shrink-0 mt-0.5 transition-transform group-open:rotate-90"
                    />
                    <span class="truncate group-open:hidden">
                      {{ check.errorMessage }}
                    </span>
                    <span class="hidden group-open:inline whitespace-pre-wrap break-words">
                      {{ check.errorMessage }}
                    </span>
                  </summary>
                  <div
                    v-if="check.errorCategory"
                    class="hidden group-open:block text-base-content/60 text-[10px] uppercase tracking-wide pl-5 mt-1"
                  >
                    {{ check.errorCategory }}
                  </div>
                </details>
                <span v-else class="text-base-content/40">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="modal-action">
        <button class="btn btn-sm" @click="close">Закрыть</button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="close">close</button>
    </form>
  </dialog>
</template>
