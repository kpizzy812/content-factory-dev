<script setup lang="ts">
/**
 * Топ источников трендов: площадка и ключевое слово парсинга.
 *
 * Сортировка по продажам, а не по числу трендов: пятьсот трендов без единой
 * продажи стоят ниже двухсот с продажами.
 */
import type { RankedTrendSource } from '#shared/types/analytics-funnel'

defineProps<{
  sources: RankedTrendSource[]
}>()
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-border bg-panel">
    <header class="border-b border-border bg-card px-3 py-2.5 text-sm font-semibold">
      Топ источников трендов
    </header>

    <UiEmptyState
      v-if="!sources.length"
      title="Трендов за период нет"
      description="Источник — площадка и ключевое слово профиля парсинга."
    />

    <div v-else class="flex flex-col gap-2.5 px-3 py-2.5">
      <div
        v-for="source in sources"
        :key="source.key"
        class="grid grid-cols-[minmax(0,1fr)_92px_74px] items-center gap-x-2.5 text-sm"
        :class="source.sales === 0 ? 'text-muted' : ''"
      >
        <span class="truncate" :title="source.label">{{ source.label }}</span>
        <span class="tnum text-right font-mono text-muted">{{ source.trends }} трендов</span>
        <span class="tnum text-right font-mono font-semibold">
          {{ source.sales }} прод.
        </span>
      </div>
      <p class="border-t border-divider pt-1.5 text-[11px] text-subtle">
        Продажа приписывается источнику того тренда, из которого вырос ролик.
      </p>
    </div>
  </section>
</template>
