<script setup lang="ts">
/**
 * Расход за сутки по типам операций.
 * Источник: design-preview/catalog/08-settings-admin.dc.html
 *
 * Полоска показывает долю группы в расходе, а не абсолютную величину: сравнить
 * «7 410» и «800» глазами трудно, а две полоски разной длины — легко. Самая
 * дорогая группа задаёт масштаб.
 *
 * Строка с нулём — не ошибка: рендер собирается локально и ничего не стоит,
 * и постоянный ноль отвечает на вопрос «а сборка сколько стоит» лучше, чем
 * отсутствие строки.
 */
import type { AdminSpendBreakdown } from '~/composables/useAdminBalances'
import { formatMoney } from '~~/shared/utils/money'

const props = defineProps<{
  spend: AdminSpendBreakdown | null
  pending?: boolean
}>()

const groups = computed(() => props.spend?.groups ?? [])

const maxAmount = computed(() =>
  groups.value.reduce((max, group) => Math.max(max, group.amountUsd), 0),
)

function share(amount: number): string {
  if (maxAmount.value <= 0) return '0%'
  return `${Math.round((amount / maxAmount.value) * 100)}%`
}

const perVideo = computed(() => formatMoney(props.spend?.perVideoUsd ?? null))

const summaryLabel = computed(() => {
  if (!props.spend) return 'Итого за сутки'
  if (perVideo.value) return `Итого за сутки · ${perVideo.value} за ролик`
  return 'Итого за сутки · роликов за сутки не сдано'
})
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-border bg-panel">
    <div class="border-b border-border bg-card px-3 py-2.5 text-sm font-medium">
      Расход за сутки по типам операций
    </div>

    <UiSkeleton v-if="pending && !spend" variant="details" :count="4" class="p-3" />

    <div v-else-if="!spend" class="px-3 py-3 text-sm text-muted">
      Не удалось посчитать расход.
    </div>

    <div v-else class="flex flex-col gap-2 px-3 py-3">
      <div
        v-for="group in groups"
        :key="group.key"
        class="grid grid-cols-[minmax(0,1fr)_108px_88px] items-center gap-x-2.5 text-sm"
      >
        <span class="truncate text-muted">{{ group.label }}</span>
        <span class="h-2 overflow-hidden rounded-[2px] bg-card">
          <span class="block h-full bg-accent" :style="{ width: share(group.amountUsd) }" />
        </span>
        <span class="tnum text-right font-mono">{{ formatMoney(group.amountUsd) }}</span>
      </div>

      <div class="my-0.5 h-px bg-divider" />

      <div class="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span class="text-muted">{{ summaryLabel }}</span>
        <span class="tnum font-mono font-semibold">{{ formatMoney(spend.totalUsd) }}</span>
      </div>

      <p class="text-micro text-subtle">
        Считается по журналу списаний: то же, из чего складывается фактическая
        стоимость ролика и запуска конвейера. Роликов за сутки: {{ spend.videoCount }}.
      </p>
    </div>
  </section>
</template>
