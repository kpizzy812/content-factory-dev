<script setup lang="ts">
import type { SceneStatus } from '~~/shared/types/scene'
import { SCENE_STATUS_LABELS } from '~~/shared/types/scene'

const filtersStore = useSceneFiltersStore()

const { data: appsData } = useFetch<{ data: { id: number; name: string }[] }>('/api/apps', {
  default: () => ({ data: [] }) as any,
})
const apps = computed(() => appsData.value?.data ?? [])

watch(apps, (list) => {
  if (!filtersStore.appId && list.length) filtersStore.appId = list[0]!.id
}, { immediate: true })

const statuses: SceneStatus[] = ['draft', 'ready', 'generating', 'done']
</script>

<template>
  <div class="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
    <select v-model.number="filtersStore.appId" class="select select-sm w-full sm:w-64">
      <option :value="undefined" disabled>Выберите приложение</option>
      <option v-for="app in apps" :key="app.id" :value="app.id">{{ app.name }}</option>
    </select>

    <label class="input input-sm flex items-center gap-2 flex-1">
      <Icon name="mingcute:search-line" class="size-4 text-base-content/50" />
      <input v-model="filtersStore.search" type="text" placeholder="Поиск" class="grow" />
    </label>

    <select v-model="filtersStore.status" class="select select-sm w-full sm:w-44">
      <option value="">Все статусы</option>
      <option v-for="s in statuses" :key="s" :value="s">{{ SCENE_STATUS_LABELS[s] }}</option>
    </select>

    <label class="label cursor-pointer gap-2">
      <input v-model="filtersStore.showArchived" type="checkbox" class="toggle toggle-sm" />
      <span class="label-text text-sm">архив</span>
    </label>
  </div>
</template>
