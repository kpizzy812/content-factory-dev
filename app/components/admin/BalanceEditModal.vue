<script setup lang="ts">
import type { AdminServiceBalanceRow } from "~/composables/useAdminBalances"
import {
  BALANCE_CURRENCIES,
  type BalanceCurrency,
  updateServiceBalance,
} from "~/composables/useAdminBalances"

const emit = defineEmits<{
  saved: []
  close: []
}>()

const dialogRef = ref<HTMLDialogElement>()
const currentRow = ref<AdminServiceBalanceRow | null>(null)

const editAmount = ref("")
const editCurrency = ref<string>("USD")
const editNotes = ref("")
const saving = ref(false)
const error = ref<string | null>(null)

function open(row: AdminServiceBalanceRow) {
  currentRow.value = row
  // Автоподстановка: текущее значение из row (manual / api fetched / fallback)
  editAmount.value = row.balance?.balance?.amount?.toString() ?? ""
  editCurrency.value = row.balance?.balance?.currency ?? row.defaultCurrency
  editNotes.value = row.balance?.notes ?? ""
  error.value = null
  saving.value = false
  dialogRef.value?.showModal()
}

function close() {
  dialogRef.value?.close()
  currentRow.value = null
  emit("close")
}

defineExpose({ open, close })

const src = computed(() => currentRow.value?.balance?.source)
const isQuotaService = computed(() => currentRow.value?.key === "nodemaven")

// Парсим причину fallback из notes (формат: "[fallback: ...]" — пишется в providers)
const fallbackReason = computed(() => {
  const notes = currentRow.value?.balance?.notes
  if (!notes) return null
  const m = notes.match(/\[fallback:\s*([^\]]+)\]/)
  return m?.[1]?.trim() ?? null
})

// Defensive: если в row пришла legacy currency не из BALANCE_CURRENCIES — добавляем
// её в options, чтобы пользователь видел реальное значение и мог его поменять.
const currencyOptions = computed<readonly string[]>(() => {
  const cur = currentRow.value?.balance?.balance?.currency
  if (cur && !(BALANCE_CURRENCIES as readonly string[]).includes(cur)) {
    return [...BALANCE_CURRENCIES, cur]
  }
  return BALANCE_CURRENCIES
})

const isHttpsHint = computed(() => {
  const h = currentRow.value?.dashboardHint
  return !!h && h.startsWith("https://")
})

async function save() {
  if (!currentRow.value) return
  const amount = Number(editAmount.value.replace(",", "."))
  if (!Number.isFinite(amount) || amount < 0) {
    error.value = "Введите корректную сумму ≥ 0"
    return
  }
  saving.value = true
  error.value = null
  try {
    await updateServiceBalance(currentRow.value.key, {
      amount,
      currency: editCurrency.value || undefined,
      notes: editNotes.value.trim() || null,
    })
    emit("saved")
    close()
  } catch (err) {
    const msg = (err as { statusMessage?: string; message?: string })?.statusMessage
      ?? (err as { message?: string })?.message
      ?? "Не удалось сохранить"
    error.value = msg
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <dialog ref="dialogRef" class="modal" @close="emit('close')">
    <div class="modal-box max-w-lg">
      <h3 class="font-bold text-lg mb-1">
        Обновить баланс: {{ currentRow?.label }}
      </h3>

      <p v-if="currentRow?.dashboardHint" class="text-xs text-base-content/60 mb-3">
        Где взять:
        <a
          v-if="isHttpsHint"
          :href="currentRow.dashboardHint"
          target="_blank"
          rel="noopener noreferrer"
          class="link link-primary"
        >
          {{ currentRow.dashboardHint }}
          <Icon name="mingcute:external-link-line" class="inline align-text-bottom" />
        </a>
        <span v-else>{{ currentRow.dashboardHint }}</span>
      </p>

      <!-- Source alerts -->
      <div v-if="src === 'api'" role="alert" class="alert alert-info alert-soft text-xs mb-3">
        <Icon name="mingcute:information-line" />
        <span>
          Автоматически фетчится из API. Manual значение используется как резерв
          (fallback при недоступности API).
        </span>
      </div>
      <div v-else-if="src === 'estimate'" role="alert" class="alert alert-warning alert-soft text-xs mb-3">
        <Icon name="mingcute:warning-line" />
        <span>
          Baseline для расчёта расхода. Введите остаток после top-up — система будет
          списывать с него каждый AI-вызов.
        </span>
      </div>
      <div v-else-if="src === 'fallback'" role="alert" class="alert alert-error alert-soft text-xs mb-3">
        <Icon name="mingcute:warning-line" />
        <div>
          <div>API сейчас недоступен — показано последнее manual значение. Проверьте API-ключ в <code>.env</code>.</div>
          <div v-if="fallbackReason" class="mt-1 opacity-80">
            Причина: {{ fallbackReason }}
          </div>
        </div>
      </div>
      <div v-else role="alert" class="alert alert-soft text-xs mb-3">
        <Icon name="mingcute:edit-line" />
        <span>
          Введено вручную: автосбор для этого сервиса недоступен (нет публичного
          billing API). Обновляйте после каждого пополнения. Пороги low/critical
          настроены в <code>server/utils/balance/config.ts</code>.
        </span>
      </div>

      <!-- F-2: подсказка для quota-сервисов (NodeMaven) -->
      <div v-if="isQuotaService" role="alert" class="alert alert-info alert-soft text-xs mb-3">
        <Icon name="mingcute:information-line" />
        <span>
          NodeMaven — quota-сервис (трафик в GB). Введите <b>стоимость подписки в USD</b>
          для контроля общих расходов. Объём трафика обновляется автоматически из API и
          отображается в колонке «Текущий баланс».
        </span>
      </div>

      <fieldset class="fieldset mb-3">
        <legend class="fieldset-legend">Сумма</legend>
        <input
          v-model="editAmount"
          type="text"
          inputmode="decimal"
          class="input input-sm w-full"
          placeholder="Например, 12.50"
        >
        <p v-if="src === 'api'" class="text-xs text-base-content/60 mt-1">
          Подтянуто из API, проверьте перед сохранением.
        </p>
      </fieldset>

      <fieldset class="fieldset mb-3">
        <legend class="fieldset-legend">Валюта</legend>
        <select v-model="editCurrency" class="select select-sm w-full">
          <option v-for="c in currencyOptions" :key="c" :value="c">{{ c }}</option>
        </select>
      </fieldset>

      <fieldset class="fieldset mb-3">
        <legend class="fieldset-legend">Заметки (необязательно)</legend>
        <textarea
          v-model="editNotes"
          class="textarea textarea-sm w-full"
          rows="2"
          maxlength="500"
          placeholder="Например, дата пополнения / прогноз когда кончится"
        />
      </fieldset>

      <div v-if="error" role="alert" class="alert alert-error mb-3">
        <Icon name="mingcute:warning-line" />
        <span class="text-sm">{{ error }}</span>
      </div>

      <div class="modal-action">
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          :disabled="saving"
          @click="close"
        >
          Отмена
        </button>
        <button
          type="button"
          class="btn btn-sm btn-primary"
          :disabled="saving"
          @click="save"
        >
          <span v-if="saving" class="loading loading-spinner loading-xs" />
          Сохранить
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="close">close</button>
    </form>
  </dialog>
</template>
