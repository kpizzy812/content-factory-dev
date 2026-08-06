<script setup lang="ts">
/**
 * Каталог конвейеров.
 *
 * Сворачивается: на странице ниже живёт монитор запусков, и оператору, который
 * следит за прогонами, каталог мешает. Состояние свёрнутости хранится в сторе.
 */
import type { PipelineMonitorItem, PipelineMonitorMeta } from '~~/shared/types/workflow'

defineProps<{
  pipelines: PipelineMonitorItem[]
  meta: PipelineMonitorMeta | null
  pending: boolean
}>()

const emit = defineEmits<{
  'click': [pipeline: PipelineMonitorItem]
  'update:page': [page: number]
}>()

const store = usePipelineMonitorStore()
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-border bg-panel">
    <button
      type="button"
      class="flex w-full cursor-pointer items-center gap-2 px-3.5 py-2.5 text-left"
      :aria-expanded="store.catalogBlockExpanded"
      @click="store.toggleCatalogBlock()"
    >
      <Icon
        name="mingcute:right-line"
        class="shrink-0 text-subtle transition-transform duration-(--duration-fast)"
        :class="store.catalogBlockExpanded && 'rotate-90'"
      />
      <h2 class="text-base font-medium">Мои конвейеры</h2>
      <span v-if="meta" class="tnum font-mono text-micro text-subtle">{{ meta.total }}</span>
    </button>

    <div v-if="store.catalogBlockExpanded" class="flex flex-col gap-3 px-3.5 pb-3.5">
      <UiSkeleton v-if="pending && !pipelines.length" variant="details" :count="4" />

      <UiEmptyState
        v-else-if="!pipelines.length"
        variant="first"
        title="Конвейеров нет"
        description="Соберите первый или возьмите готовый шаблон."
      />

      <template v-else>
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <PipelineCard
            v-for="pipeline in pipelines"
            :key="pipeline.id"
            :pipeline="pipeline"
            @click="emit('click', pipeline)"
          />
        </div>

        <ListPagination
          v-if="meta"
          :page="meta.page"
          :total-pages="meta.totalPages"
          :total="meta.total"
          :per-page="store.catalogPerPage"
          @update:page="(p) => emit('update:page', p)"
          @update:per-page="(v) => { store.catalogPerPage = v; store.catalogPage = 1 }"
        />
      </template>
    </div>
  </section>
</template>
