<script setup lang="ts">
definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'analytics' })
useHead({ title: 'Референсы' })

const page = ref(1)
const perPage = ref(20)

const { data, pending, error, refresh } = useReferences(computed(() => ({
  page: page.value,
  perPage: perPage.value,
})))

const references = computed(() => data.value?.data ?? [])
const meta = computed(() => data.value?.meta ?? { total: 0, page: 1, perPage: 20, totalPages: 1 })
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-semibold">Референсы</h1>
      <span class="tnum text-sm text-subtle">{{ meta.total }}</span>
      <span class="flex-1" />
      <UiButton @click="refresh()">
        <Icon name="mingcute:refresh-2-line" />
        Обновить
      </UiButton>
    </div>

    <p class="text-sm text-muted">
      Публикации, которые система признала образцовыми. Отсюда берут приёмы для следующих роликов.
    </p>

    <UiSkeleton v-if="pending && !references.length" variant="cards" :count="6" />

    <UiErrorState
      v-else-if="error"
      message="Не удалось загрузить референсы."
      :details="error.message"
      @retry="refresh()"
    />

    <UiEmptyState
      v-else-if="!references.length"
      variant="first"
      title="Референсов пока нет"
      description="Успешные ролики попадают сюда сами после разбора метрик."
    />

    <template v-else>
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <ReferenceCard
          v-for="item in references"
          :id="item.id"
          :key="item.id"
          :upload-id="item.uploadId"
          :reason="item.reason"
          :added-at="item.addedAt"
          :upload="item.upload"
        />
      </div>

      <ListPagination
        :page="meta.page"
        :total-pages="meta.totalPages"
        :total="meta.total"
        :per-page="meta.perPage"
        @update:page="page = $event"
        @update:per-page="perPage = $event; page = 1"
      />
    </template>
  </div>
</template>
