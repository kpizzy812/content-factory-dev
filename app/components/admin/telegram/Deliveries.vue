<script setup lang="ts">
interface DeliveryTemplate {
  id: number
  key: string
  title: string
}

interface Delivery {
  id: number
  templateId: number | null
  eventType: string
  relatedEntityType: string | null
  relatedEntityId: string | null
  targetChatId: string | number
  status: 'pending' | 'sent' | 'failed'
  telegramMessageId: string | null
  errorMessage: string | null
  messageText: string | null
  sentAt: string | null
  createdAt: string
  template: DeliveryTemplate | null
  chat: { title: string | null; username: string | null; chatType: string } | null
}

interface Meta {
  page: number
  limit: number
  total: number
  totalPages: number
}

function chatDisplayName(d: Delivery): string {
  if (d.chat?.title) return d.chat.title
  if (d.chat?.username) return `@${d.chat.username}`
  return String(d.targetChatId)
}

const { resendDelivery } = useAdminTelegramActions()

const statusOptions = [
  { value: '', label: 'Все статусы' },
  { value: 'pending', label: 'Ожидание' },
  { value: 'sent', label: 'Отправлено' },
  { value: 'failed', label: 'Ошибка' },
]

const eventTypeOptions = [
  { value: '', label: 'Все события' },
  { value: 'cycle_started', label: 'Цикл запущен' },
  { value: 'upload_success', label: 'Загрузка завершена' },
  { value: 'critical_error', label: 'Критическая ошибка' },
  { value: 'idea_created', label: 'Идея создана' },
  { value: 'test', label: 'Тест' },
  { value: 'custom', label: 'Пользовательское' },
]

const filterStatus = ref('')
const filterEventType = ref('')
const page = ref(1)
const expandedId = ref<number | null>(null)
const resendingId = ref<number | null>(null)
const resendFeedback = ref<{ id: number; success: boolean; message: string } | null>(null)

const params = computed(() => ({
  page: page.value,
  ...(filterStatus.value && { status: filterStatus.value }),
  ...(filterEventType.value && { eventType: filterEventType.value }),
}))

const { data: raw, refresh } = useAdminTelegramDeliveries(params)

const items = computed<Delivery[]>(() => (raw.value as any)?.data ?? (raw.value as any)?.items ?? [])
const meta = computed<Meta>(() => (raw.value as any)?.meta ?? { page: 1, limit: 20, total: 0, totalPages: 1 })

function onFilterChange() {
  page.value = 1
  refresh()
}

function toggleExpand(id: number) {
  expandedId.value = expandedId.value === id ? null : id
}

function formatDate(date: string | null): string {
  if (!date) return '—'
  return new Date(date).toLocaleString('ru-RU')
}

function statusBadge(status: string): string {
  if (status === 'sent') return 'badge-success'
  if (status === 'failed') return 'badge-error'
  return 'badge-warning'
}

function statusLabel(status: string): string {
  return statusOptions.find(o => o.value === status)?.label ?? status
}

function eventLabel(eventType: string): string {
  return eventTypeOptions.find(o => o.value === eventType)?.label ?? eventType
}

function humanReadableError(error: string | null): string {
  if (!error) return ''
  if (error.includes('chat not found')) return 'Чат не найден — возможно, бот был удалён из чата'
  if (error.includes('bot was blocked')) return 'Бот заблокирован пользователем'
  if (error.includes('FLOOD_WAIT')) return 'Telegram ограничил отправку — слишком много запросов'
  if (error.includes('Too Many Requests')) return 'Превышен лимит запросов к Telegram API'
  if (error.includes('Forbidden')) return 'Бот не имеет прав отправлять сообщения в этот чат'
  if (error.includes('timeout') || error.includes('ETIMEDOUT')) return 'Таймаут соединения с Telegram API'
  if (error.includes('Unauthorized') || error.includes('401')) return 'Токен бота невалиден'
  return error
}

async function handleResend(delivery: Delivery) {
  resendingId.value = delivery.id
  resendFeedback.value = null
  try {
    const res = await resendDelivery(delivery.id) as { success: boolean; error?: string }
    resendFeedback.value = {
      id: delivery.id,
      success: res.success,
      message: res.success ? 'Повторная отправка успешна' : (res.error || 'Не удалось отправить'),
    }
    await refresh()
  } catch (e: any) {
    resendFeedback.value = {
      id: delivery.id,
      success: false,
      message: e.data?.message || e.message || 'Ошибка повторной отправки',
    }
  } finally {
    resendingId.value = null
    setTimeout(() => { resendFeedback.value = null }, 5000)
  }
}

function goToPage(p: number) {
  if (p < 1 || p > meta.value.totalPages) return
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
  <div class="space-y-4">
    <div class="flex items-center justify-between flex-wrap gap-2">
      <div>
        <h3 class="text-lg font-semibold flex items-center gap-2">
          <Icon name="mingcute:mail-send-line" class="size-5" />
          История доставок
        </h3>
        <p class="text-xs text-base-content/50">Все отправленные уведомления с их статусами и деталями ошибок</p>
      </div>
      <div class="flex items-center gap-2">
        <select v-model="filterStatus" class="select select-sm" @change="onFilterChange">
          <option v-for="o in statusOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <select v-model="filterEventType" class="select select-sm" @change="onFilterChange">
          <option v-for="o in eventTypeOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </div>
    </div>

    <!-- Resend feedback -->
    <div v-if="resendFeedback" role="alert" :class="['alert alert-sm', resendFeedback.success ? 'alert-success' : 'alert-error']">
      <Icon :name="resendFeedback.success ? 'mingcute:check-circle-line' : 'mingcute:close-circle-line'" />
      <span>{{ resendFeedback.message }}</span>
      <button class="btn btn-ghost btn-xs" @click="resendFeedback = null">✕</button>
    </div>

    <!-- Table -->
    <div v-if="items.length" class="overflow-x-auto">
      <table class="table table-sm">
        <thead>
          <tr>
            <th>Событие</th>
            <th>Чат</th>
            <th>Статус</th>
            <th>Шаблон</th>
            <th>Связь</th>
            <th>Отправлено</th>
            <th>Ошибка</th>
            <th class="text-right">Действия</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="d in items" :key="d.id">
            <tr class="cursor-pointer hover" @click="toggleExpand(d.id)">
              <td>
                <span class="badge badge-sm badge-outline">{{ eventLabel(d.eventType) }}</span>
              </td>
              <td class="text-xs">
                <span class="font-semibold">{{ chatDisplayName(d) }}</span>
                <code v-if="d.chat" class="font-mono text-base-content/40 ml-1 text-[10px]">({{ d.targetChatId }})</code>
              </td>
              <td>
                <span :class="['badge badge-sm', statusBadge(d.status)]">
                  {{ statusLabel(d.status) }}
                </span>
              </td>
              <td class="text-xs">
                <span v-if="d.template" class="text-info">{{ d.template.title }}</span>
                <span v-else class="opacity-40">—</span>
              </td>
              <td class="text-xs">
                <span v-if="d.relatedEntityType" class="badge badge-xs badge-outline">
                  {{ d.relatedEntityType }}#{{ d.relatedEntityId }}
                </span>
                <span v-else class="opacity-40">—</span>
              </td>
              <td class="text-xs text-base-content/60 whitespace-nowrap">{{ formatDate(d.sentAt) }}</td>
              <td class="text-xs max-w-48">
                <span v-if="d.errorMessage" class="text-error" :title="d.errorMessage">
                  {{ humanReadableError(d.errorMessage) }}
                </span>
                <span v-else class="opacity-40">—</span>
              </td>
              <td class="text-right" @click.stop>
                <div v-if="d.status === 'failed'" class="tooltip" data-tip="Повторить отправку">
                  <button
                    class="btn btn-ghost btn-xs"
                    :disabled="resendingId === d.id"
                    @click="handleResend(d)"
                  >
                    <span v-if="resendingId === d.id" class="loading loading-spinner loading-xs" />
                    <Icon v-else name="mingcute:refresh-2-line" class="size-4" />
                  </button>
                </div>
              </td>
            </tr>
            <!-- Expanded details -->
            <tr v-if="expandedId === d.id">
              <td colspan="8" class="bg-base-200 p-4">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div class="text-xs font-semibold opacity-60 mb-1">Текст сообщения</div>
                    <pre v-if="d.messageText" class="text-sm whitespace-pre-wrap bg-base-300 rounded-lg p-3 max-h-48 overflow-y-auto">{{ d.messageText }}</pre>
                    <span v-else class="text-sm opacity-40">Текст отсутствует</span>
                  </div>
                  <div class="space-y-3">
                    <div>
                      <div class="text-xs font-semibold opacity-60 mb-1">Детали</div>
                      <div class="text-xs space-y-1">
                        <div>ID: <code class="font-mono">{{ d.id }}</code></div>
                        <div>Создано: {{ formatDate(d.createdAt) }}</div>
                        <div v-if="d.telegramMessageId">Telegram ID: <code class="font-mono">{{ d.telegramMessageId }}</code></div>
                      </div>
                    </div>
                    <div v-if="d.errorMessage">
                      <div class="text-xs font-semibold text-error mb-1">Ошибка (raw)</div>
                      <pre class="text-xs whitespace-pre-wrap text-error bg-base-300 rounded-lg p-3">{{ d.errorMessage }}</pre>
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- Empty state -->
    <div v-else class="flex flex-col items-center gap-3 py-12 text-base-content/50">
      <Icon name="mingcute:inbox-line" class="text-4xl" />
      <div class="text-center">
        <p class="font-medium">Доставки не найдены</p>
        <p v-if="filterStatus || filterEventType" class="text-xs mt-1">Попробуйте изменить фильтры</p>
        <p v-else class="text-xs mt-1">Отправьте тестовое сообщение через вкладку «Диагностика»</p>
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
