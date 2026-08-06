<script setup lang="ts">
/**
 * Админка. Макет: design-preview/catalog/08-settings-admin.dc.html
 *
 * Второй уровень навигации из макета живёт списком разделов наверху страницы:
 * отдельной колонки под него нет, потому что оболочка уже даёт группу «Админ»
 * в сайдбаре, и второй вертикальный список рядом с первым читается хуже.
 */
definePageMeta({ middleware: ['admin-access'] })
useHead({ title: 'Администрирование' })

const { data, pending } = useAdminDashboard()
const dashboard = computed(() => data.value?.data ?? null)

const SECTIONS = [
  { to: '/admin/apps', label: 'Приложения', icon: 'mingcute:box-line', hint: 'Контейнеры производства и их референсы' },
  { to: '/admin/users', label: 'Пользователи', icon: 'mingcute:group-line', hint: 'Роли и права, только просмотр' },
  { to: '/admin/cycles', label: 'Циклы', icon: 'mingcute:refresh-2-line', hint: 'Запуск и история циклов' },
  { to: '/admin/logs', label: 'Логи', icon: 'mingcute:file-line', hint: 'Журнал системы и ошибки' },
  { to: '/admin/telegram', label: 'Telegram', icon: 'mingcute:send-plane-line', hint: 'Чаты, алерты и шаблоны' },
  { to: '/admin/integrations', label: 'Интеграции', icon: 'mingcute:link-line', hint: 'Где что настраивается' },
  { to: '/admin/warmup-keywords', label: 'Пулы прогрева', icon: 'mingcute:fire-line', hint: 'Ключевые слова для планировщика' },
  { to: '/admin/accounts-health', label: 'Здоровье аккаунтов', icon: 'mingcute:heart-line', hint: 'Полнота и риски аккаунтов' },
  { to: '/admin/balances', label: 'Балансы', icon: 'mingcute:wallet-line', hint: 'Остатки на платных сервисах' },
  { to: '/admin/storage-health', label: 'Хранилище', icon: 'mingcute:folder-line', hint: 'Целостность файлов роликов' },
]

const MODULE_LABELS: Record<string, string> = {
  trendwatcher: 'Трендвотчер',
  'script-generator': 'Сценарии',
  'video-generator': 'Видео',
  'social-upload': 'Загрузка',
  analytics: 'Аналитика',
  orchestrator: 'Оркестратор',
}

const PIPELINE_TILES = [
  { key: 'trendsNew', label: 'Новых трендов', to: '/trends?status=new', tone: '' },
  { key: 'ideasReady', label: 'Идей готово', to: '/ideas?status=ready', tone: '' },
  { key: 'scenariosAwaitingReview', label: 'На ревью', to: '/scenarios?status=generated', tone: 'text-warning' },
  { key: 'videosGenerating', label: 'Генерация', to: '/videos', tone: 'text-info' },
  { key: 'pendingUploads', label: 'К публикации', to: '/uploads?status=pending', tone: '' },
  { key: 'trendsTotal', label: 'Всего трендов', to: '/trends', tone: 'text-subtle' },
] as const

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <h1 class="text-xl font-semibold">Администрирование</h1>

    <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <NuxtLink
        v-for="section in SECTIONS"
        :key="section.to"
        :to="section.to"
        class="flex flex-col gap-1 rounded-md border border-border bg-panel p-2.5 no-underline hover:border-subtle hover:bg-card"
      >
        <span class="flex items-center gap-2">
          <Icon :name="section.icon" class="shrink-0 text-accent" />
          <span class="truncate font-medium text-fg">{{ section.label }}</span>
        </span>
        <span class="text-sm text-subtle">{{ section.hint }}</span>
      </NuxtLink>
    </div>

    <UiSkeleton v-if="pending && !dashboard" variant="details" :count="6" />

    <template v-else-if="dashboard">
      <AdminDashboardSummary
        :status="dashboard.status"
        :videos-today="dashboard.videosToday"
        :videos-week="dashboard.videosWeek"
        :unresolved-errors="dashboard.unresolvedErrors"
      />

      <section v-if="dashboard.contentPipeline" class="overflow-hidden rounded-lg border border-border bg-panel">
        <h2 class="border-b border-divider bg-card px-3.5 py-2.5 text-base font-medium">Что сейчас в работе</h2>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          <NuxtLink
            v-for="tile in PIPELINE_TILES"
            :key="tile.key"
            :to="tile.to"
            class="border-r border-b border-divider px-3 py-2.5 no-underline last:border-r-0 hover:bg-card"
          >
            <span class="tnum block font-mono text-2xl font-semibold" :class="tile.tone || 'text-fg'">
              {{ dashboard.contentPipeline[tile.key] }}
            </span>
            <span class="block text-sm text-muted">{{ tile.label }}</span>
          </NuxtLink>
        </div>
      </section>

      <section
        v-if="dashboard.recentErrors?.length"
        class="overflow-hidden rounded-lg border border-border bg-panel"
      >
        <div class="flex items-center gap-2 border-b border-divider bg-card px-3.5 py-2.5">
          <Icon name="mingcute:alert-line" class="text-danger" />
          <h2 class="text-base font-medium">Последние ошибки</h2>
          <span class="flex-1" />
          <NuxtLink to="/admin/logs?level=error&resolved=false" class="text-sm">Все ошибки</NuxtLink>
        </div>
        <div
          v-for="err in dashboard.recentErrors"
          :key="err.id"
          class="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-2.5 gap-y-1 border-b border-divider px-3.5 py-2 text-sm last:border-b-0 sm:grid-cols-[96px_minmax(0,1fr)_auto_96px]"
        >
          <span class="truncate text-subtle">{{ MODULE_LABELS[err.module] ?? err.module }}</span>
          <span class="min-w-0 break-words">{{ err.message }}</span>
          <NuxtLink v-if="err.cycleId" :to="`/admin/cycles/${err.cycleId}`" class="text-sm whitespace-nowrap">
            цикл #{{ err.cycleId }}
          </NuxtLink>
          <span v-else class="hidden sm:block" />
          <ClientOnly>
            <span class="tnum col-span-2 font-mono text-micro text-subtle sm:col-span-1 sm:text-right">
              {{ formatDate(err.createdAt) }}
            </span>
          </ClientOnly>
        </div>
      </section>

      <NuxtLink
        to="/admin/telegram"
        class="flex items-center gap-2.5 rounded-lg border border-border bg-panel px-3.5 py-2.5 no-underline hover:bg-card"
      >
        <Icon name="mingcute:send-plane-line" class="text-info" />
        <span class="text-fg">Telegram</span>
        <span class="text-sm text-muted">
          <template v-if="dashboard.telegramAlertChats > 0">
            {{ dashboard.telegramAlertChats }} чатов получают алерты
          </template>
          <template v-else>чаты не подключены — алерты никуда не уходят</template>
        </span>
        <span class="flex-1" />
        <Icon name="mingcute:right-line" class="text-subtle" />
      </NuxtLink>

      <AdminDashboardRecentCycles :cycles="dashboard.recentCycles" />
    </template>
  </div>
</template>
