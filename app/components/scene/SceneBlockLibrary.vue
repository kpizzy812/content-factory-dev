<script setup lang="ts">
/**
 * Библиотека блоков: шесть кнопок, каждая добавляет блок своего типа в сборку.
 * Это не drag-источник — блок добавляется кликом, а порядок меняется уже в сборке.
 */
import type { SceneBlockKind } from '~~/shared/types/scene'
import { SCENE_BLOCK_KINDS, SCENE_BLOCK_LABELS, SCENE_BLOCK_ICONS } from '~~/shared/types/scene'

const emit = defineEmits<{
  add: [kind: SceneBlockKind]
}>()
</script>

<template>
  <div class="flex flex-col gap-2">
    <h3 class="text-micro tracking-[.06em] text-subtle uppercase">Библиотека блоков</h3>
    <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <button
        v-for="kind in SCENE_BLOCK_KINDS"
        :key="kind"
        type="button"
        class="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-left text-sm transition-colors duration-(--duration-fast) hover:border-accent-border hover:bg-accent-bg"
        :data-block-kind="kind"
        @click="emit('add', kind)"
      >
        <Icon :name="SCENE_BLOCK_ICONS[kind]" class="shrink-0 text-accent" />
        <span class="min-w-0 truncate">{{ SCENE_BLOCK_LABELS[kind] }}</span>
      </button>
    </div>
  </div>
</template>
