<script setup lang="ts">
import type { PipelineMonitorItem } from '~~/shared/types/workflow'
import { getPipelineColorClasses } from '~~/shared/utils/pipeline-meta'

const props = defineProps<{
  item: PipelineMonitorItem
}>()

const emit = defineEmits<{
  refresh: []
}>()

const store = usePipelineMonitorStore()

const expanded = computed(() => store.isExpanded(props.item.id))
const colorClasses = computed(() => getPipelineColorClasses(props.item.color))

function toggle() {
  store.toggleExpanded(props.item.id)
}
</script>

<template>
  <div class="card card-border bg-base-100">
    <div class="card-body p-4 gap-3">
      <div
        class="flex items-center gap-2 cursor-pointer"
        @click="toggle"
      >
        <div
          class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          :class="colorClasses.bg20"
        >
          <Icon
            :name="item.icon || 'mingcute:git-merge-line'"
            class="text-xl"
            :class="colorClasses.text"
          />
        </div>

        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5 flex-wrap">
            <h3 class="card-title text-sm truncate">
              {{ item.name }}
            </h3>
            <PipelineStatusBadge :status="item.status" />
          </div>
          <div v-if="item.activeRuns.length > 0" class="text-xs text-info mt-0.5 flex items-center gap-1">
            <span class="status status-info status-xs animate-pulse" />
            Выполняется: {{ item.activeRuns.length }}
          </div>
        </div>

        <Icon
          :name="expanded ? 'mingcute:up-line' : 'mingcute:down-line'"
          class="text-base-content/50 shrink-0"
        />
      </div>

      <p v-if="item.description && !expanded" class="text-xs text-base-content/60 line-clamp-2">
        {{ item.description }}
      </p>

      <div v-if="expanded" class="pt-1 border-t border-base-300">
        <div class="pt-3">
          <PipelineMonitorRunsList :item="item" @refresh="emit('refresh')" />
        </div>
      </div>
    </div>
  </div>
</template>
