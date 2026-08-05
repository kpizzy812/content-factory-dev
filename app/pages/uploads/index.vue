<script setup lang="ts">
definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'social-upload' })
useHead({ title: 'Загрузки' })

const filters = useUploadFiltersStore()

// Заход из монитора запусков по кнопке «К юниту».
useRunPipelineFilter(filters)
</script>

<template>
  <div class="flex flex-col gap-3">
    <UploadModuleBanner />

    <!-- Три разных пути публикации легко перепутать, поэтому развилка стоит
         прямо на странице, а не в справке. -->
    <p class="text-sm text-subtle">
      Здесь публикации через официальные API площадок. Очередь постинга через устройство —
      в разделе <NuxtLink to="/posting-jobs" class="text-accent-text">Постинг</NuxtLink>,
      сами ролики — в разделе <NuxtLink to="/videos" class="text-accent-text">Видео</NuxtLink>.
    </p>

    <UploadListView />
  </div>
</template>
