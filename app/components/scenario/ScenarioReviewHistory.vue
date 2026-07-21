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

const actionLabels: Record<string, { label: string; icon: string; color: string }> = {
  accept: { label: 'Принят', icon: 'mingcute:check-circle-line', color: 'text-success' },
  reject: { label: 'Отклонён', icon: 'mingcute:close-circle-line', color: 'text-error' },
  rework: { label: 'На доработку', icon: 'mingcute:refresh-2-line', color: 'text-warning' },
  regenerate: { label: 'Перегенерация', icon: 'mingcute:refresh-1-line', color: 'text-info' },
  regenerate_block: { label: 'Перегенерация блока', icon: 'mingcute:refresh-3-line', color: 'text-info' },
  delete_scenario: { label: 'Удалён', icon: 'mingcute:delete-2-line', color: 'text-error' },
  delete_variant: { label: 'Вариант удалён', icon: 'mingcute:delete-line', color: 'text-error' },
  copy: { label: 'Скопировано', icon: 'mingcute:copy-2-line', color: 'text-base-content/60' },
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <div v-if="actions.length > 0" class="space-y-1">
    <h4 class="text-xs font-semibold text-base-content/50 uppercase tracking-wide">
      История действий
    </h4>
    <div
      v-for="action in actions"
      :key="action.id"
      class="flex items-start gap-2 text-xs py-1"
    >
      <Icon
        :name="actionLabels[action.actionType]?.icon || 'mingcute:information-line'"
        :class="actionLabels[action.actionType]?.color || 'text-base-content/40'"
        class="text-sm mt-0.5 shrink-0"
      />
      <div class="min-w-0 flex-1">
        <span class="font-medium">
          {{ actionLabels[action.actionType]?.label || action.actionType }}
        </span>
        <span v-if="action.variantId" class="text-base-content/40 ml-1">
          (вар. #{{ action.variantId }})
        </span>
        <span class="text-base-content/40 ml-1">
          {{ formatDate(action.createdAt) }}
        </span>
        <p v-if="action.reason" class="text-base-content/60 mt-0.5 italic">
          {{ action.reason }}
        </p>
      </div>
    </div>
  </div>
</template>
