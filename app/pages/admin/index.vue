<script setup lang="ts">
definePageMeta({
  middleware: ['admin-access'],
})

useHead({ title: 'Администрирование' })

const { data, pending } = useAdminDashboard()
const dashboard = computed(() => data.value?.data ?? null)

const adminSections = [
  { to: '/admin/apps', label: 'Приложения', icon: 'mingcute:box-line', description: 'Создание и настройка приложений' },
  { to: '/admin/users', label: 'Пользователи', icon: 'mingcute:group-line', description: 'Роли, права и доступ' },
  { to: '/admin/cycles', label: 'Циклы', icon: 'mingcute:refresh-2-line', description: 'Запуск и история циклов' },
  { to: '/admin/logs', label: 'Логи', icon: 'mingcute:file-line', description: 'Журнал и ошибки' },
  { to: '/admin/telegram', label: 'Telegram', icon: 'mingcute:send-plane-line', description: 'Бот, алерты и шаблоны' },
  { to: '/admin/integrations', label: 'Интеграции', icon: 'mingcute:link-line', description: 'Облачные устройства DuoPlus и внешние сервисы' },
  { to: '/admin/warmup-keywords', label: 'Пулы прогрева', icon: 'mingcute:fire-line', description: 'Ключевые слова для warmup planner' },
  { to: '/admin/accounts-health', label: 'Здоровье аккаунтов', icon: 'mingcute:heart-line', description: 'Полнота и риски социальных аккаунтов' },
  { to: '/admin/balances', label: 'Балансы', icon: 'mingcute:wallet-line', description: 'Остатки по AI/прокси/музыке' },
]

const moduleLabels: Record<string, string> = {
  trendwatcher: 'Трендвотчер',
  'script-generator': 'Сценарии',
  'video-generator': 'Видео',
  'social-upload': 'Загрузка',
  analytics: 'Аналитика',
  orchestrator: 'Оркестратор',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-bold text-base-content">Администрирование</h1>

    <!-- Навигация по разделам -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <NuxtLink
        v-for="section in adminSections"
        :key="section.to"
        :to="section.to"
        class="card card-border bg-base-100 shadow-sm hover:shadow-md transition-shadow hover:border-primary/30"
      >
        <div class="card-body p-3 gap-1">
          <div class="flex items-center gap-2">
            <Icon :name="section.icon" class="text-primary text-lg" />
            <h3 class="font-bold text-sm">{{ section.label }}</h3>
          </div>
          <p class="text-xs text-base-content/60">{{ section.description }}</p>
        </div>
      </NuxtLink>
    </div>

    <!-- Дашборд -->
    <div v-if="pending" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <template v-else-if="dashboard">
      <!-- Статус и видео -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <AdminDashboardStatusCard :status="dashboard.status" />
        <AdminDashboardVideoStats
          :videos-today="dashboard.videosToday"
          :videos-week="dashboard.videosWeek"
        />
      </div>

      <!-- Контент-пайплайн -->
      <div v-if="dashboard.contentPipeline" class="card bg-base-100 shadow-sm">
        <div class="card-body p-4 gap-3">
          <h3 class="card-title text-sm">
            <Icon name="mingcute:git-merge-line" />
            Контент-пайплайн
          </h3>
          <div class="grid grid-cols-3 sm:grid-cols-6 gap-3">
            <NuxtLink to="/trends?status=new" class="text-center p-2 rounded-box bg-base-200/50 hover:bg-base-200 transition-colors">
              <div class="text-xl font-bold text-base-content">{{ dashboard.contentPipeline.trendsNew }}</div>
              <div class="text-xs text-base-content/60">Новых трендов</div>
            </NuxtLink>
            <NuxtLink to="/ideas?status=ready" class="text-center p-2 rounded-box bg-base-200/50 hover:bg-base-200 transition-colors">
              <div class="text-xl font-bold text-base-content">{{ dashboard.contentPipeline.ideasReady }}</div>
              <div class="text-xs text-base-content/60">Идей готово</div>
            </NuxtLink>
            <NuxtLink to="/scenarios?status=generated" class="text-center p-2 rounded-box bg-base-200/50 hover:bg-base-200 transition-colors">
              <div class="text-xl font-bold text-warning">{{ dashboard.contentPipeline.scenariosAwaitingReview }}</div>
              <div class="text-xs text-base-content/60">На ревью</div>
            </NuxtLink>
            <NuxtLink to="/videos" class="text-center p-2 rounded-box bg-base-200/50 hover:bg-base-200 transition-colors">
              <div class="text-xl font-bold text-info">{{ dashboard.contentPipeline.videosGenerating }}</div>
              <div class="text-xs text-base-content/60">Генерация</div>
            </NuxtLink>
            <NuxtLink to="/uploads?status=pending" class="text-center p-2 rounded-box bg-base-200/50 hover:bg-base-200 transition-colors">
              <div class="text-xl font-bold text-base-content">{{ dashboard.contentPipeline.pendingUploads }}</div>
              <div class="text-xs text-base-content/60">К загрузке</div>
            </NuxtLink>
            <NuxtLink to="/trends" class="text-center p-2 rounded-box bg-base-200/50 hover:bg-base-200 transition-colors">
              <div class="text-xl font-bold text-base-content/60">{{ dashboard.contentPipeline.trendsTotal }}</div>
              <div class="text-xs text-base-content/60">Всего трендов</div>
            </NuxtLink>
          </div>
        </div>
      </div>

      <!-- Ошибки и Telegram -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <AdminDashboardAlerts :unresolved-errors="dashboard.unresolvedErrors" />

        <!-- Telegram -->
        <NuxtLink to="/admin/telegram" class="card bg-base-100 shadow-sm hover:shadow-md transition-shadow">
          <div class="card-body p-4 gap-2">
            <div class="flex items-center gap-2">
              <Icon name="mingcute:send-plane-line" class="text-info text-lg" />
              <span class="text-sm font-medium">Telegram-интеграция</span>
              <Icon name="mingcute:arrow-right-line" class="text-xs text-base-content/40 ml-auto" />
            </div>
            <p class="text-sm text-base-content/60">
              <template v-if="dashboard.telegramAlertChats > 0">
                {{ dashboard.telegramAlertChats }} чат{{ dashboard.telegramAlertChats === 1 ? '' : dashboard.telegramAlertChats < 5 ? 'а' : 'ов' }} с алертами
              </template>
              <template v-else>
                Нет подключённых чатов
              </template>
            </p>
          </div>
        </NuxtLink>
      </div>

      <!-- Последние ошибки (быстрый доступ) -->
      <div v-if="dashboard.recentErrors?.length" class="card bg-base-100 shadow-sm">
        <div class="card-body p-4 gap-3">
          <div class="flex items-center justify-between">
            <h3 class="card-title text-sm">
              <Icon name="mingcute:warning-line" class="text-error" />
              Последние ошибки
            </h3>
            <NuxtLink to="/admin/logs?level=error&resolved=false" class="btn btn-ghost btn-xs">
              Все ошибки
              <Icon name="mingcute:arrow-right-line" />
            </NuxtLink>
          </div>
          <div class="space-y-1">
            <div
              v-for="err in dashboard.recentErrors"
              :key="err.id"
              class="flex items-start gap-2 p-2 rounded text-sm hover:bg-base-200/50"
            >
              <span class="badge badge-soft badge-error badge-xs shrink-0 mt-1">!</span>
              <span class="text-xs text-base-content/50 shrink-0 w-20">
                {{ moduleLabels[err.module] ?? err.module }}
              </span>
              <span class="flex-1 text-base-content break-words line-clamp-1">{{ err.message }}</span>
              <NuxtLink
                v-if="err.cycleId"
                :to="`/admin/cycles/${err.cycleId}`"
                class="link link-primary text-xs shrink-0"
              >
                Цикл #{{ err.cycleId }}
              </NuxtLink>
              <span class="text-xs text-base-content/40 shrink-0">{{ formatDate(err.createdAt) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Последние циклы -->
      <AdminDashboardRecentCycles :cycles="dashboard.recentCycles" />
    </template>
  </div>
</template>
