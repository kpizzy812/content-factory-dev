<script setup lang="ts">
import type { VariantQualityScore } from '~~/shared/types/scenario'

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

function onBadgeClick(event: MouseEvent, variantId: number) {
  // Не дать кнопке-родителю переключить активный variant — клик по бейджу
  // открывает модалку с отчётом, а не выбирает таб.
  event.stopPropagation()
  emit('open-critic-report', variantId)
}
</script>

<template>
  <div class="flex gap-1 flex-wrap">
    <button
      v-for="v in props.variants"
      :key="v.id"
      class="btn btn-sm gap-1"
      :class="{
        'btn-primary': v.id === props.activeVariantId,
        'btn-outline': v.id !== props.activeVariantId,
        'btn-success btn-outline': v.id === props.selectedVariantId && v.id !== props.activeVariantId,
        'opacity-50': v.status === 'rejected' || v.status === 'superseded',
      }"
      @click="emit('select', v.id)"
    >
      <Icon
        v-if="v.id === props.selectedVariantId"
        name="mingcute:check-circle-line"
        class="text-xs"
      />
      Вариант {{ v.variantIndex + 1 }}
      <ScenarioVariantStatusBadge :status="v.status" />
      <span
        role="button"
        tabindex="0"
        class="cursor-pointer flex items-center justify-center min-h-[44px] min-w-[44px] -m-2 p-2"
        :aria-label="`Отчёт критика по варианту ${v.variantIndex + 1}`"
        @click="onBadgeClick($event, v.id)"
        @keydown.enter.stop.prevent="emit('open-critic-report', v.id)"
        @keydown.space.stop.prevent="emit('open-critic-report', v.id)"
      >
        <ScenarioCriticBadge :score="v.qualityScore ?? null" size="sm" />
      </span>
    </button>
  </div>
</template>
