<script setup lang="ts">
import type { VariantQualityScore } from '~~/shared/types/scenario'
import { variantStatus, VARIANT_STATUS_LABELS } from './ScenarioStatusMap'

interface VariantTabItem {
  id: number
  variantIndex: number
  status: string
  title: string
  qualityScore?: number | null
  qualityScoreDetails?: VariantQualityScore | null
}

const props = defineProps<{
  variants: VariantTabItem[]
  selectedVariantId: number | null
  activeVariantId: number | null
}>()

const emit = defineEmits<{
  'select': [id: number]
  'open-critic-report': [variantId: number]
}>()

function openReport(event: Event, variantId: number) {
  // Клик по оценке открывает отчёт критика, а не переключает вариант.
  event.stopPropagation()
  emit('open-critic-report', variantId)
}
</script>

<template>
  <div role="tablist" class="flex flex-wrap gap-1.5">
    <div
      v-for="v in props.variants"
      :key="v.id"
      class="flex items-center gap-1.5 rounded-md border px-2 py-1"
      :class="[
        v.id === props.activeVariantId
          ? 'border-accent bg-accent-bg'
          : 'border-border bg-card hover:border-subtle',
        ['rejected', 'superseded'].includes(v.status) && v.id !== props.activeVariantId && 'opacity-60',
      ]"
    >
      <button
        type="button"
        role="tab"
        :aria-selected="v.id === props.activeVariantId"
        class="flex cursor-pointer items-center gap-1.5 text-sm"
        @click="emit('select', v.id)"
      >
        <Icon
          v-if="v.id === props.selectedVariantId"
          name="mingcute:check-circle-line"
          class="shrink-0 text-success"
          :title="'Выбран для производства'"
        />
        <span class="font-medium">Вариант {{ v.variantIndex + 1 }}</span>
        <UiStatusBadge
          :status="variantStatus(v.status)"
          size="xs"
          dot
          icon-only
          :title="VARIANT_STATUS_LABELS[v.status] ?? v.status"
        />
      </button>

      <button
        type="button"
        class="cursor-pointer"
        :aria-label="`Отчёт критика по варианту ${v.variantIndex + 1}`"
        @click="openReport($event, v.id)"
        @keydown.enter.stop.prevent="emit('open-critic-report', v.id)"
      >
        <ScenarioCriticBadge :score="v.qualityScore ?? null" size="xs" />
      </button>
    </div>
  </div>
</template>
