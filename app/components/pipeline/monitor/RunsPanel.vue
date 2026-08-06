<script setup lang="ts">
/**
 * Список запусков конвейера. Источник: design-preview/catalog/05-run-monitor.dc.html
 *
 * Активные закреплены сверху отдельным блоком и не скроллятся: новый запуск
 * наращивает верхний блок и не сдвигает место в истории, куда доскроллил
 * оператор. История сгруппирована по дням.
 */
import type { WorkflowRun } from '~~/shared/types/workflow'
import { dayKey, formatClock, formatDayLabel, runCostLabel } from '../PipelineRunFormat'
import { triggerLabel } from '../PipelineRunStatusMap'

const props = defineProps<{
  pipelineId: string | number
  runs: WorkflowRun[]
  /** Всего запусков у конвейера по мете API. */
  total: number | null
  pending: boolean
  currentRunId?: number | null
  /** Есть ли ещё страницы. */
  hasMore: boolean
  failedOnly: boolean
  /** На своей странице заголовок уже есть — панель его не повторяет. */
  embedded?: boolean
}>()

const emit = defineEmits<{
  'update:failedOnly': [value: boolean]
  'more': []
}>()

const ACTIVE = ['running', 'pending']

const activeRuns = computed(() => props.runs.filter(r => ACTIVE.includes(r.status)))
const historyRuns = computed(() => props.runs.filter(r => !ACTIVE.includes(r.status)))

const failedLoaded = computed(() => props.runs.filter(r => r.status === 'failed').length)

/** Сколько активных показываем без раскрытия — остальные за кнопкой. */
const ACTIVE_VISIBLE = 3
const activeExpanded = ref(false)
const visibleActive = computed(() =>
  activeExpanded.value ? activeRuns.value : activeRuns.value.slice(0, ACTIVE_VISIBLE),
)

interface DayGroup {
  key: string
  date: string
  runs: WorkflowRun[]
  failed: number
}

// Группировка не зависит от «сейчас» и рисуется на сервере; «Сегодня»/«Вчера»
// считается уже в браузере — иначе подпись расходится при гидратации.
const now = ref<Date | null>(null)
onMounted(() => { now.value = new Date() })

const groups = computed<DayGroup[]>(() => {
  const map = new Map<string, DayGroup>()
  for (const run of historyRuns.value) {
    const key = dayKey(run.createdAt)
    let group = map.get(key)
    if (!group) {
      group = { key, date: run.createdAt, runs: [], failed: 0 }
      map.set(key, group)
    }
    group.runs.push(run)
    if (run.status === 'failed') group.failed += 1
  }
  return [...map.values()]
})

function dayTitle(date: string) {
  return now.value ? formatDayLabel(date, now.value) : ''
}

function runHref(id: number) {
  return `/pipeline/${props.pipelineId}/runs/${id}`
}
</script>

<template>
  <div class="flex min-h-0 flex-col border-border bg-panel">
    <div class="flex flex-none flex-col gap-[7px] border-b border-divider p-2.5">
      <div v-if="!embedded" class="flex items-center gap-2">
        <span class="text-base font-semibold">Запуски</span>
        <span v-if="total != null" class="tnum font-mono text-micro text-subtle">всего {{ total }}</span>
      </div>
      <button
        type="button"
        class="flex h-7 cursor-pointer items-center gap-[7px] rounded-md border px-[9px] text-sm transition-colors duration-(--duration-fast)"
        :class="failedOnly
          ? 'border-danger-border bg-danger text-inverse'
          : 'border-danger-border bg-danger-bg text-danger hover:bg-danger hover:text-inverse'"
        :aria-pressed="failedOnly"
        @click="emit('update:failedOnly', !failedOnly)"
      >
        <Icon name="mingcute:alert-line" class="shrink-0" />
        Только упавшие
        <span class="tnum ml-auto font-mono text-micro">{{ failedLoaded }}</span>
      </button>
    </div>

    <!-- Активные не скроллятся: рост блока не сдвигает историю под курсором -->
    <div v-if="activeRuns.length" class="flex-none border-b border-border bg-card">
      <div class="flex items-center gap-[7px] px-2.5 pt-[7px] pb-[5px]">
        <span class="size-1.5 rounded-full bg-info motion-safe:animate-pulse" />
        <span class="text-micro tracking-[.06em] text-subtle uppercase">Активные</span>
        <span class="tnum font-mono text-micro text-info">{{ activeRuns.length }}</span>
        <span class="flex-1" />
        <span v-if="activeRuns.length > ACTIVE_VISIBLE" class="text-micro text-subtle">
          видно {{ visibleActive.length }}
        </span>
      </div>
      <div class="flex flex-col gap-[5px] px-2.5 pb-2">
        <NuxtLink
          v-for="run in visibleActive"
          :key="run.id"
          :to="runHref(run.id)"
          class="block rounded-sm border px-2 py-[7px] no-underline transition-colors duration-(--duration-fast)"
          :class="run.id === currentRunId
            ? 'border-accent-border bg-accent-bg'
            : 'border-border bg-panel hover:bg-card'"
        >
          <div class="flex items-center gap-[7px]">
            <span class="font-mono text-sm text-fg">#{{ run.id }}</span>
            <span class="flex-1" />
            <PipelineRunStatusBadge :status="run.status" size="xs" />
          </div>
          <div class="tnum mt-[5px] flex flex-wrap gap-x-2.5 gap-y-1 font-mono text-micro text-muted">
            <PipelineMonitorLiveDuration
              :started-at="run.startedAt"
              :finished-at="run.finishedAt"
              :now="now?.getTime() ?? null"
            />
            <span>{{ run._count?.steps ?? 0 }} шагов</span>
            <span v-if="runCostLabel(run)">{{ runCostLabel(run) }}</span>
            <span class="text-subtle">{{ triggerLabel(run.triggerType) }}</span>
          </div>
        </NuxtLink>
        <UiButton
          v-if="activeRuns.length > ACTIVE_VISIBLE"
          variant="ghost"
          class="justify-center"
          @click="activeExpanded = !activeExpanded"
        >
          {{ activeExpanded ? 'Свернуть' : `Ещё ${activeRuns.length - ACTIVE_VISIBLE} активных` }}
        </UiButton>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <UiSkeleton v-if="pending && !runs.length" variant="details" :count="6" class="p-2.5" />

      <div v-else-if="!runs.length" class="p-4">
        <p class="text-sm text-muted">
          {{ failedOnly ? 'Упавших запусков нет.' : 'Запусков пока нет.' }}
        </p>
      </div>

      <template v-else>
        <div v-for="group in groups" :key="group.key">
          <div
            class="sticky top-0 z-2 flex items-center gap-2 border-b border-divider bg-panel px-2.5 py-[5px]"
          >
            <ClientOnly>
              <span class="text-micro tracking-[.06em] text-subtle uppercase">{{ dayTitle(group.date) }}</span>
              <template #fallback>
                <span class="text-micro tracking-[.06em] text-subtle uppercase">Запуски</span>
              </template>
            </ClientOnly>
            <span class="tnum font-mono text-micro text-subtle">{{ group.runs.length }}</span>
            <span class="flex-1" />
            <span v-if="group.failed" class="tnum font-mono text-micro text-danger">
              {{ group.failed }} упало
            </span>
          </div>
          <NuxtLink
            v-for="run in group.runs"
            :key="run.id"
            :to="runHref(run.id)"
            class="block border-b border-divider px-2.5 py-2 no-underline transition-colors duration-(--duration-fast)"
            :class="run.id === currentRunId ? 'bg-accent-bg' : 'hover:bg-card'"
          >
            <div class="flex items-center gap-[7px]">
              <span class="font-mono text-sm text-muted">#{{ run.id }}</span>
              <span class="flex-1" />
              <PipelineRunStatusBadge :status="run.status" size="xs" />
            </div>
            <p v-if="run.errorMessage" class="mt-[3px] truncate text-sm text-danger">
              {{ run.errorMessage }}
            </p>
            <div class="tnum mt-[5px] flex flex-wrap gap-x-2.5 gap-y-1 font-mono text-micro text-subtle">
              <span>{{ formatClock(run.createdAt, false) }}</span>
              <PipelineMonitorLiveDuration
                :started-at="run.startedAt"
                :finished-at="run.finishedAt"
                :now="now?.getTime() ?? null"
              />
              <span>{{ run._count?.steps ?? 0 }} шагов</span>
              <span v-if="runCostLabel(run)">{{ runCostLabel(run) }}</span>
              <span>{{ triggerLabel(run.triggerType) }}</span>
            </div>
          </NuxtLink>
        </div>

        <div class="flex flex-col gap-1.5 p-2.5">
          <UiButton v-if="hasMore" :loading="pending" class="justify-center" @click="emit('more')">
            Показать ещё
          </UiButton>
          <span v-if="total != null" class="tnum text-center font-mono text-micro text-subtle">
            показано {{ runs.length }} из {{ total }}
          </span>
        </div>
      </template>
    </div>
  </div>
</template>
