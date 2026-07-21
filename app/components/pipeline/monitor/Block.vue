<script setup lang="ts">
import type { PipelineMonitorItem, PipelineMonitorMeta } from '~~/shared/types/workflow'

const props = defineProps<{
  items: PipelineMonitorItem[]
  meta: PipelineMonitorMeta | null
  pending: boolean
}>()

const emit = defineEmits<{
  refresh: []
}>()

const store = usePipelineMonitorStore()

const runtime = computed(() => props.meta?.runtime ?? null)

function onToolbarClick(ev: Event) {
  // Защищаемся от всплытия в collapse-title — иначе клик по тулбару внутри
  // заголовка блока триггерит свой же toggle.
  ev.stopPropagation()
}
</script>

<template>
  <section
    class="collapse collapse-arrow bg-base-100 border border-base-300 rounded-box"
    :class="store.monitorBlockExpanded ? 'collapse-open' : 'collapse-close'"
  >
    <div
      class="collapse-title cursor-pointer flex items-center justify-between flex-wrap gap-2 py-3"
      @click="store.toggleMonitorBlock()"
    >
      <div class="flex items-center gap-2">
        <h2 class="text-lg font-bold text-base-content">
          Исполнения
        </h2>
        <span v-if="runtime" class="badge badge-sm badge-ghost font-mono" title="Загрузка рантайма">
          <Icon name="mingcute:cpu-line" class="mr-1" />
          {{ runtime.capacityUsed }}
        </span>
        <span v-if="runtime && runtime.queuedRuns > 0" class="badge badge-sm badge-warning">
          В очереди: {{ runtime.queuedRuns }}
        </span>
      </div>
      <div class="flex items-center gap-1 mr-8" @click="onToolbarClick">
        <button
          class="btn btn-ghost btn-sm"
          title="Развернуть все коллапсеры в блоке Исполнения"
          @click.stop="store.expandAll()"
        >
          <Icon name="mingcute:unfold-vertical-line" />
          <span class="hidden sm:inline">Показать все</span>
        </button>
        <button
          class="btn btn-ghost btn-sm"
          title="Свернуть все коллапсеры"
          @click.stop="store.collapseAll()"
        >
          <Icon name="mingcute:fold-vertical-line" />
          <span class="hidden sm:inline">Закрыть все</span>
        </button>
      </div>
    </div>

    <div class="collapse-content">
      <div class="space-y-3">
        <PipelineMonitorToolbar />

        <div v-if="pending && items.length === 0" class="flex justify-center py-10">
          <span class="loading loading-spinner loading-lg" />
        </div>

        <PipelineMonitorEmpty v-else-if="items.length === 0" />

        <template v-else>
          <div v-if="store.viewMode === 'list'" class="space-y-2">
            <PipelineMonitorRow
              v-for="item in items"
              :key="item.id"
              :item="item"
              @refresh="emit('refresh')"
            />
          </div>
          <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <PipelineMonitorCard
              v-for="item in items"
              :key="item.id"
              :item="item"
              @refresh="emit('refresh')"
            />
          </div>
        </template>
      </div>
    </div>
  </section>
</template>
