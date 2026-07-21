<script setup lang="ts">
definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'video-generator' })
useHead({ title: 'Видео' })

const filtersStore = useVideoFiltersStore()

// URL ↔ state sync для runId/pipelineId (из кнопки «К юниту» монитора исполнений)
useRunPipelineFilter(filtersStore)

const { data, pending, error } = useVideos(computed(() => filtersStore.query))

const videos = computed(() => data.value?.data ?? [])
const meta = computed(() => data.value?.meta ?? { total: 0, page: 1, perPage: 12, totalPages: 1 })

function onPageUpdate(p: number) {
  filtersStore.page = p
}

function clearRunFilter() {
  filtersStore.runId = undefined
  filtersStore.resetPage()
}

function clearPipelineFilter() {
  filtersStore.pipelineId = undefined
  filtersStore.resetPage()
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-2xl font-bold text-base-content">
      Видео
    </h1>

    <SharedPageGuide
      guide-key="videos"
      :title="pageGuides.videos.title"
      :steps="pageGuides.videos.steps"
      :tips="pageGuides.videos.tips"
    />

    <VideoFilters />

    <!-- Фильтр по запуску / конвейеру -->
    <SharedRunPipelineFilterBadge
      :run-id="filtersStore.runId"
      :pipeline-id="filtersStore.pipelineId"
      @clear-run="clearRunFilter"
      @clear-pipeline="clearPipelineFilter"
    />

    <!-- Loading -->
    <SharedListSkeleton v-if="pending" :count="6" variant="card" :cols="3" />

    <!-- Error -->
    <div v-else-if="error" role="alert" class="alert alert-error">
      <Icon name="mingcute:warning-line" />
      <span>Ошибка загрузки: {{ error.message }}</span>
    </div>

    <!-- Empty -->
    <SharedEmptyState
      v-else-if="videos.length === 0"
      icon="mingcute:video-line"
      title="Видео пока нет"
      description="Выберите сценарий и создайте первое видео."
    />

    <!-- Video list -->
    <template v-else>
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <VideoCard
          v-for="video in videos"
          :key="video.id"
          :video="video"
        />
      </div>

      <SharedPagination
        v-if="meta.totalPages > 1"
        :page="meta.page"
        :total-pages="meta.totalPages"
        :total="meta.total"
        @update:page="onPageUpdate"
      />
    </template>
  </div>
</template>
