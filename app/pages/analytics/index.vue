<script setup lang="ts">
/**
 * Аналитика. Источник: design-preview/catalog/07-analytics.dc.html.
 *
 * Экран отвечает на три вопроса подряд: сколько дошло от тренда до продажи,
 * что именно сработало и как это выглядело во времени. Разбор одной публикации
 * открывается кликом по ролику в рейтинге — это та же цепочка, только целиком.
 *
 * Вкладки «По аккаунту» и «Аккаунты» остались от прежнего экрана: там живут
 * per-post выборка по одному аккаунту и Apify-метрики профилей, и сквозная
 * воронка их не заменяет.
 */
import type { AttributionModel, TimeseriesMetric } from '#shared/types/analytics-funnel'
import { periodLabel } from '~/components/analytics/AnalyticsFunnelFormat'

definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'analytics' })
useHead({ title: 'Аналитика' })

type Tab = 'summary' | 'account' | 'accounts'

const route = useRoute()
const router = useRouter()
const filtersStore = useAnalyticsFiltersStore()

// URL ↔ state sync для runId/pipelineId (из кнопки «К юниту» монитора запусков)
useRunPipelineFilter(filtersStore)

const activeTab = computed<Tab>(() => {
  const value = route.query.tab
  return value === 'account' || value === 'accounts' ? value : 'summary'
})

const TABS: Array<{ key: Tab, label: string, icon: string }> = [
  { key: 'summary', label: 'Сводный вид', icon: 'mingcute:chart-bar-line' },
  { key: 'account', label: 'По аккаунту', icon: 'mingcute:user-star-line' },
  { key: 'accounts', label: 'Аккаунты', icon: 'mingcute:group-line' },
]

function setTab(tab: Tab) {
  if (tab !== 'account') filtersStore.socialAccountId = undefined
  filtersStore.resetPage()
  router.replace({ query: { ...route.query, tab: tab === 'summary' ? undefined : tab } })
}

// ── Сквозная аналитика ──────────────────────────────────────────────────────
const scopeQuery = computed(() => filtersStore.scopeQuery)
const attributionModel = ref<AttributionModel>('first')
const chartMetric = ref<TimeseriesMetric>('views')

const { data: funnelData, pending: funnelPending, error: funnelError, refresh: refreshFunnel }
  = useAnalyticsFunnel(scopeQuery)
const { data: rankingsData, pending: rankingsPending } = useAnalyticsRankings(scopeQuery, attributionModel)
const { data: seriesData, pending: seriesPending } = useAnalyticsTimeseries(scopeQuery, chartMetric)

const funnel = computed(() => funnelData.value?.data ?? null)
const rankings = computed(() => rankingsData.value?.data ?? null)
const series = computed(() => seriesData.value?.data ?? null)

const headerPeriod = computed(() =>
  funnel.value ? periodLabel(funnel.value.period.from, funnel.value.period.to) : '',
)

// ── Разбор одной публикации ────────────────────────────────────────────────
const selectedUploadId = ref<number | null>(null)
const { data: chainData, pending: chainPending, execute: loadChain } = useAnalyticsChain(selectedUploadId)
const chain = computed(() => chainData.value?.data ?? null)

async function selectPublication(uploadId: number) {
  selectedUploadId.value = uploadId
  await loadChain()
}

// ── Таблица публикаций (прежний экран) ──────────────────────────────────────
const { data: postsData, pending: postsPending, error: postsError, refresh: refreshPosts }
  = useAnalyticsPosts(computed(() => filtersStore.query))

const posts = computed(() => postsData.value?.data ?? [])
const meta = computed(() => postsData.value?.meta ?? { total: 0, page: 1, perPage: 20, totalPages: 1 })

// ── Apify-метрики аккаунтов ────────────────────────────────────────────────
const accountsSummaryQuery = computed(() => ({
  ...(filtersStore.appId ? { appId: filtersStore.appId } : {}),
  ...(filtersStore.platform ? { platform: filtersStore.platform } : {}),
}))
const {
  data: accountsSummaryData,
  pending: accountsSummaryPending,
  error: accountsSummaryError,
} = useAnalyticsAccountsSummary(accountsSummaryQuery)
const accountsSummary = computed(() => accountsSummaryData.value?.data ?? null)

const { data: accountsData } = useAccounts(computed(() => ({})))
const accountsList = computed(() => accountsData.value?.data ?? [])
const accountOptions = computed(() => [
  { value: '', label: 'Выберите аккаунт' },
  ...accountsList.value.map(account => ({
    value: account.id,
    label: `${account.displayName} · ${account.platform}`,
  })),
])

function onSelectAccount(value: string | number) {
  const parsed = Number(value)
  filtersStore.socialAccountId = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  filtersStore.resetPage()
}

async function onCollected() {
  await Promise.all([refreshFunnel(), refreshPosts()])
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
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2.5">
      <h1 class="text-xl font-semibold tracking-[-.01em]">Аналитика</h1>
      <span v-if="headerPeriod" class="tnum font-mono text-micro text-subtle">{{ headerPeriod }}</span>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <AnalyticsPeriodPicker />
      <AnalyticsFilters />
    </div>

    <SharedRunPipelineFilterBadge
      :run-id="filtersStore.runId"
      :pipeline-id="filtersStore.pipelineId"
      @clear-run="clearRunFilter"
      @clear-pipeline="clearPipelineFilter"
    />

    <div class="flex gap-0.5 border-b border-divider">
      <button
        v-for="tab in TABS"
        :key="tab.key"
        type="button"
        class="flex h-8 cursor-pointer items-center gap-1.5 border-b-2 px-2.5 text-base"
        :class="activeTab === tab.key
          ? 'border-accent font-medium text-fg'
          : 'border-transparent text-muted hover:text-fg'"
        @click="setTab(tab.key)"
      >
        <Icon :name="tab.icon" />
        {{ tab.label }}
      </button>
    </div>

    <!-- ── Сводный вид ─────────────────────────────────────────────────── -->
    <template v-if="activeTab === 'summary'">
      <UiErrorState
        v-if="funnelError"
        title="Не удалось посчитать воронку"
        :message="funnelError.message"
        @retry="refreshFunnel"
      />
      <UiSkeleton v-else-if="!funnel && funnelPending" variant="details" :count="4" />
      <AnalyticsFunnel v-else-if="funnel" :funnel="funnel" />

      <AnalyticsKpiRow v-if="funnel" :kpis="funnel.kpis" />

      <!--
        На телефоне остаются воронка и KPI: рейтинги, график и разбор — это
        таблицы в пять колонок, и на 390 они превращаются в кашу. Так же
        сделано в макете: «Рейтинги и разбор публикации — с компьютера».
      -->
      <p class="text-sm text-subtle sm:hidden">
        Рейтинги, динамика и разбор публикации — с компьютера: на телефоне
        остаются воронка и показатели периода.
      </p>

      <div class="hidden gap-3 sm:grid xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <UiSkeleton v-if="!rankings && rankingsPending" variant="details" :count="4" />
        <AnalyticsTopVideos
          v-else-if="rankings"
          :videos="rankings.topVideos"
          :selected-upload-id="selectedUploadId"
          @select="selectPublication"
        />
        <AnalyticsLeadsByAccount
          v-if="rankings"
          :accounts="rankings.byAccount"
          :geo="rankings.geo"
          :period-label="headerPeriod"
        />
      </div>

      <section v-if="rankings" class="hidden flex-col gap-3 sm:flex">
        <div class="flex flex-wrap items-baseline gap-2.5">
          <h2 class="text-base font-semibold">Что сработало</h2>
          <div class="flex rounded-md border border-border bg-card p-0.5">
            <button
              type="button"
              class="h-5.5 rounded-sm px-2.5 text-micro"
              :class="attributionModel === 'first' ? 'bg-raised text-fg' : 'text-muted hover:text-fg'"
              @click="attributionModel = 'first'"
            >
              По первому касанию
            </button>
            <button
              type="button"
              class="h-5.5 rounded-sm px-2.5 text-micro"
              :class="attributionModel === 'last' ? 'bg-raised text-fg' : 'text-muted hover:text-fg'"
              @click="attributionModel = 'last'"
            >
              По последнему
            </button>
          </div>
          <p class="max-w-[860px] text-[12.5px] text-muted">
            Рейтинги хуков, трендов и источников — по первому касанию: последнее
            перекладывает заслугу на пост с лид-магнитом и занижает хук, который
            человека привёл. Деньги в KPI — по последнему, как в CRM.
          </p>
        </div>

        <div class="grid gap-3.5 lg:grid-cols-2 xl:grid-cols-3">
          <AnalyticsHooksRanking :hooks="rankings.hooks" />
          <AnalyticsTrendSources :sources="rankings.trendSources" />
          <AnalyticsAbCompare
            v-for="comparison in rankings.abTests"
            :key="comparison.scenarioId"
            :comparison="comparison"
          />
        </div>
      </section>

      <section class="hidden flex-col gap-3 sm:flex">
        <div class="flex flex-wrap items-baseline gap-2.5">
          <h2 class="text-base font-semibold">Динамика во времени</h2>
          <p class="max-w-[860px] text-[12.5px] text-muted">
            Один показатель на графике, переключение сверху. Отметки под осью —
            дни с публикациями: всплеск читается вместе со своей причиной.
          </p>
        </div>
        <UiSkeleton v-if="!series && seriesPending" variant="details" :count="3" />
        <AnalyticsTrendChart v-else-if="series" v-model:metric="chartMetric" :series="series" />
      </section>

      <section v-if="selectedUploadId" class="hidden flex-col gap-3 sm:flex">
        <div class="flex flex-wrap items-baseline gap-2.5">
          <h2 class="text-base font-semibold">Разбор публикации</h2>
          <p class="max-w-[860px] text-[12.5px] text-muted">
            Полная цепочка происхождения от тренда до продажи.
          </p>
          <UiButton variant="ghost" size="sm" class="ml-auto" @click="selectedUploadId = null">
            Свернуть
          </UiButton>
        </div>
        <UiSkeleton v-if="!chain && chainPending" variant="details" :count="3" />
        <AnalyticsPublicationChain v-else-if="chain" :chain="chain" />
      </section>
    </template>

    <!-- ── По аккаунту ─────────────────────────────────────────────────── -->
    <template v-else-if="activeTab === 'account'">
      <UiSelect
        :model-value="filtersStore.socialAccountId ?? ''"
        :options="accountOptions"
        class="w-[280px]"
        @update:model-value="onSelectAccount"
      />
    </template>

    <!-- ── Аккаунты: Apify-метрики профилей ────────────────────────────── -->
    <template v-else>
      <p class="flex items-start gap-1.5 px-1 text-micro text-muted">
        <Icon name="mingcute:information-line" class="mt-0.5 shrink-0" />
        <span>
          Метрики профилей собираются через Apify и не зависят от способа
          постинга: публичный профиль скрейпится и для API-аккаунта, и для
          автоматизации. Метрики отдельных публикаций — на вкладке «Сводный вид».
        </span>
      </p>

      <UiSkeleton v-if="accountsSummaryPending && !accountsSummary" variant="details" :count="4" />
      <UiErrorState
        v-else-if="accountsSummaryError"
        title="Не удалось загрузить сводку"
        :message="accountsSummaryError.message"
      />
      <UiEmptyState
        v-else-if="accountsSummary && !accountsSummary.items.length"
        title="Аккаунтов нет"
        description="Заведите аккаунт в разделе «Аккаунты» и соберите статистику."
      />
      <template v-else-if="accountsSummary">
        <AnalyticsAccountsSummaryAggregate :aggregate="accountsSummary.aggregate" />
        <div class="grid gap-3 lg:grid-cols-2">
          <AnalyticsAccountsSummaryCard
            v-for="item in accountsSummary.items"
            :key="item.account.id"
            :item="item"
          />
        </div>
      </template>
    </template>

    <!-- ── Таблица публикаций: общая для сводного вида и разреза по аккаунту -->
    <template v-if="activeTab !== 'accounts'">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-base font-semibold">Публикации</h2>
        <AnalyticsCollectButton @collected="onCollected" />
      </div>

      <UiSkeleton v-if="postsPending && !posts.length" variant="table" :count="6" />
      <UiErrorState
        v-else-if="postsError"
        title="Не удалось загрузить публикации"
        :message="postsError.message"
        @retry="refreshPosts"
      />
      <UiEmptyState
        v-else-if="!posts.length"
        title="Публикаций за период нет"
        description="Опубликуйте ролики и соберите метрики — таблица наполнится сама."
      />
      <template v-else>
        <AnalyticsPostsTable
          :posts="posts"
          :sort-by="filtersStore.sortBy ?? 'createdAt'"
          :sort-order="filtersStore.sortOrder ?? 'desc'"
          @update:sort="filtersStore.toggleSort($event as never)"
          @select="selectPublication"
        />
        <ListPagination
          v-if="meta.totalPages > 1"
          :page="meta.page"
          :per-page="meta.perPage"
          :total="meta.total"
          :total-pages="meta.totalPages"
          @update:page="filtersStore.page = $event"
          @update:per-page="filtersStore.perPage = $event"
        />
      </template>
    </template>
  </div>
</template>
