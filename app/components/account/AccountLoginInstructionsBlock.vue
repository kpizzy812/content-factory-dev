<script setup lang="ts">
/**
 * Вход в аккаунт через устройство: порядок действий, доступы и живой генератор
 * кодов 2FA. Показывается только для метода `browser_automation`.
 *
 * Автоматическая проверка входа заморожена на время миграции движка устройств,
 * поэтому текст говорит об этом прямо, а не показывает пустую проверку.
 */
import type { CredentialField } from '~~/app/composables/useAccountCredentials'

const props = defineProps<{
  accountId: number
  hasLoginEmail: boolean
  hasLoginPassword: boolean
  hasTwoFASecret: boolean
}>()

const toast = useToast()
const { revealField, error: revealError } = useAccountCredentials()
const { setSecret, code, remainingSec, progress } = useTotp()

const revealModalRef = ref<{ open: (id: number, field: CredentialField, label: string) => void }>()

const FIELD_LABELS: Record<CredentialField, string> = {
  loginEmail: 'Email для входа',
  loginPassword: 'Пароль',
  recoveryEmail: 'Email восстановления',
  recoveryPhone: 'Телефон восстановления',
  twoFASecret: 'Секрет 2FA',
}

function showField(field: CredentialField) {
  revealModalRef.value?.open(props.accountId, field, FIELD_LABELS[field])
}

const isLoadingTotp = ref(false)
const totpError = ref<string | null>(null)
const totpRevealed = ref(false)
const totpReason = ref('')

async function revealTotpAndStart() {
  totpError.value = null
  if (totpReason.value.trim().length < 10) {
    totpError.value = 'Причина обязательна и не короче десяти символов — запрос пишется в журнал доступа.'
    return
  }
  isLoadingTotp.value = true
  try {
    const secret = await revealField(props.accountId, 'twoFASecret', totpReason.value.trim())
    if (secret) {
      setSecret(secret)
      totpRevealed.value = true
    }
    else {
      totpError.value = 'Секрет 2FA не задан или не расшифровался.'
    }
  }
  finally {
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
    toast.success('Код скопирован')
  }
  catch {
    toast.error('Браузер не дал доступ к буферу обмена')
  }
}

const barTone = computed(() => {
  if (remainingSec.value < 5) return 'bg-danger'
  if (remainingSec.value < 10) return 'bg-warning'
  return 'bg-accent'
})

onBeforeUnmount(hideTotp)
</script>

<template>
  <section class="flex flex-col gap-3 rounded-md border border-border bg-card p-3">
    <h4 class="flex items-center gap-2 text-sm font-medium">
      <Icon name="mingcute:robot-line" class="text-warning" />
      Вход через устройство
    </h4>

    <p class="text-sm text-muted">
      Перед первой публикацией войдите в аккаунт в приложении соцсети прямо на
      устройстве — дальше используется сохранённая сессия.
    </p>

    <ol class="flex list-inside list-decimal flex-col gap-1 text-sm text-muted">
      <li>Откройте устройство</li>
      <li>Войдите в приложение соцсети</li>
      <li>Введите email и пароль — их покажет кнопка «Показать»</li>
      <li v-if="hasTwoFASecret">Код 2FA возьмите из генератора ниже</li>
    </ol>

    <p class="flex gap-2 rounded-md border border-info-border bg-info-bg p-2.5 text-sm">
      <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
      <span>
        Автоматическая проверка входа заморожена на время миграции движка устройств.
        Для аккаунтов на официальном API сессия продлевается сама.
      </span>
    </p>

    <div class="flex flex-col gap-1.5 border-t border-divider pt-2.5">
      <div class="flex items-center gap-2 text-sm">
        <span class="w-20 text-muted">Email</span>
        <span :class="hasLoginEmail ? 'text-success' : 'text-subtle'">
          {{ hasLoginEmail ? 'задан' : 'не задан' }}
        </span>
        <span class="flex-1" />
        <UiButton variant="ghost" :disabled="!hasLoginEmail" @click="showField('loginEmail')">
          <Icon name="mingcute:eye-line" />
          Показать
        </UiButton>
      </div>
      <div class="flex items-center gap-2 text-sm">
        <span class="w-20 text-muted">Пароль</span>
        <span :class="hasLoginPassword ? 'text-success' : 'text-subtle'">
          {{ hasLoginPassword ? 'задан' : 'не задан' }}
        </span>
        <span class="flex-1" />
        <UiButton variant="ghost" :disabled="!hasLoginPassword" @click="showField('loginPassword')">
          <Icon name="mingcute:eye-line" />
          Показать
        </UiButton>
      </div>
    </div>

    <p
      v-if="revealError"
      aria-live="polite"
      class="flex items-center gap-2 rounded-md border border-danger-border bg-danger-bg p-2 text-sm text-danger"
    >
      <Icon name="mingcute:warning-line" class="shrink-0" />
      {{ revealError }}
    </p>

    <div v-if="hasTwoFASecret" class="flex flex-col gap-2 border-t border-divider pt-2.5">
      <h5 class="text-micro tracking-[.06em] text-subtle uppercase">Код 2FA</h5>

      <template v-if="!totpRevealed">
        <p class="text-sm text-muted">
          Генератор обновляет код каждые 30 секунд. Запрос пишется в журнал доступа.
        </p>
        <UiField label="Причина" hint="Не короче десяти символов.">
          <UiTextarea v-model="totpReason" :rows="2" placeholder="Например: ручной вход на устройстве" />
        </UiField>
        <p v-if="totpError" class="flex items-center gap-2 rounded-md border border-danger-border bg-danger-bg p-2 text-sm text-danger">
          <Icon name="mingcute:warning-line" class="shrink-0" />
          {{ totpError }}
        </p>
        <UiButton variant="primary" :loading="isLoadingTotp" class="w-fit" @click="revealTotpAndStart">
          <Icon v-if="!isLoadingTotp" name="mingcute:key-2-line" />
          Запустить генератор
        </UiButton>
      </template>

      <template v-else>
        <div aria-live="polite" aria-atomic="true" class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <code class="tnum flex-1 rounded-md border border-border bg-surface px-3 py-2 text-center font-mono text-2xl tracking-widest">
              {{ code ?? '——————' }}
            </code>
            <UiButton variant="primary" @click="copyCode">
              <Icon name="mingcute:copy-2-line" />
              Копировать
            </UiButton>
          </div>
          <div class="flex items-center gap-2">
            <span class="h-1 flex-1 overflow-hidden rounded-full bg-neutral-bg">
              <span class="block h-full" :class="barTone" :style="{ width: `${progress * 100}%` }" />
            </span>
            <span class="tnum w-10 text-right font-mono text-micro text-subtle">{{ remainingSec }} с</span>
          </div>
          <UiButton variant="ghost" class="w-fit" @click="hideTotp">
            <Icon name="mingcute:close-line" />
            Скрыть генератор
          </UiButton>
        </div>
      </template>
    </div>

    <div class="border-t border-divider pt-2.5">
      <AccountLoginCheckButton :account-id="accountId" />
    </div>

    <AccountCredentialRevealModal ref="revealModalRef" />
  </section>
</template>
