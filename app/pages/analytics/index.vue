<script setup lang="ts">
definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'analytics' })
useHead({ title: 'Аналитика' })

const filtersStore = useAnalyticsFiltersStore()

// URL ↔ state sync для runId/pipelineId (из кнопки «К юниту» монитора исполнений)
useRunPipelineFilter(filtersStore)

const activeTab = ref<'summary' | 'account' | 'accounts'>('summary')

const { data: dashboardData, refresh: refreshDashboard } = useAnalyticsDashboard(computed(() => filtersStore.dashboardQuery))
const { data: postsData, pending, error, refresh: refreshPosts } = useAnalyticsPosts(computed(() => filtersStore.query))

// Apify-метрики на табе «Аккаунты»: фильтры только platform/appId
// (date/run/pipeline не применимы к AccountMetricsSnapshot — это per-account snapshot).
const accountsSummaryQuery = computed(() => ({
  ...(filtersStore.appId ? { appId: filtersStore.appId } : {}),
  ...(filtersStore.platform ? { platform: filtersStore.platform } : {}),
}))
const {
  data: accountsSummaryData,
  pending: accountsSummaryPending,
  error: accountsSummaryError,
  refresh: refreshAccountsSummary,
} = useAnalyticsAccountsSummary(accountsSummaryQuery)
const accountsSummary = computed(() => accountsSummaryData.value?.data ?? null)

const dashboard = computed(() => dashboardData.value?.data ?? null)
const posts = computed(() => postsData.value?.data ?? [])
const meta = computed(() => postsData.value?.meta ?? { total: 0, page: 1, perPage: 20, totalPages: 1 })

const lastCollectedAt = computed(() => {
  const allMetrics = posts.value
    .filter(p => p.latestMetrics)
    .map(p => p.latestMetrics!.collectedAt)
  if (allMetrics.length === 0) return null
  const latest = allMetrics.sort().reverse()[0]
  if (!latest) return null
  return new Date(latest).toLocaleString('ru-RU')
})

// Аккаунты для таба "По аккаунту"
const accountQuery = computed(() => ({}))
const { data: accountsData } = useAccounts(accountQuery)
const accountsList = computed(() => accountsData.value?.data ?? [])

function onSelectAccount(id: number) {
  filtersStore.socialAccountId = id
  filtersStore.resetPage()
}

type SortField = 'views' | 'likes' | 'comments' | 'shares' | 'watchThrough' | 'ctr' | 'followerGain' | 'createdAt'

function onSortUpdate(field: string) {
  filtersStore.toggleSort(field as SortField)
}

function onPageUpdate(p: number) {
  filtersStore.page = p
}

async function onCollected() {
  await Promise.all([refreshDashboard(), refreshPosts()])
}

function switchToAccount() {
  activeTab.value = 'account'
}

function switchToSummary() {
  activeTab.value = 'summary'
  filtersStore.socialAccountId = undefined
  filtersStore.resetPage()
}

function switchToAccounts() {
  activeTab.value = 'accounts'
  // На табе «Аккаунты» socialAccountId не нужен — сбрасываем, чтобы не
  // влиять на post-level выборки при возврате.
  filtersStore.socialAccountId = undefined
  refreshAccountsSummary()
}

function clearRunFilter() {
  filtersStore.runId = undefined
  filtersStore.resetPage()
}

function clearPipelineFilter() {
  filtersStore.pipelineId = undefined
  filtersStore.resetPage()
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-2xl font-bold text-base-content">Аналитика</h1>

    <SharedPageGuide
      guide-key="analytics"
      :title="pageGuides.analytics.title"
      :steps="pageGuides.analytics.steps"
      :tips="pageGuides.analytics.tips"
    />

    <!-- Табы -->
    <div role="tablist" class="tabs tabs-box">
      <button
        role="tab"
        class="tab"
        :class="{ 'tab-active': activeTab === 'summary' }"
        @click="switchToSummary"
      >
        Сводный вид
      </button>
      <button
        role="tab"
        class="tab"
        :class="{ 'tab-active': activeTab === 'account' }"
        @click="switchToAccount"
      >
        По аккаунту
      </button>
      <button
        role="tab"
        class="tab"
        :class="{ 'tab-active': activeTab === 'accounts' }"
        @click="switchToAccounts"
        title="Apify-метрики профилей соцсетей. Покрывает и API-track, и browser_automation."
      >
        Аккаунты
      </button>
    </div>

    <!-- Источник данных — пояснение разводки треков -->
    <div
      v-if="activeTab === 'accounts'"
      class="text-xs text-base-content/60 px-1"
    >
      <Icon name="mingcute:information-line" class="inline-block align-text-bottom" />
      Метрики аккаунтов через Apify (followers / engagement / posts). Покрывает любой
      <code class="bg-base-200 px-1 rounded">postingMethod</code> — публичный профиль
      скрейпится независимо от способа постинга. Per-post метрики (просмотры / CTR
      опубликованного поста) — на вкладке «Сводный вид».
    </div>

    <!-- Фильтр по запуску / конвейеру -->
    <SharedRunPipelineFilterBadge
      :run-id="filtersStore.runId"
      :pipeline-id="filtersStore.pipelineId"
      @clear-run="clearRunFilter"
      @clear-pipeline="clearPipelineFilter"
    />

    <!-- Таб "По аккаунту": выбор аккаунта -->
    <template v-if="activeTab === 'account'">
      <fieldset class="fieldset max-w-xs">
        <legend class="fieldset-legend">Выберите аккаунт</legend>
        <select
          :value="filtersStore.socialAccountId ?? ''"
          class="select w-full"
          @change="onSelectAccount(Number(($event.target as HTMLSelectElement).value))"
        >
          <option value="" disabled>Выберите аккаунт</option>
          <option
            v-for="acc in accountsList"
            :key="acc.id"
            :value="acc.id"
          >
            {{ acc.displayName }} ({{ acc.platform }})
          </option>
        </select>
      </fieldset>
    </template>

    <!-- Фильтры для сводного -->
    <AnalyticsFilters v-if="activeTab === 'summary'" />

    <div
      v-if="activeTab !== 'accounts'"
      class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
    >
      <AnalyticsCollectButton @collected="onCollected" />
      <span v-if="lastCollectedAt" class="text-sm text-base-content/50">
        Последнее обновление: {{ lastCollectedAt }}
      </span>
    </div>

    <!-- ========== ТАБ «Аккаунты»: Apify-метрики, summary endpoint ========== -->
    <template v-if="activeTab === 'accounts'">
      <div
        v-if="accountsSummaryPending && !accountsSummary"
        class="flex justify-center py-12"
      >
        <span class="loading loading-spinner loading-lg" />
      </div>

      <div
        v-else-if="accountsSummaryError"
        role="alert"
        class="alert alert-error alert-soft"
      >
        <Icon name="mingcute:warning-line" />
        <span>Ошибка загрузки сводки: {{ accountsSummaryError.message }}</span>
      </div>

      <SharedEmptyState
        v-else-if="accountsSummary && accountsSummary.items.length === 0"
        icon="mingcute:group-line"
        title="Аккаунтов нет"
        description="Создайте аккаунт в /accounts и соберите статистику в табе «Статистика»."
      />

      <template v-else-if="accountsSummary">
        <AnalyticsAccountsSummaryAggregate :aggregate="accountsSummary.aggregate" />

        <!-- 2 колонки даже на xl: каждая карточка содержит AccountMetricsStatCards
             с 4 horizontal-stat'ами (после sm:). В 3-колонной сетке 4 stat'а не
             влезают по ширине и обрезаются - проверено на Saturn (Test YT 1). -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AnalyticsAccountsSummaryCard
            v-for="item in accountsSummary.items"
            :key="item.account.id"
            :item="item"
          />
        </div>
      </template>
    </template>

    <!-- ========== ТАБЫ «Сводный» / «По аккаунту»: per-post метрики ========== -->
    <template v-if="activeTab !== 'accounts'">
      <!-- Loading -->
      <div v-if="pending" class="flex justify-center py-12">
        <span class="loading loading-spinner loading-lg" />
      </div>

      <!-- Error -->
      <div v-else-if="error" role="alert" class="alert alert-error alert-soft">
        <Icon name="mingcute:warning-line" />
        <span>Ошибка загрузки: {{ error.message }}</span>
      </div>

      <!-- Empty -->
      <SharedEmptyState
        v-else-if="posts.length === 0 && !dashboard"
        icon="mingcute:chart-bar-line"
        title="Данных аналитики пока нет"
        description="Опубликуйте ролики и соберите метрики для начала работы. Метрики аккаунтов — на вкладке «Аккаунты»."
      />

      <!-- Data -->
      <template v-else>
        <!-- Сводный вид: дашборд + топ -->
        <template v-if="activeTab === 'summary'">
          <AnalyticsDashboardStats
            v-if="dashboard"
            :data="dashboard"
            :total-posts="meta.total"
          />

          <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div class="lg:col-span-3">
              <AnalyticsTopCtrList
                v-if="dashboard?.topCtrPosts?.length"
                :posts="dashboard.topCtrPosts"
              />
            </div>
          </div>
        </template>

        <!-- Таблица постов (общая для обоих табов) -->
        <AnalyticsPostsTable
          :posts="posts"
          :meta="meta"
          :sort-by="filtersStore.sortBy ?? 'createdAt'"
          :sort-order="filtersStore.sortOrder ?? 'desc'"
          @update:sort="onSortUpdate"
        />

        <SharedPagination
          v-if="meta.totalPages > 1"
          :page="meta.page"
          :total-pages="meta.totalPages"
          :total="meta.total"
          @update:page="onPageUpdate"
        />
      </template>
    </template>
  </div>
</template>
