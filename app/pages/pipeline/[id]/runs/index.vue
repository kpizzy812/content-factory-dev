<script setup lang="ts">
definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'pipeline' })

const route = useRoute()
const pipelineId = computed(() => route.params.id as string)
const page = ref(1)
const statusFilter = ref('')
const triggerFilter = ref('')
const searchQuery = ref('')

const { data, pending, error } = usePipelineRuns(pipelineId, page)

const runs = computed(() => {
  let list = data.value?.data ?? []
  if (statusFilter.value) {
    list = list.filter((r: any) => r.status === statusFilter.value)
  }
  if (triggerFilter.value) {
    list = list.filter((r: any) => r.triggerType === triggerFilter.value)
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    list = list.filter((r: any) =>
      String(r.id).includes(q)
      || (r.errorMessage && r.errorMessage.toLowerCase().includes(q))
      || (r.triggerType && r.triggerType.toLowerCase().includes(q)),
    )
  }
  return list
})
const meta = computed(() => data.value?.meta)

useHead({ title: 'История запусков' })

const stats = computed(() => {
  const all = data.value?.data ?? []
  return {
    total: all.length,
    success: all.filter((r: any) => r.status === 'success').length,
    failed: all.filter((r: any) => r.status === 'failed').length,
    running: all.filter((r: any) => r.status === 'running').length,
  }
})

const basePath = computed(() => `/pipeline/${pipelineId.value}`)
</script>

<template>
  <div class="p-4 max-w-5xl mx-auto space-y-4">
    <!-- Header -->
    <div class="flex items-center gap-2 flex-wrap">
      <div class="tooltip tooltip-bottom" data-tip="Назад к редактору">
        <button class="btn btn-ghost btn-sm btn-square" @click="navigateTo(`/pipeline/${pipelineId}`)">
          <Icon name="mingcute:arrow-left-line" />
        </button>
      </div>
      <div>
        <h1 class="text-xl font-bold">История запусков</h1>
        <p class="text-xs text-base-content/50">Все запуски конвейера — ручные, по расписанию и через webhook</p>
      </div>
    </div>

    <!-- Stats -->
    <PipelineRunStats
      v-if="!pending && !error"
      :total="stats.total"
      :success="stats.success"
      :failed="stats.failed"
      :running="stats.running"
    />

    <!-- Filters bar -->
    <div class="flex items-center gap-2 flex-wrap">
      <label class="input input-sm flex-1 min-w-48 max-w-xs">
        <Icon name="mingcute:search-line" class="text-base-content/40" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Поиск по ID или ошибке..."
        />
      </label>
      <select v-model="statusFilter" class="select select-sm">
        <option value="">Все статусы</option>
        <option value="success">Успешно</option>
        <option value="failed">Ошибка</option>
        <option value="running">Выполняется</option>
        <option value="pending">Ожидание</option>
        <option value="cancelled">Отменён</option>
      </select>
      <select v-model="triggerFilter" class="select select-sm">
        <option value="">Все триггеры</option>
        <option value="manual">Вручную</option>
        <option value="schedule">По расписанию</option>
        <option value="webhook">Webhook</option>
      </select>
    </div>

    <!-- Loading -->
    <div v-if="pending" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <!-- Error -->
    <div v-else-if="error" role="alert" class="alert alert-error">
      <Icon name="mingcute:warning-line" />
      <span>{{ error.message }}</span>
    </div>

    <!-- Empty -->
    <div v-else-if="runs.length === 0 && !searchQuery && !statusFilter && !triggerFilter" class="text-center py-12">
      <Icon name="mingcute:inbox-line" class="text-4xl text-base-content/20 mb-2" />
      <p class="text-base-content/50">Запусков пока нет</p>
      <p class="text-xs text-base-content/30 mt-1">Запустите конвейер вручную, по расписанию или через webhook</p>
    </div>

    <!-- Filtered empty -->
    <div v-else-if="runs.length === 0" class="text-center py-8 text-base-content/50">
      <Icon name="mingcute:search-line" class="text-3xl text-base-content/20 mb-2" />
      <p>Ничего не найдено по выбранным фильтрам</p>
      <button class="btn btn-xs btn-ghost mt-2" @click="searchQuery = ''; statusFilter = ''; triggerFilter = ''">
        Сбросить фильтры
      </button>
    </div>

    <!-- Runs list -->
    <div v-else class="space-y-2">
      <PipelineRunCard
        v-for="run in runs"
        :key="run.id"
        :run="run"
        :base-path="basePath"
      />
    </div>

    <!-- Pagination -->
    <SharedPagination
      v-if="meta && meta.totalPages > 1"
      :page="meta.page"
      :total-pages="meta.totalPages"
      :total="meta.total"
      @update:page="page = $event"
    />
  </div>
</template>
