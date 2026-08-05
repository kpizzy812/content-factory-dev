<script setup lang="ts">
definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'trendwatcher' })
useHead({ title: 'Креативы' })

interface CreativeItem {
  type: 'trend' | 'scenario' | 'video'
  id: number
  title: string
  status: string
  platform: string | null
  createdAt: string
  appName: string | null
}

const filters = useCreativeFiltersStore()

const { data, pending, error, refresh } = useCreatives(computed(() => filters.query))

const creatives = computed<CreativeItem[]>(() => data.value?.data ?? [])
const meta = computed(() => data.value?.meta ?? { total: 0, page: 1, perPage: 20, totalPages: 1 })

const hasFilters = computed(() => filters.type !== 'all' || !!filters.status || !!filters.appId)
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-semibold">Креативы</h1>
      <span class="tnum text-sm text-subtle">{{ meta.total }}</span>
      <span class="flex-1" />
      <UiButton @click="refresh()">
        <Icon name="mingcute:refresh-2-line" />
        Обновить
      </UiButton>
    </div>

    <p class="text-sm text-muted">
      Общая витрина трендов, сценариев и роликов — всё, что произведено, в одном списке.
    </p>

    <CreativeFilters />

    <UiSkeleton v-if="pending && !creatives.length" variant="cards" :count="8" />

    <UiErrorState
      v-else-if="error"
      message="Не удалось загрузить креативы."
      :details="error.message"
      @retry="refresh()"
    />

    <UiEmptyState
      v-else-if="!creatives.length && hasFilters"
      variant="search"
      title="Ничего не найдено"
      description="Под текущие фильтры креативов нет."
    >
      <UiButton @click="filters.resetFilters()">Сбросить фильтры</UiButton>
    </UiEmptyState>

    <UiEmptyState
      v-else-if="!creatives.length"
      variant="first"
      title="Креативов пока нет"
      description="Импортируйте тренды или соберите сценарий — всё произведённое попадёт сюда."
    />

    <template v-else>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <CreativeCard
          v-for="item in creatives"
          :id="item.id"
          :key="`${item.type}-${item.id}`"
          :type="item.type"
          :title="item.title"
          :status="item.status"
          :platform="item.platform"
          :created-at="item.createdAt"
          :app-name="item.appName"
        />
      </div>

      <ListPagination
        :page="meta.page"
        :total-pages="meta.totalPages"
        :total="meta.total"
        :per-page="meta.perPage"
        @update:page="filters.page = $event"
        @update:per-page="filters.perPage = $event; filters.resetPage()"
      />
    </template>
  </div>
</template>
