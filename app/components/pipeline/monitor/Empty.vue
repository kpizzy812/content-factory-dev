<script setup lang="ts">
const store = usePipelineMonitorStore()

const hasFilters = computed(
  () => !!store.searchQuery || !!store.runsFilter,
)

function reset() {
  store.resetFilters()
}
</script>

<template>
  <div class="card bg-base-100 border border-base-300">
    <div class="card-body items-center text-center py-10">
      <Icon name="mingcute:inbox-line" class="text-5xl text-base-content/30 mb-2" />
      <h3 class="text-base font-semibold">
        Ничего не найдено
      </h3>
      <p class="text-sm text-base-content/60">
        <template v-if="hasFilters">
          Попробуйте изменить параметры поиска или фильтры.
        </template>
        <template v-else>
          На этой странице нет конвейеров.
        </template>
      </p>
      <button v-if="hasFilters" class="btn btn-ghost btn-sm mt-2" @click="reset">
        <Icon name="mingcute:refresh-2-line" />
        Сбросить фильтры
      </button>
    </div>
  </div>
</template>
