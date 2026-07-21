<script setup lang="ts">
definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'script-generator' })
useHead({ title: 'Идеи' })

const filtersStore = useIdeaFiltersStore()

// URL ↔ state sync для runId/pipelineId (из кнопки «К юниту» монитора исполнений)
useRunPipelineFilter(filtersStore)

const queryParams = computed(() => filtersStore.query)
const { data, pending, error, refresh } = useIdeas(queryParams)

const ideas = computed(() => data.value?.data ?? [])
const meta = computed(() => data.value?.meta ?? { total: 0, page: 1, perPage: 20, totalPages: 1 })

function onPageUpdate(p: number) {
  filtersStore.page = p
}

async function onCreated() {
  filtersStore.resetPage()
  await refresh()
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
      Идеи
    </h1>

    <SharedPageGuide
      guide-key="ideas"
      :title="pageGuides.ideas.title"
      :steps="pageGuides.ideas.steps"
      :tips="pageGuides.ideas.tips"
    />

    <IdeaSubmitForm @created="onCreated" />

    <IdeaSyncToolbar @imported="onCreated" />

    <IdeaFilters />

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
      v-else-if="ideas.length === 0"
      icon="mingcute:bulb-line"
      title="Идеи не найдены"
      description="Добавьте ссылку на видео выше или отправьте ссылку через Telegram-бот."
    />

    <!-- Ideas list -->
    <template v-else>
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <IdeaCard
          v-for="idea in ideas"
          :key="idea.id"
          :idea="idea"
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
