<script setup lang="ts">
const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  'created': [credentialId: number]
}>()

const { createCredential } = useGoogleDrive()

const name = ref('')
const description = ref('')
const clientEmail = ref('')
const privateKey = ref('')
const projectId = ref('')
const privateKeyId = ref('')

const advancedMode = ref(false)
const rawJson = ref('')
const showGuide = ref(false)

const isSubmitting = ref(false)
const errorMessage = ref<string | null>(null)

const dialogRef = ref<HTMLDialogElement | null>(null)

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      name.value = ''
      description.value = ''
      clientEmail.value = ''
      privateKey.value = ''
      projectId.value = ''
      privateKeyId.value = ''
      rawJson.value = ''
      advancedMode.value = false
      showGuide.value = false
      errorMessage.value = null
      nextTick(() => dialogRef.value?.showModal())
    }
    else {
      dialogRef.value?.close()
    }
  },
)

const emailLooksValid = computed(() => /@[a-z0-9.-]+\.iam\.gserviceaccount\.com$/i.test(clientEmail.value.trim()))
const privateKeyLooksValid = computed(() => privateKey.value.includes('BEGIN PRIVATE KEY') && privateKey.value.includes('END PRIVATE KEY'))

const typedFieldsValid = computed(() => emailLooksValid.value && privateKeyLooksValid.value)

const rawJsonValidation = computed(() => {
  const raw = rawJson.value.trim()
  if (raw.length === 0) return { valid: false, hint: '' }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed.type !== 'service_account') {
      return { valid: false, hint: 'Поле type должно быть "service_account"' }
    }
    if (typeof parsed.private_key !== 'string' || (parsed.private_key as string).length === 0) {
      return { valid: false, hint: 'Отсутствует private_key' }
    }
    if (typeof parsed.client_email !== 'string' || (parsed.client_email as string).length === 0) {
      return { valid: false, hint: 'Отсутствует client_email' }
    }
    return { valid: true, hint: `OK: ${parsed.client_email as string}` }
  }
  catch {
    return { valid: false, hint: 'Невалидный JSON' }
  }
})

const canSubmit = computed(() => {
  if (name.value.trim().length < 2) return false
  if (isSubmitting.value) return false
  return advancedMode.value ? rawJsonValidation.value.valid : typedFieldsValid.value
})

function buildServiceAccountJson(): string {
  if (advancedMode.value) return rawJson.value.trim()
  const sa: Record<string, string> = {
    type: 'service_account',
    client_email: clientEmail.value.trim(),
    private_key: privateKey.value,
    token_uri: 'https://oauth2.googleapis.com/token',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  }
  if (projectId.value.trim()) sa.project_id = projectId.value.trim()
  if (privateKeyId.value.trim()) sa.private_key_id = privateKeyId.value.trim()
  return JSON.stringify(sa)
}

async function handleSubmit() {
  if (!canSubmit.value) return
  isSubmitting.value = true
  errorMessage.value = null
  try {
    const cred = await createCredential({
      name: name.value.trim(),
      description: description.value.trim() || undefined,
      serviceAccountJson: buildServiceAccountJson(),
    })
    emit('created', cred.id)
    emit('update:modelValue', false)
  }
  catch (err: unknown) {
    const data = (err as { data?: { message?: string }, message?: string })
    errorMessage.value = data?.data?.message || data?.message || 'Не удалось подключить аккаунт'
  }
  finally {
    isSubmitting.value = false
  }
}

function handleClose() {
  emit('update:modelValue', false)
}

function handlePastedJson(value: string) {
  const trimmed = value.trim()
  if (!trimmed.startsWith('{')) return
  try {
    const parsed = JSON.parse(trimmed) as Record<string, string>
    if (parsed.type !== 'service_account') return
    if (typeof parsed.client_email === 'string') clientEmail.value = parsed.client_email
    if (typeof parsed.private_key === 'string') privateKey.value = parsed.private_key
    if (typeof parsed.project_id === 'string') projectId.value = parsed.project_id
    if (typeof parsed.private_key_id === 'string') privateKeyId.value = parsed.private_key_id
  }
  catch {
    // ignore — пользователь вводит email вручную
  }
}
</script>

<template>
  <dialog ref="dialogRef" class="modal" @close="handleClose">
    <div class="modal-box max-w-2xl my-8 max-h-[calc(100vh-4rem)]">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-lg font-bold">Подключить Google Drive</h3>
        <button
          class="btn btn-ghost btn-sm"
          :title="showGuide ? 'Скрыть инструкцию' : 'Показать инструкцию'"
          @click="showGuide = !showGuide"
        >
          <Icon name="mingcute:question-line" class="h-4 w-4 text-primary" />
          <span class="hidden sm:inline">{{ showGuide ? 'Скрыть' : 'Как получить ключ' }}</span>
        </button>
      </div>

      <p class="text-sm text-base-content/70 mb-4">
        Подключите сервисный аккаунт Google Cloud с правом
        <code class="text-xs bg-base-200 px-1 rounded">drive.readonly</code>.
        Все секреты шифруются (AES-256-GCM) и не возвращаются на клиент после сохранения.
      </p>

      <!-- Setup guide accordion -->
      <div v-if="showGuide" class="alert mb-4 flex-col items-start">
        <div class="flex items-start gap-2 w-full">
          <Icon name="mingcute:information-line" class="h-5 w-5 shrink-0 text-info" />
          <div class="flex-1 text-xs space-y-1.5">
            <p class="font-medium text-sm">Шаги получения Service Account JSON</p>
            <ol class="list-decimal list-inside space-y-1 text-base-content/70">
              <li>Откройте <a href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" rel="noopener" class="link link-primary">Google Cloud Console — IAM &rarr; Service Accounts</a>.</li>
              <li>Создайте сервис-аккаунт (или выберите существующий).</li>
              <li>Откройте вкладку <b>Keys</b> &rarr; Add Key &rarr; Create new key &rarr; <b>JSON</b>.</li>
              <li>Скачается файл — откройте и скопируйте его содержимое или возьмите оттуда два поля.</li>
              <li>В Google Drive расшарьте нужную папку (<b>Доступ</b>) на <code class="bg-base-200 px-1 rounded">client_email</code> сервис-аккаунта.</li>
              <li>Включите <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener" class="link link-primary">Google Drive API</a> в проекте.</li>
            </ol>
          </div>
        </div>
      </div>

      <!-- Name -->
      <fieldset class="fieldset mb-2">
        <legend class="fieldset-legend">
          Название <span class="text-error">*</span>
        </legend>
        <input
          v-model="name"
          type="text"
          placeholder="Например, Drive — Marketing"
          class="input w-full"
          :disabled="isSubmitting"
        >
        <p class="text-xs text-base-content/50 mt-1">
          Произвольное имя для отображения в списке подключений.
        </p>
      </fieldset>

      <!-- Description -->
      <fieldset class="fieldset mb-3">
        <legend class="fieldset-legend">Описание (опционально)</legend>
        <input
          v-model="description"
          type="text"
          placeholder="Например, основная папка с креативами для tiktok"
          class="input w-full"
          :disabled="isSubmitting"
        >
      </fieldset>

      <!-- Mode toggle -->
      <div class="divider text-xs text-base-content/40 my-2">
        {{ advancedMode ? 'Вставка JSON целиком' : 'Поля сервис-аккаунта' }}
      </div>

      <!-- Typed fields mode -->
      <template v-if="!advancedMode">
        <fieldset class="fieldset mb-2">
          <legend class="fieldset-legend">
            Email сервис-аккаунта (client_email) <span class="text-error">*</span>
          </legend>
          <input
            v-model="clientEmail"
            type="email"
            placeholder="my-bot@my-project.iam.gserviceaccount.com"
            class="input w-full font-mono text-sm"
            :disabled="isSubmitting"
            @paste="(e) => handlePastedJson((e.clipboardData?.getData('text') ?? ''))"
          >
          <p
            class="text-xs mt-1"
            :class="emailLooksValid ? 'text-success' : 'text-base-content/50'"
          >
            <template v-if="clientEmail.trim().length === 0">
              Адрес из поля client_email в JSON-файле сервис-аккаунта. Заканчивается на <code class="bg-base-200 px-1 rounded">.iam.gserviceaccount.com</code>.
            </template>
            <template v-else-if="emailLooksValid">
              ✓ Похоже на корректный email сервис-аккаунта
            </template>
            <template v-else>
              ⚠ Email должен заканчиваться на <code class="bg-base-200 px-1 rounded">.iam.gserviceaccount.com</code>
            </template>
          </p>
        </fieldset>

        <fieldset class="fieldset mb-2">
          <legend class="fieldset-legend">
            Приватный ключ (private_key) <span class="text-error">*</span>
          </legend>
          <textarea
            v-model="privateKey"
            class="textarea w-full font-mono text-xs"
            rows="6"
            placeholder="-----BEGIN PRIVATE KEY-----&#10;MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ...&#10;-----END PRIVATE KEY-----"
            :disabled="isSubmitting"
          />
          <p
            class="text-xs mt-1"
            :class="privateKeyLooksValid ? 'text-success' : 'text-base-content/50'"
          >
            <template v-if="privateKey.length === 0">
              Поле private_key из JSON. Включает строки <code class="bg-base-200 px-1 rounded">BEGIN PRIVATE KEY</code> и <code class="bg-base-200 px-1 rounded">END PRIVATE KEY</code>. Сохраняйте символы переноса строк.
            </template>
            <template v-else-if="privateKeyLooksValid">
              ✓ PEM-блок выглядит корректно
            </template>
            <template v-else>
              ⚠ Не найдены строки BEGIN/END PRIVATE KEY — проверьте что вставили блок целиком
            </template>
          </p>
        </fieldset>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">ID проекта (опционально)</legend>
            <input
              v-model="projectId"
              type="text"
              placeholder="my-gcp-project-12345"
              class="input input-sm w-full font-mono text-xs"
              :disabled="isSubmitting"
            >
            <p class="text-xs text-base-content/50 mt-1">
              project_id из JSON. Используется для отображения, не для авторизации.
            </p>
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">ID ключа (опционально)</legend>
            <input
              v-model="privateKeyId"
              type="text"
              placeholder="abc123def456..."
              class="input input-sm w-full font-mono text-xs"
              :disabled="isSubmitting"
            >
            <p class="text-xs text-base-content/50 mt-1">
              private_key_id из JSON. Помогает идентифицировать ротацию ключа.
            </p>
          </fieldset>
        </div>
      </template>

      <!-- Advanced JSON mode -->
      <template v-else>
        <fieldset class="fieldset mb-3">
          <legend class="fieldset-legend">
            JSON service account целиком <span class="text-error">*</span>
          </legend>
          <textarea
            v-model="rawJson"
            class="textarea w-full font-mono text-xs"
            rows="10"
            placeholder='{ "type": "service_account", "project_id": "...", "private_key": "...", "client_email": "...", ... }'
            :disabled="isSubmitting"
          />
          <p
            class="text-xs mt-1"
            :class="{
              'text-success': rawJsonValidation.valid,
              'text-error': !rawJsonValidation.valid && rawJsonValidation.hint.length > 0,
              'text-base-content/50': rawJsonValidation.hint.length === 0,
            }"
          >
            {{ rawJsonValidation.hint || 'Вставьте содержимое JSON-файла Service Account целиком.' }}
          </p>
        </fieldset>
      </template>

      <!-- Critical hint about folder sharing -->
      <div class="alert alert-warning text-xs mb-3">
        <Icon name="mingcute:alert-line" class="h-4 w-4 shrink-0" />
        <span>
          После подключения <b>обязательно</b> расшарьте нужную папку в Google Drive на email сервис-аккаунта — без этого папка не будет видна.
        </span>
      </div>

      <!-- Mode toggle button -->
      <div class="flex items-center justify-between mb-3">
        <button
          class="btn btn-ghost btn-xs text-base-content/60"
          type="button"
          @click="advancedMode = !advancedMode"
        >
          <Icon :name="advancedMode ? 'mingcute:textbox-line' : 'mingcute:code-line'" class="h-3.5 w-3.5" />
          {{ advancedMode ? 'Простая форма (поля)' : 'Расширенный режим (JSON)' }}
        </button>
        <p class="text-xs text-base-content/40">
          <Icon name="mingcute:lock-line" class="h-3 w-3 inline" />
          Шифрование AES-256-GCM
        </p>
      </div>

      <div v-if="errorMessage" class="alert alert-error mb-3 text-sm">
        <Icon name="mingcute:warning-line" class="h-5 w-5" />
        <span>{{ errorMessage }}</span>
      </div>

      <div class="modal-action">
        <button class="btn btn-ghost" :disabled="isSubmitting" @click="handleClose">
          Отмена
        </button>
        <button
          class="btn btn-primary"
          :disabled="!canSubmit"
          @click="handleSubmit"
        >
          <span v-if="isSubmitting" class="loading loading-spinner loading-sm" />
          <Icon v-else name="mingcute:link-line" class="h-4 w-4" />
          Подключить
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="handleClose">close</button>
    </form>
  </dialog>
</template>
