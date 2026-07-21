<script setup lang="ts">
definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'trendwatcher' })

const route = useRoute()
const router = useRouter()
const trendId = computed(() => route.params.id as string)

const { data, pending, error, refresh } = useTrendDetail(trendId)
const { canDelete } = usePermissions()

const trend = computed(() => data.value?.data ?? null)

useHead({
  title: computed(() => trend.value?.title ?? 'Тренд'),
})

// Сценарии тренда
const scenariosQuery = computed(() => ({
  trendId: Number(trendId.value),
  perPage: 10,
}))
const { data: scenariosData, refresh: refreshScenarios } = useScenarios(scenariosQuery)
const trendScenarios = computed(() => scenariosData.value?.data ?? [])
const hasExistingScenarios = computed(() => trendScenarios.value.length > 0)

async function onStatusUpdated() {
  await refresh()
}

async function onScenariosGenerated() {
  await Promise.all([refresh(), refreshScenarios()])
}

async function onAnalyzed() {
  await refresh()
}

// Удаление тренда
const deleting = ref(false)
const confirmDelete = ref(false)

async function handleDelete() {
  if (!confirmDelete.value) {
    confirmDelete.value = true
    return
  }
  deleting.value = true
  try {
    await $fetch(`/api/trends/${trendId.value}`, { method: 'DELETE' })
    router.push('/trends')
  } catch {
    deleting.value = false
    confirmDelete.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- Навигация -->
    <div class="flex items-center justify-between">
      <NuxtLink to="/trends" class="btn btn-ghost btn-sm gap-1">
        <Icon name="mingcute:arrow-left-line" />
        Назад к трендам
      </NuxtLink>

      <!-- Кнопка удаления -->
      <div v-if="canDelete && trend && !trend.isDeleted" class="flex items-center gap-2">
        <template v-if="confirmDelete">
          <span class="text-sm text-error">Удалить тренд?</span>
          <button
            class="btn btn-sm btn-error"
            :disabled="deleting"
            @click="handleDelete"
          >
            <span v-if="deleting" class="loading loading-spinner loading-xs" />
            <template v-else>Да, удалить</template>
          </button>
          <button
            class="btn btn-sm btn-ghost"
            :disabled="deleting"
            @click="confirmDelete = false"
          >
            Отмена
          </button>
        </template>
        <button
          v-else
          class="btn btn-sm btn-ghost text-error gap-1"
          @click="handleDelete"
        >
          <Icon name="mingcute:delete-2-line" />
          Удалить
        </button>
      </div>
    </div>

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
    <template v-else-if="trend">
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <!-- Основной контент -->
        <div class="lg:col-span-2 space-y-4">
          <!-- Медиа -->
          <div class="card bg-base-100 shadow-sm">
            <div class="card-body p-4 gap-3">
              <!-- Видео или миниатюра -->
              <div v-if="trend.videoUrl" class="aspect-video rounded-lg overflow-hidden bg-base-200">
                <video
                  :src="trend.videoUrl"
                  :poster="trend.thumbnailUrl ?? undefined"
                  controls
                  class="w-full h-full object-contain"
                />
              </div>
              <div
                v-else-if="trend.thumbnailUrl"
                class="aspect-video rounded-lg overflow-hidden bg-base-200"
              >
                <img
                  :src="trend.thumbnailUrl"
                  :alt="trend.title"
                  class="w-full h-full object-contain"
                >
              </div>

              <!-- Заголовок и мета -->
              <div class="flex items-center gap-2 flex-wrap">
                <TrendPlatformBadge :platform="trend.platform" />
                <TrendStatusBadge :status="trend.status" />
                <span
                  v-if="trend.analysisStatus === 'completed'"
                  class="badge badge-success badge-xs"
                >
                  AI-анализ
                </span>
                <span
                  v-else-if="trend.analysisStatus === 'failed'"
                  class="badge badge-error badge-xs"
                >
                  Ошибка анализа
                </span>
              </div>

              <h1 class="text-xl font-bold text-base-content">
                {{ trend.title }}
              </h1>

              <p v-if="trend.authorName" class="text-sm text-base-content/60">
                {{ trend.authorName }}
              </p>

              <p v-if="trend.description" class="text-sm text-base-content/80">
                {{ trend.description }}
              </p>

              <!-- Мета-информация: язык, гео, ключевое слово -->
              <div v-if="trend.language || trend.geo || trend.keyword" class="flex gap-2 flex-wrap text-xs">
                <span v-if="trend.language" class="badge badge-ghost badge-sm">
                  {{ trend.language }}
                </span>
                <span v-if="trend.geo" class="badge badge-ghost badge-sm">
                  {{ trend.geo }}
                </span>
                <span v-if="trend.keyword" class="badge badge-outline badge-sm">
                  {{ trend.keyword }}
                </span>
              </div>

              <!-- Хештеги -->
              <div v-if="trend.hashtags?.length" class="flex flex-wrap gap-1">
                <span
                  v-for="tag in trend.hashtags"
                  :key="tag"
                  class="badge badge-outline badge-sm"
                >
                  #{{ tag }}
                </span>
              </div>
            </div>
          </div>

          <!-- Привязка приложения (если не привязано) -->
          <TrendAppSelector
            v-if="!trend.appId"
            :trend-id="trend.id"
            :current-app-id="trend.appId"
            :current-app-name="trend.app?.name ?? null"
            @updated="refresh()"
          />

          <!-- AI-анализ -->
          <TrendAiAnalyzeButton
            :trend-id="trend.id"
            :analysis-status="trend.analysisStatus"
            @analyzed="onAnalyzed"
          />

          <!-- Креативный бриф -->
          <TrendBriefCard
            v-if="trend.brief"
            :brief="trend.brief"
          />

          <!-- Инсайты (обратная совместимость) -->
          <TrendInsightCard
            v-for="insight in trend.insights"
            :key="insight.id"
            :insight="insight"
          />
        </div>

        <!-- Сайдбар -->
        <TrendDetailSidebar
          :trend="trend"
          :scenarios="trendScenarios"
          :has-existing-scenarios="hasExistingScenarios"
          @status-updated="onStatusUpdated"
          @scenarios-generated="onScenariosGenerated"
        />
      </div>
    </template>
  </div>
</template>
