<script setup lang="ts">
import type { AccountDiagnosticError } from "~~/shared/types/account-diagnostic"
import { toDiagnosticError } from "~~/shared/types/account-diagnostic"

const props = defineProps<{
  appId: number
}>()

const emit = defineEmits<{
  created: [payload: { id: number; displayName: string; platform: "tiktok" | "youtube" | "instagram" }]
  close: []
}>()

const dialogRef = ref<HTMLDialogElement>()

const step = ref<1 | 2 | 3>(1)
const isBusy = ref(false)
const lastError = ref<AccountDiagnosticError | null>(null)

const form = reactive({
  platform: "tiktok" as "tiktok" | "youtube" | "instagram",
  displayName: "",
  platformHandle: "",
  loginEmail: "",
  loginPassword: "",
  twoFASecret: "",
})

const platforms = [
  { value: "tiktok", label: "TikTok", icon: "mingcute:tiktok-line" },
  { value: "youtube", label: "YouTube", icon: "mingcute:youtube-line" },
  { value: "instagram", label: "Instagram", icon: "mingcute:instagram-line" },
] as const

function resetForm() {
  step.value = 1
  isBusy.value = false
  lastError.value = null
  form.platform = "tiktok"
  form.displayName = ""
  form.platformHandle = ""
  form.loginEmail = ""
  form.loginPassword = ""
  form.twoFASecret = ""
}

function open() {
  resetForm()
  dialogRef.value?.showModal()
}

function close() {
  dialogRef.value?.close()
  emit("close")
}

defineExpose({ open, close })

const canProceedStep1 = computed(
  () => !!form.platform && form.displayName.trim().length > 0,
)

function next() {
  if (step.value === 1 && !canProceedStep1.value) return
  if (step.value < 3) {
    step.value = (step.value + 1) as 1 | 2 | 3
  }
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
      message: "Поле 'Отображаемое имя' обязательно",
      phase: "validation",
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
    if (form.platformHandle.trim()) {
      createPayload.platformHandle = form.platformHandle.trim()
    }

    const created = await $fetch<{
      data: { id: number; displayName: string }
      error: null | string
    }>("/api/accounts", {
      method: "POST",
      body: createPayload,
    })

    const accountId = created.data.id

    const credentialsBody: Record<string, string | null> = {}
    if (form.loginEmail.trim()) credentialsBody.loginEmail = form.loginEmail.trim()
    if (form.loginPassword) credentialsBody.loginPassword = form.loginPassword
    if (form.twoFASecret) credentialsBody.twoFASecret = form.twoFASecret

    if (Object.keys(credentialsBody).length > 0) {
      try {
        await $fetch(`/api/accounts/${accountId}/credentials`, {
          method: "PUT",
          body: credentialsBody,
        })
      } catch (credErr) {
        lastError.value = toDiagnosticError(credErr, {
          phase: "credentials",
          url: `/api/accounts/${accountId}/credentials`,
          suggestion:
            "Аккаунт создан, но доступы не сохранены. Откройте 'Редактировать' и заполните вкладку 'Доступы'.",
        })
        emit("created", { id: accountId, displayName: created.data.displayName, platform: form.platform })
        return
      }
    }

    emit("created", { id: accountId, displayName: created.data.displayName })
    close()
  } catch (err) {
    lastError.value = toDiagnosticError(err, {
      phase: "create",
      url: "/api/accounts",
      suggestion:
        "Проверьте поля 'Платформа' и 'Отображаемое имя'. Если ошибка повторяется — пришлите JSON диагностики в саппорт.",
    })
  } finally {
    isBusy.value = false
  }
}
</script>

<template>
  <dialog ref="dialogRef" class="modal">
    <div class="modal-box max-w-2xl max-h-[90vh] flex flex-col">
      <h3 class="font-bold text-lg mb-1 shrink-0">Новый аккаунт</h3>
      <p class="text-xs text-base-content/60 mb-4 shrink-0">
        Ручное создание аккаунта (без OAuth). Подходит для покупных аккаунтов.
      </p>

      <ul class="steps w-full mb-6 text-xs shrink-0">
        <li :class="['step', step >= 1 && 'step-primary']">Основное</li>
        <li :class="['step', step >= 2 && 'step-primary']">Доступы</li>
        <li :class="['step', step >= 3 && 'step-primary']">Прокси + Устройство</li>
      </ul>

      <div class="flex-1 overflow-y-auto pr-1">
      <div v-if="step === 1" class="space-y-3">
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Платформа *</legend>
          <div class="join">
            <button
              v-for="p in platforms"
              :key="p.value"
              type="button"
              class="join-item btn btn-sm"
              :class="{ 'btn-primary': form.platform === p.value }"
              @click="form.platform = p.value"
            >
              <Icon :name="p.icon" />
              {{ p.label }}
            </button>
          </div>
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Отображаемое имя *</legend>
          <input
            v-model="form.displayName"
            type="text"
            class="input input-sm w-full"
            placeholder="Мой TikTok US #1"
            maxlength="100"
            autocomplete="off"
          />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">@Username (handle)</legend>
          <input
            v-model="form.platformHandle"
            type="text"
            class="input input-sm w-full"
            placeholder="@username"
            autocomplete="off"
          />
          <p class="text-xs opacity-60 mt-1">
            Нужен для сбора статистики через Apify и для входа в соцсеть. @ добавится автоматически.
          </p>
        </fieldset>
      </div>

      <div v-else-if="step === 2" class="space-y-3">
        <div role="alert" class="alert alert-info alert-soft text-sm">
          <Icon name="mingcute:information-line" />
          <span>
            Доступы шифруются AES-256-GCM, в открытом виде в БД не хранятся. Все поля
            необязательные на этом шаге — можно заполнить позже через "Редактировать".
          </span>
        </div>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Email для входа</legend>
          <input
            v-model="form.loginEmail"
            type="text"
            class="input input-sm w-full"
            placeholder="login@example.com"
            autocomplete="off"
          />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Пароль</legend>
          <input
            v-model="form.loginPassword"
            type="password"
            class="input input-sm w-full"
            placeholder="••••••••"
            autocomplete="new-password"
          />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">2FA секрет</legend>
          <input
            v-model="form.twoFASecret"
            type="password"
            class="input input-sm w-full"
            placeholder="TOTP base32 / recovery code"
            autocomplete="new-password"
          />
        </fieldset>
      </div>

      <div v-else-if="step === 3" class="space-y-3">
        <div role="alert" class="alert alert-warning alert-soft text-sm">
          <Icon name="mingcute:warning-line" />
          <span>
            Аккаунт без прокси <b>не сможет публиковать</b>. После создания привяжите
            прокси (1 аккаунт = 1 прокси = 1 профиль устройства) на вкладке "Прокси" и
            создайте профиль устройства на вкладке "Устройство" в окне редактирования.
          </span>
        </div>

        <!-- Превентивный warning для YouTube: studio.youtube.com требует
             desktop UA. Если оператор привяжет mobile профиль, постинг
             не сработает (poster-runner guard блокирует). -->
        <div
          v-if="form.platform === 'youtube'"
          role="alert"
          class="alert alert-info alert-soft text-sm"
        >
          <Icon name="mingcute:information-line" />
          <span>
            Для <b>YouTube</b> создайте <b>desktop</b> профиль устройства (Windows / macOS / Linux).
            Mobile (iOS / Android) не подходит - studio.youtube.com работает только с desktop UA.
          </span>
        </div>

        <ul class="text-sm space-y-2 opacity-80">
          <li class="flex items-start gap-2">
            <Icon name="mingcute:check-circle-line" class="text-success mt-0.5" />
            <span>Платформа: <b>{{ form.platform }}</b></span>
          </li>
          <li class="flex items-start gap-2">
            <Icon name="mingcute:check-circle-line" class="text-success mt-0.5" />
            <span>Имя: <b>{{ form.displayName || '—' }}</b></span>
          </li>
          <li class="flex items-start gap-2">
            <Icon
              :name="form.platformHandle ? 'mingcute:check-circle-line' : 'mingcute:alert-line'"
              :class="form.platformHandle ? 'text-success' : 'text-warning'"
              class="mt-0.5"
            />
            <span>
              @Handle:
              <b v-if="form.platformHandle">{{ form.platformHandle }}</b>
              <span v-else class="text-warning">не указан (статистика недоступна)</span>
            </span>
          </li>
          <li class="flex items-start gap-2">
            <Icon
              :name="form.loginEmail ? 'mingcute:check-circle-line' : 'mingcute:alert-line'"
              :class="form.loginEmail ? 'text-success' : 'text-warning'"
              class="mt-0.5"
            />
            <span>
              Доступы:
              <b v-if="form.loginEmail">заполнены</b>
              <span v-else class="text-warning">пустые (заполнить позже)</span>
            </span>
          </li>
        </ul>
      </div>

      <AccountDiagnosticPanel :error="lastError" />
      </div>

      <div class="modal-action mt-4 pt-3 border-t border-base-300 sticky bottom-0 bg-base-100 shrink-0">
        <button
          v-if="step > 1"
          type="button"
          class="btn btn-sm btn-ghost"
          :disabled="isBusy"
          @click="back"
        >
          Назад
        </button>
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          :disabled="isBusy"
          @click="close"
        >
          Отмена
        </button>
        <button
          v-if="step < 3"
          type="button"
          class="btn btn-sm btn-primary"
          :disabled="step === 1 ? !canProceedStep1 : false"
          @click="next"
        >
          Далее
          <Icon name="mingcute:right-line" />
        </button>
        <button
          v-else
          type="button"
          class="btn btn-sm btn-primary"
          :disabled="isBusy"
          @click="submit"
        >
          <span v-if="isBusy" class="loading loading-spinner loading-xs" />
          Создать
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="close">close</button>
    </form>
  </dialog>
</template>
