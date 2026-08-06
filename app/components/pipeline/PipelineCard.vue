<script setup lang="ts">
/**
 * Карточка конвейера в каталоге.
 *
 * Клик открывает превью, а не редактор: конвейеров много, и перед правкой
 * оператор смотрит, что внутри.
 */
import { formatDateOnly } from '~~/shared/utils/pipeline-format'
import { pipelineColor } from './PipelineColorMap'

const props = defineProps<{
  pipeline: {
    id: number
    name: string
    description: string | null
    icon: string | null
    color: string | null
    tags: Array<{ id: number, name: string }>
    status: string
    nodesCount: number
    updatedAt: string
    lastEditedAt?: string
  }
}>()

const emit = defineEmits<{
  click: [pipeline: typeof props.pipeline]
}>()

const color = computed(() => pipelineColor(props.pipeline.color))
</script>

<template>
  <button
    type="button"
    class="flex cursor-pointer flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left transition-colors duration-(--duration-fast) hover:border-subtle"
    @click="emit('click', pipeline)"
  >
    <div class="flex w-full items-center gap-2">
      <span class="flex size-8 shrink-0 items-center justify-center rounded-md" :class="color.bg">
        <Icon :name="pipeline.icon || 'mingcute:git-merge-line'" :class="color.text" />
      </span>
      <span class="min-w-0 flex-1 truncate font-medium">{{ pipeline.name }}</span>
      <PipelineStatusBadge :status="pipeline.status" />
    </div>

    <p v-if="pipeline.description" class="line-clamp-2 text-sm text-muted">
      {{ pipeline.description }}
    </p>

    <div class="flex w-full items-center gap-2 text-micro text-subtle">
      <span class="tnum shrink-0 font-mono">{{ pipeline.nodesCount }} блоков</span>
      <span
        v-for="tag in pipeline.tags.slice(0, 3)"
        :key="tag.id"
        class="shrink-0 rounded-sm border border-divider px-1.5"
      >
        {{ tag.name }}
      </span>
      <span v-if="pipeline.tags.length > 3" class="shrink-0 rounded-sm border border-divider px-1.5">
        +{{ pipeline.tags.length - 3 }}
      </span>
      <span class="tnum ml-auto shrink-0 font-mono">
        {{ formatDateOnly(pipeline.lastEditedAt || pipeline.updatedAt) }}
      </span>
    </div>
  </button>
</template>
