<script setup lang="ts">
definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'script-generator' })
useHead({ title: 'Сценарии' })

const route = useRoute()
const filtersStore = useScenarioFiltersStore()

if (route.query.trendId) {
  filtersStore.trendId = Number(route.query.trendId)
}

// URL ↔ state sync для runId/pipelineId (из кнопки «К юниту» монитора исполнений)
useRunPipelineFilter(filtersStore)

const queryParams = computed(() => ({
  ...(filtersStore.status ? { status: filtersStore.status } : {}),
  ...(filtersStore.trendId ? { trendId: filtersStore.trendId } : {}),
  ...(filtersStore.runId ? { runId: filtersStore.runId } : {}),
  ...(filtersStore.pipelineId ? { pipelineId: filtersStore.pipelineId } : {}),
  page: filtersStore.page,
  perPage: filtersStore.perPage,
}))

const { data, pending, error } = useScenarios(queryParams)

const scenarios = computed(() => data.value?.data ?? [])
const meta = computed(() => data.value?.meta ?? { total: 0, page: 1, perPage: 20, totalPages: 1 })

function onPageUpdate(p: number) {
  filtersStore.page = p
}

function clearTrendFilter() {
  filtersStore.trendId = undefined
  filtersStore.resetPage()
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
      Сценарии
    </h1>

    <SharedPageGuide
      guide-key="scenarios"
      :title="pageGuides.scenarios.title"
      :steps="pageGuides.scenarios.steps"
      :tips="pageGuides.scenarios.tips"
    />

    <ScenarioFilters />

    <!-- Фильтр по тренду -->
    <div v-if="filtersStore.trendId" class="flex items-center gap-2">
      <span class="badge badge-outline badge-sm gap-1">
        <Icon name="mingcute:eye-line" class="text-xs" />
        Тренд #{{ filtersStore.trendId }}
        <button class="btn btn-ghost btn-xs btn-circle" @click="clearTrendFilter">
          <Icon name="mingcute:close-line" />
        </button>
      </span>
    </div>

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
      v-else-if="scenarios.length === 0"
      icon="mingcute:document-line"
      title="Сценарии не найдены"
      description="Сценарии ещё не сгенерированы. Перейдите к тренду и нажмите «Сгенерировать сценарии»."
    />

    <!-- Scenario list -->
    <template v-else>
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <ScenarioCard
          v-for="scenario in scenarios"
          :key="scenario.id"
          :scenario="scenario as any"
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
