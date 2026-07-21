<script setup lang="ts">
definePageMeta({
  middleware: ['admin-access'],
})

useHead({ title: 'Производственные циклы' })

const store = useAdminFiltersStore()
const cycleModalRef = ref<{ open: () => void }>()

const { data: appsData } = useAdminApps()
const apps = computed(() => appsData.value?.data ?? [])

const { data, pending, refresh } = useAdminCycles(store.cycleQuery)
const cycles = computed(() => data.value?.data ?? [])
const meta = computed(() => data.value?.meta ?? null)

const statusOptions = [
  { value: '', label: 'Все статусы' },
  { value: 'pending', label: 'Ожидание' },
  { value: 'running', label: 'Работает' },
  { value: 'completed', label: 'Завершён' },
  { value: 'failed', label: 'Ошибка' },
  { value: 'stopped', label: 'Остановлен' },
]

function onFilterChange() {
  store.resetPage()
}

function onStarted() {
  refresh()
}

function onPageUpdate(p: number) {
  store.page = p
}
</script>

<template>
  <div class="space-y-6">
    <!-- Breadcrumbs -->
    <div class="text-sm breadcrumbs">
      <ul>
        <li><NuxtLink to="/admin">Админ</NuxtLink></li>
        <li>Циклы</li>
      </ul>
    </div>

    <div class="flex items-center justify-between flex-wrap gap-3">
      <h1 class="text-2xl font-bold text-base-content">Производственные циклы</h1>
      <button class="btn btn-primary btn-sm" @click="cycleModalRef?.open()">
        <Icon name="mingcute:play-line" />
        Запустить цикл
      </button>
    </div>

    <AdminCycleStartModal ref="cycleModalRef" @started="onStarted" />

    <!-- Фильтры -->
    <div class="flex flex-wrap gap-3">
      <select v-model="store.cycleStatus" class="select select-sm" @change="onFilterChange">
        <option v-for="opt in statusOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>

      <select v-model="store.cycleAppId" class="select select-sm" @change="onFilterChange">
        <option :value="undefined">Все приложения</option>
        <option v-for="app in apps" :key="app.id" :value="app.id">
          {{ app.name }}
        </option>
      </select>
    </div>

    <div v-if="pending" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <template v-else>
      <div v-if="cycles.length" class="space-y-3">
        <AdminCycleCard v-for="cycle in cycles" :key="cycle.id" :cycle="cycle" />
      </div>

      <SharedEmptyState
        v-else
        icon="mingcute:refresh-2-line"
        title="Нет циклов"
        description="Запустите первый производственный цикл"
      />

      <SharedPagination
        v-if="meta && meta.totalPages > 1"
        :page="meta.page"
        :total-pages="meta.totalPages"
        :total="meta.total"
        @update:page="onPageUpdate"
      />
    </template>
  </div>
</template>
