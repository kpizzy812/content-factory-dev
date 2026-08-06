<script setup lang="ts">
defineProps<{
  actions: Array<{
    id: number
    actionType: string
    reason: string | null
    createdAt: string
    variantId: number | null
  }>
}>()

const ACTION_META: Record<string, { label: string, icon: string, tone: string }> = {
  accept: { label: 'Принят', icon: 'mingcute:check-circle-line', tone: 'text-success' },
  reject: { label: 'Отклонён', icon: 'mingcute:close-circle-line', tone: 'text-danger' },
  rework: { label: 'На доработку', icon: 'mingcute:refresh-2-line', tone: 'text-warning' },
  regenerate: { label: 'Перегенерация', icon: 'mingcute:refresh-1-line', tone: 'text-info' },
  regenerate_block: { label: 'Перегенерация блока', icon: 'mingcute:refresh-3-line', tone: 'text-info' },
  delete_scenario: { label: 'Удалён', icon: 'mingcute:delete-2-line', tone: 'text-danger' },
  delete_variant: { label: 'Вариант удалён', icon: 'mingcute:delete-line', tone: 'text-danger' },
  copy: { label: 'Скопировано', icon: 'mingcute:copy-2-line', tone: 'text-subtle' },
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}
</script>

<template>
  <section v-if="actions.length" class="rounded-lg border border-border bg-panel p-3.5">
    <h2 class="mb-2 text-micro tracking-[.06em] text-subtle uppercase">История действий</h2>

    <div
      v-for="action in actions"
      :key="action.id"
      class="flex items-start gap-2 border-b border-divider py-1.5 last:border-b-0"
    >
      <Icon
        :name="ACTION_META[action.actionType]?.icon ?? 'mingcute:information-line'"
        class="mt-0.5 shrink-0"
        :class="ACTION_META[action.actionType]?.tone ?? 'text-subtle'"
      />
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-baseline gap-2 text-sm">
          <span class="font-medium">{{ ACTION_META[action.actionType]?.label ?? action.actionType }}</span>
          <span v-if="action.variantId" class="font-mono text-micro text-subtle">вар. #{{ action.variantId }}</span>
          <span class="tnum font-mono text-micro text-subtle">{{ fmtDate(action.createdAt) }}</span>
        </div>
        <p v-if="action.reason" class="text-sm text-muted">{{ action.reason }}</p>
      </div>
    </div>
  </section>
</template>
