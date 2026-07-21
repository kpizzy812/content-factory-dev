<script setup lang="ts">
defineProps<{
  source: string
  syncStatus?: string | null
  externalId?: number | null
}>()

const sourceMap: Record<string, { label: string; icon: string; class: string }> = {
  manual: { label: 'Ручной ввод', icon: 'mingcute:edit-line', class: 'badge-outline' },
  telegram: { label: 'Telegram', icon: 'mingcute:telegram-line', class: 'badge-info badge-outline' },
  pipeline: { label: 'Pipeline', icon: 'mingcute:settings-3-line', class: 'badge-accent badge-outline' },
  marketingcamp: { label: 'MarketingCamp', icon: 'mingcute:arrow-right-down-line', class: 'badge-secondary badge-outline' },
}

const syncBadge = computed(() => {
  const map: Record<string, { label: string; class: string }> = {
    synced: { label: 'Синхр.', class: 'badge-success badge-outline' },
    conflict: { label: 'Конфликт', class: 'badge-warning badge-outline' },
    error: { label: 'Ошибка синхр.', class: 'badge-error badge-outline' },
    pending_export: { label: 'Ожидает экспорт', class: 'badge-info badge-outline' },
    pending_import: { label: 'Ожидает импорт', class: 'badge-info badge-outline' },
  }
  return map
})
</script>

<template>
  <span
    class="badge badge-sm gap-1"
    :class="sourceMap[source]?.class ?? 'badge-outline'"
  >
    <Icon :name="sourceMap[source]?.icon ?? 'mingcute:question-line'" class="text-xs" />
    {{ sourceMap[source]?.label ?? source }}
  </span>
  <span
    v-if="syncStatus && syncStatus !== 'none' && syncBadge[syncStatus]"
    class="badge badge-xs gap-0.5"
    :class="syncBadge[syncStatus]!.class"
  >
    <Icon name="mingcute:refresh-2-line" class="text-[10px]" />
    {{ syncBadge[syncStatus]!.label }}
  </span>
</template>
