<script setup lang="ts">
import type { VariantQualityScore, CriticReviewRecord } from '~~/shared/types/scenario'
import { scenarioStatus } from '~/components/scenario/ScenarioStatusMap'
import { videoStatus } from '~/components/video/VideoStatusMap'

definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'script-generator' })

const route = useRoute()
const scenarioId = computed(() => route.params.id as string)

const { data, pending, error, refresh } = useScenarioDetail(scenarioId)
const scenario = computed(() => data.value?.data ?? null)

const toast = useToast()

// ─── Критик ──────────────────────────────────────────────────────────────────
const { data: criticReviewsData, refresh: refreshCriticReviews } = useFetch<{ data: CriticReviewRecord[] }>(
  () => `/api/scenarios/${scenarioId.value}/critic-reviews`,
  { default: () => ({ data: [] }), watch: [scenarioId] },
)
const criticReviews = computed<CriticReviewRecord[]>(() => criticReviewsData.value?.data ?? [])
const lastCriticReview = computed<CriticReviewRecord | null>(() => criticReviews.value[0] ?? null)
const showLowScoreAlert = computed(() => Boolean(lastCriticReview.value && !lastCriticReview.value.reachedThreshold))

const criticModalOpen = ref(false)
const criticModalVariantId = ref<number | null>(null)

function findVariant(id: number | null) {
  if (!id || !scenario.value?.variants) return null
  return scenario.value.variants.find((v: { id: number }) => v.id === id) ?? null
}

const criticModalDetails = computed<VariantQualityScore | null>(() => {
  const v = findVariant(criticModalVariantId.value) as { qualityScoreDetails?: VariantQualityScore | null } | null
  return v?.qualityScoreDetails ?? null
})
const criticModalVariantTitle = computed<string | null>(() => {
  const v = findVariant(criticModalVariantId.value) as { title?: string } | null
  return v?.title ?? null
})

function onOpenCriticReport(variantId: number) {
  criticModalVariantId.value = variantId
  criticModalOpen.value = true
}

const recriticPending = ref(false)
const rerunError = ref<string | null>(null)

async function onRerunCritic() {
  if (recriticPending.value) return
  rerunError.value = null
  recriticPending.value = true
  try {
    await $fetch(`/api/scenarios/${scenarioId.value}/critic`, { method: 'POST' })
    await Promise.all([refresh(), refreshCriticReviews()])
  }
  catch (err) {
    // 429 и 500 показываем в странице: window.alert ломал Playwright и не темизировался.
    rerunError.value = (err as { data?: { message?: string }, message?: string })?.data?.message
      || (err as Error)?.message
      || 'Не удалось перезапустить критика'
  }
  finally {
    recriticPending.value = false
  }
}

// ─── Варианты ────────────────────────────────────────────────────────────────
const activeVariantId = ref<number | null>(null)

const activeVariant = computed(() => {
  const s = scenario.value
  if (!s?.variants?.length) return null
  if (activeVariantId.value) {
    return s.variants.find((v: { id: number }) => v.id === activeVariantId.value) ?? s.variants[0]
  }
  return s.variants.find((v: { id: number }) => v.id === s.selectedVariantId) ?? s.variants[0]
})

watch(scenario, (s) => {
  if (s && !activeVariantId.value) {
    activeVariantId.value = s.selectedVariantId ?? s.variants?.[0]?.id ?? null
  }
}, { immediate: true })

const isEditing = ref(false)

const title = computed(() => activeVariant.value?.title ?? `Сценарий #${scenario.value?.id ?? ''}`)
useHead({ title: computed(() => `${title.value} — сценарий`) })

async function onUpdated() {
  isEditing.value = false
  await refresh()
}

function onSelectVariant(id: number) {
  activeVariantId.value = id
  isEditing.value = false
}

// ─── Ролики сценария ─────────────────────────────────────────────────────────
const videoQuery = computed(() => ({ scenarioId: Number(scenarioId.value), perPage: 5 }))
const { data: videosData } = useVideos(videoQuery)
const scenarioVideos = computed(() => videosData.value?.data ?? [])
const hasActiveVideo = computed(() =>
  scenarioVideos.value.some((v: { status: string }) =>
    ['pending', 'generating_images', 'generating_clips', 'assembling'].includes(v.status)),
)

// ─── Навигация по соседям ────────────────────────────────────────────────────
const filters = useScenarioFiltersStore()
const { data: listData } = useScenarios(computed(() => filters.query))

const siblings = computed(() => listData.value?.data?.map((s: { id: number }) => s.id) ?? [])
const currentIndex = computed(() => siblings.value.indexOf(Number(scenarioId.value)))
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
    await navigateTo(`/scenarios/${next}`)
    return
  }
  const targetPage = filters.page + delta
  if (targetPage < 1 || (listMeta.value && targetPage > listMeta.value.totalPages)) return

  filters.page = targetPage
  await nextTick()
  const edge = delta === 1 ? siblings.value[0] : siblings.value[siblings.value.length - 1]
  if (edge != null) await navigateTo(`/scenarios/${edge}`)
}

// ─── Связи ───────────────────────────────────────────────────────────────────
const relations = computed(() => {
  const s = scenario.value
  if (!s) return []
  const chain: Array<{ label: string, title: string, to?: string, current?: boolean }> = []
  if (s.trend) chain.push({ label: 'Тренд', title: s.trend.title || `#${s.trend.id}`, to: `/trends/${s.trend.id}` })
  chain.push({ label: 'Сценарий', title: `scn_${s.id}`, current: true })
  if (scenarioVideos.value.length) {
    const first = scenarioVideos.value[0]
    chain.push({
      label: scenarioVideos.value.length > 1 ? `Ролики · ${scenarioVideos.value.length}` : 'Ролик',
      title: `vid_${first.id}`,
      to: `/videos/${first.id}`,
    })
  }
  return chain
})

function copyId() {
  if (!scenario.value) return
  navigator.clipboard.writeText(`scn_${scenario.value.id}`)
  toast.success('Идентификатор скопирован')
}
</script>

<template>
  <div>
    <UiSkeleton v-if="pending && !scenario" variant="details" :count="6" />

    <UiErrorState
      v-else-if="error"
      title="Не удалось загрузить сценарий"
      :message="error.message"
      @retry="refresh"
    />

    <template v-else-if="scenario">
      <DetailHeader
        :title="title"
        :code="`scn_${scenario.id}`"
        back-to="/scenarios"
        back-label="К сценариям"
        :position="position"
        :has-prev="hasPrev"
        :has-next="hasNext"
        @prev="goSibling(-1)"
        @next="goSibling(1)"
      >
        <template #badges>
          <UiStatusBadge :status="scenarioStatus(scenario.status)" />
          <UiButton icon-only variant="ghost" aria-label="Скопировать идентификатор" @click="copyId">
            <Icon name="mingcute:copy-2-line" />
          </UiButton>
        </template>

        <template #actions>
          <ScenarioActions
            v-if="activeVariant"
            :scenario-id="scenario.id"
            :scenario-status="scenario.status"
            :variant-id="activeVariant.id"
            :variant-status="activeVariant.status"
            :is-deleted="scenario.isDeleted"
            @updated="onUpdated"
            @edit="isEditing = true"
          />
        </template>
      </DetailHeader>

      <div class="flex flex-wrap items-center gap-4 px-1 pb-3 text-sm text-muted">
        <span v-if="scenario.variants?.length" class="flex items-center gap-1.5">
          Вариантов
          <span class="tnum font-mono text-fg">{{ scenario.variants.length }}</span>
        </span>
        <span class="flex items-center gap-1.5">
          Создан
          <span class="tnum font-mono">{{ new Date(scenario.createdAt).toLocaleString('ru-RU') }}</span>
        </span>
        <DetailRelations :chain="relations" class="ml-auto" />
      </div>

      <div class="flex flex-col gap-3">
        <!-- Состояние сценария -->
        <div
          v-if="scenario.isDeleted"
          role="alert"
          class="flex items-center gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-sm text-warning"
        >
          <Icon name="mingcute:delete-2-line" class="shrink-0" />
          Сценарий удалён — доступен только для чтения.
        </div>
        <div
          v-else-if="scenario.status === 'generating'"
          role="status"
          class="flex items-center gap-2 rounded-md border border-info-border bg-info-bg px-2.5 py-2 text-sm text-info"
        >
          <Icon name="mingcute:loading-line" class="shrink-0 animate-spin" />
          Идёт генерация вариантов.
        </div>

        <SceneShadowScenarioInfo
          v-if="!scenario.trend && scenario.scene"
          :scene-id="String(scenario.scene.id)"
          :scene-name="scenario.scene.name"
        />

        <div
          v-if="scenario.reworkRequest"
          role="note"
          class="flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-sm"
        >
          <Icon name="mingcute:refresh-2-line" class="mt-0.5 shrink-0 text-warning" />
          <span><span class="font-medium text-warning">Запрос на переработку:</span> {{ scenario.reworkRequest }}</span>
        </div>

        <div
          v-if="showLowScoreAlert"
          role="note"
          class="flex flex-wrap items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-sm"
        >
          <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-warning" />
          <span class="min-w-0 flex-1">
            <span class="font-medium text-warning">Критик не одобрил:</span>
            средний балл {{ Math.round(lastCriticReview!.averageScore) }}/100,
            итерация {{ lastCriticReview!.iteration }}. Можно перезапустить или поправить руками.
          </span>
          <UiButton :loading="recriticPending" @click="onRerunCritic">
            <Icon v-if="!recriticPending" name="mingcute:refresh-2-line" />
            Перезапустить критика
          </UiButton>
        </div>

        <div
          v-if="rerunError"
          role="alert"
          class="flex flex-wrap items-center gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
        >
          <Icon name="mingcute:alert-line" class="shrink-0" />
          <span class="min-w-0 flex-1">{{ rerunError }}</span>
          <UiButton variant="ghost" @click="rerunError = null">Закрыть</UiButton>
        </div>

        <ScenarioVariantTabs
          v-if="scenario.variants && scenario.variants.length > 1"
          :variants="scenario.variants"
          :selected-variant-id="scenario.selectedVariantId"
          :active-variant-id="activeVariantId"
          @select="onSelectVariant"
          @open-critic-report="onOpenCriticReport"
        />

        <template v-if="activeVariant">
          <ScenarioEditor
            v-if="isEditing"
            :scenario-id="scenario.id"
            :variant-id="activeVariant.id"
            :initial="{
              title: activeVariant.title,
              hook: activeVariant.hook,
              body: activeVariant.body,
              cta: activeVariant.cta,
              visualStyleText: activeVariant.visualStyleText,
            }"
            @saved="onUpdated"
            @cancel="isEditing = false"
          />

          <ScenarioDetail
            v-else
            :scenario-id="scenario.id"
            :variant="activeVariant"
            @regenerated="onUpdated"
          />
        </template>

        <UiEmptyState
          v-else
          title="Вариантов пока нет"
          description="Генерация ещё не запускалась или не дошла до результата."
        />

        <ScenarioStoryPlan v-if="activeVariant?.storyPlan" :story-plan="activeVariant.storyPlan" />

        <ScenarioFeedbackForm v-if="scenario.status !== 'generating'" :scenario-id="scenario.id" />

        <ScenarioReviewHistory v-if="scenario.reviewActions?.length" :actions="scenario.reviewActions" />

        <!-- Ролики -->
        <section v-if="scenario.status === 'selected'" class="rounded-lg border border-border bg-panel p-3.5">
          <div class="mb-2 flex flex-wrap items-center gap-2">
            <h2 class="text-micro tracking-[.06em] text-subtle uppercase">Ролики</h2>
            <span class="flex-1" />
            <VideoGenerateButton
              :scenario-id="scenario.id"
              :scenario-status="scenario.status"
              :has-active-video="hasActiveVideo"
            />
          </div>

          <div v-if="scenarioVideos.length" class="flex flex-col">
            <NuxtLink
              v-for="v in scenarioVideos"
              :key="v.id"
              :to="`/videos/${v.id}`"
              class="flex items-center gap-3 border-b border-divider py-2 text-sm last:border-b-0 hover:text-fg"
            >
              <Icon name="mingcute:video-line" class="shrink-0 text-subtle" />
              <span class="font-mono text-micro text-subtle">vid_{{ v.id }}</span>
              <span class="min-w-0 flex-1 truncate">
                {{ v.format === 'portrait' ? '9:16 · вертикальное' : '16:9 · горизонтальное' }}
              </span>
              <UiStatusBadge :status="videoStatus(v.status)" size="xs" dot />
            </NuxtLink>
          </div>

          <p v-else class="text-sm text-subtle">Ролик ещё не создавался.</p>
        </section>
      </div>

      <ScenarioCriticReportModal
        :open="criticModalOpen"
        :details="criticModalDetails"
        :history="criticReviews"
        :variant-title="criticModalVariantTitle"
        @close="criticModalOpen = false"
      />
    </template>
  </div>
</template>
