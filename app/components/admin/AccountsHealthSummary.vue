<script setup lang="ts">
import type { AccountsHealthSummary } from "~~/shared/types/accounts-health"

const props = defineProps<{ summary: AccountsHealthSummary }>()

interface SummaryCard {
  label: string
  value: number
  icon: string
  colorClass: string
}

const cards = computed<SummaryCard[]>(() => {
  const s = props.summary
  const problemsCount = Math.max(0, s.total - s.activeCount)
  return [
    {
      label: "Всего",
      value: s.total,
      icon: "mingcute:group-line",
      colorClass: "text-base-content/70",
    },
    {
      label: "Активных",
      value: s.activeCount,
      icon: "mingcute:check-circle-line",
      colorClass: s.activeCount > 0 ? "text-success" : "text-base-content/40",
    },
    {
      label: "Проблемных",
      value: problemsCount,
      icon: "mingcute:warning-line",
      colorClass: problemsCount > 0 ? "text-error" : "text-base-content/40",
    },
    {
      label: "Постинг заблокирован",
      value: s.withoutProxy,
      icon: "mingcute:forbid-circle-line",
      colorClass: s.withoutProxy > 0 ? "text-error" : "text-base-content/40",
    },
    {
      label: "Мёртвый прокси",
      value: s.withDeadProxy,
      icon: "mingcute:wifi-off-line",
      colorClass: s.withDeadProxy > 0 ? "text-error" : "text-base-content/40",
    },
    {
      label: "Без warmup 7д+",
      value: s.withoutWarmup7d,
      icon: "mingcute:fire-line",
      colorClass: s.withoutWarmup7d > 0 ? "text-warning" : "text-base-content/40",
    },
    {
      label: "Без креденшелов",
      value: s.withoutCredentials,
      icon: "mingcute:lock-line",
      colorClass: s.withoutCredentials > 0 ? "text-warning" : "text-base-content/40",
    },
  ]
})
</script>

<template>
  <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
    <div
      v-for="card in cards"
      :key="card.label"
      class="card bg-base-100 shadow-sm"
    >
      <div class="card-body p-3 gap-1 flex-row items-center">
        <Icon :name="card.icon" class="text-2xl shrink-0" :class="card.colorClass" />
        <div class="flex-1 min-w-0">
          <div class="text-xs text-base-content/60 truncate">{{ card.label }}</div>
          <div class="text-2xl font-bold leading-tight">{{ card.value }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
