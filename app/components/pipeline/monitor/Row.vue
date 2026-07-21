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
  <div
    class="collapse collapse-arrow bg-base-100 border border-base-300 rounded-box"
    :class="expanded ? 'collapse-open' : 'collapse-close'"
  >
    <div
      class="collapse-title cursor-pointer flex items-center gap-3 px-4 py-3"
      @click="toggle"
    >
      <div
        class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
        :class="colorClasses.bg20"
      >
        <Icon
          :name="item.icon || 'mingcute:git-merge-line'"
          class="text-lg"
          :class="colorClasses.text"
        />
      </div>

      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <h3 class="font-semibold truncate">
            {{ item.name }}
          </h3>
          <PipelineStatusBadge :status="item.status" />
          <span v-if="item.activeRuns.length > 0" class="badge badge-sm badge-info gap-1">
            <span class="status status-info status-xs animate-pulse" />
            Выполняется {{ item.activeRuns.length }}
          </span>
        </div>
        <p v-if="item.description" class="text-xs text-base-content/60 truncate mt-0.5">
          {{ item.description }}
        </p>
      </div>

      <div class="flex items-center gap-3 text-xs text-base-content/60 shrink-0 pr-8">
        <span class="hidden md:flex items-center gap-1">
          <Icon name="mingcute:box-line" />
          {{ item.totalNodes }}
        </span>
        <span class="hidden md:flex items-center gap-1">
          <Icon name="mingcute:history-line" />
          {{ item.runStats.total }}
        </span>
      </div>
    </div>

    <div class="collapse-content">
      <div class="pt-1">
        <PipelineMonitorRunsList :item="item" @refresh="emit('refresh')" />
      </div>
    </div>
  </div>
</template>
