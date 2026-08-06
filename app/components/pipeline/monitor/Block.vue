<script setup lang="ts">
/**
 * Блок «Исполнения» на странице конвейеров.
 *
 * Иконка загрузки рантайма была `mingcute:cpu-line` — такой в наборе нет, и она
 * молча не рисовалась. Заменена на существующую.
 */
import type { PipelineMonitorItem, PipelineMonitorMeta } from '~~/shared/types/workflow'

const props = defineProps<{
  items: PipelineMonitorItem[]
  meta: PipelineMonitorMeta | null
  pending: boolean
}>()

const emit = defineEmits<{ refresh: [] }>()

const store = usePipelineMonitorStore()

const runtime = computed(() => props.meta?.runtime ?? null)
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-border bg-panel">
    <div class="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
      <button
        type="button"
        class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
        :aria-expanded="store.monitorBlockExpanded"
        @click="store.toggleMonitorBlock()"
      >
        <Icon
          name="mingcute:right-line"
          class="shrink-0 text-subtle transition-transform duration-(--duration-fast)"
          :class="store.monitorBlockExpanded && 'rotate-90'"
        />
        <h2 class="text-base font-medium">Исполнения</h2>
        <span
          v-if="runtime"
          class="tnum inline-flex h-[18px] items-center gap-1 rounded-sm border border-border bg-card px-1.5 font-mono text-micro text-muted"
          title="Загрузка рантайма: активных из максимума"
        >
          <Icon name="mingcute:server-line" />
          {{ runtime.capacityUsed }}
        </span>
        <span
          v-if="runtime && runtime.queuedRuns > 0"
          class="tnum inline-flex h-[18px] items-center rounded-sm border border-warning-border bg-warning-bg px-1.5 font-mono text-micro text-warning"
        >
          в очереди {{ runtime.queuedRuns }}
        </span>
      </button>

      <div class="flex shrink-0 items-center gap-1">
        <UiButton variant="ghost" title="Развернуть все конвейеры" @click="store.expandAll()">
          <Icon name="mingcute:unfold-vertical-line" />
          <span class="hidden sm:inline">Показать все</span>
        </UiButton>
        <UiButton variant="ghost" title="Свернуть все конвейеры" @click="store.collapseAll()">
          <Icon name="mingcute:fold-vertical-line" />
          <span class="hidden sm:inline">Закрыть все</span>
        </UiButton>
      </div>
    </div>

    <div v-if="store.monitorBlockExpanded" class="flex flex-col gap-3 px-3.5 pb-3.5">
      <PipelineMonitorToolbar />

      <UiSkeleton v-if="pending && !items.length" variant="details" :count="5" />

      <PipelineMonitorEmpty v-else-if="!items.length" />

      <template v-else>
        <div v-if="store.viewMode === 'list'" class="flex flex-col gap-2">
          <PipelineMonitorRow
            v-for="item in items"
            :key="item.id"
            :item="item"
            @refresh="emit('refresh')"
          />
        </div>
        <div v-else class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <PipelineMonitorCard
            v-for="item in items"
            :key="item.id"
            :item="item"
            @refresh="emit('refresh')"
          />
        </div>
      </template>
    </div>
  </section>
</template>
