<script setup lang="ts">
/**
 * Разбор шага по типу ноды: то, что нельзя показать общей формой.
 *
 * Вынесено из строки шага отдельным файлом — иначе разметка шага снова
 * вырастает в пятисотстрочный монолит, где видео, уведомления и пустые
 * результаты перемешаны.
 */
import type { WorkflowStep } from '~~/shared/types/workflow'

const props = defineProps<{ step: WorkflowStep }>()

const out = computed(() => (props.step.output ?? null) as Record<string, any> | null)

const noData = computed(() =>
  props.step.status === 'no_data' || out.value?._noData === true,
)

const noDataReason = computed(() =>
  out.value?._noDataReason || out.value?.reason
  || 'Нода отработала технически, но полезного результата не произвела',
)

const notificationSkipped = computed(() =>
  props.step.nodeType === 'notification' && out.value?.skipReason === 'no_data',
)

/** Итог рендера шаблона уведомления — сервер пишет его в renderStatus. */
const RENDER_STATUS: Record<string, { box: string; iconTone: string; label: string; icon: string }> = {
  blocked_unresolved_variables: {
    box: 'border-danger-border bg-danger-bg',
    iconTone: 'text-danger',
    label: 'Отправка заблокирована: неразрешённые переменные',
    icon: 'mingcute:close-circle-line',
  },
  blocked_template_error: {
    box: 'border-danger-border bg-danger-bg',
    iconTone: 'text-danger',
    label: 'Отправка заблокирована: ошибка шаблона',
    icon: 'mingcute:close-circle-line',
  },
  sent_degraded: {
    box: 'border-warning-border bg-warning-bg',
    iconTone: 'text-warning',
    label: 'Отправлено с неразрешёнными переменными',
    icon: 'mingcute:alert-line',
  },
  rendered_ok: {
    box: 'border-success-border bg-success-bg',
    iconTone: 'text-success',
    label: 'Отправлено успешно',
    icon: 'mingcute:check-circle-line',
  },
  blocked_no_data: {
    box: 'border-info-border bg-info-bg',
    iconTone: 'text-info',
    label: 'Не отправлено: в контексте не было данных',
    icon: 'mingcute:notification-off-line',
  },
}

const renderStatus = computed(() => {
  if (props.step.nodeType !== 'notification') return null
  const key = out.value?.renderStatus
  return key ? RENDER_STATUS[key] ?? null : null
})

const videoSummary = computed(() => {
  if (props.step.nodeType !== 'video') return null
  const o = out.value
  if (!o || (o.generatedCount === undefined && o.failedCount === undefined)) return null
  return {
    generated: o.generatedCount ?? 0,
    failed: o.failedCount ?? 0,
    timeouts: o.timeoutCount ?? 0,
    domainStatus: o._domainStatus as string | undefined,
    degraded: o._domainDegraded === true,
    videos: Array.isArray(o.videos) ? o.videos : [],
  }
})

const DOMAIN_LABEL: Record<string, string> = {
  success: 'Все ролики готовы',
  partial: 'Частичный результат',
  failed: 'Генерация не удалась',
}

/** Ограничение кардинальности: сервер помечает им усечённый вход. */
const limited = computed(() => {
  const o = out.value
  if (!o?._cardinalityLimited) return null
  return { applied: o._limitApplied, total: o._totalAvailable }
})

const duplicates = computed(() => {
  const n = out.value?.skippedDuplicates
  return typeof n === 'number' && n > 0 ? n : null
})

const errors = computed<string[]>(() => {
  const e = out.value?.errors
  return Array.isArray(e) ? e : []
})

const unresolved = computed<string[]>(() => {
  const v = out.value?.unresolvedVariables
  return Array.isArray(v) ? v : []
})

const stripped = computed<string[]>(() => {
  const v = out.value?.strippedExpressions
  return Array.isArray(v) ? v : []
})

const snapshot = computed<Array<[string, unknown]>>(() => {
  const s = out.value?.resolvedSnapshot
  return s && typeof s === 'object' ? Object.entries(s) : []
})

function money(value: unknown) {
  return typeof value === 'number' ? `$${value.toFixed(2)}` : null
}
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <p
      v-if="noData"
      class="flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-sm text-fg"
    >
      <Icon name="mingcute:inbox-line" class="mt-0.5 shrink-0 text-warning" />
      <span class="min-w-0 flex-1">
        {{ noDataReason }}
        <span v-if="out?.skipped" class="block text-micro text-subtle">
          Ноды ниже по графу пропущены вместе с этой.
        </span>
      </span>
    </p>

    <p
      v-if="notificationSkipped"
      class="flex items-start gap-2 rounded-md border border-info-border bg-info-bg px-2.5 py-2 text-sm text-fg"
    >
      <Icon name="mingcute:notification-off-line" class="mt-0.5 shrink-0 text-info" />
      <span class="min-w-0 flex-1">
        Сработала политика «пропускать при отсутствии данных» — ложно-успешное сообщение не ушло.
        <span v-if="out?.noDataSources?.length" class="block text-micro text-subtle">
          Источники без данных: {{ out.noDataSources.map((s: any) => s.nodeName).join(', ') }}
        </span>
      </span>
    </p>

    <p
      v-if="renderStatus"
      class="flex items-start gap-2 rounded-md border px-2.5 py-2 text-sm text-fg"
      :class="renderStatus.box"
    >
      <Icon :name="renderStatus.icon" class="mt-0.5 shrink-0" :class="renderStatus.iconTone" />
      <span class="min-w-0 flex-1">
        {{ renderStatus.label }}
        <span v-if="out?.error" class="block text-micro text-muted">{{ out.error }}</span>
      </span>
    </p>

    <div v-if="limited || duplicates" class="flex flex-wrap items-center gap-2 text-sm text-muted">
      <span
        v-if="limited"
        class="inline-flex h-5 items-center gap-1.5 rounded-sm border border-warning-border bg-warning-bg px-[7px] text-micro text-warning"
      >
        Лимит: взято {{ limited.applied }} из {{ limited.total }}
      </span>
      <span
        v-if="duplicates"
        class="inline-flex h-5 items-center gap-1.5 rounded-sm border border-border bg-card px-[7px] text-micro text-muted"
      >
        {{ duplicates }} уже существовали и пропущены
      </span>
    </div>

    <div v-if="videoSummary" class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <span
          v-if="videoSummary.domainStatus"
          class="inline-flex h-5 items-center rounded-sm border px-[7px] text-micro"
          :class="{
            success: 'border-success-border bg-success-bg text-success',
            partial: 'border-warning-border bg-warning-bg text-warning',
            failed: 'border-danger-border bg-danger-bg text-danger',
          }[videoSummary.domainStatus] ?? 'border-border bg-card text-muted'"
        >
          {{ DOMAIN_LABEL[videoSummary.domainStatus] ?? videoSummary.domainStatus }}
        </span>
        <span v-if="videoSummary.degraded" class="text-micro text-warning">
          есть ошибки, но часть роликов готова
        </span>
      </div>

      <div class="grid gap-2 sm:grid-cols-3">
        <div class="rounded-md border border-border bg-card px-2.5 py-2">
          <div class="text-micro text-subtle">Сгенерировано</div>
          <div class="tnum font-mono text-lg text-success">{{ videoSummary.generated }}</div>
        </div>
        <div class="rounded-md border border-border bg-card px-2.5 py-2">
          <div class="text-micro text-subtle">Ошибки</div>
          <div class="tnum font-mono text-lg" :class="videoSummary.failed ? 'text-danger' : 'text-subtle'">
            {{ videoSummary.failed }}
          </div>
        </div>
        <div v-if="videoSummary.timeouts" class="rounded-md border border-border bg-card px-2.5 py-2">
          <div class="text-micro text-subtle">Таймауты</div>
          <div class="tnum font-mono text-lg text-warning">{{ videoSummary.timeouts }}</div>
        </div>
      </div>

      <p
        v-if="videoSummary.timeouts"
        class="flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-sm text-fg"
      >
        <Icon name="mingcute:time-line" class="mt-0.5 shrink-0 text-warning" />
        <span>Задача провайдера может ещё выполняться. Повтор шага переподключится к результату, а не начнёт заново.</span>
      </p>

      <ul v-if="videoSummary.videos.length" class="flex flex-col gap-1">
        <li
          v-for="(v, i) in videoSummary.videos"
          :key="i"
          class="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-micro"
        >
          <PipelineRunStatusBadge
            :status="v.status === 'completed' ? 'success' : v.status === 'timeout' ? 'partial' : v.status"
            scope="step"
            size="xs"
          />
          <NuxtLink v-if="v.id" :to="`/videos/${v.id}`" class="font-mono">#{{ v.id }}</NuxtLink>
          <span v-if="v.errorMessage" class="min-w-0 flex-1 truncate text-danger">{{ v.errorMessage }}</span>
          <span v-if="v.duration" class="tnum font-mono text-subtle">{{ v.duration }} c</span>
          <span class="flex-1" />
          <span v-if="money(v.totalCostActual)" class="tnum font-mono text-success">
            факт {{ money(v.totalCostActual) }}
          </span>
          <span v-else-if="money(v.totalCostEstimate)" class="tnum font-mono text-subtle">
            оценка {{ money(v.totalCostEstimate) }}
          </span>
        </li>
      </ul>
    </div>

    <p
      v-if="errors.length"
      class="flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-sm text-fg"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-warning" />
      <span class="min-w-0 flex-1">
        <span v-for="(e, i) in errors" :key="i" class="block">{{ e }}</span>
      </span>
    </p>

    <p
      v-if="unresolved.length"
      class="flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-sm text-fg"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-warning" />
      <span class="min-w-0 flex-1">
        Неразрешённые переменные:
        <span class="font-mono">{{ unresolved.join(', ') }}</span>
      </span>
    </p>

    <p
      v-if="stripped.length"
      class="flex items-start gap-2 rounded-md border border-info-border bg-info-bg px-2.5 py-2 text-sm text-fg"
    >
      <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
      <span class="min-w-0 flex-1">
        Удалены неподдерживаемые выражения:
        <span class="block font-mono text-micro">{{ stripped.join(' · ') }}</span>
      </span>
    </p>

    <UiDisclosure v-if="snapshot.length" title="Снимок подставленных переменных" :count="snapshot.length">
      <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-micro">
        <template v-for="[key, value] in snapshot" :key="key">
          <dt class="text-subtle">{{ key }}</dt>
          <dd class="min-w-0 break-words text-fg">{{ value }}</dd>
        </template>
      </dl>
    </UiDisclosure>
  </div>
</template>
