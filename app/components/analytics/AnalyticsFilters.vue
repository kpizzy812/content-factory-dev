<script setup lang="ts">
/**
 * Разрезы сквозной аналитики: приложение, площадка, аккаунт, конвейер.
 *
 * Отбор по языку из макета не перенесён: язык лежит у тренда-источника, а не
 * у публикации, и «язык публикации» пришлось бы выдумывать. Разрез по странам
 * есть там, где для него есть данные — в заявках по аккаунтам.
 */
const store = useAnalyticsFiltersStore()

const accountQuery = computed(() => ({
  ...(store.platform ? { platform: store.platform } : {}),
}))

const { data: accountsData } = useAccounts(accountQuery)
const { data: appsData } = useFetch('/api/apps', { default: () => ({ data: [] }) })
const { data: pipelinesData } = useFetch('/api/pipelines', { default: () => ({ data: [] }) })

const appOptions = computed(() => [
  { value: '', label: 'Все приложения' },
  ...((appsData.value?.data ?? []) as Array<{ id: number, name: string }>)
    .map(app => ({ value: app.id, label: app.name })),
])

const platformOptions = [
  { value: '', label: 'Все площадки' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'instagram', label: 'Instagram' },
]

const accountOptions = computed(() => [
  { value: '', label: 'Все аккаунты' },
  ...(accountsData.value?.data ?? []).map(account => ({
    value: account.id,
    label: account.displayName,
  })),
])

const pipelineOptions = computed(() => [
  { value: '', label: 'Все конвейеры' },
  ...((pipelinesData.value?.data ?? []) as Array<{ id: number, name: string }>)
    .map(pipeline => ({ value: pipeline.id, label: pipeline.name })),
])

/** `UiSelect` отдаёт пустую строку вместо null — приводим сами. */
function toId(value: string | number): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

const hasFilters = computed(() => Boolean(
  store.appId || store.platform || store.socialAccountId || store.pipelineId || store.runId
  || store.period !== '7d',
))

function onApp(value: string | number) {
  store.appId = toId(value)
  store.resetPage()
}

function onPlatform(value: string | number) {
  store.platform = (value || '') as typeof store.platform
  store.socialAccountId = undefined
  store.resetPage()
}

function onAccount(value: string | number) {
  store.socialAccountId = toId(value)
  store.resetPage()
}

function onPipeline(value: string | number) {
  store.pipelineId = toId(value)
  store.resetPage()
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <UiSelect
      :model-value="store.appId ?? ''"
      :options="appOptions"
      class="w-[190px]"
      @update:model-value="onApp"
    />
    <UiSelect
      :model-value="store.platform || ''"
      :options="platformOptions"
      class="w-[160px]"
      @update:model-value="onPlatform"
    />
    <UiSelect
      :model-value="store.socialAccountId ?? ''"
      :options="accountOptions"
      class="w-[190px]"
      @update:model-value="onAccount"
    />
    <UiSelect
      :model-value="store.pipelineId ?? ''"
      :options="pipelineOptions"
      class="w-[190px]"
      @update:model-value="onPipeline"
    />
    <UiButton v-if="hasFilters" variant="ghost" size="sm" @click="store.resetFilters()">
      Сбросить
    </UiButton>
  </div>
</template>
