<script setup lang="ts">
import type { CredentialField } from '~~/app/composables/useAccountCredentials'

/**
 * Показ расшифрованного секрета. Причина обязательна: запрос пишется в
 * журнал доступа, и без неё запись бесполезна.
 */
const emit = defineEmits<{ close: [] }>()

const toast = useToast()
const { revealField, isBusy } = useAccountCredentials()

const isOpen = ref(false)
const accountId = ref<number | null>(null)
const field = ref<CredentialField | null>(null)
const fieldLabel = ref('')
const reason = ref('')
const value = ref<string | null>(null)
const error = ref('')

const reasonValid = computed(() => reason.value.trim().length >= 10)
const revealed = computed(() => value.value !== null)

function reset() {
  accountId.value = null
  field.value = null
  fieldLabel.value = ''
  reason.value = ''
  value.value = null
  error.value = ''
}

function open(id: number, f: CredentialField, label: string) {
  reset()
  accountId.value = id
  field.value = f
  fieldLabel.value = label
  isOpen.value = true
}

function close() {
  isOpen.value = false
  reset()
  emit('close')
}

async function submit() {
  if (!accountId.value || !field.value || !reasonValid.value) return
  error.value = ''
  const v = await revealField(accountId.value, field.value, reason.value.trim())
  if (v === null) {
    error.value = 'Не удалось получить значение'
    return
  }
  value.value = v
}

async function copyValue() {
  if (!value.value) return
  try {
    await navigator.clipboard.writeText(value.value)
    toast.success('Значение скопировано')
  }
  catch {
    error.value = 'Браузер не дал доступ к буферу обмена'
  }
}

defineExpose({ open, close })
</script>

<template>
  <UiModal :open="isOpen" :title="`Показать: ${fieldLabel}`" size="md" @close="close">
    <div v-if="!revealed" class="flex flex-col gap-3">
      <p class="flex gap-2 rounded-md border border-warning-border bg-warning-bg p-2.5 text-sm">
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-warning" />
        <span>Запрос попадёт в журнал доступа вместе с причиной и вашим именем.</span>
      </p>

      <UiField label="Причина" hint="Не короче десяти символов.">
        <UiTextarea v-model="reason" :rows="3" placeholder="Например: ручной вход в аккаунт после смены пароля" />
      </UiField>

      <p v-if="error" class="flex items-center gap-2 rounded-md border border-danger-border bg-danger-bg p-2.5 text-sm text-danger">
        <Icon name="mingcute:warning-line" class="shrink-0" />
        {{ error }}
      </p>
    </div>

    <div v-else class="flex flex-col gap-3">
      <p class="flex gap-2 rounded-md border border-info-border bg-info-bg p-2.5 text-sm">
        <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
        <span>Значение показано на время окна и нигде не сохраняется.</span>
      </p>

      <div class="flex items-center gap-2">
        <code class="min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 py-2 font-mono text-sm break-all">
          {{ value }}
        </code>
        <UiButton variant="primary" @click="copyValue">
          <Icon name="mingcute:copy-2-line" />
          Копировать
        </UiButton>
      </div>
    </div>

    <template #footer>
      <UiButton variant="ghost" @click="close">Закрыть</UiButton>
      <UiButton v-if="!revealed" variant="primary" :disabled="!reasonValid" :loading="isBusy" @click="submit">
        Показать
      </UiButton>
    </template>
  </UiModal>
</template>
