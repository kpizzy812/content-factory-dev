<script setup lang="ts">
import { CYCLE_STATUS_LABELS } from '~/components/admin/CycleStatusMap'

definePageMeta({
  middleware: ['admin-access'],
})

useHead({ title: 'Производственные циклы' })

const store = useAdminFiltersStore()
const cycleModalRef = ref<{ open: () => void }>()

const { data: appsData } = useAdminApps()
const apps = computed(() => appsData.value?.data ?? [])

const cycleQueryRef = computed(() => store.cycleQuery)
const { data, pending, error, refresh } = useAdminCycles(cycleQueryRef)
const cycles = computed(() => data.value?.data ?? [])
const meta = computed(() => data.value?.meta ?? null)

const statusOptions = [
  { value: '', label: 'Любой статус' },
  ...Object.entries(CYCLE_STATUS_LABELS).map(([value, label]) => ({ value, label })),
]

const appOptions = computed(() => [
  { value: '', label: 'Все приложения' },
  ...apps.value.map((a: { id: number, name: string }) => ({ value: a.id, label: a.name })),
])
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-semibold">Производственные циклы</h1>
      <span v-if="meta" class="tnum text-sm text-subtle">{{ meta.total }}</span>
      <span class="flex-1" />
      <UiButton variant="primary" @click="cycleModalRef?.open()">
        <Icon name="mingcute:play-circle-line" />
        Запустить цикл
      </UiButton>
    </div>

    <p class="text-sm text-muted">
      Цикл проходит конвейер целиком: тренды, сценарии, ролики, публикации.
    </p>

    <div class="flex flex-wrap items-center gap-2">
      <UiSelect
        v-model="store.cycleStatus"
        class="w-48"
        :options="statusOptions"
        @update:model-value="store.resetPage()"
      />
      <UiSelect
        :model-value="store.cycleAppId ?? ''"
        class="w-56"
        :options="appOptions"
        @update:model-value="(v) => { store.cycleAppId = v ? Number(v) : undefined; store.resetPage() }"
      />
      <UiButton variant="ghost" @click="store.resetCycleFilters()">Сбросить</UiButton>
    </div>

    <UiSkeleton v-if="pending && !cycles.length" variant="details" :count="5" />

    <UiErrorState
      v-else-if="error"
      message="Не удалось загрузить циклы."
      :details="error.message"
      @retry="refresh()"
    />

    <UiEmptyState
      v-else-if="!cycles.length && (store.cycleStatus || store.cycleAppId)"
      variant="search"
      title="Ничего не найдено"
      description="Под текущие фильтры циклов нет."
    >
      <UiButton @click="store.resetCycleFilters()">Сбросить фильтры</UiButton>
    </UiEmptyState>

    <UiEmptyState
      v-else-if="!cycles.length"
      variant="first"
      title="Циклов ещё не было"
      description="Запустите первый — он пройдёт конвейер от трендов до публикаций."
    />

    <template v-else>
      <div class="flex flex-col gap-2">
        <AdminCycleCard v-for="cycle in cycles" :key="cycle.id" :cycle="cycle" />
      </div>

      <ListPagination
        v-if="meta"
        :page="meta.page"
        :total-pages="meta.totalPages"
        :total="meta.total"
        :per-page="store.perPage"
        @update:page="(p) => store.page = p"
        @update:per-page="(v) => { store.perPage = v; store.resetPage() }"
      />
    </template>

    <AdminCycleStartModal ref="cycleModalRef" @started="refresh()" />
  </div>
</template>
