<script setup lang="ts">
/**
 * Витрина оболочки: сайдбар, топбар, ⌘K, подсказка «?».
 * Временная страница этапа 2, удаляется в этапе 7 вместе с /_ui.
 *
 * Нужна потому, что все продуктовые страницы за авторизацией, а оболочку надо
 * смотреть отдельно от них: без сессии usePermissions работает fail-open и
 * отдаёт полную навигацию — это как раз худший случай по объёму меню.
 */
definePageMeta({ layout: 'default' })
useHead({ title: 'Оболочка' })

const { counters } = useNavCounters()

// Демонстрационные счётчики: проверяем, что пункт не меняет ширину при
// переходе с однозначного числа на трёхзначное.
counters.value = {
  activeRuns: 7,
  trends: 240,
  scenariosOnReview: 12,
  videosFailed: 3,
  postingQueued: 8,
  accountsAttention: 2,
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <h1 class="text-xl font-semibold">Витрина оболочки</h1>
    <p class="max-w-2xl text-sm text-muted">
      Сайдбар сворачивается и запоминает состояние, раскрыта только группа активного раздела.
      Подсказка по странице живёт в кнопке «?» топбара. Палитра открывается на Ctrl+K или ⌘K.
    </p>

    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div v-for="i in 8" :key="i" class="rounded-lg border border-border bg-panel p-4">
        <UiMetricStat
          :label="`Показатель ${i}`"
          :value="(i * 37) % 200"
          :delta="i % 2 ? 12 : -8"
          delta-caption="к прошлым суткам"
        />
      </div>
    </div>

    <div class="rounded-lg border border-dashed border-border p-10 text-center text-sm text-subtle">
      Здесь рендерится содержимое страницы
    </div>
  </div>
</template>
