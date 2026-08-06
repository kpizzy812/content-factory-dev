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

const isOpen = ref(false)
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
  isOpen.value = true
}

function close() {
  if (saving.value) return
  isOpen.value = false
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
  <UiModal :open="isOpen" :title="`Баланс: ${currentRow?.label ?? ''}`" @close="close">
    <div class="flex flex-col gap-3">
      <p v-if="currentRow?.dashboardHint" class="text-sm text-muted">
        Где взять:
        <a
          v-if="isHttpsHint"
          :href="currentRow.dashboardHint"
          target="_blank"
          rel="noopener noreferrer"
        >{{ currentRow.dashboardHint }}</a>
        <span v-else>{{ currentRow.dashboardHint }}</span>
      </p>

      <p
        v-if="src === 'api'"
        class="flex items-start gap-2 rounded-md border border-info-border bg-info-bg px-2.5 py-2 text-sm text-fg"
      >
        <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
        <span>Значение приходит из API сервиса. Введённое руками остаётся резервом на случай, когда API недоступен.</span>
      </p>
      <p
        v-else-if="src === 'estimate'"
        class="flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-sm text-fg"
      >
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-warning" />
        <span>Это отправная точка для расчёта расхода: введите остаток после пополнения, дальше система списывает с него каждый платный вызов.</span>
      </p>
      <p
        v-else-if="src === 'fallback'"
        class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-fg"
      >
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-danger" />
        <span class="min-w-0 flex-1">
          API сервиса сейчас недоступен — показано последнее введённое значение.
          <span v-if="fallbackReason" class="block text-micro text-subtle">Причина: {{ fallbackReason }}</span>
        </span>
      </p>
      <p
        v-else
        class="flex items-start gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-sm text-muted"
      >
        <Icon name="mingcute:edit-line" class="mt-0.5 shrink-0" />
        <span>У сервиса нет публичного billing API — остаток вводится руками после каждого пополнения.</span>
      </p>

      <p
        v-if="isQuotaService"
        class="flex items-start gap-2 rounded-md border border-info-border bg-info-bg px-2.5 py-2 text-sm text-fg"
      >
        <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
        <span>Здесь считается трафик, а не деньги. Введите стоимость подписки в долларах — объём приходит из API сам.</span>
      </p>

      <UiField label="Сумма" :hint="src === 'api' ? 'Подтянуто из API — проверьте перед сохранением' : undefined">
        <UiInput v-model="editAmount" mono inputmode="decimal" placeholder="12.50" />
      </UiField>

      <UiField label="Валюта">
        <UiSelect
          v-model="editCurrency"
          :options="currencyOptions.map(c => ({ value: c, label: c }))"
          class="w-40"
        />
      </UiField>

      <UiField label="Заметки" hint="Например, когда пополняли и на сколько хватило">
        <UiTextarea v-model="editNotes" :rows="2" placeholder="Необязательно" />
      </UiField>

      <p
        v-if="error"
        role="alert"
        class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
      >
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
        <span class="min-w-0 flex-1">{{ error }}</span>
      </p>
    </div>

    <template #footer>
      <UiButton variant="ghost" :disabled="saving" @click="close">Отмена</UiButton>
      <UiButton variant="primary" :loading="saving" @click="save">Сохранить</UiButton>
    </template>
  </UiModal>
</template>
