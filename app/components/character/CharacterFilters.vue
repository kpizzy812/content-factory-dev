<script setup lang="ts">
const filtersStore = useCharacterFiltersStore()

const { data: appsData } = useFetch<{ data: { id: number; name: string }[] }>('/api/apps', {
  default: () => ({ data: [] }) as any,
})
const apps = computed(() => appsData.value?.data ?? [])

// При первом получении списка приложений выставляем дефолт, если не выбрано.
watch(apps, (list) => {
  if (!filtersStore.appId && list.length) filtersStore.appId = list[0]!.id
}, { immediate: true })
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

    <UiInput
      v-model="filtersStore.search"
      class="max-w-72 flex-1"
      placeholder="Поиск по имени, описанию, тегу"
    />

    <UiCheckbox v-model="filtersStore.showArchived" label="Показать архив" />
  </div>
</template>
