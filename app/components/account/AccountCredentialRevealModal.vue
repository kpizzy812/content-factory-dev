<script setup lang="ts">
import type { CredentialField } from "~~/app/composables/useAccountCredentials"

const emit = defineEmits<{
  close: []
}>()

const modalRef = ref<HTMLDialogElement>()

const accountId = ref<number | null>(null)
const field = ref<CredentialField | null>(null)
const fieldLabel = ref("")
const reason = ref("")
const value = ref<string | null>(null)
const error = ref("")
const copied = ref(false)

const { revealField, isBusy } = useAccountCredentials()

const reasonValid = computed(() => reason.value.trim().length >= 10)
const isStep2 = computed(() => value.value !== null)

function open(id: number, f: CredentialField, label: string) {
  reset()
  accountId.value = id
  field.value = f
  fieldLabel.value = label
  modalRef.value?.showModal()
}

function reset() {
  accountId.value = null
  field.value = null
  fieldLabel.value = ""
  reason.value = ""
  value.value = null
  error.value = ""
  copied.value = false
}

function close() {
  modalRef.value?.close()
  reset()
  emit("close")
}

async function submit() {
  if (!accountId.value || !field.value || !reasonValid.value) return
  error.value = ""
  const v = await revealField(accountId.value, field.value, reason.value.trim())
  if (v === null) {
    error.value = "Не удалось получить значение"
    return
  }
  value.value = v
}

async function copyValue() {
  if (!value.value) return
  try {
    await navigator.clipboard.writeText(value.value)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch {
    error.value = "Не удалось скопировать"
  }
}

defineExpose({ open, close })
</script>

<template>
  <dialog ref="modalRef" class="modal">
    <div class="modal-box max-h-[90vh] overflow-y-auto">
      <h3 class="text-lg font-bold">Расшифровка: {{ fieldLabel }}</h3>

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
            placeholder="Например: ручная авторизация через устройство DuoPlus"
          />
        </fieldset>

        <div v-if="error" role="alert" class="alert alert-error alert-soft">
          <Icon name="mingcute:warning-line" />
          <span>{{ error }}</span>
        </div>
      </div>

      <div v-else class="space-y-3 mt-4">
        <div role="alert" class="alert alert-info alert-soft">
          <Icon name="mingcute:information-line" />
          <span class="text-sm">
            Значение показано временно. После закрытия исчезнет из памяти.
          </span>
        </div>

        <div class="flex items-center gap-2">
          <code class="bg-base-200 px-2 py-1 rounded text-sm flex-1 break-all">
            {{ value }}
          </code>
          <button class="btn btn-sm btn-primary" @click="copyValue">
            <Icon
              :name="copied ? 'mingcute:check-line' : 'mingcute:copy-2-line'"
              class="text-sm"
            />
            {{ copied ? "Скопировано" : "Копировать" }}
          </button>
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
          Показать
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="close">close</button>
    </form>
  </dialog>
</template>
