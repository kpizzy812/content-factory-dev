<script setup lang="ts">
import { formatRate } from '~/components/analytics/AnalyticsFormat'
definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'analytics' })

const route = useRoute()
const uploadId = computed(() => Number(route.params.uploadId))

const { data, pending, error, refresh } = useAnalyticsDetail(uploadId)
const detail = computed(() => data.value?.data ?? null)

useHead({ title: computed(() => `${detail.value?.title ?? 'Публикация'} — разбор`) })

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString('ru-RU')
}

const metrics = computed(() => detail.value?.latestMetrics ?? null)

const relations = computed(() => {
  const d = detail.value
  if (!d) return []
  return [
    { label: 'Публикация', title: `pub_${uploadId.value}`, to: `/uploads/${uploadId.value}` },
    { label: 'Разбор', title: 'аналитика', current: true },
  ]
})
</script>

<template>
  <div>
    <UiSkeleton v-if="pending && !detail" variant="details" :count="5" />

    <UiErrorState
      v-else-if="error"
      title="Не удалось загрузить разбор"
      :message="error.message"
      @retry="refresh"
    />

    <template v-else-if="detail">
      <DetailHeader
        :title="detail.title || 'Без названия'"
        :code="`pub_${uploadId}`"
        back-to="/analytics"
        back-label="К аналитике"
      >
        <template #badges>
          <UiPlatformBadge v-if="detail.socialAccount" :platform="detail.socialAccount.platform" />
        </template>

        <template #actions>
          <a v-if="detail.platformPostUrl" :href="detail.platformPostUrl" target="_blank" rel="noopener">
            <UiButton>
              <Icon name="mingcute:external-link-line" />
              Открыть на платформе
            </UiButton>
          </a>
        </template>
      </DetailHeader>

      <div class="flex flex-wrap items-center gap-4 px-1 pb-3 text-sm text-muted">
        <span v-if="detail.socialAccount" class="flex items-center gap-1.5">
          Аккаунт
          <span class="text-fg">{{ detail.socialAccount.displayName }}</span>
        </span>
        <span class="flex items-center gap-1.5">
          Опубликована
          <span class="tnum font-mono">{{ formatDate(detail.createdAt) }}</span>
        </span>
        <DetailRelations :chain="relations" class="ml-auto" />
      </div>

      <div class="flex flex-col gap-3">
        <section v-if="metrics" class="grid gap-3 rounded-lg border border-border bg-panel p-3.5 sm:grid-cols-3">
          <UiMetricStat label="Просмотры" :value="formatNumber(metrics.views)" />
          <UiMetricStat label="Досмотры" :value="formatRate(metrics.watchThrough)" />
          <UiMetricStat label="CTR" :value="formatRate(metrics.ctr)" />
        </section>

        <div
          v-if="detail.reference"
          role="note"
          class="flex items-start gap-2 rounded-md border border-success-border bg-success-bg px-2.5 py-2 text-sm"
        >
          <Icon name="mingcute:star-fill" class="mt-0.5 shrink-0 text-success" />
          <span>
            <span class="font-medium text-success">Ролик в базе референсов.</span>
            {{ detail.reference.reason }}
          </span>
        </div>

        <AnalyticsAnalyzeButton :upload-id="uploadId" @analyzed="refresh" />

        <AnalyticsMetricsHistory :metrics="detail.metricsHistory ?? []" />
      </div>
    </template>
  </div>
</template>
