<script setup lang="ts">
/** Заполненность стиль-профиля. Тон из словаря, подпись доменная. */
const props = defineProps<{
  status: 'not_set' | 'partial' | 'complete' | undefined | null
}>()

const CONFIG: Record<string, { label: string, tone: string }> = {
  not_set: { label: 'Стиль не задан', tone: 'border-divider bg-transparent text-subtle' },
  partial: { label: 'Стиль частичный', tone: 'border-warning-border bg-warning-bg text-warning' },
  complete: { label: 'Стиль задан', tone: 'border-success-border bg-success-bg text-success' },
}

const config = computed(() => CONFIG[props.status ?? 'not_set'] ?? CONFIG.not_set!)
</script>

<template>
  <span
    v-if="status"
    class="inline-flex h-[22px] w-fit items-center gap-1.5 rounded-sm border px-2 text-sm whitespace-nowrap"
    :class="config.tone"
  >
    <Icon name="mingcute:palette-line" class="shrink-0" />
    {{ config.label }}
  </span>
</template>
