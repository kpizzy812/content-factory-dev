<script setup lang="ts">
import type { CredentialField } from '~~/app/composables/useAccountCredentials'

/**
 * Доступы аккаунта. Секреты шифруются на сервере, наружу приходят только флаги
 * «значение задано» — поэтому поля показывают звёздочки, а не содержимое.
 */
const props = defineProps<{ accountId: number }>()

const emit = defineEmits<{ saved: [] }>()

const toast = useToast()
const { saveCredentials, loadMeta, isBusy, error } = useAccountCredentials()
const { legacyModules, loadLegacyModules } = useLegacyModules()
loadLegacyModules()

const loginEmail = ref('')
const loginPassword = ref('')
const recoveryEmail = ref('')
const recoveryPhone = ref('')
const twoFASecret = ref('')
const notes = ref('')
const birthDate = ref('')
const registrationSource = ref('')
const warmupStatus = ref('new')
const postingMethod = ref('api')

const validationError = ref<string | null>(null)
const isLoadingMeta = ref(false)

const has = reactive({
  loginEmail: false,
  loginPassword: false,
  recoveryEmail: false,
  recoveryPhone: false,
  twoFASecret: false,
})

/** Отправляем только изменённые поля: пустое поле секрета не должно его стирать. */
const dirty = ref<Record<string, boolean>>({})

function markDirty(field: string) {
  dirty.value[field] = true
  validationError.value = null
}

onMounted(async () => {
  isLoadingMeta.value = true
  try {
    const meta = await loadMeta(props.accountId)
    if (!meta) return
    notes.value = meta.notes ?? ''
    birthDate.value = meta.birthDate ? meta.birthDate.slice(0, 10) : ''
    registrationSource.value = meta.registrationSource ?? ''
    warmupStatus.value = meta.warmupStatus
    postingMethod.value = meta.postingMethod ?? 'api'
    has.loginEmail = meta.hasLoginEmail
    has.loginPassword = meta.hasLoginPassword
    has.recoveryEmail = meta.hasRecoveryEmail
    has.recoveryPhone = meta.hasRecoveryPhone
    has.twoFASecret = meta.hasTwoFASecret
    dirty.value = {}
  }
  finally {
    isLoadingMeta.value = false
  }
})

const revealModalRef = ref<{ open: (id: number, field: CredentialField, label: string) => void }>()

const FIELD_LABELS: Record<CredentialField, string> = {
  loginEmail: 'Email для входа',
  loginPassword: 'Пароль',
  recoveryEmail: 'Email восстановления',
  recoveryPhone: 'Телефон восстановления',
  twoFASecret: 'Секрет 2FA',
}

const SECRET_FIELDS: Array<{ key: CredentialField, model: Ref<string>, type?: string }> = [
  { key: 'loginEmail', model: loginEmail },
  { key: 'loginPassword', model: loginPassword, type: 'password' },
  { key: 'recoveryEmail', model: recoveryEmail },
  { key: 'recoveryPhone', model: recoveryPhone },
  { key: 'twoFASecret', model: twoFASecret, type: 'password' },
]

function showField(field: CredentialField) {
  revealModalRef.value?.open(props.accountId, field, FIELD_LABELS[field])
}

function clearField(field: CredentialField) {
  const entry = SECRET_FIELDS.find(f => f.key === field)
  if (entry) entry.model.value = ''
  markDirty(field)
}

const REGISTRATION_SOURCES = [
  { value: '', label: 'Не указан' },
  { value: 'self', label: 'Самостоятельная регистрация' },
  { value: 'purchased', label: 'Куплен' },
  { value: 'transferred', label: 'Передан' },
]

const WARMUP_STATUSES = [
  { value: 'new', label: 'Новый' },
  { value: 'warming', label: 'Прогревается' },
  { value: 'ready', label: 'Готов' },
  { value: 'cold', label: 'Холодный' },
]

async function save() {
  validationError.value = null

  if (dirty.value.birthDate && birthDate.value) {
    const d = new Date(birthDate.value)
    if (Number.isNaN(d.getTime())) {
      validationError.value = 'Дата рождения в неверном формате'
      return
    }
    if (d.getTime() > Date.now()) {
      validationError.value = 'Дата рождения не может быть в будущем'
      return
    }
  }

  const body: Record<string, string | null> = {}
  if (dirty.value.loginEmail) body.loginEmail = loginEmail.value || null
  if (dirty.value.loginPassword) body.loginPassword = loginPassword.value || null
  if (dirty.value.recoveryEmail) body.recoveryEmail = recoveryEmail.value || null
  if (dirty.value.recoveryPhone) body.recoveryPhone = recoveryPhone.value || null
  if (dirty.value.twoFASecret) body.twoFASecret = twoFASecret.value || null
  if (dirty.value.notes) body.notes = notes.value || null
  if (dirty.value.birthDate) body.birthDate = birthDate.value || null
  if (dirty.value.registrationSource) body.registrationSource = registrationSource.value || null
  if (dirty.value.warmupStatus) body.warmupStatus = warmupStatus.value
  if (dirty.value.postingMethod) body.postingMethod = postingMethod.value

  if (Object.keys(body).length === 0) {
    toast.info('Менять нечего — ни одно поле не тронуто')
    return
  }

  const ok = await saveCredentials(props.accountId, body)
  if (!ok) return

  dirty.value = {}
  // Пароли не оставляем в форме открытым текстом после сохранения.
  if ('loginPassword' in body) {
    loginPassword.value = ''
    has.loginPassword = body.loginPassword !== null
  }
  if ('twoFASecret' in body) {
    twoFASecret.value = ''
    has.twoFASecret = body.twoFASecret !== null
  }
  if ('loginEmail' in body) has.loginEmail = body.loginEmail !== null
  if ('recoveryEmail' in body) has.recoveryEmail = body.recoveryEmail !== null
  if ('recoveryPhone' in body) has.recoveryPhone = body.recoveryPhone !== null

  toast.success('Доступы сохранены')
  emit('saved')
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <p class="flex gap-2 rounded-md border border-info-border bg-info-bg p-2.5 text-sm">
      <Icon name="mingcute:lock-line" class="mt-0.5 shrink-0 text-info" />
      <span>
        Секреты шифруются AES-256-GCM. Чтобы увидеть сохранённое значение — глаз,
        чтобы стереть — крестик и «Сохранить».
      </span>
    </p>

    <UiSkeleton v-if="isLoadingMeta" variant="details" :count="4" />

    <template v-else>
      <UiField v-if="legacyModules.deviceAutomation" label="Метод постинга">
        <div class="flex flex-col gap-2">
          <label class="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-card p-2.5">
            <input
              v-model="postingMethod"
              type="radio"
              value="api"
              class="mt-0.5 size-3.5 cursor-pointer accent-(--color-accent)"
              @change="markDirty('postingMethod')"
            >
            <span class="min-w-0">
              <span class="block text-sm font-medium">Официальный API платформы</span>
              <span class="block text-sm text-muted">
                OAuth-токены TikTok Business, YouTube Data и Instagram Graph. Требует
                верификации аккаунта на платформе.
              </span>
            </span>
          </label>
          <label class="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-card p-2.5">
            <input
              v-model="postingMethod"
              type="radio"
              value="browser_automation"
              class="mt-0.5 size-3.5 cursor-pointer accent-(--color-accent)"
              @change="markDirty('postingMethod')"
            >
            <span class="min-w-0">
              <span class="block text-sm font-medium">Через устройство · унаследованный контур</span>
              <span class="block text-sm text-muted">
                Публикация с облачного устройства. Нужны прокси, профиль устройства и
                сохранённая сессия. Зона живёт под флагом и по умолчанию выключена.
              </span>
            </span>
          </label>
        </div>
      </UiField>

      <AccountLoginInstructionsBlock
        v-if="postingMethod === 'browser_automation' && legacyModules.deviceAutomation"
        :account-id="accountId"
        :has-login-email="has.loginEmail"
        :has-login-password="has.loginPassword"
        :has-two-f-a-secret="has.twoFASecret"
      />

      <div class="flex flex-col gap-3">
        <AccountSecretField
          v-for="field in SECRET_FIELDS"
          :key="field.key"
          v-model="field.model.value"
          :label="FIELD_LABELS[field.key]"
          :type="field.type"
          :has-value="has[field.key]"
          @update:model-value="markDirty(field.key)"
          @reveal="showField(field.key)"
          @clear="clearField(field.key)"
        />
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        <UiField label="Дата рождения">
          <UiInput v-model="birthDate" type="date" @update:model-value="markDirty('birthDate')" />
        </UiField>
        <UiField label="Источник аккаунта">
          <UiSelect
            v-model="registrationSource"
            :options="REGISTRATION_SOURCES"
            @update:model-value="markDirty('registrationSource')"
          />
        </UiField>
      </div>

      <UiField v-if="legacyModules.deviceAutomation" label="Статус прогрева">
        <UiSelect v-model="warmupStatus" :options="WARMUP_STATUSES" @update:model-value="markDirty('warmupStatus')" />
      </UiField>

      <UiField label="Заметки" hint="Операторский текст, не шифруется.">
        <UiTextarea v-model="notes" :rows="3" placeholder="Что важно помнить об этом аккаунте" @update:model-value="markDirty('notes')" />
      </UiField>

      <p v-if="validationError" class="flex items-center gap-2 rounded-md border border-warning-border bg-warning-bg p-2.5 text-sm text-warning">
        <Icon name="mingcute:warning-line" class="shrink-0" />
        {{ validationError }}
      </p>

      <p v-if="error" class="flex items-center gap-2 rounded-md border border-danger-border bg-danger-bg p-2.5 text-sm text-danger">
        <Icon name="mingcute:warning-line" class="shrink-0" />
        {{ error }}
      </p>

      <div class="flex justify-end">
        <UiButton variant="primary" :loading="isBusy" @click="save">Сохранить</UiButton>
      </div>
    </template>

    <AccountCredentialRevealModal ref="revealModalRef" />
  </div>
</template>
