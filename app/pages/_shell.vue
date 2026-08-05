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

// Счётчики приезжают из /api/dashboard/summary — подставлять демонстрационные
// больше не нужно. На пустой базе они не рисуются, и это правильное поведение:
// пустое место лучше выдуманного числа.
const { counters, attention } = useNavCounters()
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

    <div class="rounded-lg border border-border bg-panel p-4">
      <h2 class="mb-2 text-micro tracking-[.07em] text-subtle uppercase">
        Требует внимания — из /api/dashboard/summary
      </h2>
      <div v-if="!attention.length" class="text-sm text-muted">
        Очередь пуста. На дашборде здесь будет состояние «Всё под контролем»,
        а не серая пустота — пустой список это хороший результат, а не отсутствие данных.
      </div>
      <div
        v-for="row in attention"
        :key="row.key"
        class="flex items-center gap-3 border-b border-divider py-2 last:border-b-0"
      >
        <span class="w-0.5 self-stretch rounded-full" :class="row.severity === 'danger' ? 'bg-danger' : 'bg-warning'" />
        <NuxtLink :to="row.to" class="flex-1 text-sm hover:underline">{{ row.label }}</NuxtLink>
        <span class="tnum font-mono text-sm">{{ row.count }}</span>
        <span v-if="row.oldestAgeMs" class="tnum font-mono text-micro text-subtle">
          старший {{ Math.round(row.oldestAgeMs / 3600000) }} ч
        </span>
      </div>
    </div>
  </div>
</template>
