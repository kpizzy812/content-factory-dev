<script setup lang="ts">
import type { EntityStatus } from '~~/shared/utils/entity-status'

/**
 * Лента вариантов ролика. Источник: design-preview/catalog/03-detail-video.dc.html
 *
 * Статус и стоимость несёт сама миниатюра: упавший и считающийся варианты
 * видны без захода внутрь.
 */
export interface VariantItem {
  id: number
  label: string
  thumbnail?: string | null
  status: EntityStatus
  cost?: number | null
}

defineProps<{
  variants: VariantItem[]
  activeId?: number | null
}>()

defineEmits<{ select: [id: number] }>()
</script>

<template>
  <div class="flex gap-2 overflow-x-auto pb-1">
    <button
      v-for="v in variants"
      :key="v.id"
      type="button"
      class="relative w-16 shrink-0 cursor-pointer overflow-hidden rounded-md border"
      :class="v.id === activeId ? 'border-accent' : 'border-border hover:border-subtle'"
      @click="$emit('select', v.id)"
    >
      <span class="block aspect-[9/16] bg-surface">
        <img v-if="v.thumbnail" :src="v.thumbnail" :alt="v.label" class="size-full object-cover" referrerpolicy="no-referrer">
      </span>
      <span class="absolute top-1 left-1">
        <UiStatusBadge :status="v.status" size="xs" dot icon-only />
      </span>
      <span class="flex items-baseline justify-between gap-1 px-1 py-0.5">
        <span class="truncate font-mono text-[10px] text-muted">{{ v.label }}</span>
        <span v-if="v.cost != null" class="tnum shrink-0 font-mono text-[10px] text-subtle">{{ v.cost.toFixed(0) }}₽</span>
      </span>
    </button>
  </div>
</template>
