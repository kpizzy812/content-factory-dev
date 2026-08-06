<script setup lang="ts">
import { trendStatus, TREND_STATUS_LABELS } from '~/components/trend/TrendStatusMap'

definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'trendwatcher' })

const route = useRoute()
const trendId = computed(() => route.params.id as string)

const { data, pending, error, refresh } = useTrendDetail(trendId)
const { can } = usePermissions()
const canDelete = computed(() => can('canDelete'))
const toast = useToast()

const trend = computed(() => data.value?.data ?? null)

useHead({ title: computed(() => `${trend.value?.title ?? 'Тренд'} — тренд`) })

// ─── Сценарии тренда ─────────────────────────────────────────────────────────
const scenariosQuery = computed(() => ({ trendId: Number(trendId.value), perPage: 10 }))
const { data: scenariosData, refresh: refreshScenarios } = useScenarios(scenariosQuery)
const trendScenarios = computed(() => scenariosData.value?.data ?? [])
const hasExistingScenarios = computed(() => trendScenarios.value.length > 0)

async function onScenariosGenerated() {
  await Promise.all([refresh(), refreshScenarios()])
}

// ─── Навигация по соседям ────────────────────────────────────────────────────
// Соседи берутся из загруженной страницы списка. Тренда там может не быть —
// заход по прямой ссылке или другие фильтры; тогда стрелки отключены.
const filters = useTrendFiltersStore()
const { data: listData } = useTrends(computed(() => filters.query))

const siblings = computed(() => listData.value?.data?.map((t: { id: number }) => t.id) ?? [])
const currentIndex = computed(() => siblings.value.indexOf(Number(trendId.value)))
const listMeta = computed(() => listData.value?.meta ?? null)
const inList = computed(() => currentIndex.value >= 0)

const hasPrev = computed(() => inList.value && (currentIndex.value > 0 || filters.page > 1))
const hasNext = computed(() => inList.value && (
  currentIndex.value < siblings.value.length - 1
  || (!!listMeta.value && filters.page < listMeta.value.totalPages)))

const position = computed(() => {
  if (!inList.value || !listMeta.value) return undefined
  const absolute = (filters.page - 1) * filters.perPage + currentIndex.value + 1
  return `${absolute} из ${listMeta.value.total}`
})

async function goSibling(delta: -1 | 1) {
  const next = siblings.value[currentIndex.value + delta]
  if (next != null) {
    await navigateTo(`/trends/${next}`)
    return
  }
  const targetPage = filters.page + delta
  if (targetPage < 1 || (listMeta.value && targetPage > listMeta.value.totalPages)) return

  filters.page = targetPage
  await nextTick()
  const edge = delta === 1 ? siblings.value[0] : siblings.value[siblings.value.length - 1]
  if (edge != null) await navigateTo(`/trends/${edge}`)
}

// ─── Свойства и связи ────────────────────────────────────────────────────────
const properties = computed(() => {
  const t = trend.value
  if (!t) return []
  return [
    { label: 'Автор', value: t.authorName, mono: false },
    { label: 'Аудитория автора', value: t.authorFollowers ? t.authorFollowers.toLocaleString('ru-RU') : null },
    { label: 'Виральность', value: t.viralityScore != null ? t.viralityScore.toFixed(1) : null },
    { label: 'Язык', value: t.language },
    { label: 'Гео', value: t.geo },
    { label: 'Ключевое слово', value: t.keyword, mono: false },
    { label: 'Источник', value: t.source },
  ]
})

const relations = computed(() => {
  const t = trend.value
  if (!t) return []
  const chain: Array<{ label: string, title: string, to?: string, current?: boolean }> = [
    { label: 'Тренд', title: `trend_${t.id}`, current: true },
  ]
  if (hasExistingScenarios.value) {
    const first = trendScenarios.value[0]
    chain.push({
      label: trendScenarios.value.length > 1 ? `Сценарии · ${trendScenarios.value.length}` : 'Сценарий',
      title: `#${first.id}`,
      to: `/scenarios/${first.id}`,
    })
  }
  return chain
})

// ─── Смена статуса ───────────────────────────────────────────────────────────
async function changeStatus(next: string) {
  if (!trend.value) return
  try {
    await $fetch(`/api/trends/${trend.value.id}/status`, { method: 'PUT', body: { status: next } })
    await refresh()
    toast.success(`Статус: ${TREND_STATUS_LABELS[next] ?? next}`)
  }
  catch {
    toast.error('Не удалось сменить статус')
  }
}

// ─── Удаление ────────────────────────────────────────────────────────────────
const showDelete = ref(false)
const isDeleting = ref(false)

async function onDelete() {
  if (!trend.value) return
  isDeleting.value = true
  try {
    await $fetch(`/api/trends/${trend.value.id}`, { method: 'DELETE' })
    await navigateTo('/trends')
  }
  catch {
    toast.error('Не удалось удалить тренд')
  }
  finally {
    isDeleting.value = false
    showDelete.value = false
  }
}

// ─── Действия шапки ──────────────────────────────────────────────────────────
const headerActions = computed(() => {
  const t = trend.value
  if (!t) return []
  const items: Array<{ key: string, label: string, icon?: string, group?: string, danger?: boolean }> = []

  if (can('canWrite')) {
    for (const [value, label] of Object.entries(TREND_STATUS_LABELS)) {
      if (value === t.status) continue
      items.push({ key: `status:${value}`, label, group: 'Сменить статус' })
    }
  }
  if (canDelete.value && !t.isDeleted) {
    items.push({ key: 'delete', label: 'Удалить тренд', icon: 'mingcute:delete-2-line', danger: true })
  }
  return items
})

function onHeaderAction(key: string) {
  if (key === 'delete') showDelete.value = true
  else if (key.startsWith('status:')) void changeStatus(key.slice(7))
}

function copyId() {
  if (!trend.value) return
  navigator.clipboard.writeText(`trend_${trend.value.id}`)
  toast.success('Идентификатор скопирован')
}

function fmt(n: number | null | undefined) {
  return (n ?? 0).toLocaleString('ru-RU')
}
</script>

<template>
  <div>
    <UiSkeleton v-if="pending && !trend" variant="details" :count="6" />

    <UiErrorState
      v-else-if="error"
      title="Не удалось загрузить тренд"
      :message="error.message"
      @retry="refresh"
    />

    <template v-else-if="trend">
      <DetailHeader
        :title="trend.title || 'Без названия'"
        :code="`trend_${trend.id}`"
        back-to="/trends"
        back-label="К трендам"
        :position="position"
        :has-prev="hasPrev"
        :has-next="hasNext"
        @prev="goSibling(-1)"
        @next="goSibling(1)"
      >
        <template #badges>
          <UiPlatformBadge :platform="trend.platform" />
          <UiStatusBadge :status="trendStatus(trend.status)" />
          <UiButton icon-only variant="ghost" aria-label="Скопировать идентификатор" @click="copyId">
            <Icon name="mingcute:copy-2-line" />
          </UiButton>
        </template>

        <template #actions>
          <a v-if="trend.sourceUrl" :href="trend.sourceUrl" target="_blank" rel="noopener noreferrer">
            <UiButton>
              <Icon name="mingcute:external-link-line" />
              Оригинал
            </UiButton>
          </a>
          <UiActionMenu v-if="headerActions.length" :items="headerActions" @select="onHeaderAction" />
        </template>
      </DetailHeader>

      <div class="flex flex-wrap items-center gap-4 px-1 pb-3 text-sm text-muted">
        <span class="flex items-center gap-1.5">
          Просмотры
          <span class="tnum font-mono text-fg">{{ fmt(trend.viewCount) }}</span>
        </span>
        <span class="flex items-center gap-1.5">
          Виральность
          <span class="tnum font-mono text-fg">{{ (trend.viralityScore ?? 0).toFixed(1) }}</span>
        </span>
        <span class="flex items-center gap-1.5">
          Импортирован
          <span class="tnum font-mono">{{ new Date(trend.importedAt).toLocaleString('ru-RU') }}</span>
        </span>
        <DetailRelations :chain="relations" class="ml-auto" />
      </div>

      <div class="grid items-start gap-3.5 xl:grid-cols-[minmax(0,1fr)_392px]">
        <!-- ЛЕВАЯ КОЛОНКА · содержимое -->
        <div class="flex min-w-0 flex-col gap-3">
          <section class="overflow-hidden rounded-lg border border-border bg-panel p-3.5">
            <div class="flex flex-col gap-3.5 md:flex-row">
              <div class="shrink-0 md:w-[300px]">
                <video
                  v-if="trend.videoUrl"
                  :src="trend.videoUrl"
                  :poster="trend.thumbnailUrl ?? undefined"
                  controls
                  class="w-full rounded-md border border-border bg-surface"
                />
                <img
                  v-else-if="trend.thumbnailUrl"
                  :src="trend.thumbnailUrl"
                  :alt="trend.title"
                  referrerpolicy="no-referrer"
                  class="w-full rounded-md border border-border bg-surface object-contain"
                >
                <div
                  v-else
                  class="flex aspect-video items-center justify-center rounded-md border border-dashed border-border bg-surface text-sm text-subtle"
                >
                  Медиа нет
                </div>
              </div>

              <div class="min-w-0 flex-1">
                <p v-if="trend.description" class="mb-3 text-sm whitespace-pre-line">{{ trend.description }}</p>

                <h3 class="mb-2 text-micro tracking-[.06em] text-subtle uppercase">Свойства</h3>
                <UiKeyValue :items="properties" />

                <div v-if="trend.hashtags?.length" class="mt-2.5 flex flex-wrap gap-1">
                  <span
                    v-for="tag in trend.hashtags"
                    :key="tag"
                    class="rounded-sm border border-divider px-1.5 py-0.5 font-mono text-micro text-muted"
                  >
                    #{{ tag }}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <TrendAppSelector
            v-if="!trend.appId"
            :trend-id="trend.id"
            :current-app-id="trend.appId"
            :current-app-name="trend.app?.name ?? null"
            @updated="refresh()"
          />

          <section class="rounded-lg border border-border bg-panel p-3.5">
            <div class="mb-2 flex items-center gap-2">
              <h2 class="text-micro tracking-[.06em] text-subtle uppercase">AI-анализ креатива</h2>
              <UiStatusBadge
                v-if="trend.analysisStatus === 'completed'"
                status="done"
                size="xs"
                dot
              />
              <UiStatusBadge
                v-else-if="trend.analysisStatus === 'failed'"
                status="failed"
                size="xs"
                dot
              />
            </div>
            <TrendAiAnalyzeButton
              :trend-id="trend.id"
              :analysis-status="trend.analysisStatus"
              @analyzed="refresh()"
            />
          </section>

          <TrendBriefCard v-if="trend.brief" :brief="trend.brief" />

          <TrendInsightCard
            v-for="insight in trend.insights"
            :key="insight.id"
            :insight="insight"
          />
        </div>

        <!-- ПРАВАЯ КОЛОНКА · метрики и сценарии -->
        <TrendDetailSidebar
          :trend="trend"
          :scenarios="trendScenarios"
          :has-existing-scenarios="hasExistingScenarios"
          @scenarios-generated="onScenariosGenerated"
        />
      </div>

      <UiModal :open="showDelete" title="Удалить тренд?" size="sm" @close="showDelete = false">
        <p class="text-sm text-muted">
          Тренд пропадёт из списка. Сгенерированные по нему сценарии и ролики останутся.
        </p>
        <template #footer>
          <UiButton variant="ghost" @click="showDelete = false">Отмена</UiButton>
          <UiButton variant="danger" :loading="isDeleting" @click="onDelete">Удалить</UiButton>
        </template>
      </UiModal>
    </template>
  </div>
</template>
