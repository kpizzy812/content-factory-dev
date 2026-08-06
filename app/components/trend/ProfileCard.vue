<script setup lang="ts">
/**
 * Карточка профиля парсинга.
 *
 * Запуск — главное действие раздела и остаётся видимой кнопкой, хотя он
 * платный (Apify тарифицирует прогон): тот же компромисс, что у включения
 * устройства. Цена объясняется в подтверждении на странице.
 *
 * Редкое и разрушающее — в меню. Проверка конфигурации там же: она бесплатна,
 * но нужна раз в жизни профиля, а в строке съедала бы место у запуска.
 */
import { profileValidation, trendRunStatus } from './TrendRunStatusMap'
import { platformMeta } from '~/components/ui/platform-meta'

const props = defineProps<{
  profile: {
    id: number
    appId: number
    app: { id: number; name: string }
    name: string
    actorId: string
    keywords: string[]
    platforms: string[]
    language: string | null
    geo: string | null
    viewCountMin: number | null
    viewCountMax: number | null
    maxItems: number
    enabled: boolean
    scheduleEnabled: boolean
    scheduleCron: string | null
    scheduleNextRunAt: string | null
    lastSuccessfulRunAt: string | null
    validationStatus: string | null
    validationSummary: string | null
    validatedAt: string | null
    hasActiveRun: boolean
    activeRunId: number | null
    lastRun: {
      id: number
      status: string
      startedAt: string
      completedAt: string | null
      foundCount: number
      importedCount: number
      failureReason: string | null
      triggerType: string
    } | null
  }
  isRunning?: boolean
}>()

const emit = defineEmits<{
  toggle: [id: number, enabled: boolean]
  run: [id: number]
  edit: [id: number]
  delete: [id: number]
  duplicate: [id: number]
  schedule: [id: number]
  showRuns: [id: number]
  showRunDetail: [runId: number]
  validate: [id: number]
}>()

const isActive = computed(() => props.profile.hasActiveRun || !!props.isRunning)

const validation = computed(() => profileValidation(props.profile.validationStatus))
const hasConfigError = computed(() =>
  !!props.profile.validationStatus && props.profile.validationStatus !== 'valid',
)

const canLaunch = computed(() => props.profile.enabled && !isActive.value && !hasConfigError.value)

const lastRunStatus = computed(() =>
  props.profile.lastRun ? trendRunStatus(props.profile.lastRun.status) : null,
)

const KEYWORDS_VISIBLE = 6
const visibleKeywords = computed(() => props.profile.keywords.slice(0, KEYWORDS_VISIBLE))
const hiddenKeywords = computed(() => Math.max(0, props.profile.keywords.length - KEYWORDS_VISIBLE))

const viewsRange = computed(() => {
  const { viewCountMin, viewCountMax } = props.profile
  if (!viewCountMin && !viewCountMax) return null
  return `${viewCountMin ?? 0}–${viewCountMax ?? '∞'} просмотров`
})

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

const menuItems = computed(() => [
  { key: 'runs', label: 'История запусков', icon: 'mingcute:history-line' },
  { key: 'schedule', label: 'Расписание', icon: 'mingcute:time-line' },
  { key: 'validate', label: 'Проверить конфигурацию', icon: 'mingcute:shield-line' },
  { key: 'duplicate', label: 'Дублировать', icon: 'mingcute:copy-2-line' },
  { key: 'edit', label: 'Изменить', icon: 'mingcute:edit-line' },
  { key: 'delete', label: 'Удалить профиль', icon: 'mingcute:delete-2-line', danger: true },
])

function onMenuSelect(key: string) {
  if (key === 'runs') emit('showRuns', props.profile.id)
  else if (key === 'schedule') emit('schedule', props.profile.id)
  else if (key === 'validate') emit('validate', props.profile.id)
  else if (key === 'duplicate') emit('duplicate', props.profile.id)
  else if (key === 'edit') emit('edit', props.profile.id)
  else if (key === 'delete') emit('delete', props.profile.id)
}
</script>

<template>
  <!-- Без overflow-hidden: меню действий выпадает за нижнюю границу карточки -->
  <article
    class="flex flex-col gap-2.5 rounded-lg border bg-card p-3"
    :class="[
      isActive ? 'border-info-border' : 'border-border',
      !profile.enabled && 'opacity-60',
    ]"
  >
    <div class="flex items-start gap-2">
      <div class="flex min-w-0 flex-1 flex-col">
        <span class="flex items-center gap-1.5">
          <span class="truncate font-medium">{{ profile.name }}</span>
          <Icon
            v-if="isActive"
            name="mingcute:loading-line"
            class="shrink-0 animate-spin text-info"
            title="Запуск идёт"
          />
        </span>
        <span class="truncate font-mono text-micro text-subtle">
          {{ profile.app.name }} · {{ profile.actorId }}
        </span>
      </div>

      <UiToggle
        :model-value="profile.enabled"
        :label="profile.enabled ? 'Включён' : 'Выключен'"
        class="shrink-0"
        @update:model-value="emit('toggle', profile.id, !profile.enabled)"
      />
    </div>

    <div class="flex flex-wrap items-center gap-1.5">
      <TrendRunStatusBadge
        kind="validation"
        :status="profile.validationStatus"
        size="xs"
        :title="profile.validationSummary ?? validation.label"
      />
      <span
        v-for="platform in profile.platforms"
        :key="platform"
        class="inline-flex h-[18px] items-center gap-1 rounded-sm border border-divider px-1.5 text-micro text-muted"
      >
        <span class="size-1.5 rounded-full" :style="{ background: platformMeta(platform).color }" />
        {{ platformMeta(platform).label }}
      </span>
      <span v-if="profile.language" class="rounded-sm border border-divider px-1.5 text-micro text-muted">
        {{ profile.language }}
      </span>
      <span v-if="profile.geo" class="rounded-sm border border-divider px-1.5 text-micro text-muted">
        {{ profile.geo }}
      </span>
      <span v-if="viewsRange" class="tnum rounded-sm border border-divider px-1.5 font-mono text-micro text-muted">
        {{ viewsRange }}
      </span>
    </div>

    <div v-if="visibleKeywords.length" class="flex flex-wrap gap-1">
      <span
        v-for="keyword in visibleKeywords"
        :key="keyword"
        class="rounded-sm bg-surface px-1.5 py-0.5 text-micro text-muted"
      >{{ keyword }}</span>
      <span v-if="hiddenKeywords" class="rounded-sm bg-surface px-1.5 py-0.5 text-micro text-subtle">
        +{{ hiddenKeywords }}
      </span>
    </div>
    <p v-else class="text-micro text-subtle">Ключевых слов нет — парсер возьмёт всё, что найдёт актор.</p>

    <p
      v-if="hasConfigError"
      class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2 py-1.5 text-sm text-fg"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-danger" />
      <span class="min-w-0 flex-1">
        {{ profile.validationSummary ?? 'Конфигурация не прошла проверку' }}
        <button
          type="button"
          class="mt-0.5 block cursor-pointer text-sm text-danger underline"
          @click="emit('validate', profile.id)"
        >
          Проверить снова
        </button>
      </span>
    </p>

    <div v-if="profile.scheduleEnabled && profile.scheduleCron" class="flex flex-wrap items-center gap-1.5 text-sm text-muted">
      <Icon name="mingcute:time-line" class="shrink-0" />
      <span class="font-mono">{{ profile.scheduleCron }}</span>
      <ClientOnly>
        <span v-if="profile.scheduleNextRunAt" class="tnum font-mono text-micro text-subtle">
          след. {{ formatDate(profile.scheduleNextRunAt) }}
        </span>
      </ClientOnly>
    </div>

    <button
      v-if="profile.lastRun && lastRunStatus"
      type="button"
      class="flex cursor-pointer flex-wrap items-center gap-2 rounded-md border border-divider px-2 py-1.5 text-left hover:bg-surface"
      @click="emit('showRunDetail', profile.lastRun.id)"
    >
      <TrendRunStatusBadge :status="profile.lastRun.status" size="xs" />
      <ClientOnly>
        <span class="tnum font-mono text-micro text-subtle">
          {{ formatDate(profile.lastRun.completedAt ?? profile.lastRun.startedAt) }}
        </span>
      </ClientOnly>
      <span v-if="profile.lastRun.importedCount > 0" class="tnum font-mono text-micro text-success">
        +{{ profile.lastRun.importedCount }}
      </span>
      <span class="flex-1" />
      <Icon name="mingcute:right-line" class="shrink-0 text-subtle" />
    </button>
    <p v-else class="text-sm text-subtle">Ещё не запускался.</p>

    <div class="flex items-center gap-1.5 border-t border-divider pt-2">
      <UiButton
        variant="primary"
        :disabled="!canLaunch"
        :title="hasConfigError ? 'Исправьте конфигурацию перед запуском' : 'Прогон тарифицируется Apify'"
        @click="emit('run', profile.id)"
      >
        <Icon v-if="!isActive" name="mingcute:play-circle-line" />
        <Icon v-else name="mingcute:loading-line" class="animate-spin" />
        {{ isActive ? 'Работает' : 'Запустить · платно' }}
      </UiButton>
      <span class="flex-1" />
      <UiActionMenu :items="menuItems" @select="onMenuSelect" />
    </div>
  </article>
</template>
