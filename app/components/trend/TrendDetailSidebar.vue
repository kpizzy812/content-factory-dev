<script setup lang="ts">
import { scenarioStatus } from '~/components/scenario/ScenarioStatusMap'

const props = defineProps<{
  trend: {
    id: number
    status: string
    viewCount: number
    likeCount: number
    commentCount: number
    sourceUrl: string
    publishedAt: string | null
    importedAt: string
    appId?: number | null
    app?: { name: string } | null
  }
  scenarios: Array<{
    id: number
    status: string
    variants?: Array<{ title: string, status: string }>
  }>
  hasExistingScenarios: boolean
}>()

const emit = defineEmits<{
  scenariosGenerated: []
}>()

function fmt(n: number | null | undefined) {
  return (n ?? 0).toLocaleString('ru-RU')
}

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const metrics = computed(() => [
  { label: 'Просмотры', value: fmt(props.trend.viewCount) },
  { label: 'Лайки', value: fmt(props.trend.likeCount) },
  { label: 'Комментарии', value: fmt(props.trend.commentCount) },
])

const info = computed(() => [
  { label: 'Опубликован', value: props.trend.publishedAt ? fmtDate(props.trend.publishedAt) : null },
  { label: 'Импортирован', value: fmtDate(props.trend.importedAt) },
  { label: 'Приложение', value: props.trend.app?.name ?? null, mono: false },
])
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Метрики -->
    <section class="rounded-lg border border-border bg-panel p-3.5">
      <h2 class="mb-2 text-micro tracking-[.06em] text-subtle uppercase">Метрики</h2>
      <div class="grid grid-cols-3 gap-2">
        <div v-for="m in metrics" :key="m.label" class="min-w-0">
          <div class="text-[11.5px] text-muted">{{ m.label }}</div>
          <div class="tnum truncate font-mono text-lg font-semibold">{{ m.value }}</div>
        </div>
      </div>
    </section>

    <!-- Сценарии -->
    <section class="rounded-lg border border-border bg-panel p-3.5">
      <h2 class="mb-2 text-micro tracking-[.06em] text-subtle uppercase">Сценарии</h2>

      <ScenarioGenerateButton
        :trend-id="trend.id"
        :trend-status="trend.status"
        :has-app="!!trend.app"
        :app-id="trend.appId ?? null"
        :has-existing-scenarios="hasExistingScenarios"
        @generated="emit('scenariosGenerated')"
      />

      <template v-if="hasExistingScenarios">
        <ul class="mt-2.5 flex flex-col">
          <li v-for="s in scenarios" :key="s.id" class="border-b border-divider last:border-b-0">
            <NuxtLink
              :to="`/scenarios/${s.id}`"
              class="flex items-center gap-2 py-1.5 text-sm hover:text-fg"
            >
              <UiStatusBadge :status="scenarioStatus(s.status)" size="xs" dot icon-only />
              <span class="truncate">{{ s.variants?.[0]?.title ?? `Сценарий #${s.id}` }}</span>
            </NuxtLink>
          </li>
        </ul>

        <NuxtLink :to="`/scenarios?trendId=${trend.id}`" class="mt-2 inline-block">
          <UiButton variant="ghost">
            Все сценарии тренда
            <Icon name="mingcute:right-line" />
          </UiButton>
        </NuxtLink>
      </template>
    </section>

    <!-- Информация -->
    <section class="rounded-lg border border-border bg-panel p-3.5">
      <h2 class="mb-2 text-micro tracking-[.06em] text-subtle uppercase">Информация</h2>
      <UiKeyValue :items="info" label-width="124px" />
    </section>
  </div>
</template>
