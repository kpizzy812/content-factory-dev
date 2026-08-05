<script setup lang="ts">
definePageMeta({ layout: 'default' })
useHead({ title: 'Главная' })

const { user } = useUserSession()
const { canAccessModule } = usePermissions()
const { data: statsData, pending: statsPending } = useTrendStats()

const stats = computed(() => statsData.value?.data ?? null)

const recentFilters = computed(() => ({ perPage: 5, sort: '-importedAt' }))
const { data: trendsData } = useTrends(recentFilters)
const recentTrends = computed(() => trendsData.value?.data ?? [])

const displayName = computed(() => {
  if (!user.value) return ''
  const parts = [user.value.name, user.value.surname].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : user.value.email
})

const quickLinks = computed(() => {
  const links = []
  if (canAccessModule('pipeline')) {
    links.push({ to: '/pipeline', label: 'Конвейер', icon: 'mingcute:git-merge-line', desc: 'Автоматизация от тренда до публикации' })
  }
  if (canAccessModule('trendwatcher')) {
    links.push({ to: '/trends', label: 'Тренды', icon: 'mingcute:eye-line', desc: 'Мониторинг вирусного контента' })
  }
  if (canAccessModule('script-generator')) {
    links.push({ to: '/scenarios', label: 'Сценарии', icon: 'mingcute:document-line', desc: 'Генерация и редактирование' })
  }
  if (canAccessModule('video-generator')) {
    links.push({ to: '/videos', label: 'Видео', icon: 'mingcute:video-line', desc: 'Создание контента' })
  }
  if (canAccessModule('social-upload')) {
    links.push({ to: '/uploads', label: 'Загрузки', icon: 'mingcute:upload-3-line', desc: 'Публикация в соцсети' })
  }
  if (canAccessModule('analytics')) {
    links.push({ to: '/analytics', label: 'Аналитика', icon: 'mingcute:chart-bar-line', desc: 'Метрики и результаты' })
  }
  return links
})

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  })
}
</script>

<template>
  <div class="space-y-6">
    <!-- Приветствие -->
    <div>
      <h1 class="text-2xl font-bold text-base-content">Контент-Завод</h1>
      <p v-if="displayName" class="text-base-content/60 mt-1">{{ displayName }}</p>
    </div>

    <!-- Статистика -->
    <div v-if="statsPending" class="flex justify-center py-8">
      <span class="loading loading-spinner loading-md" />
    </div>

    <template v-else-if="stats">
      <div class="stats stats-vertical sm:stats-horizontal shadow-sm w-full">
        <div class="stat">
          <div class="stat-figure text-primary">
            <Icon name="mingcute:fire-line" class="text-3xl" />
          </div>
          <div class="stat-title">Всего трендов</div>
          <div class="stat-value text-primary">{{ stats.total }}</div>
        </div>
        <div class="stat">
          <div class="stat-figure text-info">
            <Icon name="mingcute:time-line" class="text-3xl" />
          </div>
          <div class="stat-title">За 24 часа</div>
          <div class="stat-value text-info">{{ stats.recentCount }}</div>
        </div>
      </div>
    </template>

    <!-- Быстрые ссылки -->
    <div v-if="quickLinks.length">
      <h2 class="text-lg font-semibold text-base-content mb-3">Разделы</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <NuxtLink
          v-for="link in quickLinks"
          :key="link.to"
          :to="link.to"
          class="card bg-base-100 shadow-sm hover:shadow-md transition-shadow"
        >
          <div class="card-body p-4 flex-row items-center gap-3">
            <div class="bg-primary/10 rounded-lg p-2">
              <Icon :name="link.icon" class="text-xl text-primary" />
            </div>
            <div>
              <div class="font-medium text-base-content">{{ link.label }}</div>
              <div class="text-xs text-base-content/50">{{ link.desc }}</div>
            </div>
          </div>
        </NuxtLink>
      </div>
    </div>

    <!-- Последние тренды -->
    <div v-if="recentTrends.length">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-lg font-semibold text-base-content">Последние тренды</h2>
        <NuxtLink to="/trends" class="btn btn-ghost btn-xs">
          Все тренды
          <Icon name="mingcute:arrow-right-line" />
        </NuxtLink>
      </div>
      <div class="space-y-2">
        <NuxtLink
          v-for="trend in recentTrends"
          :key="trend.id"
          :to="`/trends/${trend.id}`"
          class="flex items-center gap-3 p-3 rounded-lg bg-base-100 hover:bg-base-200 transition-colors"
        >
          <Icon name="mingcute:fire-line" class="text-lg text-primary shrink-0" />
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-base-content truncate">
              {{ trend.title || trend.originalTitle || 'Без названия' }}
            </div>
            <div class="text-xs text-base-content/50">
              {{ trend.platform }} / {{ formatDate(trend.importedAt) }}
            </div>
          </div>
          <span class="badge badge-sm badge-ghost shrink-0">{{ trend.status }}</span>
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
