<script setup lang="ts">
import type { SceneStatus } from '~~/shared/types/scene'
import { SCENE_STATUS_LABELS } from '~~/shared/types/scene'

const filtersStore = useSceneFiltersStore()

const { data: appsData } = useFetch<{ data: { id: number, name: string }[] }>('/api/apps', {
  default: () => ({ data: [] }),
})
const apps = computed(() => appsData.value?.data ?? [])

// Раздел без приложения бессмыслен, поэтому первое подставляется само.
watch(apps, (list) => {
  if (!filtersStore.appId && list.length) filtersStore.appId = list[0]!.id
}, { immediate: true })

const STATUSES: SceneStatus[] = ['draft', 'ready', 'generating', 'done']
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <UiSelect
      :model-value="filtersStore.appId ?? ''"
      class="w-64"
      placeholder="Выберите приложение"
      :options="apps.map(a => ({ value: a.id, label: a.name }))"
      @update:model-value="filtersStore.appId = $event ? Number($event) : undefined"
    />

    <UiInput v-model="filtersStore.search" class="max-w-64 flex-1" placeholder="Поиск по названию" />

    <UiSelect
      v-model="filtersStore.status"
      class="w-44"
      :options="[
        { value: '', label: 'Любой статус' },
        ...STATUSES.map(s => ({ value: s, label: SCENE_STATUS_LABELS[s] })),
      ]"
    />

    <UiCheckbox v-model="filtersStore.showArchived" label="Показать архив" />
  </div>
</template>
