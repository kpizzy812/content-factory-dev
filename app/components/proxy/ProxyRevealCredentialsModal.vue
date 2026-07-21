<script setup lang="ts">
const emit = defineEmits<{
  close: []
}>()

const modalRef = ref<HTMLDialogElement>()

interface RevealedData {
  host: string | null
  port: number
  username: string | null
  password: string | null
  rotationUrl: string | null
  formatted: string
}

const proxyId = ref<string | null>(null)
const proxyLabel = ref("")
const reason = ref("")
const revealed = ref<RevealedData | null>(null)
const error = ref("")
const copiedField = ref<string | null>(null)

const { revealProxy, isBusy } = useProxyActions()

const isStep2 = computed(() => revealed.value !== null)
const reasonValid = computed(() => reason.value.trim().length >= 10)

function open(id: string, label: string) {
  reset()
  proxyId.value = id
  proxyLabel.value = label
  modalRef.value?.showModal()
}

function reset() {
  proxyId.value = null
  proxyLabel.value = ""
  reason.value = ""
  revealed.value = null
  error.value = ""
  copiedField.value = null
}

function close() {
  modalRef.value?.close()
  reset()
  emit("close")
}

async function submit() {
  if (!proxyId.value || !reasonValid.value) return
  error.value = ""
  const data = await revealProxy(proxyId.value, reason.value.trim())
  if (!data) {
    error.value = "Не удалось получить креды"
    return
  }
  revealed.value = data
}

async function copyTo(field: string, value: string | null) {
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
    copiedField.value = field
    setTimeout(() => {
      if (copiedField.value === field) copiedField.value = null
    }, 1500)
  } catch {
    error.value = "Не удалось скопировать"
  }
}

defineExpose({ open, close })
</script>

<template>
  <dialog ref="modalRef" class="modal">
    <div class="modal-box max-w-xl max-h-[90vh] overflow-y-auto">
      <h3 class="text-lg font-bold">Расшифровка кредов</h3>
      <p class="text-sm text-base-content/60 mt-1">
        Прокси: <strong>{{ proxyLabel }}</strong>
      </p>

      <!-- Step 1: причина -->
      <div v-if="!isStep2" class="space-y-3 mt-4">
        <div role="alert" class="alert alert-warning alert-soft">
          <Icon name="mingcute:alert-line" />
          <span class="text-sm">
            Действие будет записано в audit-лог. Укажите причину доступа.
          </span>
        </div>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Причина (минимум 10 символов)</legend>
          <textarea
            v-model="reason"
            class="textarea textarea-sm w-full"
            rows="3"
            placeholder="Например: подключение к профилю устройства DuoPlus"
          />
          <p class="label text-xs text-base-content/50">
            {{ reason.trim().length }}/500
          </p>
        </fieldset>

        <div v-if="error" role="alert" class="alert alert-error alert-soft">
          <Icon name="mingcute:warning-line" />
          <span>{{ error }}</span>
        </div>
      </div>

      <!-- Step 2: показанные креды -->
      <div v-else class="space-y-3 mt-4">
        <div role="alert" class="alert alert-info alert-soft">
          <Icon name="mingcute:information-line" />
          <span class="text-sm">
            Креды показаны временно. После закрытия окна они исчезнут из памяти.
          </span>
        </div>

        <div class="space-y-2">
          <div class="flex items-center gap-2">
            <span class="text-xs text-base-content/60 w-24 shrink-0">Host</span>
            <code class="bg-base-200 px-2 py-1 rounded text-xs flex-1 break-all">
              {{ revealed?.host ?? "—" }}
            </code>
            <button
              v-if="revealed?.host"
              class="btn btn-xs btn-ghost"
              @click="copyTo('host', revealed.host)"
            >
              <Icon
                :name="copiedField === 'host' ? 'mingcute:check-line' : 'mingcute:copy-2-line'"
                class="text-sm"
              />
            </button>
          </div>

          <div class="flex items-center gap-2">
            <span class="text-xs text-base-content/60 w-24 shrink-0">Port</span>
            <code class="bg-base-200 px-2 py-1 rounded text-xs flex-1">
              {{ revealed?.port }}
            </code>
          </div>

          <div class="flex items-center gap-2">
            <span class="text-xs text-base-content/60 w-24 shrink-0">Username</span>
            <code class="bg-base-200 px-2 py-1 rounded text-xs flex-1 break-all">
              {{ revealed?.username ?? "—" }}
            </code>
            <button
              v-if="revealed?.username"
              class="btn btn-xs btn-ghost"
              @click="copyTo('username', revealed.username)"
            >
              <Icon
                :name="copiedField === 'username' ? 'mingcute:check-line' : 'mingcute:copy-2-line'"
                class="text-sm"
              />
            </button>
          </div>

          <div class="flex items-center gap-2">
            <span class="text-xs text-base-content/60 w-24 shrink-0">Password</span>
            <code class="bg-base-200 px-2 py-1 rounded text-xs flex-1 break-all">
              {{ revealed?.password ?? "—" }}
            </code>
            <button
              v-if="revealed?.password"
              class="btn btn-xs btn-ghost"
              @click="copyTo('password', revealed.password)"
            >
              <Icon
                :name="copiedField === 'password' ? 'mingcute:check-line' : 'mingcute:copy-2-line'"
                class="text-sm"
              />
            </button>
          </div>

          <div v-if="revealed?.rotationUrl" class="flex items-center gap-2">
            <span class="text-xs text-base-content/60 w-24 shrink-0">Rotation URL</span>
            <code class="bg-base-200 px-2 py-1 rounded text-xs flex-1 break-all">
              {{ revealed.rotationUrl }}
            </code>
            <button
              class="btn btn-xs btn-ghost"
              @click="copyTo('rotationUrl', revealed.rotationUrl)"
            >
              <Icon
                :name="copiedField === 'rotationUrl' ? 'mingcute:check-line' : 'mingcute:copy-2-line'"
                class="text-sm"
              />
            </button>
          </div>

          <div class="divider my-2 text-xs">Готовая строка</div>

          <div class="flex items-center gap-2">
            <code class="bg-base-200 px-2 py-1 rounded text-xs flex-1 break-all">
              {{ revealed?.formatted }}
            </code>
            <button
              v-if="revealed?.formatted"
              class="btn btn-xs btn-primary"
              @click="copyTo('formatted', revealed.formatted)"
            >
              <Icon
                :name="copiedField === 'formatted' ? 'mingcute:check-line' : 'mingcute:copy-2-line'"
                class="text-sm"
              />
              Скопировать
            </button>
          </div>
        </div>
      </div>

      <div class="modal-action">
        <button class="btn btn-ghost btn-sm" @click="close">Закрыть</button>
        <button
          v-if="!isStep2"
          class="btn btn-primary btn-sm"
          :disabled="!reasonValid || isBusy"
          @click="submit"
        >
          <span v-if="isBusy" class="loading loading-spinner loading-xs" />
          Показать креды
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="close">close</button>
    </form>
  </dialog>
</template>
