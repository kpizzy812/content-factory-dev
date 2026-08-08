<script setup lang="ts">
definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'script-generator' })
useHead({ title: 'Идеи' })

const filters = useIdeaFiltersStore()

// Заход из монитора запусков по кнопке «К юниту».
useRunPipelineFilter(filters)

const list = useTemplateRef('list')

// Обмен идеями с MarketingCamp — унаследованная зона: при выключенном
// LEGACY_MARKETING_CAMP_SYNC_ENABLED сервер отдаёт /api/ideas/sync как 404,
// и кнопка «Импорт из MarketingCamp» вела бы в никуда.
const { legacyModules, loadLegacyModules } = useLegacyModules()
await loadLegacyModules()

async function onCreated() {
  filters.resetPage()
  await list.value?.refresh()
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <IdeaSubmitForm @created="onCreated" />
    <IdeaSyncToolbar v-if="legacyModules.marketingCampSync" @imported="onCreated" />
    <IdeaListView ref="list" />
  </div>
</template>
