<script setup lang="ts">
import { getPipelineColorClasses } from '~~/shared/utils/pipeline-meta'
import { formatDateOnly } from '~~/shared/utils/pipeline-format'

const props = defineProps<{
  pipeline: {
    id: number
    name: string
    description: string | null
    icon: string | null
    color: string | null
    tags: Array<{ id: number; name: string }>
    status: string
    nodesCount: number
    updatedAt: string
    lastEditedAt?: string
  }
}>()

const emit = defineEmits<{
  click: [pipeline: typeof props.pipeline]
}>()

const colorClasses = computed(() => getPipelineColorClasses(props.pipeline.color))

function handleClick() {
  emit('click', props.pipeline)
}
</script>

<template>
  <div
    class="card bg-base-100 shadow-sm cursor-pointer transition-shadow hover:shadow-md"
    @click="handleClick"
  >
    <div class="card-body p-4 gap-2">
      <div class="flex items-center gap-2">
        <div
          class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          :class="colorClasses.bg20"
        >
          <Icon
            :name="pipeline.icon || 'mingcute:git-merge-line'"
            class="text-lg"
            :class="colorClasses.text"
          />
        </div>
        <h3 class="card-title text-sm flex-1 truncate">
          {{ pipeline.name }}
        </h3>
        <PipelineStatusBadge :status="pipeline.status" />
      </div>

      <p
        v-if="pipeline.description"
        class="text-xs text-base-content/60 line-clamp-2"
      >
        {{ pipeline.description }}
      </p>

      <div class="flex items-center justify-between mt-1 text-xs text-base-content/40 gap-2">
        <div class="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
          <span class="flex items-center gap-1 shrink-0">
            <Icon name="mingcute:box-line" class="text-sm" />
            {{ pipeline.nodesCount }} {{ pipeline.nodesCount === 1 ? 'блок' : 'блоков' }}
          </span>
          <span
            v-for="tag in pipeline.tags.slice(0, 3)"
            :key="tag.id"
            class="badge badge-ghost badge-xs shrink-0"
          >
            {{ tag.name }}
          </span>
          <span
            v-if="pipeline.tags.length > 3"
            class="badge badge-ghost badge-xs shrink-0"
          >
            +{{ pipeline.tags.length - 3 }}
          </span>
        </div>
        <span class="shrink-0">{{ formatDateOnly(pipeline.lastEditedAt || pipeline.updatedAt) }}</span>
      </div>
    </div>
  </div>
</template>
