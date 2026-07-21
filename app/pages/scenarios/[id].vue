<script setup lang="ts">
import type { VisualStyleStructured, VariantQualityScore, CriticReviewRecord } from '~~/shared/types/scenario'

definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'script-generator' })

const route = useRoute()
const scenarioId = computed(() => route.params.id as string)

const { data, pending, error, refresh } = useScenarioDetail(scenarioId)

const scenario = computed(() => data.value?.data ?? null)

// Critic reviews — для alert и истории в модалке.
const { data: criticReviewsData, refresh: refreshCriticReviews } = useFetch<{ data: CriticReviewRecord[] }>(
  () => `/api/scenarios/${scenarioId.value}/critic-reviews`,
  { default: () => ({ data: [] }), watch: [scenarioId] },
)
const criticReviews = computed<CriticReviewRecord[]>(() => criticReviewsData.value?.data ?? [])
const lastCriticReview = computed<CriticReviewRecord | null>(() => criticReviews.value[0] ?? null)
const showLowScoreAlert = computed(() =>
  Boolean(lastCriticReview.value && !lastCriticReview.value.reachedThreshold),
)

// Critic Report Modal state.
const criticModalOpen = ref(false)
const criticModalVariantId = ref<number | null>(null)
const criticModalDetails = computed<VariantQualityScore | null>(() => {
  const id = criticModalVariantId.value
  if (!id || !scenario.value?.variants) return null
  const v = scenario.value.variants.find((x: any) => x.id === id) as any
  return (v?.qualityScoreDetails as VariantQualityScore | null) ?? null
})
const criticModalVariantTitle = computed<string | null>(() => {
  const id = criticModalVariantId.value
  if (!id || !scenario.value?.variants) return null
  const v = scenario.value.variants.find((x: any) => x.id === id) as any
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
  } catch (err: any) {
    // 429/500 показываем inline — без блокирующего window.alert (ломал Playwright + не темизировался).
    rerunError.value = err?.data?.message || err?.message || 'Не удалось перезапустить критика'
  } finally {
    recriticPending.value = false
  }
}

useHead({
  title: computed(() => {
    const s = scenario.value
    if (!s) return 'Сценарий'
    const v = s.variants?.find((v: any) => v.id === s.selectedVariantId) ?? s.variants?.[0]
    return v?.title ?? `Сценарий #${s.id}`
  }),
})

// Активный вариант для просмотра
const activeVariantId = ref<number | null>(null)

const activeVariant = computed(() => {
  const s = scenario.value
  if (!s?.variants?.length) return null
  if (activeVariantId.value) {
    return s.variants.find((v: any) => v.id === activeVariantId.value) ?? s.variants[0]
  }
  // По умолчанию: выбранный или первый
  return s.variants.find((v: any) => v.id === s.selectedVariantId) ?? s.variants[0]
})

watch(scenario, (s) => {
  if (s && !activeVariantId.value) {
    activeVariantId.value = s.selectedVariantId ?? s.variants?.[0]?.id ?? null
  }
}, { immediate: true })

const isEditing = ref(false)

// Видео для этого сценария
const videoQuery = computed(() => ({
  scenarioId: Number(scenarioId.value),
  perPage: 5,
}))
const { data: videosData, refresh: refreshVideos } = useVideos(videoQuery)
const scenarioVideos = computed(() => videosData.value?.data ?? [])
const hasActiveVideo = computed(() => {
  return scenarioVideos.value.some((v: any) =>
    ['pending', 'generating_images', 'generating_clips', 'assembling'].includes(v.status),
  )
})

async function onUpdated() {
  isEditing.value = false
  await refresh()
}

function onEdit() {
  isEditing.value = true
}

function onCancelEdit() {
  isEditing.value = false
}

function onSelectVariant(id: number) {
  activeVariantId.value = id
  isEditing.value = false
}
</script>

<template>
  <div class="space-y-4">
    <!-- Назад -->
    <NuxtLink to="/scenarios" class="btn btn-ghost btn-sm gap-1">
      <Icon name="mingcute:arrow-left-line" />
      Назад к сценариям
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

    <!-- Content -->
    <template v-else-if="scenario">
      <!-- Баннер: удалён -->
      <div v-if="scenario.isDeleted" role="alert" class="alert alert-warning">
        <Icon name="mingcute:delete-2-line" />
        <span>Этот сценарий удалён</span>
      </div>

      <!-- Баннер: выбран -->
      <div v-else-if="scenario.status === 'selected'" role="alert" class="alert alert-success">
        <Icon name="mingcute:check-circle-line" />
        <span>Сценарий выбран для производства</span>
      </div>

      <!-- Баннер: generating -->
      <div v-else-if="scenario.status === 'generating'" role="alert" class="alert alert-info">
        <span class="loading loading-spinner loading-sm" />
        <span>Идёт генерация вариантов...</span>
      </div>

      <!-- Shadow Scenario info: для scene-driven path (trendId=null, sceneId!=null) -->
      <SceneShadowScenarioInfo
        v-if="!scenario.trend && (scenario as any).scene"
        :scene-id="(scenario as any).scene.id"
        :scene-name="(scenario as any).scene.name"
      />

      <!-- Мета-информация -->
      <div class="flex items-center gap-2 flex-wrap">
        <ScenarioStatusBadge :status="scenario.status" />
        <NuxtLink
          v-if="scenario.trend"
          :to="`/trends/${scenario.trend.id}`"
          class="link link-hover text-sm text-base-content/60 gap-1 inline-flex items-center"
        >
          <Icon name="mingcute:eye-line" class="text-xs" />
          {{ scenario.trend.title }}
        </NuxtLink>
        <span v-if="scenario.variants?.length" class="text-sm text-base-content/40">
          {{ scenario.variants.length }} вариант{{ scenario.variants.length > 1 ? 'а' : '' }}
        </span>
      </div>

      <!-- Rework request -->
      <div v-if="scenario.reworkRequest" role="alert" class="alert alert-warning alert-soft text-sm">
        <Icon name="mingcute:refresh-2-line" />
        <div>
          <span class="font-semibold">Запрос на переработку:</span>
          {{ scenario.reworkRequest }}
        </div>
      </div>

      <!-- Quality critic alert: последний прогон не достиг порога -->
      <div
        v-if="showLowScoreAlert"
        role="alert"
        class="alert alert-warning alert-soft text-sm"
      >
        <Icon name="mingcute:alert-line" />
        <div class="flex-1">
          <span class="font-semibold">Критик не одобрил:</span>
          средний балл {{ Math.round(lastCriticReview!.averageScore) }}/100
          (итерация {{ lastCriticReview!.iteration }}).
          Можно перезапустить с другими порогами или внести правки вручную.
        </div>
        <button
          class="btn btn-sm btn-warning"
          :disabled="recriticPending"
          @click="onRerunCritic"
        >
          <span v-if="recriticPending" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:refresh-2-line" />
          Перезапустить критика
        </button>
      </div>

      <!-- Inline-ошибка перезапуска критика (вместо window.alert) -->
      <div v-if="rerunError" role="alert" class="alert alert-error text-sm">
        <Icon name="mingcute:warning-line" />
        <span class="flex-1">{{ rerunError }}</span>
        <button class="btn btn-ghost btn-sm" @click="rerunError = null">Закрыть</button>
      </div>

      <!-- Табы вариантов -->
      <ScenarioVariantTabs
        v-if="scenario.variants && scenario.variants.length > 1"
        :variants="scenario.variants"
        :selected-variant-id="scenario.selectedVariantId"
        :active-variant-id="activeVariantId"
        @select="onSelectVariant"
        @open-critic-report="onOpenCriticReport"
      />

      <!-- Активный вариант -->
      <template v-if="activeVariant">
        <h1 class="text-xl font-bold text-base-content">
          {{ activeVariant.title }}
        </h1>

        <!-- Действия -->
        <ScenarioActions
          :scenario-id="scenario.id"
          :scenario-status="scenario.status"
          :variant-id="activeVariant.id"
          :variant-status="activeVariant.status"
          :is-deleted="scenario.isDeleted"
          @updated="onUpdated"
          @edit="onEdit"
        />

        <!-- Редактор -->
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
          @cancel="onCancelEdit"
        />

        <!-- Детальное отображение -->
        <ScenarioDetail
          v-else
          :scenario-id="scenario.id"
          :variant="activeVariant as any"
          @regenerated="onUpdated"
        />
      </template>

      <p v-else class="text-sm text-base-content/50">
        Варианты ещё не сгенерированы.
      </p>

      <!-- Story Plan -->
      <ScenarioStoryPlan
        v-if="activeVariant?.storyPlan"
        :story-plan="activeVariant.storyPlan"
      />

      <!-- Обратная связь -->
      <ScenarioFeedbackForm
        v-if="scenario.status !== 'generating'"
        :scenario-id="scenario.id"
      />

      <!-- История действий -->
      <ScenarioReviewHistory
        v-if="scenario.reviewActions?.length"
        :actions="scenario.reviewActions"
      />

      <!-- Генерация видео -->
      <div v-if="scenario.status === 'selected'" class="space-y-3">
        <div class="divider" />
        <div class="flex items-center justify-between gap-4 flex-wrap">
          <h3 class="text-base font-semibold text-base-content">Видео</h3>
          <VideoGenerateButton
            :scenario-id="scenario.id"
            :scenario-status="scenario.status"
            :has-active-video="hasActiveVideo"
          />
        </div>

        <div v-if="scenarioVideos.length > 0" class="space-y-2">
          <NuxtLink
            v-for="v in scenarioVideos"
            :key="v.id"
            :to="`/videos/${v.id}`"
            class="flex items-center gap-3 p-3 rounded-box bg-base-100 hover:bg-base-200 transition-colors"
          >
            <Icon name="mingcute:video-line" class="text-lg text-base-content/40" />
            <div class="flex-1 min-w-0">
              <span class="text-sm text-base-content">
                {{ v.format === 'portrait' ? 'Вертикальное' : 'Горизонтальное' }}
              </span>
            </div>
            <VideoStatusBadge :status="v.status" />
          </NuxtLink>
        </div>

        <p v-else class="text-sm text-base-content/50">
          Видео ещё не создавалось. Выберите формат и запустите генерацию.
        </p>
      </div>
    </template>

    <!-- Critic Report Modal -->
    <ScenarioCriticReportModal
      :open="criticModalOpen"
      :details="criticModalDetails"
      :history="criticReviews"
      :variant-title="criticModalVariantTitle"
      @close="criticModalOpen = false"
    />
  </div>
</template>
