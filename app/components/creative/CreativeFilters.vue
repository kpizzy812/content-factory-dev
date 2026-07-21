<script setup lang="ts">
const store = useCreativeFiltersStore()

const { data: appsData } = useFetch('/api/apps', { default: () => ({ data: [] }) })
const apps = computed(() => (appsData.value?.data ?? []) as { id: number; name: string }[])

function onFilterChange() {
  store.resetPage()
}
</script>

<template>
  <div class="flex flex-col sm:flex-row gap-3 items-end flex-wrap">
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Тип</legend>
      <select v-model="store.type" class="select" @change="onFilterChange">
        <option value="all">Все типы</option>
        <option value="trend">Тренды</option>
        <option value="scenario">Сценарии</option>
        <option value="video">Видео</option>
      </select>
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Статус</legend>
      <select v-model="store.status" class="select" @change="onFilterChange">
        <option value="">Все статусы</option>
        <option value="new">Новый</option>
        <option value="reviewed">На рассмотрении</option>
        <option value="in_work">В работе</option>
        <option value="completed">Завершён</option>
        <option value="draft">Черновик</option>
        <option value="selected">Выбран</option>
        <option value="pending">Ожидание</option>
        <option value="failed">Ошибка</option>
      </select>
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Приложение</legend>
      <select v-model.number="store.appId" class="select" @change="onFilterChange">
        <option :value="undefined">Все приложения</option>
        <option v-for="app in apps" :key="app.id" :value="app.id">
          {{ app.name }}
        </option>
      </select>
    </fieldset>
  </div>
</template>
