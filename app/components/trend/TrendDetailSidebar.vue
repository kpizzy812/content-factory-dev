<script setup lang="ts">
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
    app?: { name: string } | null
  }
  scenarios: Array<{
    id: number
    status: string
    variants?: Array<{ title: string; status: string }>
  }>
  hasExistingScenarios: boolean
}>()

const emit = defineEmits<{
  statusUpdated: []
  scenariosGenerated: []
}>()

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}
</script>

<template>
  <div class="space-y-4">
    <!-- Метрики -->
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body p-4 gap-3">
        <h3 class="card-title text-sm">Метрики</h3>
        <div class="stats stats-vertical w-full shadow-none">
          <div class="stat px-0 py-2">
            <div class="stat-title">Просмотры</div>
            <div class="stat-value text-lg">{{ formatNumber(trend.viewCount) }}</div>
          </div>
          <div class="stat px-0 py-2">
            <div class="stat-title">Лайки</div>
            <div class="stat-value text-lg">{{ formatNumber(trend.likeCount) }}</div>
          </div>
          <div class="stat px-0 py-2">
            <div class="stat-title">Комментарии</div>
            <div class="stat-value text-lg">{{ formatNumber(trend.commentCount) }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Действия -->
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body p-4 gap-3">
        <h3 class="card-title text-sm">Действия</h3>
        <TrendStatusActions
          :trend-id="trend.id"
          :current-status="trend.status"
          @updated="emit('statusUpdated')"
        />
        <a
          v-if="trend.sourceUrl"
          :href="trend.sourceUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="btn btn-sm btn-outline gap-1"
        >
          <Icon name="mingcute:external-link-line" />
          Оригинал
        </a>
      </div>
    </div>

    <!-- Сценарии -->
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body p-4 gap-3">
        <h3 class="card-title text-sm">
          <Icon name="mingcute:document-line" class="text-primary" />
          Сценарии
        </h3>

        <ScenarioGenerateButton
          :trend-id="trend.id"
          :trend-status="trend.status"
          :has-app="!!trend.app"
          :has-existing-scenarios="hasExistingScenarios"
          @generated="emit('scenariosGenerated')"
        />

        <template v-if="hasExistingScenarios">
          <ul class="menu menu-sm p-0 gap-1">
            <li v-for="s in scenarios" :key="s.id">
              <NuxtLink :to="`/scenarios/${s.id}`" class="gap-2">
                <ScenarioStatusBadge :status="s.status" />
                <span class="truncate">{{ s.variants?.[0]?.title ?? `Сценарий #${s.id}` }}</span>
              </NuxtLink>
            </li>
          </ul>

          <NuxtLink :to="`/scenarios?trendId=${trend.id}`" class="btn btn-sm btn-ghost gap-1">
            <Icon name="mingcute:arrow-right-line" />
            Все сценарии тренда
          </NuxtLink>
        </template>
      </div>
    </div>

    <!-- Информация -->
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body p-4 gap-2">
        <h3 class="card-title text-sm">Информация</h3>
        <div class="text-sm space-y-1">
          <p v-if="trend.publishedAt" class="text-base-content/70">
            <span class="font-medium">Опубликовано:</span>
            {{ formatDate(trend.publishedAt) }}
          </p>
          <p class="text-base-content/70">
            <span class="font-medium">Импортировано:</span>
            {{ formatDate(trend.importedAt) }}
          </p>
          <p v-if="trend.app" class="text-base-content/70">
            <span class="font-medium">Приложение:</span>
            {{ trend.app.name }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
