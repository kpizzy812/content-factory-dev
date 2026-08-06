<script setup lang="ts">
import { platformMeta } from './platform-meta'

/**
 * Бейдж платформы. Источник: design-preview/_system/blocks/PlatformBadge.html
 *
 * Платформа — не статус. Цвет вынесен в узкую метку слева и намеренно не
 * заливает бейдж целиком, чтобы не спорить со статусным бейджем в той же строке.
 * Это единственное место в системе, где допустимы небрендовые фирменные цвета;
 * сами значения лежат в `platform-meta.ts`, чтобы строки списков не заводили
 * вторую копию.
 */
const props = defineProps<{ platform: string }>()

const meta = computed(() => platformMeta(props.platform))
</script>

<template>
  <span
    class="inline-flex h-[22px] items-center gap-1.5 rounded-sm border border-border bg-card px-2 text-sm whitespace-nowrap text-muted"
  >
    <span class="h-3 w-[5px] shrink-0 rounded-[2px]" :style="{ background: meta.color }" />
    {{ meta.label }}
  </span>
</template>
