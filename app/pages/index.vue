<script setup lang="ts">
definePageMeta({ layout: 'default' })
useHead({ title: 'Сейчас' })

/**
 * Дашборд оператора. Источник: design-preview/catalog/01-dashboard.dc.html.
 *
 * Первым блоком идёт не сводка объёмов, а очередь решений: цифры сверху
 * отвечают «что происходит», очередь — «что делать».
 *
 * Из макета не перенесены расход за сутки, состояние интеграций, воронка со
 * средним временем шага и результаты за период: этих величин не считает ни
 * `/api/dashboard/summary`, ни какой-либо другой endpoint.
 */
const { user } = useUserSession()
const { canAccessModule } = usePermissions()
const { counters, attention, computedAt, pending, refresh } = useNavCounters()

const displayName = computed(() => {
  if (!user.value) return ''
  const parts = [user.value.name, user.value.surname].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : user.value.email
})

const computedAtLabel = computed(() => {
  if (!computedAt.value) return null
  return new Date(computedAt.value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-semibold">Сейчас</h1>
      <span v-if="displayName" class="text-sm text-subtle">{{ displayName }}</span>
      <span class="flex-1" />
      <ClientOnly>
        <span v-if="computedAtLabel" class="flex items-center gap-1.5 text-micro text-subtle">
          <span class="size-1.5 shrink-0 rounded-full" :class="pending ? 'bg-info' : 'bg-neutral-border'" />
          посчитано в {{ computedAtLabel }}
        </span>
      </ClientOnly>
      <UiButton :loading="pending" @click="refresh()">
        <Icon v-if="!pending" name="mingcute:refresh-3-line" />
        Обновить
      </UiButton>
    </div>

    <DashboardStatusStrip :counters="counters" :pending="pending" />

    <DashboardAttentionQueue :rows="attention" :pending="pending" />

    <DashboardActiveRuns v-if="canAccessModule('pipeline')" />

    <p class="text-micro text-subtle">
      Сводка пересчитывается раз в тридцать секунд. Разделы, к которым нет доступа,
      не считаются вовсе — счётчик не должен подсказывать объём того, чего не видно.
    </p>
  </div>
</template>
