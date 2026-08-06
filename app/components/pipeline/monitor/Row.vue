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
  <div class="overflow-hidden rounded-md border border-border bg-panel">
    <button
      type="button"
      class="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left"
      :aria-expanded="expanded"
      @click="store.toggleExpanded(item.id)"
    >
      <Icon
        name="mingcute:right-line"
        class="shrink-0 text-subtle transition-transform duration-(--duration-fast)"
        :class="expanded && 'rotate-90'"
      />
      <span class="flex size-8 shrink-0 items-center justify-center rounded-md" :class="color.bg">
        <Icon :name="item.icon || 'mingcute:git-merge-line'" class="text-lg" :class="color.text" />
      </span>

      <span class="min-w-0 flex-1">
        <span class="flex flex-wrap items-center gap-2">
          <span class="truncate font-medium">{{ item.name }}</span>
          <PipelineStatusBadge :status="item.status" />
          <span
            v-if="item.activeRuns.length"
            class="tnum inline-flex h-[18px] items-center gap-1.5 rounded-sm border border-info-border bg-info-bg px-1.5 text-micro text-info"
          >
            <span class="size-1.5 rounded-full bg-current motion-safe:animate-pulse" />
            идёт {{ item.activeRuns.length }}
          </span>
        </span>
        <span v-if="item.description" class="mt-0.5 block truncate text-sm text-muted">
          {{ item.description }}
        </span>
      </span>

      <span class="tnum hidden shrink-0 items-center gap-3 font-mono text-sm text-subtle md:flex">
        <span class="flex items-center gap-1" title="Блоков в графе">
          <Icon name="mingcute:box-line" />{{ item.totalNodes }}
        </span>
        <span class="flex items-center gap-1" title="Всего запусков">
          <Icon name="mingcute:history-line" />{{ item.runStats.total }}
        </span>
      </span>
    </button>

    <div v-if="expanded" class="border-t border-divider px-3 py-2.5">
      <PipelineMonitorRunsList :item="item" @refresh="emit('refresh')" />
    </div>
  </div>
</template>
