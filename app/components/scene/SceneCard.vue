<script setup lang="ts">
import type { Scene, SceneStatus } from '~~/shared/types/scene'
import { SCENE_STATUS_LABELS } from '~~/shared/types/scene'
import type { EntityStatus } from '~~/shared/utils/entity-status'

/**
 * Карточка сцены.
 *
 * Превью собранного промпта важнее описания: именно он уходит в генерацию,
 * и по нему видно, что сцена пустая, ещё до захода внутрь.
 */
const SCENE_STATUS_TO_ENTITY: Record<string, EntityStatus> = {
  draft: 'draft',
  ready: 'queued',
  generating: 'running',
  done: 'done',
}

const props = defineProps<{ scene: Scene }>()

const blocksCount = computed(() => (Array.isArray(props.scene.blocks) ? props.scene.blocks.length : 0))
const promptPreview = computed(() => (props.scene.promptCompiled ?? '').slice(0, 220))
const status = computed<EntityStatus>(() => SCENE_STATUS_TO_ENTITY[props.scene.status as SceneStatus] ?? 'draft')
</script>

<template>
  <NuxtLink
    :to="`/scenes/${scene.id}`"
    class="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 transition-colors duration-(--duration-fast) ease-out hover:border-subtle"
  >
    <div class="flex items-start gap-2">
      <h3 class="min-w-0 flex-1 truncate text-base font-medium">{{ scene.name }}</h3>
      <UiStatusBadge :status="status" size="xs" dot />
    </div>

    <p v-if="scene.description" class="line-clamp-2 text-sm text-muted">{{ scene.description }}</p>

    <p class="line-clamp-3 text-micro text-subtle">
      {{ promptPreview || 'Сцена пустая — добавьте блоки' }}
    </p>

    <div class="flex flex-wrap items-center gap-2">
      <span class="tnum font-mono text-micro text-subtle">{{ blocksCount }} блоков</span>
      <span
        v-for="t in scene.tags?.slice(0, 3) ?? []"
        :key="t"
        class="rounded-sm border border-border bg-panel px-1.5 text-micro text-subtle"
      >
        {{ t }}
      </span>
      <span
        v-if="scene.archived"
        class="ml-auto rounded-sm border border-warning-border bg-warning-bg px-1.5 text-micro text-warning"
      >
        архив
      </span>
    </div>
  </NuxtLink>
</template>
