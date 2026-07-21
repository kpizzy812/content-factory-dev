<script setup lang="ts">
definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'social-upload' })
useHead({ title: 'Загрузки' })

const filtersStore = useUploadFiltersStore()

// URL ↔ state sync для runId/pipelineId (из кнопки «К юниту» монитора исполнений)
useRunPipelineFilter(filtersStore)

const { data, pending, error } = useUploads(computed(() => filtersStore.query))

const uploads = computed(() => data.value?.data ?? [])
const meta = computed(() => data.value?.meta ?? { total: 0, page: 1, perPage: 20, totalPages: 1 })

function onStatusChange() {
  filtersStore.resetPage()
}

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
      Загрузки
    </h1>

    <SharedPageGuide
      guide-key="uploads"
      :title="pageGuides.uploads.title"
      :steps="pageGuides.uploads.steps"
      :tips="pageGuides.uploads.tips"
    />

    <UploadModuleBanner />

    <!-- Разводящая подпись треков (Q1 в утверждённом плане):
         Upload (этa страница) — API/OAuth-track. PostingJob (browser_automation
         + state-machine) — отдельный track в /posting-jobs. Видео-креативы — в /videos. -->
    <div class="text-xs text-base-content/60 px-1 flex items-start gap-2">
      <Icon name="mingcute:information-line" class="text-sm shrink-0 mt-0.5" />
      <span>
        Эта страница — публикации через API/OAuth (модель <code class="bg-base-200 px-1 rounded">Upload</code>).
        Очередь и история постинга через browser_automation — в
        <NuxtLink to="/posting-jobs" class="link link-primary">/posting-jobs</NuxtLink>.
        Сами видео-креативы — в
        <NuxtLink to="/videos" class="link link-primary">/videos</NuxtLink>.
      </span>
    </div>

    <!-- Фильтры -->
    <div class="flex flex-col sm:flex-row gap-3 items-end flex-wrap">
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Статус</legend>
        <select
          v-model="filtersStore.status"
          class="select"
          @change="onStatusChange"
        >
          <option value="">Все статусы</option>
          <option value="pending">Ожидание</option>
          <option value="uploading">Загрузка</option>
          <option value="published">Опубликовано</option>
          <option value="failed">Ошибка</option>
          <option value="scheduled">Запланировано</option>
          <option value="canceled">Отменено</option>
          <option value="blocked_by_env">Заблокировано (ENV)</option>
        </select>
      </fieldset>
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
    <div v-else-if="error" role="alert" class="alert alert-error alert-soft">
      <Icon name="mingcute:warning-line" />
      <span>Ошибка загрузки: {{ error.message }}</span>
    </div>

    <!-- Empty -->
    <SharedEmptyState
      v-else-if="uploads.length === 0"
      icon="mingcute:upload-3-line"
      title="Загрузок пока нет"
      description="Создайте загрузку из страницы готового видео."
    />

    <!-- Upload list -->
    <template v-else>
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <UploadCard
          v-for="upload in uploads"
          :key="upload.id"
          :upload="upload"
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
