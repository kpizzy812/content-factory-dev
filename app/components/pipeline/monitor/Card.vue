<script setup lang="ts">
import type { PipelineMonitorItem } from '~~/shared/types/workflow'
import { pipelineColor } from '../PipelineColorMap'

const props = defineProps<{ item: PipelineMonitorItem }>()

const emit = defineEmits<{ refresh: [] }>()

const store = usePipelineMonitorStore()

const expanded = computed(() => store.isExpanded(props.item.id))
const color = computed(() => pipelineColor(props.item.color))
</script>

<template>
  <div class="flex flex-col overflow-hidden rounded-lg border border-border bg-panel">
    <button
      type="button"
      class="flex cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left"
      :aria-expanded="expanded"
      @click="store.toggleExpanded(item.id)"
    >
      <span class="flex size-9 shrink-0 items-center justify-center rounded-md" :class="color.bg">
        <Icon :name="item.icon || 'mingcute:git-merge-line'" class="text-xl" :class="color.text" />
      </span>

      <span class="min-w-0 flex-1">
        <span class="flex flex-wrap items-center gap-1.5">
          <span class="truncate font-medium">{{ item.name }}</span>
          <PipelineStatusBadge :status="item.status" />
        </span>
        <span
          v-if="item.activeRuns.length"
          class="mt-0.5 flex items-center gap-1.5 text-sm text-info"
        >
          <span class="size-1.5 rounded-full bg-current motion-safe:animate-pulse" />
          идёт {{ item.activeRuns.length }}
        </span>
      </span>

      <Icon
        name="mingcute:up-line"
        class="shrink-0 text-subtle transition-transform duration-(--duration-fast)"
        :class="!expanded && 'rotate-180'"
      />
    </button>

    <p v-if="item.description && !expanded" class="line-clamp-2 px-3 pb-3 text-sm text-muted">
      {{ item.description }}
    </p>

    <div v-if="expanded" class="border-t border-divider px-3 py-2.5">
      <PipelineMonitorRunsList :item="item" @refresh="emit('refresh')" />
    </div>
  </div>
</template>
