<script setup lang="ts">
import type { CredentialField } from "~~/app/composables/useAccountCredentials"

const props = defineProps<{
  accountId: number
}>()

const emit = defineEmits<{
  saved: []
}>()

const { saveCredentials, loadMeta, isBusy, error } = useAccountCredentials()

// Поля формы
const loginEmail = ref<string>("")
const loginPassword = ref<string>("")
const recoveryEmail = ref<string>("")
const recoveryPhone = ref<string>("")
const twoFASecret = ref<string>("")
const notes = ref<string>("")
const birthDate = ref<string>("")
const registrationSource = ref<string>("")
const warmupStatus = ref<string>("new")
const postingMethod = ref<string>("api")

const success = ref(false)
const validationError = ref<string | null>(null)
const isLoadingMeta = ref(false)

// Флаги наличия зашифрованных значений (из meta endpoint, никогда не plaintext)
const hasLoginEmail = ref(false)
const hasLoginPassword = ref(false)
const hasRecoveryEmail = ref(false)
const hasRecoveryPhone = ref(false)
const hasTwoFASecret = ref(false)

// Какие поля изменены пользователем — только их отправляем
const dirty = ref<Record<string, boolean>>({})

function markDirty(field: string) {
  dirty.value[field] = true
  success.value = false
  validationError.value = null
}

function placeholderFor(hasValue: boolean): string {
  return hasValue ? "•••••••• (не изменено)" : "(не задано)"
}

onMounted(async () => {
  isLoadingMeta.value = true
  try {
    const meta = await loadMeta(props.accountId)
    if (!meta) return
    notes.value = meta.notes ?? ""
    birthDate.value = meta.birthDate ? meta.birthDate.slice(0, 10) : ""
    registrationSource.value = meta.registrationSource ?? ""
    warmupStatus.value = meta.warmupStatus
    postingMethod.value = meta.postingMethod ?? "api"
    hasLoginEmail.value = meta.hasLoginEmail
    hasLoginPassword.value = meta.hasLoginPassword
    hasRecoveryEmail.value = meta.hasRecoveryEmail
    hasRecoveryPhone.value = meta.hasRecoveryPhone
    hasTwoFASecret.value = meta.hasTwoFASecret
    dirty.value = {}
  } finally {
    isLoadingMeta.value = false
  }
})

const revealModalRef = ref<{
  open: (id: number, field: CredentialField, label: string) => void
}>()

const fieldLabels: Record<CredentialField, string> = {
  loginEmail: "Email для входа",
  loginPassword: "Пароль",
  recoveryEmail: "Email восстановления",
  recoveryPhone: "Телефон восстановления",
  twoFASecret: "2FA секрет",
}

function showField(field: CredentialField) {
  revealModalRef.value?.open(props.accountId, field, fieldLabels[field])
}

const registrationSources = [
  { value: "", label: "Не указан" },
  { value: "self", label: "Самостоятельная регистрация" },
  { value: "purchased", label: "Куплен" },
  { value: "transferred", label: "Передан" },
]

const warmupStatuses = [
  { value: "new", label: "Новый" },
  { value: "warming", label: "Прогревается" },
  { value: "ready", label: "Готов" },
  { value: "cold", label: "Холодный" },
]

async function save() {
  success.value = false
  validationError.value = null

  if (dirty.value.birthDate && birthDate.value) {
    const d = new Date(birthDate.value)
    if (Number.isNaN(d.getTime())) {
      validationError.value = "Поле 'Дата рождения' имеет неверный формат"
      return
    }
    if (d.getTime() > Date.now()) {
      validationError.value = "Поле 'Дата рождения' не может быть в будущем"
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
  if (dirty.value.registrationSource)
    body.registrationSource = registrationSource.value || null
  if (dirty.value.warmupStatus) body.warmupStatus = warmupStatus.value
  if (dirty.value.postingMethod) body.postingMethod = postingMethod.value

  if (Object.keys(body).length === 0) {
    success.value = true
    return
  }

  const ok = await saveCredentials(props.accountId, body)
  if (ok) {
    success.value = true
    dirty.value = {}
    // Очищаем поля паролей после сохранения, чтобы не оставлять plaintext
    if ("loginPassword" in body) {
      loginPassword.value = ""
      hasLoginPassword.value = body.loginPassword !== null
    }
    if ("twoFASecret" in body) {
      twoFASecret.value = ""
      hasTwoFASecret.value = body.twoFASecret !== null
    }
    if ("loginEmail" in body) hasLoginEmail.value = body.loginEmail !== null
    if ("recoveryEmail" in body)
      hasRecoveryEmail.value = body.recoveryEmail !== null
    if ("recoveryPhone" in body)
      hasRecoveryPhone.value = body.recoveryPhone !== null
    emit("saved")
  }
}

function clearLoginEmail() { loginEmail.value = ""; markDirty("loginEmail") }
function clearLoginPassword() { loginPassword.value = ""; markDirty("loginPassword") }
function clearRecoveryEmail() { recoveryEmail.value = ""; markDirty("recoveryEmail") }
function clearRecoveryPhone() { recoveryPhone.value = ""; markDirty("recoveryPhone") }
function clearTwoFASecret() { twoFASecret.value = ""; markDirty("twoFASecret") }
</script>

<template>
  <div class="space-y-3">
    <div role="alert" class="alert alert-info alert-soft text-sm">
      <Icon name="mingcute:information-line" />
      <span>
        Введённые секреты будут зашифрованы. Чтобы увидеть текущее значение, нажмите
        иконку глаза. Чтобы стереть значение — нажмите крестик.
      </span>
    </div>

    <div v-if="isLoadingMeta" class="flex items-center gap-2 text-sm text-base-content/60">
      <span class="loading loading-spinner loading-xs" />
      Загрузка данных аккаунта...
    </div>

    <!-- Метод постинга - переключатель API vs Browser Automation.
         API (default) - через OAuth токены платформ. browser_automation -
         через устройство DuoPlus (для private TikTok / personal
         Instagram где API недоступен). -->
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Метод постинга</legend>
      <div class="flex flex-col gap-2">
        <label class="label cursor-pointer justify-start gap-3 p-0">
          <input
            v-model="postingMethod"
            type="radio"
            class="radio radio-sm"
            value="api"
            @change="markDirty('postingMethod')"
          />
          <div class="flex-1">
            <div class="label-text font-medium">Через API платформы</div>
            <div class="text-xs text-base-content/60">
              OAuth токены (TikTok Business, YouTube Data, Instagram Graph).
              Требует верификации аккаунта на платформе.
            </div>
          </div>
        </label>
        <label class="label cursor-pointer justify-start gap-3 p-0">
          <input
            v-model="postingMethod"
            type="radio"
            class="radio radio-sm"
            value="browser_automation"
            @change="markDirty('postingMethod')"
          />
          <div class="flex-1">
            <div class="label-text font-medium">
              Через устройство DuoPlus (Automation)
              <span class="badge badge-warning badge-soft badge-xs gap-1 ml-1">
                <Icon name="mingcute:warning-line" class="text-[10px]" />
                beta
              </span>
            </div>
            <div class="text-xs text-base-content/60">
              Облачное устройство DuoPlus с уникальным fingerprint. Работает с
              любым типом аккаунта (private TikTok / personal Instagram).
              Требует привязанный профиль устройства с US-прокси и сохранённые cookies.
            </div>
          </div>
        </label>
      </div>
    </fieldset>

    <!-- Hybrid Browser Automation: инструкция логина + TOTP виджет.
         Показывается только когда postingMethod=browser_automation. -->
    <AccountLoginInstructionsBlock
      v-if="postingMethod === 'browser_automation'"
      :account-id="accountId"
      :has-login-email="hasLoginEmail"
      :has-login-password="hasLoginPassword"
      :has-two-f-a-secret="hasTwoFASecret"
    />

    <div class="divider my-2" />

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Email для входа</legend>
      <div class="flex gap-1 items-center">
        <input
          v-model="loginEmail"
          type="text"
          class="input input-sm flex-1"
          :placeholder="placeholderFor(hasLoginEmail)"
          autocomplete="off"
          @input="markDirty('loginEmail')"
        />
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          aria-label="Показать email для входа"
          title="Показать сохранённое значение"
          @click="showField('loginEmail')"
        >
          <Icon name="mingcute:eye-line" />
        </button>
        <button
          type="button"
          class="btn btn-sm btn-ghost text-error"
          aria-label="Очистить email для входа"
          title="Очистить значение"
          @click="clearLoginEmail"
        >
          <Icon name="mingcute:close-line" />
        </button>
      </div>
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Пароль</legend>
      <div class="flex gap-1 items-center">
        <input
          v-model="loginPassword"
          type="password"
          class="input input-sm flex-1"
          :placeholder="placeholderFor(hasLoginPassword)"
          autocomplete="new-password"
          @input="markDirty('loginPassword')"
        />
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          aria-label="Показать пароль"
          title="Показать сохранённое значение"
          @click="showField('loginPassword')"
        >
          <Icon name="mingcute:eye-line" />
        </button>
        <button
          type="button"
          class="btn btn-sm btn-ghost text-error"
          aria-label="Очистить пароль"
          title="Очистить значение"
          @click="clearLoginPassword"
        >
          <Icon name="mingcute:close-line" />
        </button>
      </div>
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Email восстановления</legend>
      <div class="flex gap-1 items-center">
        <input
          v-model="recoveryEmail"
          type="text"
          class="input input-sm flex-1"
          :placeholder="placeholderFor(hasRecoveryEmail)"
          autocomplete="off"
          @input="markDirty('recoveryEmail')"
        />
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          aria-label="Показать email восстановления"
          @click="showField('recoveryEmail')"
        >
          <Icon name="mingcute:eye-line" />
        </button>
        <button
          type="button"
          class="btn btn-sm btn-ghost text-error"
          aria-label="Очистить email восстановления"
          @click="clearRecoveryEmail"
        >
          <Icon name="mingcute:close-line" />
        </button>
      </div>
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Телефон восстановления</legend>
      <div class="flex gap-1 items-center">
        <input
          v-model="recoveryPhone"
          type="text"
          class="input input-sm flex-1"
          :placeholder="placeholderFor(hasRecoveryPhone)"
          autocomplete="off"
          @input="markDirty('recoveryPhone')"
        />
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          aria-label="Показать телефон восстановления"
          @click="showField('recoveryPhone')"
        >
          <Icon name="mingcute:eye-line" />
        </button>
        <button
          type="button"
          class="btn btn-sm btn-ghost text-error"
          aria-label="Очистить телефон восстановления"
          @click="clearRecoveryPhone"
        >
          <Icon name="mingcute:close-line" />
        </button>
      </div>
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">2FA секрет</legend>
      <div class="flex gap-1 items-center">
        <input
          v-model="twoFASecret"
          type="password"
          class="input input-sm flex-1"
          :placeholder="placeholderFor(hasTwoFASecret)"
          autocomplete="new-password"
          @input="markDirty('twoFASecret')"
        />
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          aria-label="Показать 2FA секрет"
          @click="showField('twoFASecret')"
        >
          <Icon name="mingcute:eye-line" />
        </button>
        <button
          type="button"
          class="btn btn-sm btn-ghost text-error"
          aria-label="Очистить 2FA секрет"
          @click="clearTwoFASecret"
        >
          <Icon name="mingcute:close-line" />
        </button>
      </div>
    </fieldset>

    <div class="divider text-xs my-1">Метаданные</div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Дата рождения</legend>
        <input
          v-model="birthDate"
          type="date"
          class="input input-sm w-full"
          @input="markDirty('birthDate')"
        />
      </fieldset>
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Источник</legend>
        <select
          v-model="registrationSource"
          class="select select-sm w-full"
          @change="markDirty('registrationSource')"
        >
          <option v-for="opt in registrationSources" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </fieldset>
    </div>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Статус прогрева</legend>
      <select
        v-model="warmupStatus"
        class="select select-sm w-full"
        @change="markDirty('warmupStatus')"
      >
        <option v-for="opt in warmupStatuses" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Заметки</legend>
      <textarea
        v-model="notes"
        class="textarea textarea-sm w-full"
        rows="3"
        placeholder="Любые операторские заметки (не шифруется)"
        @input="markDirty('notes')"
      />
    </fieldset>

    <div v-if="validationError" role="alert" class="alert alert-warning alert-soft">
      <Icon name="mingcute:warning-line" />
      <span>{{ validationError }}</span>
    </div>

    <div v-if="error" role="alert" class="alert alert-error alert-soft">
      <Icon name="mingcute:warning-line" />
      <span>{{ error }}</span>
    </div>

    <div v-if="success" role="alert" class="alert alert-success alert-soft">
      <Icon name="mingcute:check-circle-line" />
      <span>Сохранено</span>
    </div>

    <div class="flex justify-end">
      <button class="btn btn-primary btn-sm" :disabled="isBusy" @click="save">
        <span v-if="isBusy" class="loading loading-spinner loading-xs" />
        Сохранить
      </button>
    </div>

    <AccountCredentialRevealModal ref="revealModalRef" />
  </div>
</template>
