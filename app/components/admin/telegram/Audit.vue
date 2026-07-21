<script setup lang="ts">
interface AuditEntry {
  id: number
  chatId: string | number
  telegramUserId: string | number
  telegramUsername: string | null
  command: string
  parsedArgs: Record<string, unknown> | string | null
  resultStatus: 'success' | 'error' | 'unauthorized' | 'not_found'
  relatedEntityType: string | null
  relatedEntityId: string | number | null
  errorMessage: string | null
  createdAt: string
  chat: { title: string | null; username: string | null; chatType: string } | null
}

function chatDisplayName(entry: AuditEntry): string {
  if (entry.chat?.title) return entry.chat.title
  if (entry.chat?.username) return `@${entry.chat.username}`
  return String(entry.chatId)
}

const commandOptions = [
  { value: '', label: 'Все команды' },
  { value: '/start', label: '/start — Начало работы' },
  { value: '/link', label: '/link — Привязка аккаунта' },
  { value: '/status', label: '/status — Статус системы' },
  { value: '/stop', label: '/stop — Остановка цикла' },
  { value: '/start_cycle', label: '/start_cycle — Запуск цикла' },
  { value: '/help', label: '/help — Справка' },
  { value: 'video_url', label: 'video_url — Анализ видео' },
]

const statusOptions = [
  { value: '', label: 'Все статусы' },
  { value: 'success', label: 'Успех' },
  { value: 'error', label: 'Ошибка' },
  { value: 'unauthorized', label: 'Не авторизован' },
  { value: 'not_found', label: 'Не найдено' },
]

const filterCommand = ref('')
const filterStatus = ref('')
const page = ref(1)
const expandedId = ref<number | null>(null)

const params = computed(() => ({
  page: page.value,
  ...(filterCommand.value && { command: filterCommand.value }),
  ...(filterStatus.value && { resultStatus: filterStatus.value }),
}))

const { data, refresh } = useAdminTelegramAudit(params)

const items = computed<AuditEntry[]>(() => (data.value as any)?.data ?? [])
const meta = computed(() => (data.value as any)?.meta ?? { page: 1, total: 0, totalPages: 1 })

function resetFilters() {
  filterCommand.value = ''
  filterStatus.value = ''
  page.value = 1
}

function onFilterChange() {
  page.value = 1
}

function statusBadge(status: string): string {
  switch (status) {
    case 'success': return 'badge-success'
    case 'error': return 'badge-error'
    case 'unauthorized': return 'badge-warning'
    case 'not_found': return 'badge-ghost'
    default: return ''
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'success': return 'Успех'
    case 'error': return 'Ошибка'
    case 'unauthorized': return 'Не авторизован'
    case 'not_found': return 'Не найдено'
    default: return status
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case 'success': return 'mingcute:check-circle-line'
    case 'error': return 'mingcute:close-circle-line'
    case 'unauthorized': return 'mingcute:shield-line'
    case 'not_found': return 'mingcute:question-line'
    default: return 'mingcute:information-line'
  }
}

function formatDate(date: string): string {
  return new Date(date).toLocaleString('ru-RU')
}

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime()
  if (diff < 60_000) return 'только что'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин. назад`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ч. назад`
  return `${Math.floor(diff / 86_400_000)} дн. назад`
}

function humanReadableEvent(entry: AuditEntry): string {
  const user = entry.telegramUsername ? `@${entry.telegramUsername}` : `ID ${entry.telegramUserId}`
  switch (entry.command) {
    case '/start': return `${user} начал работу с ботом`
    case '/link': return `${user} привязал аккаунт`
    case '/status': return `${user} запросил статус системы`
    case '/stop': return `${user} остановил цикл`
    case '/start_cycle': return `${user} запустил цикл`
    case '/help': return `${user} запросил справку`
    case 'video_url': return `${user} отправил видео на анализ`
    default: return `${user} выполнил ${entry.command}`
  }
}

function formatArgs(args: Record<string, unknown> | string | null): string {
  if (!args) return ''
  if (typeof args === 'string') return args
  if (!Object.keys(args).length) return ''
  return JSON.stringify(args)
}

function goToPage(p: number) {
  page.value = p
}

const pageNumbers = computed(() => {
  const total = meta.value.totalPages
  const current = meta.value.page
  const pages: number[] = []
  const start = Math.max(1, current - 2)
  const end = Math.min(total, current + 2)
  for (let i = start; i <= end; i++) pages.push(i)
  return pages
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <div>
      <h3 class="text-lg font-semibold flex items-center gap-2">
        <Icon name="mingcute:history-line" class="size-5" />
        Аудит команд
      </h3>
      <p class="text-xs text-base-content/50">Все взаимодействия пользователей с ботом в Telegram</p>
    </div>

    <!-- Filters -->
    <div class="flex flex-wrap items-center gap-3">
      <select v-model="filterCommand" class="select select-sm" @change="onFilterChange">
        <option v-for="opt in commandOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
      <select v-model="filterStatus" class="select select-sm" @change="onFilterChange">
        <option v-for="opt in statusOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
      <button
        v-if="filterCommand || filterStatus"
        class="btn btn-sm btn-ghost gap-1"
        @click="resetFilters"
      >
        <Icon name="mingcute:close-line" class="text-sm" />
        Сбросить
      </button>
      <button class="btn btn-sm btn-ghost gap-1 ml-auto" @click="refresh()">
        <Icon name="mingcute:refresh-2-line" class="text-sm" />
        Обновить
      </button>
    </div>

    <!-- Timeline-style entries -->
    <div v-if="items.length" class="space-y-2">
      <div
        v-for="entry in items"
        :key="entry.id"
        class="card bg-base-100 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
        @click="expandedId = expandedId === entry.id ? null : entry.id"
      >
        <div class="card-body p-3 gap-1">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0">
              <Icon :name="statusIcon(entry.resultStatus)" :class="['text-lg shrink-0', statusBadge(entry.resultStatus).replace('badge-', 'text-')]" />
              <div class="min-w-0">
                <div class="text-sm">{{ humanReadableEvent(entry) }}</div>
                <div class="flex items-center gap-2 text-xs text-base-content/50">
                  <code class="font-mono font-semibold">{{ entry.command }}</code>
                  <span v-if="entry.relatedEntityType" class="badge badge-xs badge-outline">
                    {{ entry.relatedEntityType }}#{{ entry.relatedEntityId }}
                  </span>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span :class="['badge badge-xs', statusBadge(entry.resultStatus)]">
                {{ statusLabel(entry.resultStatus) }}
              </span>
              <span class="text-xs text-base-content/40 whitespace-nowrap">{{ timeAgo(entry.createdAt) }}</span>
            </div>
          </div>

          <!-- Expanded details -->
          <div v-if="expandedId === entry.id" class="mt-2 pt-2 border-t border-base-200">
            <div class="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span class="opacity-50">Чат:</span>
                <span class="font-semibold ml-1">{{ chatDisplayName(entry) }}</span>
                <code class="font-mono text-base-content/40 ml-1 text-[10px]">({{ entry.chatId }})</code>
              </div>
              <div>
                <span class="opacity-50">Telegram User:</span>
                <span class="ml-1">{{ entry.telegramUsername ? `@${entry.telegramUsername}` : entry.telegramUserId }}</span>
              </div>
              <div>
                <span class="opacity-50">Время:</span>
                <span class="ml-1">{{ formatDate(entry.createdAt) }}</span>
              </div>
              <div v-if="formatArgs(entry.parsedArgs)">
                <span class="opacity-50">Аргументы:</span>
                <code class="font-mono ml-1">{{ formatArgs(entry.parsedArgs) }}</code>
              </div>
            </div>
            <div v-if="entry.errorMessage" class="mt-2 alert alert-error alert-sm py-1.5">
              <Icon name="mingcute:close-circle-line" class="text-sm" />
              <span class="text-xs">{{ entry.errorMessage }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="flex flex-col items-center gap-3 py-12 text-base-content/50">
      <Icon name="mingcute:document-line" class="text-4xl" />
      <div class="text-center">
        <p class="font-medium">Записей аудита не найдено</p>
        <p v-if="filterCommand || filterStatus" class="text-xs mt-1">Попробуйте изменить фильтры</p>
        <p v-else class="text-xs mt-1">Аудит начнёт заполняться, когда пользователи будут взаимодействовать с ботом</p>
      </div>
    </div>

    <!-- Pagination -->
    <div v-if="meta.totalPages > 1" class="flex justify-center">
      <div class="join">
        <button class="join-item btn btn-sm" :disabled="page <= 1" @click="goToPage(page - 1)">
          <Icon name="mingcute:left-line" class="size-4" />
        </button>
        <button
          v-for="p in pageNumbers"
          :key="p"
          :class="['join-item btn btn-sm', { 'btn-active': p === meta.page }]"
          @click="goToPage(p)"
        >
          {{ p }}
        </button>
        <button class="join-item btn btn-sm" :disabled="page >= meta.totalPages" @click="goToPage(page + 1)">
          <Icon name="mingcute:right-line" class="size-4" />
        </button>
      </div>
    </div>

    <div v-if="meta.total > 0" class="text-center text-xs text-base-content/50">
      Всего: {{ meta.total }} записей
    </div>
  </div>
</template>
