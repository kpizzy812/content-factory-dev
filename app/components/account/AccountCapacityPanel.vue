<script setup lang="ts">
/**
 * Свободная ёмкость и восстановление лимита. Источник: макет 06.
 *
 * Два разных источника, и в подписи это сказано прямо. Ёмкость — из замера
 * площадки (`content_publishing_limit`), который мы сохраняем в момент
 * отправки. Кривая — прогноз по нашей истории публикаций: квота катится сутки,
 * поэтому публикация в 14:02 освобождает слот в 14:02 следующего дня.
 *
 * Всё, что зависит от «сейчас» — часы под столбиками и подпись «полностью к» —
 * рисуется только в браузере.
 */
import type { PublishingCapacity } from '#shared/types/account-capacity'

const props = defineProps<{
  capacity: PublishingCapacity | null
}>()

const peak = computed(
  () => Math.max(...(props.capacity?.recovery ?? []).map(point => point.recovered), 1),
)

const totalRecovering = computed(
  () => (props.capacity?.recovery ?? []).reduce((sum, point) => sum + point.recovered, 0),
)

function hourLabel(iso: string): string {
  const date = new Date(iso)
  return String(date.getHours()).padStart(2, '0')
}

const fullyRecoveredLabel = computed(() => {
  const stamp = props.capacity?.fullyRecoveredAt
  if (!stamp) return null
  const date = new Date(stamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
})
</script>

<template>
  <section v-if="capacity" class="overflow-hidden rounded-lg border border-border bg-panel">
    <header class="flex flex-wrap items-center gap-2.5 border-b border-border bg-card px-3.5 py-2.5">
      <span class="text-sm font-semibold">Свободная ёмкость на сутки</span>
      <span class="ml-auto flex items-baseline gap-1.5">
        <span class="tnum font-mono text-lg font-semibold">
          {{ capacity.totalFree ?? '—' }}
        </span>
        <span class="text-micro text-subtle">
          {{ capacity.totalFree === null ? 'замеров площадки нет' : 'слотов' }}
        </span>
      </span>
    </header>

    <div class="px-3.5 py-3">
      <div
        v-if="capacity.totalFree === null"
        class="flex items-start gap-2 text-sm text-muted"
      >
        <Icon name="mingcute:information-line" class="mt-0.5 shrink-0" />
        <span>
          Лимит публикаций площадка отдаёт только в момент отправки. Пока с этих
          аккаунтов не публиковали, свободную ёмкость взять неоткуда — считать её
          по своей истории значило бы выдумать число.
        </span>
      </div>

      <p v-else-if="capacity.accountsWithoutLimit > 0" class="mb-2 text-sm text-muted">
        Посчитано по аккаунтам со свежим замером. Ещё
        <span class="tnum font-mono">{{ capacity.accountsWithoutLimit }}</span>
        без замера или с протухшим — они в сумму не входят.
      </p>

      <ClientOnly>
        <template v-if="totalRecovering > 0">
          <div class="mt-1 flex h-14 items-end gap-1">
            <div
              v-for="point in capacity.recovery"
              :key="point.hour"
              class="flex flex-1 flex-col justify-end gap-1"
              :title="`${hourLabel(point.hour)}:00 · вернётся ${point.recovered}`"
            >
              <span
                class="rounded-t-[2px] bg-accent"
                :style="{
                  height: `${point.recovered ? Math.max((point.recovered / peak) * 40, 3) : 0}px`,
                  opacity: point.recovered ? 0.85 : 0,
                }"
              />
              <span class="text-center font-mono text-[10px] text-subtle">
                {{ hourLabel(point.hour) }}
              </span>
            </div>
          </div>
          <p class="mt-1.5 text-[11px] text-subtle">
            Прогноз по нашей истории публикаций: слот возвращается через сутки
            после отправки. Агрегат площадки главнее — если он расходится с
            прогнозом, верить надо ему.
            <template v-if="fullyRecoveredLabel">
              Последний слот вернётся к {{ fullyRecoveredLabel }}.
            </template>
          </p>
        </template>
        <p v-else class="text-[11px] text-subtle">
          За последние сутки публикаций не было — восстанавливать нечего.
        </p>
      </ClientOnly>
    </div>
  </section>
</template>
