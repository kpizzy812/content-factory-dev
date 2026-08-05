<script setup lang="ts">
definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'script-generator' })
useHead({ title: 'Идеи' })

const filters = useIdeaFiltersStore()

// Заход из монитора запусков по кнопке «К юниту».
useRunPipelineFilter(filters)

const list = useTemplateRef('list')

async function onCreated() {
  filters.resetPage()
  await list.value?.refresh()
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <IdeaSubmitForm @created="onCreated" />
    <IdeaSyncToolbar @imported="onCreated" />
    <IdeaListView ref="list" />
  </div>
</template>
