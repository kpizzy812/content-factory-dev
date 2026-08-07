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

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
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
  } catch {
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
  } catch (err: unknown) {
    const data = (err as { data?: { message?: string }, message?: string })
    errorMessage.value = data?.data?.message || data?.message || 'Не удалось подключить аккаунт'
  } finally {
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
  } catch {
    // ignore — пользователь вводит email вручную
  }
}

const CODE = 'rounded-sm border border-divider bg-card px-1 font-mono text-micro text-fg'

// Подсказка под полем меняет тон: нейтральная — пока пусто, зелёная — когда
// значение похоже на правильное, тревожная — когда точно нет.
function hintTone(empty: boolean, valid: boolean) {
  if (empty) return 'text-subtle'
  return valid ? 'text-success' : 'text-warning'
}
</script>

<template>
  <UiModal :open="modelValue" size="lg" :persistent="isSubmitting" @close="handleClose">
    <template #header>
      <span class="flex items-center gap-2">
        Подключить Google Drive
        <UiButton variant="ghost" @click="showGuide = !showGuide">
          <Icon name="mingcute:question-line" class="text-accent-text" />
          <span class="hidden sm:inline">{{ showGuide ? 'Скрыть' : 'Как получить ключ' }}</span>
        </UiButton>
      </span>
    </template>

    <div class="flex flex-col gap-3">
      <p class="text-muted">
        Подключите сервисный аккаунт Google Cloud с правом
        <code :class="CODE">drive.readonly</code>. Все секреты шифруются (AES-256-GCM)
        и не возвращаются на клиент после сохранения.
      </p>

      <!-- Инструкция -->
      <div
        v-if="showGuide"
        class="flex items-start gap-2 rounded-md border border-info-border bg-info-bg px-2.5 py-2"
      >
        <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
        <div class="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
          <p class="font-medium">Шаги получения Service Account JSON</p>
          <ol class="list-inside list-decimal space-y-1 text-muted">
            <li>Откройте <a href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" rel="noopener">Google Cloud Console — IAM → Service Accounts</a>.</li>
            <li>Создайте сервис-аккаунт или выберите существующий.</li>
            <li>Откройте вкладку <b class="text-fg">Keys</b> → Add Key → Create new key → <b class="text-fg">JSON</b>.</li>
            <li>Скачается файл — откройте и скопируйте его содержимое или возьмите оттуда два поля.</li>
            <li>В Google Drive расшарьте нужную папку на <code :class="CODE">client_email</code> сервис-аккаунта.</li>
            <li>Включите <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener">Google Drive API</a> в проекте.</li>
          </ol>
        </div>
      </div>

      <UiField label="Название *" hint="Произвольное имя для отображения в списке подключений.">
        <UiInput v-model="name" placeholder="Например, Drive — Marketing" :disabled="isSubmitting" />
      </UiField>

      <UiField label="Описание (опционально)">
        <UiInput
          v-model="description"
          placeholder="Например, основная папка с креативами для TikTok"
          :disabled="isSubmitting"
        />
      </UiField>

      <div class="flex items-center gap-2 text-micro text-subtle">
        <span class="h-px flex-1 bg-divider" />
        {{ advancedMode ? 'Вставка JSON целиком' : 'Поля сервис-аккаунта' }}
        <span class="h-px flex-1 bg-divider" />
      </div>

      <!-- Поля по отдельности -->
      <template v-if="!advancedMode">
        <UiField label="Email сервис-аккаунта (client_email) *">
          <UiInput
            v-model="clientEmail"
            type="email"
            mono
            placeholder="my-bot@my-project.iam.gserviceaccount.com"
            :disabled="isSubmitting"
            @paste="(e: ClipboardEvent) => handlePastedJson(e.clipboardData?.getData('text') ?? '')"
          />
          <p class="mt-1 text-micro" :class="hintTone(clientEmail.trim().length === 0, emailLooksValid)">
            <template v-if="clientEmail.trim().length === 0">
              Адрес из поля client_email в JSON-файле сервис-аккаунта. Заканчивается на
              <code :class="CODE">.iam.gserviceaccount.com</code>.
            </template>
            <template v-else-if="emailLooksValid">Похоже на корректный email сервис-аккаунта</template>
            <template v-else>
              Email должен заканчиваться на <code :class="CODE">.iam.gserviceaccount.com</code>
            </template>
          </p>
        </UiField>

        <UiField label="Приватный ключ (private_key) *">
          <UiTextarea
            v-model="privateKey"
            :rows="6"
            class="font-mono text-sm"
            placeholder="-----BEGIN PRIVATE KEY-----&#10;MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ...&#10;-----END PRIVATE KEY-----"
            :disabled="isSubmitting"
          />
          <p class="mt-1 text-micro" :class="hintTone(privateKey.length === 0, privateKeyLooksValid)">
            <template v-if="privateKey.length === 0">
              Поле private_key из JSON. Включает строки <code :class="CODE">BEGIN PRIVATE KEY</code> и
              <code :class="CODE">END PRIVATE KEY</code>. Сохраняйте символы переноса строк.
            </template>
            <template v-else-if="privateKeyLooksValid">PEM-блок выглядит корректно</template>
            <template v-else>
              Не найдены строки BEGIN/END PRIVATE KEY — проверьте, что вставили блок целиком
            </template>
          </p>
        </UiField>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <UiField
            label="ID проекта (опционально)"
            hint="project_id из JSON. Используется для отображения, не для авторизации."
          >
            <UiInput v-model="projectId" mono placeholder="my-gcp-project-12345" :disabled="isSubmitting" />
          </UiField>

          <UiField
            label="ID ключа (опционально)"
            hint="private_key_id из JSON. Помогает идентифицировать ротацию ключа."
          >
            <UiInput v-model="privateKeyId" mono placeholder="abc123def456…" :disabled="isSubmitting" />
          </UiField>
        </div>
      </template>

      <!-- JSON целиком -->
      <UiField v-else label="JSON service account целиком *">
        <UiTextarea
          v-model="rawJson"
          :rows="10"
          class="font-mono text-sm"
          placeholder='{ "type": "service_account", "project_id": "...", "private_key": "...", "client_email": "...", ... }'
          :disabled="isSubmitting"
        />
        <p
          class="mt-1 text-micro"
          :class="rawJsonValidation.hint.length === 0
            ? 'text-subtle'
            : rawJsonValidation.valid ? 'text-success' : 'text-danger'"
        >
          {{ rawJsonValidation.hint || 'Вставьте содержимое JSON-файла Service Account целиком.' }}
        </p>
      </UiField>

      <p class="flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-muted">
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-warning" />
        <span>
          После подключения <b class="text-fg">обязательно</b> расшарьте нужную папку в Google Drive
          на email сервис-аккаунта — без этого папка не будет видна.
        </span>
      </p>

      <div class="flex items-center justify-between gap-2">
        <UiButton variant="ghost" @click="advancedMode = !advancedMode">
          <Icon :name="advancedMode ? 'mingcute:textbox-line' : 'mingcute:code-line'" />
          {{ advancedMode ? 'Простая форма (поля)' : 'Расширенный режим (JSON)' }}
        </UiButton>
        <p class="flex items-center gap-1 text-micro text-subtle">
          <Icon name="mingcute:lock-line" />
          Шифрование AES-256-GCM
        </p>
      </div>

      <p
        v-if="errorMessage"
        class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-danger"
      >
        <Icon name="mingcute:warning-line" class="mt-0.5 shrink-0" />
        <span>{{ errorMessage }}</span>
      </p>
    </div>

    <template #footer>
      <UiButton variant="ghost" size="md" :disabled="isSubmitting" @click="handleClose">Отмена</UiButton>
      <UiButton variant="primary" size="md" :disabled="!canSubmit" :loading="isSubmitting" @click="handleSubmit">
        <Icon v-if="!isSubmitting" name="mingcute:link-line" />
        Подключить
      </UiButton>
    </template>
  </UiModal>
</template>
