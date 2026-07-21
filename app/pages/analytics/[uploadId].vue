<script setup lang="ts">
definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'analytics' })

const route = useRoute()
const uploadId = computed(() => Number(route.params.uploadId))

const { data, pending, error, refresh } = useAnalyticsDetail(uploadId)

const detail = computed(() => data.value?.data ?? null)

useHead({
  title: computed(() => detail.value?.title ? `${detail.value.title} - Аналитика` : 'Аналитика поста'),
})

const platformLabels: Record<string, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString('ru-RU')
}

async function onAnalyzed() {
  await refresh()
}
</script>

<template>
  <div class="space-y-4">
    <NuxtLink to="/analytics" class="btn btn-ghost btn-sm gap-1">
      <Icon name="mingcute:arrow-left-line" />
      Назад к аналитике
    </NuxtLink>

    <!-- Loading -->
    <div v-if="pending" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <!-- Error -->
    <div v-else-if="error" role="alert" class="alert alert-error">
      <Icon name="mingcute:warning-line" />
      <span>Ошибка загрузки: {{ error.message }}</span>
    </div>

    <template v-else-if="detail">
      <!-- Upload info card -->
      <div class="card bg-base-100 shadow-sm">
        <div class="card-body">
          <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div>
              <h1 class="text-xl font-bold text-base-content">
                {{ detail.title || 'Без названия' }}
              </h1>
              <div class="flex flex-wrap items-center gap-2 mt-2 text-sm text-base-content/60">
                <span class="badge badge-sm badge-ghost">
                  {{ platformLabels[detail.socialAccount?.platform ?? ''] ?? '---' }}
                </span>
                <span>{{ detail.socialAccount?.displayName }}</span>
                <span>{{ formatDate(detail.createdAt) }}</span>
              </div>
              <a
                v-if="detail.platformPostUrl"
                :href="detail.platformPostUrl"
                target="_blank"
                class="link link-primary text-sm mt-1 inline-flex items-center gap-1"
              >
                <Icon name="mingcute:external-link-line" class="text-xs" />
                Открыть на платформе
              </a>
            </div>

            <div v-if="detail.latestMetrics" class="stats stats-vertical sm:stats-horizontal shadow-sm text-sm">
              <div class="stat py-2 px-3">
                <div class="stat-title text-xs">Просмотры</div>
                <div class="stat-value text-base">{{ formatNumber(detail.latestMetrics.views) }}</div>
              </div>
              <div class="stat py-2 px-3">
                <div class="stat-title text-xs">Досмотры</div>
                <div class="stat-value text-base">{{ detail.latestMetrics.watchThrough }}%</div>
              </div>
              <div class="stat py-2 px-3">
                <div class="stat-title text-xs">CTR</div>
                <div class="stat-value text-base">{{ detail.latestMetrics.ctr.toFixed(1) }}%</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Reference banner -->
      <div v-if="detail.reference" role="alert" class="alert alert-success">
        <Icon name="mingcute:star-fill" class="text-lg" />
        <div>
          <h3 class="font-bold text-sm">Этот ролик в базе референсов</h3>
          <p class="text-xs text-success-content/80">{{ detail.reference.reason }}</p>
        </div>
      </div>

      <!-- AI Analyze -->
      <AnalyticsAnalyzeButton :upload-id="uploadId" @analyzed="onAnalyzed" />

      <!-- Metrics History -->
      <AnalyticsMetricsHistory :metrics="detail.metricsHistory ?? []" />
    </template>
  </div>
</template>
