<script setup lang="ts">
/**
 * Инструкция для оператора как залогиниться через устройство DuoPlus:
 *   1. Войти в аккаунт в приложении соцсети на устройстве DuoPlus
 *   2. Ввести email/пароль (reveal через иконку ниже)
 *   3. Если нужен 2FA - live TOTP виджет здесь
 *
 * Автоматическая проверка логина (login-check) заморожена на время миграции DuoPlus -
 * device-движок ещё не реализован. Для OAuth-аккаунтов сессия валидируется через refresh.
 *
 * Показывается только когда postingMethod === 'browser_automation'.
 */
import type { CredentialField } from "~~/app/composables/useAccountCredentials"

const props = defineProps<{
  accountId: number
  hasLoginEmail: boolean
  hasLoginPassword: boolean
  hasTwoFASecret: boolean
}>()

const { revealField, error: revealError } = useAccountCredentials()
const { setSecret, code, remainingSec, progress } = useTotp()

const revealModalRef = ref<{
  open: (id: number, field: CredentialField, label: string) => void
}>()

const fieldLabels: Record<CredentialField, string> = {
  loginEmail: 'Email для входа',
  loginPassword: 'Пароль',
  recoveryEmail: 'Email восстановления',
  recoveryPhone: 'Телефон восстановления',
  twoFASecret: '2FA секрет',
}

function showField(field: CredentialField) {
  revealModalRef.value?.open(props.accountId, field, fieldLabels[field])
}

const isLoadingTotp = ref(false)
const totpError = ref<string | null>(null)
const totpRevealed = ref(false)
const totpReason = ref('')

async function revealTotpAndStart() {
  totpError.value = null
  if (totpReason.value.trim().length < 10) {
    totpError.value = 'Укажите причину (минимум 10 символов) — действие пишется в audit log.'
    return
  }
  isLoadingTotp.value = true
  try {
    const secret = await revealField(props.accountId, 'twoFASecret', totpReason.value.trim())
    if (secret) {
      setSecret(secret)
      totpRevealed.value = true
    } else {
      totpError.value = '2FA секрет не задан или не удалось расшифровать.'
    }
  } finally {
    isLoadingTotp.value = false
  }
}

function hideTotp() {
  setSecret(null)
  totpRevealed.value = false
  totpReason.value = ''
}

async function copyCode() {
  if (!code.value) return
  try {
    await navigator.clipboard.writeText(code.value)
  } catch {
    /* ignore */
  }
}

onBeforeUnmount(() => {
  hideTotp()
})
</script>

<template>
  <div class="card bg-base-200">
    <div class="card-body p-4 gap-3">
      <h4 class="card-title text-base flex items-center gap-2">
        <Icon name="mingcute:robot-line" class="text-warning" />
        Hybrid Browser Automation
      </h4>

      <div role="alert" class="alert alert-warning alert-soft text-xs gap-2">
        <Icon name="mingcute:information-line" class="text-sm" />
        <div>
          Этот аккаунт постит через устройство DuoPlus. Перед первым постом войдите в аккаунт
          в приложении соцсети на устройстве DuoPlus - runner будет использовать сохранённую сессию.
        </div>
      </div>

      <!-- Шаги логина -->
      <ol class="list-decimal list-inside text-sm space-y-1 text-base-content/80">
        <li>
          Откройте устройство DuoPlus
        </li>
        <li>
          Войдите в аккаунт в приложении соцсети на устройстве DuoPlus
        </li>
        <li>
          Введите email и пароль (см. ниже - кликните "Показать" для расшифровки)
        </li>
        <li v-if="hasTwoFASecret">
          Если платформа запросит код 2FA - используйте live-генератор ниже
        </li>
      </ol>

      <div role="alert" class="alert alert-info alert-soft text-xs gap-2">
        <Icon name="mingcute:information-line" class="text-sm" />
        <div>
          Автоматическая проверка логина заморожена на время миграции DuoPlus.
          Для OAuth-аккаунтов сессия валидируется через refresh автоматически.
        </div>
      </div>

      <div class="divider my-1 text-xs">Доступы для входа</div>

      <!-- Login email reveal -->
      <div class="flex items-center justify-between gap-2 text-sm">
        <span class="text-base-content/70">Email:</span>
        <div class="flex items-center gap-1">
          <span v-if="hasLoginEmail" class="text-success text-xs">✓ задан</span>
          <span v-else class="text-base-content/40 text-xs">не задан</span>
          <button
            type="button"
            class="btn btn-xs btn-ghost"
            :disabled="!hasLoginEmail"
            aria-label="Показать сохранённый email"
            @click="showField('loginEmail')"
          >
            <Icon name="mingcute:eye-line" /> Показать
          </button>
        </div>
      </div>

      <!-- Login password reveal -->
      <div class="flex items-center justify-between gap-2 text-sm">
        <span class="text-base-content/70">Пароль:</span>
        <div class="flex items-center gap-1">
          <span v-if="hasLoginPassword" class="text-success text-xs">✓ задан</span>
          <span v-else class="text-base-content/40 text-xs">не задан</span>
          <button
            type="button"
            class="btn btn-xs btn-ghost"
            :disabled="!hasLoginPassword"
            aria-label="Показать сохранённый пароль"
            @click="showField('loginPassword')"
          >
            <Icon name="mingcute:eye-line" /> Показать
          </button>
        </div>
      </div>

      <!-- Reveal error display (P1-4 critic) -->
      <div
        v-if="revealError"
        role="alert"
        class="alert alert-error alert-soft text-xs gap-1 py-1 px-2"
        aria-live="polite"
      >
        <Icon name="mingcute:warning-line" class="text-sm" />
        <span>{{ revealError }}</span>
      </div>

      <!-- 2FA live TOTP -->
      <div v-if="hasTwoFASecret" class="divider my-1 text-xs">2FA код (TOTP)</div>

      <div v-if="hasTwoFASecret">
        <div v-if="!totpRevealed" class="space-y-2">
          <p class="text-xs text-base-content/60">
            Live-генератор обновляет код каждые 30 секунд. Действие пишется в audit log.
          </p>
          <fieldset class="fieldset">
            <legend class="fieldset-legend text-xs">Причина (минимум 10 символов)</legend>
            <textarea
              v-model="totpReason"
              class="textarea textarea-xs w-full"
              rows="2"
              placeholder="Например: ручная авторизация на устройстве DuoPlus"
            />
          </fieldset>
          <div v-if="totpError" role="alert" class="alert alert-error alert-soft text-xs gap-1 py-1 px-2">
            <Icon name="mingcute:warning-line" class="text-sm" />
            <span>{{ totpError }}</span>
          </div>
          <button
            type="button"
            class="btn btn-sm btn-primary"
            :disabled="isLoadingTotp"
            @click="revealTotpAndStart"
          >
            <span v-if="isLoadingTotp" class="loading loading-spinner loading-xs" />
            <Icon v-else name="mingcute:key-2-line" />
            Запустить генератор TOTP
          </button>
        </div>

        <div v-else class="space-y-2" aria-live="polite" aria-atomic="true">
          <div class="flex items-center justify-between gap-3">
            <code class="bg-base-100 px-3 py-2 rounded-box font-mono text-2xl tracking-widest flex-1 text-center">
              {{ code ?? '——————' }}
            </code>
            <button type="button" class="btn btn-sm btn-primary" @click="copyCode">
              <Icon name="mingcute:copy-2-line" /> Копировать
            </button>
          </div>
          <div class="flex items-center gap-2">
            <progress
              class="flex-1"
              :class="[
                'progress',
                remainingSec < 5
                  ? 'progress-error'
                  : remainingSec < 10
                    ? 'progress-warning'
                    : 'progress-primary',
              ]"
              :value="progress * 100"
              max="100"
            />
            <span class="text-xs text-base-content/60 w-12 text-right">{{ remainingSec }}s</span>
          </div>
          <button
            type="button"
            class="btn btn-xs btn-ghost"
            @click="hideTotp"
          >
            <Icon name="mingcute:close-line" />
            Скрыть генератор
          </button>
        </div>
      </div>

      <div class="divider my-1 text-xs">Проверка логина</div>

      <AccountLoginCheckButton :account-id="accountId" />
    </div>

    <AccountCredentialRevealModal ref="revealModalRef" />
  </div>
</template>
