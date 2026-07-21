<script setup lang="ts">
import type { Scene } from '~~/shared/types/scene'
import { SCENE_STATUS_LABELS } from '~~/shared/types/scene'

const props = defineProps<{
  scene: Scene
}>()

const blocksCount = computed(() => Array.isArray(props.scene.blocks) ? props.scene.blocks.length : 0)
const statusLabel = computed(() => SCENE_STATUS_LABELS[props.scene.status] ?? props.scene.status)
const promptPreview = computed(() => (props.scene.promptCompiled ?? '').slice(0, 220))
</script>

<template>
  <NuxtLink
    :to="`/scenes/${scene.id}`"
    class="card bg-base-100 shadow-sm hover:shadow-md transition-shadow border border-base-300"
  >
    <div class="card-body p-4 space-y-2">
      <div class="flex items-start justify-between gap-2">
        <h3 class="font-semibold text-base line-clamp-1">{{ scene.name }}</h3>
        <span class="badge badge-sm" :class="{
          'badge-ghost': scene.status === 'draft',
          'badge-info': scene.status === 'ready',
          'badge-warning': scene.status === 'generating',
          'badge-success': scene.status === 'done',
        }">{{ statusLabel }}</span>
      </div>

      <p v-if="scene.description" class="text-xs text-base-content/70 line-clamp-2">
        {{ scene.description }}
      </p>

      <div class="text-xs text-base-content/60 line-clamp-3 italic">
        {{ promptPreview || 'Пустая сцена — добавьте блоки' }}
      </div>

      <div class="flex items-center justify-between pt-1 text-xs text-base-content/50">
        <span class="flex items-center gap-1">
          <Icon name="mingcute:layers-line" class="size-3" />
          {{ blocksCount }} {{ blocksCount === 1 ? 'блок' : 'блоков' }}
        </span>
        <span v-if="scene.tags?.length" class="flex gap-1">
          <span v-for="t in scene.tags.slice(0, 3)" :key="t" class="badge badge-xs badge-ghost">{{ t }}</span>
        </span>
        <span v-if="scene.archived" class="badge badge-xs badge-warning">архив</span>
      </div>
    </div>
  </NuxtLink>
</template>
