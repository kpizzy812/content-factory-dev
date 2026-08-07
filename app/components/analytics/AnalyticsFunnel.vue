<script setup lang="ts">
/**
 * Воронка производства и продаж. Источник: 07-analytics.dc.html.
 *
 * Столбики сравнимы только внутри одной величины — штуки со штуками, события
 * с событиями. Общая шкала невозможна: восемьсот тысяч просмотров рядом с
 * сорока роликами превращают все остальные стадии в невидимую полоску.
 *
 * На узком экране воронка становится вертикальным списком: руководитель
 * смотрит с телефона именно её.
 */
import type { FunnelResult } from '#shared/types/analytics-funnel'
import { formatCount } from './AnalyticsFormat'
import { stageHint } from './AnalyticsFunnelFormat'

const props = defineProps<{
  funnel: FunnelResult
}>()

const stages = computed(() => props.funnel.stages)

const summary = computed(() => {
  const first = stages.value[0]
  const last = stages.value[stages.value.length - 1]
  if (!first || !last) return ''
  return `${formatCount(first.value)} ${first.label.toLowerCase()} → ${formatCount(last.value)} ${last.label.toLowerCase()}`
})

const ctrKpi = computed(() => props.funnel.kpis.find(kpi => kpi.key === 'ctr') ?? null)
const alertStage = computed(() => stages.value.find(stage => stage.alert) ?? null)
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-border bg-panel">
    <header class="flex flex-wrap items-center gap-2.5 border-b border-border bg-card px-3.5 py-2.5">
      <span class="text-sm font-semibold">Воронка производства и продаж</span>
      <span class="text-micro text-subtle">
        атрибуция по tracking token · клик по стадии открывает её список
      </span>
      <span class="tnum ml-auto font-mono text-micro text-muted">{{ summary }}</span>
    </header>

    <!-- Широкий экран: восемь стадий в ряд, на 1024 со своим скроллом -->
    <div class="hidden overflow-x-auto sm:block">
      <div class="grid min-w-[880px] grid-cols-8 px-3.5 pt-3 pb-3.5">
        <component
          :is="stage.href ? 'NuxtLink' : 'div'"
          v-for="(stage, index) in stages"
          :key="stage.key"
          :to="stage.href ?? undefined"
          class="px-2.5 first:pl-0 last:pr-0"
          :class="[
            index < stages.length - 1 ? 'border-r border-divider' : '',
            stage.alert ? 'rounded-sm bg-danger-bg' : '',
            stage.href ? 'cursor-pointer hover:bg-card' : '',
          ]"
        >
          <div
            class="flex items-center gap-1.5 text-[11px]"
            :class="stage.alert ? 'text-danger' : 'text-muted'"
          >
            <Icon v-if="stage.alert" name="mingcute:arrow-down-line" />
            {{ stage.label }}
          </div>
          <div class="tnum my-0.5 mb-1.5 font-mono text-xl font-semibold tracking-[-.02em]">
            {{ formatCount(stage.value) }}
          </div>
          <div class="flex h-11 items-end">
            <span
              class="w-full rounded-t-[2px]"
              :class="stage.alert ? 'bg-danger/80' : stage.key === 'sales' ? 'bg-success' : 'bg-neutral-bg'"
              :style="{ height: `${Math.max(stage.share * 100, stage.value > 0 ? 3 : 0)}%` }"
            />
          </div>
          <div
            class="tnum mt-1.5 text-[10.5px]"
            :class="stage.alert ? 'text-danger' : 'text-muted'"
          >
            {{ stageHint(stage) }}
          </div>
        </component>
      </div>
    </div>

    <!-- Телефон: тот же порядок стадий, но списком с горизонтальными полосами -->
    <div class="flex flex-col gap-1.5 p-3 sm:hidden">
      <component
        :is="stage.href ? 'NuxtLink' : 'div'"
        v-for="stage in stages"
        :key="stage.key"
        :to="stage.href ?? undefined"
        class="grid grid-cols-[88px_minmax(0,1fr)_64px] items-center gap-x-2.5 text-sm"
      >
        <span :class="stage.alert ? 'text-danger' : 'text-muted'">{{ stage.label }}</span>
        <span class="h-2.5 overflow-hidden rounded-[2px] bg-card">
          <span
            class="block h-full"
            :class="stage.alert ? 'bg-danger' : stage.key === 'sales' ? 'bg-success' : 'bg-neutral-bg'"
            :style="{ width: `${Math.max(stage.share * 100, stage.value > 0 ? 3 : 0)}%` }"
          />
        </span>
        <span class="tnum text-right font-mono">{{ formatCount(stage.value) }}</span>
      </component>
    </div>

    <div
      v-if="alertStage"
      role="note"
      class="mx-3.5 mb-3 flex items-start gap-2.5 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2"
    >
      <Icon name="mingcute:warning-line" class="mt-0.5 shrink-0 text-danger" />
      <span class="text-[12.5px]">
        Просадка на стадии «{{ alertStage.label }}»: CTR перехода
        {{ stageHint(alertStage) }} против
        {{ ctrKpi?.previous != null ? `${(ctrKpi.previous * 100).toFixed(2).replace('.', ',')} %` : '—' }}
        в прошлом окне той же длины. Нормы CTR у нас нет — сравниваем с собой,
        а не с выдуманным порогом.
      </span>
    </div>

    <footer class="border-t border-divider px-3.5 py-1.5 text-[11px] text-subtle">
      Высота столбика сравнивает стадию с крупнейшей стадией той же величины:
      штуки со штуками, просмотры с просмотрами, события с событиями.
      <template v-if="funnel.productionScopeNote">
        Отбор по площадке и аккаунту сужает только публикации и события —
        тренд, сценарий и ролик площадке не принадлежат.
      </template>
      <template v-if="!funnel.hasAttribution">
        Событий атрибуции за окно нет: переходы, заявки и продажи приходят из
        мессенджера и conversion sink по tracking token.
      </template>
    </footer>
  </section>
</template>
