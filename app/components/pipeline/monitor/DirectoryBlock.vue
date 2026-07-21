<script setup lang="ts">
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

function handleClick(pipeline: PipelineMonitorItem) {
  emit('click', pipeline)
}

function onPageUpdate(p: number) {
  emit('update:page', p)
}
</script>

<template>
  <section
    class="collapse collapse-arrow bg-base-100 border border-base-300 rounded-box"
    :class="store.catalogBlockExpanded ? 'collapse-open' : 'collapse-close'"
  >
    <div
      class="collapse-title cursor-pointer flex items-center gap-2 py-3"
      @click="store.toggleCatalogBlock()"
    >
      <h2 class="text-lg font-bold text-base-content">
        Мои конвейеры
      </h2>
      <span v-if="meta" class="badge badge-ghost badge-sm">
        {{ meta.total }}
      </span>
    </div>

    <div class="collapse-content">
      <div v-if="pending && pipelines.length === 0" class="flex justify-center py-10">
        <span class="loading loading-spinner loading-lg" />
      </div>

      <template v-else>
        <div v-if="pipelines.length === 0" class="card bg-base-100 border border-base-300">
          <div class="card-body items-center text-center py-8">
            <Icon name="mingcute:git-merge-line" class="text-5xl text-base-content/30 mb-2" />
            <h3 class="text-base font-semibold">
              Нет конвейеров
            </h3>
            <p class="text-sm text-base-content/60">
              Создайте свой первый конвейер или используйте готовый шаблон.
            </p>
          </div>
        </div>
        <template v-else>
          <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <PipelineCard
              v-for="pipeline in pipelines"
              :key="pipeline.id"
              :pipeline="pipeline"
              @click="handleClick"
            />
          </div>
          <SharedPagination
            v-if="meta && meta.totalPages > 1"
            :page="meta.page"
            :total-pages="meta.totalPages"
            :total="meta.total"
            class="mt-3"
            @update:page="onPageUpdate"
          />
        </template>
      </template>
    </div>
  </section>
</template>
