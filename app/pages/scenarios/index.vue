<script setup lang="ts">
definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'script-generator' })
useHead({ title: 'Сценарии' })

const route = useRoute()
const filters = useScenarioFiltersStore()

// Заход из карточки тренда: /scenarios?trendId=42
if (route.query.trendId) {
  filters.trendId = Number(route.query.trendId)
}

// Заход из монитора запусков по кнопке «К юниту».
useRunPipelineFilter(filters)
</script>

<template>
  <ScenarioListView />
</template>
