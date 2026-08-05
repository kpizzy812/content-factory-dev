<script setup lang="ts">
/**
 * Скелетон. Источник: design-preview/_system/blocks/SkeletonTable.html
 *
 * Повторяет форму будущего контента, а не подменяет её спиннером — иначе при
 * загрузке вёрстка прыгает, когда данные приезжают.
 */
withDefaults(defineProps<{
  variant?: 'table' | 'cards' | 'details'
  count?: number
  density?: 'text' | 'media'
}>(), { variant: 'table', count: 8, density: 'text' })
</script>

<template>
  <div class="motion-safe:animate-pulse">
    <div v-if="variant === 'table'" class="overflow-hidden rounded-lg border border-border">
      <div class="h-8 border-b border-border bg-card" />
      <div
        v-for="i in count"
        :key="i"
        class="flex items-center gap-3 border-b border-divider px-3 last:border-b-0"
        :class="density === 'media' ? 'h-11' : 'h-9'"
      >
        <span class="size-3.5 shrink-0 rounded-sm bg-neutral-bg" />
        <span class="shrink-0 rounded-sm bg-neutral-bg" :class="density === 'media' ? 'size-8' : 'size-7'" />
        <span class="h-3 flex-1 rounded-sm bg-neutral-bg" />
        <span class="h-3 w-20 shrink-0 rounded-sm bg-neutral-bg" />
        <span class="h-3 w-16 shrink-0 rounded-sm bg-neutral-bg" />
      </div>
    </div>

    <div v-else-if="variant === 'cards'" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
      <div v-for="i in count" :key="i" class="overflow-hidden rounded-lg border border-border bg-card">
        <div class="aspect-[9/16] bg-neutral-bg" />
        <div class="flex flex-col gap-1.5 p-2.5">
          <span class="block h-3 rounded-sm bg-neutral-bg" />
          <span class="block h-2.5 w-2/3 rounded-sm bg-neutral-bg" />
        </div>
      </div>
    </div>

    <div v-else class="flex flex-col gap-2">
      <span class="h-5 w-1/3 rounded-sm bg-neutral-bg" />
      <span v-for="i in count" :key="i" class="h-3 rounded-sm bg-neutral-bg" :style="{ width: `${100 - i * 6}%` }" />
    </div>
  </div>
</template>
