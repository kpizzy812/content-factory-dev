<script setup lang="ts">
definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'video-generator' })
useHead({ title: 'Видео' })

const filters = useVideoFiltersStore()

// Заход из монитора запусков по кнопке «К юниту».
useRunPipelineFilter(filters)
</script>

<template>
  <VideoListView />
</template>
