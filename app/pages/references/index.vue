<script setup lang="ts">
definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'analytics' })
useHead({ title: 'Референсы' })

const page = ref(1)
const perPage = ref(20)

const query = computed(() => ({
  page: page.value,
  perPage: perPage.value,
}))

const { data, pending, error } = useReferences(query)

const references = computed(() => data.value?.data ?? [])
const meta = computed(() => data.value?.meta ?? { total: 0, page: 1, perPage: 20, totalPages: 1 })

function onPageUpdate(p: number) {
  page.value = p
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-2xl font-bold text-base-content">Референсы</h1>

    <!-- Loading -->
    <div v-if="pending" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <!-- Error -->
    <div v-else-if="error" role="alert" class="alert alert-error">
      <Icon name="mingcute:warning-line" />
      <span>Ошибка загрузки: {{ error.message }}</span>
    </div>

    <!-- Empty -->
    <SharedEmptyState
      v-else-if="references.length === 0"
      icon="mingcute:star-line"
      title="Референсов пока нет"
      description="Успешные ролики попадают сюда автоматически после AI-анализа."
    />

    <!-- References grid -->
    <template v-else>
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <ReferenceCard
          v-for="ref in references"
          :key="ref.id"
          :id="ref.id"
          :upload-id="ref.uploadId"
          :reason="ref.reason"
          :added-at="ref.addedAt"
          :upload="ref.upload"
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
