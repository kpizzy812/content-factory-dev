<script setup lang="ts">
const store = useCreativeFiltersStore()

const { data: appsData } = useFetch('/api/apps', { default: () => ({ data: [] }) })
const apps = computed(() => (appsData.value?.data ?? []) as { id: number, name: string }[])

/** Общий список статусов трёх сущностей: у каждой свои, пересечения нет. */
const STATUS_OPTIONS = [
  { value: '', label: 'Любой статус' },
  { value: 'new', label: 'Новый' },
  { value: 'reviewed', label: 'На рассмотрении' },
  { value: 'in_work', label: 'В работе' },
  { value: 'completed', label: 'Завершён' },
  { value: 'draft', label: 'Черновик' },
  { value: 'selected', label: 'Выбран' },
  { value: 'pending', label: 'Ожидает' },
  { value: 'failed', label: 'Ошибка' },
]
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <UiSelect
      v-model="store.type"
      class="w-44"
      :options="[
        { value: 'all', label: 'Все типы' },
        { value: 'trend', label: 'Тренды' },
        { value: 'scenario', label: 'Сценарии' },
        { value: 'video', label: 'Ролики' },
      ]"
      @update:model-value="store.resetPage()"
    />

    <UiSelect
      v-model="store.status"
      class="w-52"
      :options="STATUS_OPTIONS"
      @update:model-value="store.resetPage()"
    />

    <UiSelect
      :model-value="store.appId ?? ''"
      class="w-56"
      :options="[
        { value: '', label: 'Все приложения' },
        ...apps.map(a => ({ value: a.id, label: a.name })),
      ]"
      @update:model-value="store.appId = $event ? Number($event) : undefined; store.resetPage()"
    />
  </div>
</template>
