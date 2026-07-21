<script setup lang="ts">
interface BotInfo {
  username?: string
  firstName?: string
}

interface TelegramStatus {
  configured: boolean
  transportMode: string
  botInfo: BotInfo | null
  health: {
    running: boolean
    lastSuccessfulUpdate: string | null
    lastError: string | null
    lastErrorCategory: "conflict" | "auth" | "network" | "unknown" | null
    lastSuccessfulSend: string | null
    lastFailedSend: { at: string; error: string | null } | null
  }
  chats: {
    total: number
    alertsEnabled: number
    items: Array<Record<string, unknown>>
  }
  deliveries: {
    total: number
    failed: number
    recent: Array<{
      id: string | number
      eventType: string
      status: string
      targetChatId: string | number
      errorMessage: string | null
      sentAt: string | null
      createdAt: string
      chat?: { title: string | null; username: string | null } | null
    }>
  }
}

const props = defineProps<{
  status: TelegramStatus | null
}>()

const emit = defineEmits<{
  'test-api': []
  'navigate': [tab: string]
  'restart-bot': []
}>()

const { restartBot } = useAdminTelegramActions()
const restarting = ref(false)
const restartFeedback = ref<{ success: boolean; message: string } | null>(null)

async function handleRestart() {
  restarting.value = true
  restartFeedback.value = null
  try {
    await restartBot()
    restartFeedback.value = { success: true, message: 'Бот перезапущен. Обновите страницу через несколько секунд.' }
  } catch (e: any) {
    restartFeedback.value = { success: false, message: e.data?.message || e.message || 'Ошибка перезапуска' }
  } finally {
    restarting.value = false
    setTimeout(() => { restartFeedback.value = null }, 8000)
  }
}

const d = computed(() => props.status)

const recentDeliveries = computed(() =>
  d.value?.deliveries.recent.slice(0, 5) ?? [],
)

// Health level: healthy / warning / error
const healthLevel = computed(() => {
  if (!d.value) return 'unknown'
  if (!d.value.configured) return 'error'
  if (!d.value.health.running) return 'error'
  if (d.value.health.lastError) return 'warning'
  if (d.value.chats.total === 0) return 'warning'
  if (d.value.chats.alertsEnabled === 0) return 'warning'
  // If polling hasn't had a successful update in 60 seconds, warning
  if (d.value.health.lastSuccessfulUpdate) {
    const diff = Date.now() - new Date(d.value.health.lastSuccessfulUpdate).getTime()
    if (diff > 60_000) return 'warning'
  }
  return 'healthy'
})

const healthBadge = computed(() => {
  switch (healthLevel.value) {
    case 'healthy': return { class: 'badge-success', label: 'Работает', icon: 'mingcute:check-circle-line' }
    case 'warning': return { class: 'badge-warning', label: 'Внимание', icon: 'mingcute:alert-line' }
    case 'error': return { class: 'badge-error', label: 'Проблема', icon: 'mingcute:close-circle-line' }
    default: return { class: 'badge-ghost', label: 'Неизвестно', icon: 'mingcute:question-line' }
  }
})

const warnings = computed(() => {
  const list: string[] = []
  if (!d.value) return list
  if (!d.value.configured) list.push('TELEGRAM_BOT_TOKEN не настроен')
  if (!d.value.health.running) list.push('Polling остановлен — бот не получает обновления')
  if (d.value.health.lastError) {
    const cat = d.value.health.lastErrorCategory
    if (cat === 'conflict') {
      list.push('Конфликт polling: другой процесс получает обновления для этого бота. Перезагрузите страницу — обычно это временная проблема при перезапуске сервера.')
    } else {
      list.push(`Ошибка polling: ${d.value.health.lastError}`)
    }
  }
  if (d.value.chats.total === 0) list.push('Нет привязанных чатов — некуда отправлять уведомления')
  if (d.value.chats.total > 0 && d.value.chats.alertsEnabled === 0) list.push('Ни у одного чата не включены уведомления')
  if (d.value.health.lastSuccessfulUpdate) {
    const diff = Date.now() - new Date(d.value.health.lastSuccessfulUpdate).getTime()
    if (diff > 60_000) list.push('Polling не получал обновлений более минуты')
  }
  return list
})

function formatDate(date: string | null): string {
  if (!date) return 'Нет данных'
  return new Date(date).toLocaleString('ru-RU')
}

function timeAgo(date: string | null): string {
  if (!date) return 'никогда'
  const diff = Date.now() - new Date(date).getTime()
  if (diff < 60_000) return 'только что'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин. назад`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ч. назад`
  return `${Math.floor(diff / 86_400_000)} дн. назад`
}

function chatDisplayName(item: { targetChatId: string | number; chat?: { title: string | null; username: string | null } | null }): string {
  if (item.chat?.title) return item.chat.title
  if (item.chat?.username) return `@${item.chat.username}`
  return String(item.targetChatId)
}

function deliveryStatusBadge(status: string): string {
  if (status === 'sent') return 'badge-success'
  if (status === 'failed') return 'badge-error'
  return 'badge-warning'
}
</script>

<template>
  <div v-if="d" class="flex flex-col gap-4">
    <!-- Bot identity + health status -->
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body p-4">
        <div class="flex items-center justify-between flex-wrap gap-2">
          <div class="flex items-center gap-3">
            <div class="avatar placeholder">
              <div class="bg-info/20 text-info rounded-full w-12 h-12 flex items-center justify-center">
                <Icon name="mingcute:telegram-line" class="text-2xl" />
              </div>
            </div>
            <div>
              <div class="font-bold text-lg">
                {{ d.botInfo?.firstName ?? 'Бот не подключён' }}
              </div>
              <div v-if="d.botInfo?.username" class="text-sm text-base-content/60">
                @{{ d.botInfo.username }}
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span :class="['badge gap-1', d.configured ? 'badge-success' : 'badge-error']">
              <Icon :name="d.configured ? 'mingcute:check-circle-line' : 'mingcute:close-circle-line'" class="text-xs" />
              {{ d.configured ? 'Настроен' : 'Не настроен' }}
            </span>
            <span :class="['badge gap-1', d.health.running ? 'badge-success' : 'badge-error']">
              <Icon :name="d.health.running ? 'mingcute:play-circle-line' : 'mingcute:pause-circle-line'" class="text-xs" />
              {{ d.health.running ? 'Запущен' : 'Остановлен' }}
            </span>
            <span :class="['badge gap-1', healthBadge.class]" :title="healthBadge.label">
              <Icon :name="healthBadge.icon" class="text-xs" />
              {{ healthBadge.label }}
            </span>
          </div>
        </div>

        <div class="divider my-1" />

        <!-- Transport and timing info -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <div class="flex items-center gap-2 text-base-content/60">
            <Icon name="mingcute:transfer-line" class="text-base shrink-0" />
            <div>
              <div class="text-xs">Транспорт</div>
              <div class="font-semibold text-base-content">{{ d.transportMode }}</div>
            </div>
          </div>
          <div class="flex items-center gap-2 text-base-content/60">
            <Icon name="mingcute:time-line" class="text-base shrink-0" />
            <div>
              <div class="text-xs">Последний polling</div>
              <div class="font-semibold text-base-content">{{ timeAgo(d.health.lastSuccessfulUpdate) }}</div>
            </div>
          </div>
          <div class="flex items-center gap-2 text-base-content/60">
            <Icon name="mingcute:send-line" class="text-base shrink-0" />
            <div>
              <div class="text-xs">Последняя отправка</div>
              <div class="font-semibold text-base-content">{{ timeAgo(d.health.lastSuccessfulSend) }}</div>
            </div>
          </div>
          <div class="flex items-center gap-2 text-base-content/60">
            <Icon name="mingcute:alert-line" class="text-base shrink-0" />
            <div>
              <div class="text-xs">Последняя ошибка</div>
              <div class="font-semibold text-base-content" :class="d.health.lastFailedSend ? 'text-error' : ''">
                {{ d.health.lastFailedSend ? timeAgo(d.health.lastFailedSend.at) : 'нет' }}
              </div>
            </div>
          </div>
        </div>

        <!-- Restart feedback -->
        <div v-if="restartFeedback" role="alert" :class="['alert alert-sm mt-2', restartFeedback.success ? 'alert-success' : 'alert-error']">
          <Icon :name="restartFeedback.success ? 'mingcute:check-circle-line' : 'mingcute:close-circle-line'" class="text-sm shrink-0" />
          <span class="text-xs">{{ restartFeedback.message }}</span>
        </div>

        <!-- Warnings -->
        <div v-if="warnings.length" class="flex flex-col gap-1 mt-2">
          <div v-for="(w, i) in warnings" :key="i" role="alert" class="alert alert-warning alert-sm py-1.5">
            <Icon name="mingcute:warning-line" class="text-sm shrink-0" />
            <span class="text-xs flex-1">{{ w }}</span>
            <button
              v-if="w.includes('остановлен') || w.includes('Конфликт') || w.includes('обновлений более минуты')"
              class="btn btn-warning btn-xs"
              :disabled="restarting"
              @click="handleRestart"
            >
              <span v-if="restarting" class="loading loading-spinner loading-xs" />
              <Icon v-else name="mingcute:refresh-2-line" class="size-3" />
              Перезапустить
            </button>
          </div>
        </div>

        <!-- Last error detail -->
        <div v-if="d.health.lastFailedSend?.error" class="mt-1">
          <div class="alert alert-error alert-sm py-1.5">
            <Icon name="mingcute:close-circle-line" class="text-sm shrink-0" />
            <span class="text-xs truncate">{{ d.health.lastFailedSend.error }}</span>
          </div>
        </div>

        <!-- Quick actions -->
        <div class="card-actions justify-end mt-2 flex-wrap gap-1">
          <button
            v-if="!d?.health.running"
            class="btn btn-sm btn-outline btn-warning gap-1"
            :disabled="restarting"
            @click="handleRestart"
          >
            <span v-if="restarting" class="loading loading-spinner loading-xs" />
            <Icon v-else name="mingcute:refresh-2-line" class="text-base" />
            Перезапустить бот
          </button>
          <button class="btn btn-sm btn-outline btn-info gap-1" @click="emit('test-api')">
            <Icon name="mingcute:radar-line" class="text-base" />
            Диагностика
          </button>
          <button class="btn btn-sm btn-outline gap-1" @click="emit('navigate', 'deliveries')">
            <Icon name="mingcute:send-plane-line" class="text-base" />
            Доставки
          </button>
          <button class="btn btn-sm btn-outline gap-1" @click="emit('navigate', 'chats')">
            <Icon name="mingcute:group-line" class="text-base" />
            Чаты
          </button>
          <button class="btn btn-sm btn-outline gap-1" @click="emit('navigate', 'audit')">
            <Icon name="mingcute:history-line" class="text-base" />
            Аудит
          </button>
        </div>
      </div>
    </div>

    <!-- Summary stats -->
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div class="card bg-base-100 shadow-sm cursor-pointer hover:shadow-md transition-shadow" @click="emit('navigate', 'chats')">
        <div class="card-body p-3 items-center text-center">
          <Icon name="mingcute:group-line" class="text-2xl text-primary" />
          <div class="text-2xl font-bold">{{ d.chats.total }}</div>
          <div class="text-xs text-base-content/60">Всего чатов</div>
        </div>
      </div>
      <div class="card bg-base-100 shadow-sm cursor-pointer hover:shadow-md transition-shadow" @click="emit('navigate', 'chats')">
        <div class="card-body p-3 items-center text-center">
          <Icon name="mingcute:notification-line" class="text-2xl text-success" />
          <div class="text-2xl font-bold">{{ d.chats.alertsEnabled }}</div>
          <div class="text-xs text-base-content/60">Уведомления вкл.</div>
        </div>
      </div>
      <div class="card bg-base-100 shadow-sm cursor-pointer hover:shadow-md transition-shadow" @click="emit('navigate', 'deliveries')">
        <div class="card-body p-3 items-center text-center">
          <Icon name="mingcute:mail-send-line" class="text-2xl text-info" />
          <div class="text-2xl font-bold">{{ d.deliveries.total }}</div>
          <div class="text-xs text-base-content/60">Всего доставок</div>
        </div>
      </div>
      <div class="card bg-base-100 shadow-sm cursor-pointer hover:shadow-md transition-shadow" @click="emit('navigate', 'deliveries')">
        <div class="card-body p-3 items-center text-center">
          <Icon name="mingcute:alert-line" class="text-2xl text-error" />
          <div class="text-2xl font-bold">{{ d.deliveries.failed }}</div>
          <div class="text-xs text-base-content/60">Ошибки доставки</div>
        </div>
      </div>
    </div>

    <!-- Recent deliveries -->
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body p-4">
        <div class="flex items-center justify-between">
          <h3 class="font-bold flex items-center gap-2">
            <Icon name="mingcute:history-line" class="text-lg" />
            Последние доставки
          </h3>
          <button v-if="recentDeliveries.length" class="btn btn-ghost btn-xs" @click="emit('navigate', 'deliveries')">
            Все доставки
            <Icon name="mingcute:right-line" class="text-sm" />
          </button>
        </div>
        <div v-if="recentDeliveries.length" class="overflow-x-auto">
          <table class="table table-xs">
            <thead>
              <tr>
                <th>Событие</th>
                <th>Чат</th>
                <th>Статус</th>
                <th>Дата</th>
                <th>Ошибка</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in recentDeliveries" :key="item.id">
                <td class="font-mono text-xs">{{ item.eventType }}</td>
                <td class="text-xs">
                  <span>{{ chatDisplayName(item) }}</span>
                </td>
                <td>
                  <span :class="['badge badge-xs', deliveryStatusBadge(item.status)]">
                    {{ item.status }}
                  </span>
                </td>
                <td class="text-xs text-base-content/60">{{ formatDate(item.sentAt ?? item.createdAt) }}</td>
                <td class="text-xs text-error max-w-48 truncate">{{ item.errorMessage ?? '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="flex flex-col items-center gap-2 py-6 text-base-content/50">
          <Icon name="mingcute:inbox-line" class="text-3xl" />
          <span class="text-sm">Нет данных о доставках</span>
          <span class="text-xs">Отправьте тестовое сообщение через вкладку «Диагностика»</span>
        </div>
      </div>
    </div>
  </div>
</template>
