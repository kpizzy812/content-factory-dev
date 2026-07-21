<script setup lang="ts">
definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'trendwatcher' })
useHead({ title: 'Креативы' })

const filtersStore = useCreativeFiltersStore()

const { data, pending, error } = useCreatives(computed(() => filtersStore.query))

const creatives = computed(() => (data.value as any)?.data ?? [])
const meta = computed(() => (data.value as any)?.meta ?? { total: 0, page: 1, perPage: 20, totalPages: 1 })

function onPageUpdate(p: number) {
  filtersStore.page = p
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-2xl font-bold text-base-content">Креативы</h1>

    <SharedPageGuide
      guide-key="creatives"
      :title="pageGuides.creatives.title"
      :steps="pageGuides.creatives.steps"
      :tips="pageGuides.creatives.tips"
    />

    <CreativeFilters />

    <!-- Loading -->
    <SharedListSkeleton v-if="pending" :count="6" variant="card" :cols="3" />

    <!-- Error -->
    <div v-else-if="error" role="alert" class="alert alert-error">
      <Icon name="mingcute:warning-line" />
      <span>Ошибка загрузки: {{ error.message }}</span>
    </div>

    <!-- Empty -->
    <SharedEmptyState
      v-else-if="creatives.length === 0"
      icon="mingcute:pic-line"
      title="Креативов пока нет"
      description="Создайте тренды, сценарии или видео -- они появятся здесь."
    />

    <!-- Grid -->
    <template v-else>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <CreativeCard
          v-for="item in creatives"
          :key="`${item.type}-${item.id}`"
          :type="item.type"
          :id="item.id"
          :title="item.title"
          :status="item.status"
          :platform="item.platform"
          :created-at="item.createdAt"
          :app-name="item.appName"
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
