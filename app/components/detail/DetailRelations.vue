<script setup lang="ts">
/**
 * Цепочка происхождения. Источник: design-preview/catalog/03-detail-video.dc.html
 *
 * Связи показываются цепочкой со стрелками, а не списком чипов: путь
 * тренд → сценарий → ролик → публикация читается за один взгляд, и именно он
 * объясняет, откуда объект взялся. Текущее звено выделено и не кликабельно.
 */
export interface RelationLink {
  label: string
  title: string
  to?: string
  current?: boolean
}

defineProps<{ chain: RelationLink[] }>()
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <template v-for="(link, i) in chain" :key="i">
      <Icon v-if="i > 0" name="mingcute:right-line" class="shrink-0 text-subtle" />

      <component
        :is="link.to && !link.current ? 'NuxtLink' : 'span'"
        :to="link.to"
        class="flex max-w-52 min-w-0 flex-col rounded-md border px-2 py-1"
        :class="link.current
          ? 'border-accent-border bg-accent-bg'
          : link.to
            ? 'border-border bg-card hover:border-subtle'
            : 'border-dashed border-divider bg-transparent'"
      >
        <span class="text-[10.5px] tracking-[.06em] text-subtle uppercase">{{ link.label }}</span>
        <span class="truncate text-sm" :class="!link.title && 'text-subtle'">{{ link.title || '—' }}</span>
      </component>
    </template>
  </div>
</template>
