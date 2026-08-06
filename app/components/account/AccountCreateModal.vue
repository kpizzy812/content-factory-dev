<script setup lang="ts">
import type { AccountDiagnosticError } from '~~/shared/types/account-diagnostic'
import { toDiagnosticError } from '~~/shared/types/account-diagnostic'

/**
 * Ручное заведение аккаунта — путь для купленных аккаунтов без OAuth.
 *
 * Третий шаг раньше всегда рассказывал про прокси и профиль устройства. Это
 * унаследованный контур: при выключенной зоне таких вкладок в правке нет, и
 * инструкция вела в никуда. Теперь шаг подстраивается под включённые зоны.
 */
const props = defineProps<{ appId: number }>()

const emit = defineEmits<{
  created: [payload: { id: number, displayName: string, platform: 'tiktok' | 'youtube' | 'instagram' }]
  close: []
}>()

const { legacyModules, loadLegacyModules } = useLegacyModules()
loadLegacyModules()

const isOpen = ref(false)
const step = ref<1 | 2 | 3>(1)
const isBusy = ref(false)
const lastError = ref<AccountDiagnosticError | null>(null)

const form = reactive({
  platform: 'tiktok' as 'tiktok' | 'youtube' | 'instagram',
  displayName: '',
  platformHandle: '',
  loginEmail: '',
  loginPassword: '',
  twoFASecret: '',
})

const PLATFORMS = [
  { value: 'tiktok', label: 'TikTok' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'instagram', label: 'Instagram' },
] as const

const STEP_TITLES = ['Основное', 'Доступы', 'Проверка']

function resetForm() {
  step.value = 1
  isBusy.value = false
  lastError.value = null
  form.platform = 'tiktok'
  form.displayName = ''
  form.platformHandle = ''
  form.loginEmail = ''
  form.loginPassword = ''
  form.twoFASecret = ''
}

function open() {
  resetForm()
  isOpen.value = true
}

function close() {
  isOpen.value = false
  emit('close')
}

defineExpose({ open, close })

const canProceedStep1 = computed(() => !!form.platform && form.displayName.trim().length > 0)

const stepStates = computed(() =>
  STEP_TITLES.map((_, i) => (i + 1 < step.value ? 'done' : i + 1 === step.value ? 'running' : 'pending') as 'done' | 'running' | 'pending'),
)

function next() {
  if (step.value === 1 && !canProceedStep1.value) return
  if (step.value < 3) step.value = (step.value + 1) as 1 | 2 | 3
}

function back() {
  if (step.value > 1) {
    step.value = (step.value - 1) as 1 | 2 | 3
    lastError.value = null
  }
}

async function submit() {
  if (!canProceedStep1.value) {
    lastError.value = {
      message: 'Поле «Отображаемое имя» обязательно',
      phase: 'validation',
      timestamp: new Date().toISOString(),
    }
    step.value = 1
    return
  }

  isBusy.value = true
  lastError.value = null

  try {
    const createPayload: Record<string, unknown> = {
      appId: props.appId,
      platform: form.platform,
      displayName: form.displayName.trim(),
    }
    if (form.platformHandle.trim()) createPayload.platformHandle = form.platformHandle.trim()

    const created = await $fetch<{ data: { id: number, displayName: string } }>('/api/accounts', {
      method: 'POST',
      body: createPayload,
    })

    const accountId = created.data.id

    const credentialsBody: Record<string, string> = {}
    if (form.loginEmail.trim()) credentialsBody.loginEmail = form.loginEmail.trim()
    if (form.loginPassword) credentialsBody.loginPassword = form.loginPassword
    if (form.twoFASecret) credentialsBody.twoFASecret = form.twoFASecret

    if (Object.keys(credentialsBody).length > 0) {
      try {
        await $fetch(`/api/accounts/${accountId}/credentials`, {
          method: 'PUT',
          body: credentialsBody,
        })
      }
      catch (credErr) {
        lastError.value = toDiagnosticError(credErr, {
          phase: 'credentials',
          url: `/api/accounts/${accountId}/credentials`,
          suggestion: 'Аккаунт создан, но доступы не сохранены. Откройте «Настроить аккаунт» и заполните вкладку «Доступы».',
        })
        emit('created', { id: accountId, displayName: created.data.displayName, platform: form.platform })
        return
      }
    }

    emit('created', { id: accountId, displayName: created.data.displayName, platform: form.platform })
    close()
  }
  catch (err) {
    lastError.value = toDiagnosticError(err, {
      phase: 'create',
      url: '/api/accounts',
      suggestion: 'Проверьте платформу и отображаемое имя. Если ошибка повторяется — приложите JSON диагностики.',
    })
  }
  finally {
    isBusy.value = false
  }
}
</script>

<template>
  <UiModal :open="isOpen" title="Новый аккаунт" size="lg" :persistent="isBusy" @close="close">
    <div class="flex flex-col gap-4">
      <div>
        <UiStepProgress :steps="stepStates" :label="STEP_TITLES[step - 1]" :caption="`шаг ${step} из 3`" />
        <p class="mt-1.5 text-sm text-muted">
          Ручное заведение аккаунта без OAuth — путь для купленных аккаунтов.
        </p>
      </div>

      <template v-if="step === 1">
        <UiField label="Платформа">
          <div class="flex overflow-hidden rounded-md border border-border">
            <button
              v-for="p in PLATFORMS"
              :key="p.value"
              type="button"
              class="h-7 flex-1 cursor-pointer border-r border-border px-3 text-sm last:border-r-0"
              :class="form.platform === p.value ? 'bg-accent text-on-accent' : 'bg-card text-muted hover:text-fg'"
              @click="form.platform = p.value"
            >
              {{ p.label }}
            </button>
          </div>
        </UiField>

        <UiField label="Отображаемое имя">
          <UiInput v-model="form.displayName" placeholder="Мой TikTok US #1" />
        </UiField>

        <UiField
          label="Handle в соцсети"
          hint="Нужен для сбора статистики через Apify. Символ @ добавится сам."
        >
          <UiInput v-model="form.platformHandle" mono placeholder="@username" />
        </UiField>
      </template>

      <template v-else-if="step === 2">
        <p class="flex gap-2 rounded-md border border-info-border bg-info-bg p-2.5 text-sm">
          <Icon name="mingcute:lock-line" class="mt-0.5 shrink-0 text-info" />
          <span>
            Доступы шифруются AES-256-GCM и в открытом виде не хранятся. Все поля
            необязательные — их можно заполнить позже.
          </span>
        </p>

        <UiField label="Email для входа">
          <UiInput v-model="form.loginEmail" placeholder="login@example.com" />
        </UiField>

        <UiField label="Пароль">
          <UiInput v-model="form.loginPassword" type="password" placeholder="••••••••" />
        </UiField>

        <UiField label="Секрет 2FA" hint="TOTP base32 или код восстановления.">
          <UiInput v-model="form.twoFASecret" type="password" placeholder="base32" />
        </UiField>
      </template>

      <template v-else>
        <UiKeyValue
          :items="[
            { label: 'Платформа', value: PLATFORMS.find(p => p.value === form.platform)?.label, mono: false },
            { label: 'Имя', value: form.displayName || null, mono: false },
            { label: 'Handle', value: form.platformHandle || 'не указан — статистики не будет' },
            { label: 'Доступы', value: form.loginEmail ? 'заполнены' : 'пустые, заполнить позже', mono: false },
          ]"
        />

        <p
          v-if="legacyModules.deviceAutomation"
          class="flex gap-2 rounded-md border border-warning-border bg-warning-bg p-2.5 text-sm"
        >
          <Icon name="mingcute:warning-line" class="mt-0.5 shrink-0 text-warning" />
          <span>
            Для постинга через устройство аккаунту нужны прокси и профиль устройства —
            один аккаунт, один прокси, одно устройство. Привяжите их в «Настроить аккаунт»
            <template v-if="form.platform === 'youtube'">
              ; для YouTube профиль обязательно desktop — studio.youtube.com не работает с мобильным UA.
            </template>
          </span>
        </p>
        <p v-else class="flex gap-2 rounded-md border border-border bg-card p-2.5 text-sm text-muted">
          <Icon name="mingcute:information-line" class="mt-0.5 shrink-0" />
          <span>
            Аккаунт будет публиковать через официальный API платформы. Прокси и профиль
            устройства не нужны — их зона выключена.
          </span>
        </p>
      </template>

      <AccountDiagnosticPanel :error="lastError" />
    </div>

    <template #footer>
      <UiButton v-if="step > 1" variant="ghost" :disabled="isBusy" @click="back">Назад</UiButton>
      <UiButton variant="ghost" :disabled="isBusy" @click="close">Отмена</UiButton>
      <UiButton v-if="step < 3" variant="primary" :disabled="step === 1 && !canProceedStep1" @click="next">
        Далее
        <Icon name="mingcute:right-line" />
      </UiButton>
      <UiButton v-else variant="primary" :loading="isBusy" @click="submit">Создать</UiButton>
    </template>
  </UiModal>
</template>
