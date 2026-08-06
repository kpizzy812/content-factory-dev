<script setup lang="ts">
/**
 * Последние циклы производства.
 * Статус берётся из общего маппера цикла, чтобы список и деталь не разъехались.
 */
import { cycleStatus } from './CycleStatusMap'

defineProps<{
  cycles: Array<{
    id: number
    status: string
    app: { id: number; name: string } | null
    startedAt: string
    trendsFound: number
    videosGen: number
    uploadsCount: number
  }>
}>()

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-border bg-panel">
    <div class="flex items-center gap-2 border-b border-divider bg-card px-3.5 py-2.5">
      <h2 class="text-base font-medium">Последние циклы</h2>
      <span class="flex-1" />
      <NuxtLink to="/admin/cycles" class="text-sm">Все циклы</NuxtLink>
    </div>

    <p v-if="!cycles.length" class="px-3.5 py-6 text-center text-sm text-subtle">
      Циклов ещё не было.
    </p>

    <NuxtLink
      v-for="cycle in cycles"
      :key="cycle.id"
      :to="`/admin/cycles/${cycle.id}`"
      class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-divider px-3.5 py-2.5 no-underline last:border-b-0 hover:bg-card sm:grid-cols-[minmax(0,1fr)_110px_repeat(3,64px)_112px]"
    >
      <span class="truncate">{{ cycle.app?.name ?? 'Без приложения' }}</span>
      <UiStatusBadge :status="cycleStatus(cycle.status)" size="xs" />
      <span class="tnum hidden font-mono text-sm text-muted sm:block sm:text-right" title="Трендов">
        {{ cycle.trendsFound }}
      </span>
      <span class="tnum hidden font-mono text-sm text-muted sm:block sm:text-right" title="Роликов">
        {{ cycle.videosGen }}
      </span>
      <span class="tnum hidden font-mono text-sm text-muted sm:block sm:text-right" title="Публикаций">
        {{ cycle.uploadsCount }}
      </span>
      <ClientOnly>
        <span class="tnum col-span-2 font-mono text-micro text-subtle sm:col-span-1 sm:text-right">
          {{ formatDate(cycle.startedAt) }}
        </span>
      </ClientOnly>
    </NuxtLink>

    <p class="border-t border-divider bg-card px-3.5 py-2 text-micro text-subtle">
      Числа в строке — тренды, ролики и публикации цикла.
    </p>
  </section>
</template>
