<script setup lang="ts">
import type { SceneBlockKind } from '~~/shared/types/scene'
import { SCENE_BLOCK_KINDS, SCENE_BLOCK_LABELS, SCENE_BLOCK_ICONS } from '~~/shared/types/scene'

const emit = defineEmits<{
  add: [kind: SceneBlockKind]
}>()
</script>

<template>
  <div class="space-y-2">
    <h3 class="text-xs uppercase tracking-wider text-base-content/60 font-semibold">Библиотека блоков</h3>
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      <button
        v-for="kind in SCENE_BLOCK_KINDS"
        :key="kind"
        type="button"
        class="btn btn-ghost btn-sm justify-start gap-2 h-auto py-2 normal-case border border-base-300 hover:border-primary hover:bg-primary/5"
        :data-block-kind="kind"
        @click="emit('add', kind)"
      >
        <Icon :name="SCENE_BLOCK_ICONS[kind]" class="size-4 text-primary" />
        <span class="text-sm">{{ SCENE_BLOCK_LABELS[kind] }}</span>
      </button>
    </div>
  </div>
</template>
