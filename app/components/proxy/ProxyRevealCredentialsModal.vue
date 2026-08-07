<script setup lang="ts">
const emit = defineEmits<{
  close: []
}>()

// Открывается императивно из строки списка прокси.
const isOpen = ref(false)

interface RevealedData {
  host: string | null
  port: number
  username: string | null
  password: string | null
  rotationUrl: string | null
  formatted: string
}

const proxyId = ref<string | null>(null)
const proxyLabel = ref('')
const reason = ref('')
const revealed = ref<RevealedData | null>(null)
const error = ref('')
const copiedField = ref<string | null>(null)

const { revealProxy, isBusy } = useProxyActions()

const isStep2 = computed(() => revealed.value !== null)
const reasonValid = computed(() => reason.value.trim().length >= 10)

function open(id: string, label: string) {
  reset()
  proxyId.value = id
  proxyLabel.value = label
  isOpen.value = true
}

function reset() {
  proxyId.value = null
  proxyLabel.value = ''
  reason.value = ''
  revealed.value = null
  error.value = ''
  copiedField.value = null
}

function close() {
  isOpen.value = false
  reset()
  emit('close')
}

async function submit() {
  if (!proxyId.value || !reasonValid.value) return
  error.value = ''
  const data = await revealProxy(proxyId.value, reason.value.trim())
  if (!data) {
    error.value = 'Не удалось получить креды'
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
    error.value = 'Не удалось скопировать'
  }
}

defineExpose({ open, close })

const CODE = 'min-w-0 flex-1 rounded-sm border border-divider bg-card px-2 py-1 font-mono text-sm break-all'
</script>

<template>
  <UiModal :open="isOpen" title="Расшифровка кредов" @close="close">
    <div class="flex flex-col gap-3">
      <p class="text-muted">
        Прокси: <strong class="text-fg">{{ proxyLabel }}</strong>
      </p>

      <!-- Шаг 1: причина -->
      <template v-if="!isStep2">
        <p class="flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-muted">
          <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-warning" />
          <span>Действие будет записано в журнал доступа. Укажите причину доступа.</span>
        </p>

        <UiField label="Причина (минимум 10 символов)">
          <UiTextarea
            v-model="reason"
            :rows="3"
            placeholder="Например: подключение к профилю устройства"
          />
          <SharedFieldHint
            text="Причина попадает в журнал доступа к секретам рядом с вашим именем и временем."
            :max-length="500"
            :current-length="reason.trim().length"
          />
        </UiField>

        <p
          v-if="error"
          class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-danger"
        >
          <Icon name="mingcute:warning-line" class="mt-0.5 shrink-0" />
          <span>{{ error }}</span>
        </p>
      </template>

      <!-- Шаг 2: показанные креды -->
      <template v-else>
        <p class="flex items-start gap-2 rounded-md border border-info-border bg-info-bg px-2.5 py-2 text-muted">
          <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
          <span>Креды показаны временно. После закрытия окна они исчезнут из памяти.</span>
        </p>

        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <span class="w-24 shrink-0 text-sm text-muted">Host</span>
            <code :class="CODE">{{ revealed?.host ?? '—' }}</code>
            <UiButton v-if="revealed?.host" variant="ghost" icon-only @click="copyTo('host', revealed.host)">
              <Icon :name="copiedField === 'host' ? 'mingcute:check-line' : 'mingcute:copy-2-line'" />
            </UiButton>
          </div>

          <div class="flex items-center gap-2">
            <span class="w-24 shrink-0 text-sm text-muted">Port</span>
            <code :class="CODE">{{ revealed?.port }}</code>
          </div>

          <div class="flex items-center gap-2">
            <span class="w-24 shrink-0 text-sm text-muted">Username</span>
            <code :class="CODE">{{ revealed?.username ?? '—' }}</code>
            <UiButton v-if="revealed?.username" variant="ghost" icon-only @click="copyTo('username', revealed.username)">
              <Icon :name="copiedField === 'username' ? 'mingcute:check-line' : 'mingcute:copy-2-line'" />
            </UiButton>
          </div>

          <div class="flex items-center gap-2">
            <span class="w-24 shrink-0 text-sm text-muted">Password</span>
            <code :class="CODE">{{ revealed?.password ?? '—' }}</code>
            <UiButton v-if="revealed?.password" variant="ghost" icon-only @click="copyTo('password', revealed.password)">
              <Icon :name="copiedField === 'password' ? 'mingcute:check-line' : 'mingcute:copy-2-line'" />
            </UiButton>
          </div>

          <div v-if="revealed?.rotationUrl" class="flex items-center gap-2">
            <span class="w-24 shrink-0 text-sm text-muted">Rotation URL</span>
            <code :class="CODE">{{ revealed.rotationUrl }}</code>
            <UiButton variant="ghost" icon-only @click="copyTo('rotationUrl', revealed.rotationUrl)">
              <Icon :name="copiedField === 'rotationUrl' ? 'mingcute:check-line' : 'mingcute:copy-2-line'" />
            </UiButton>
          </div>

          <div class="flex items-center gap-2 text-micro text-subtle">
            <span class="h-px flex-1 bg-divider" />
            Готовая строка
            <span class="h-px flex-1 bg-divider" />
          </div>

          <div class="flex items-center gap-2">
            <code :class="CODE">{{ revealed?.formatted }}</code>
            <UiButton v-if="revealed?.formatted" variant="primary" @click="copyTo('formatted', revealed.formatted)">
              <Icon :name="copiedField === 'formatted' ? 'mingcute:check-line' : 'mingcute:copy-2-line'" />
              Скопировать
            </UiButton>
          </div>
        </div>
      </template>
    </div>

    <template #footer>
      <UiButton variant="ghost" size="md" @click="close">Закрыть</UiButton>
      <UiButton
        v-if="!isStep2"
        variant="primary"
        size="md"
        :disabled="!reasonValid"
        :loading="isBusy"
        @click="submit"
      >
        Показать креды
      </UiButton>
    </template>
  </UiModal>
</template>
