<script setup lang="ts">
const { testApi, testSend, testChat } = useAdminTelegramActions()
const { data: chatsData } = useAdminTelegramChats()

const chats = computed(() => {
  const raw = (chatsData.value as any)?.data ?? chatsData.value ?? []
  return raw as Array<{ id: number; chatId: string; title: string | null; username: string | null; chatType: string; alertsEnabled: boolean }>
})

// --- Test API ---
const apiLoading = ref(false)
const apiResult = ref<{
  success: boolean
  botUsername?: string
  botName?: string
  error?: string
  steps?: Array<{ label: string; ok: boolean; detail?: string }>
} | null>(null)

async function handleTestApi() {
  apiLoading.value = true
  apiResult.value = null
  const steps: Array<{ label: string; ok: boolean; detail?: string }> = []

  try {
    steps.push({ label: 'Отправка запроса к Telegram API (getMe)', ok: true })
    const res = await testApi() as { success: boolean; botUsername?: string; botName?: string; error?: string }

    if (res.success) {
      steps.push({ label: 'Токен валиден', ok: true, detail: `@${res.botUsername}` })
      steps.push({ label: 'Бот доступен и отвечает', ok: true, detail: res.botName })
    } else {
      steps.push({ label: 'Проверка токена', ok: false, detail: res.error || 'Telegram API вернул ошибку' })
    }

    apiResult.value = { ...res, steps }
  } catch (e: any) {
    const errorMsg = e.data?.message || e.message || 'Сетевая ошибка или сервер недоступен'
    steps.push({ label: 'Соединение с сервером', ok: false, detail: errorMsg })
    apiResult.value = { success: false, error: errorMsg, steps }
  } finally {
    apiLoading.value = false
  }
}

// --- Test Send (broadcast) ---
const sendMessage = ref('')
const sendLoading = ref(false)
const sendResult = ref<{ sent: boolean; chatsCount?: number; reason?: string } | null>(null)

async function handleTestSend() {
  if (!sendMessage.value.trim()) return
  sendLoading.value = true
  sendResult.value = null
  try {
    const res = await testSend(sendMessage.value) as { sent: boolean; chatsCount?: number; reason?: string }
    sendResult.value = res
  } catch (e: any) {
    sendResult.value = { sent: false, reason: e.data?.message || e.message || 'Неизвестная ошибка' }
  } finally {
    sendLoading.value = false
  }
}

// --- Test Chat ---
const chatId = ref('')
const chatMessage = ref('')
const chatLoading = ref(false)
const chatResult = ref<{ success: boolean; messageId?: number; error?: string } | null>(null)

const selectedChatName = computed(() => {
  const c = chats.value.find(ch => ch.chatId === chatId.value)
  if (!c) return chatId.value
  return c.title || (c.username ? `@${c.username}` : `Чат ${c.chatId}`)
})

function chatTypeLabel(type: string): string {
  if (type === 'group') return 'Группа'
  if (type === 'supergroup') return 'Супергруппа'
  if (type === 'channel') return 'Канал'
  return 'Личный'
}

function humanReadableError(error: string | null): string {
  if (!error) return ''
  if (error.includes('chat not found')) return 'Чат не найден — возможно, бот был удалён из чата'
  if (error.includes('bot was blocked')) return 'Бот заблокирован пользователем'
  if (error.includes('Forbidden')) return 'Бот не имеет прав отправлять в этот чат'
  if (error.includes('FLOOD_WAIT')) return 'Telegram ограничил отправку — слишком много запросов'
  if (error.includes('Too Many Requests')) return 'Превышен лимит запросов к Telegram API'
  if (error.includes('timeout') || error.includes('ETIMEDOUT')) return 'Таймаут соединения с Telegram API'
  if (error.includes('Unauthorized') || error.includes('401')) return 'Токен бота невалиден'
  return error
}

async function handleTestChat() {
  if (!chatId.value.trim()) return
  chatLoading.value = true
  chatResult.value = null
  try {
    const res = await testChat(chatId.value, chatMessage.value || undefined) as { success: boolean; messageId?: number; error?: string }
    chatResult.value = res
  } catch (e: any) {
    chatResult.value = { success: false, error: e.data?.message || e.message || 'Неизвестная ошибка' }
  } finally {
    chatLoading.value = false
  }
}

// Advanced details toggle
const showAdvanced = ref(false)
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Test API -->
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body p-4 gap-3">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="font-bold text-base-content">Проверка API</h3>
            <p class="text-xs text-base-content/50 mt-0.5">Проверяет валидность токена и доступность Telegram Bot API</p>
          </div>
          <button class="btn btn-sm btn-primary" :disabled="apiLoading" @click="handleTestApi">
            <span v-if="apiLoading" class="loading loading-spinner loading-xs" />
            <Icon v-else name="mingcute:radar-line" />
            Тест API
          </button>
        </div>

        <!-- Result -->
        <template v-if="apiResult">
          <div role="alert" :class="['alert', apiResult.success ? 'alert-success' : 'alert-error']">
            <Icon :name="apiResult.success ? 'mingcute:check-circle-line' : 'mingcute:close-circle-line'" class="text-lg shrink-0" />
            <div>
              <template v-if="apiResult.success">
                <span class="font-semibold">Бот подключён и работает</span>
                <div class="text-sm mt-0.5">
                  <span class="badge badge-ghost badge-sm">@{{ apiResult.botUsername }}</span>
                  <span v-if="apiResult.botName" class="ml-1 opacity-70">({{ apiResult.botName }})</span>
                </div>
              </template>
              <template v-else>
                <span class="font-semibold">Тест не пройден</span>
                <div class="text-sm mt-0.5">{{ apiResult.error }}</div>
              </template>
            </div>
          </div>

          <!-- Steps breakdown -->
          <div v-if="apiResult.steps?.length" class="collapse collapse-arrow bg-base-200">
            <input type="checkbox" v-model="showAdvanced" />
            <div class="collapse-title text-sm font-medium py-2 min-h-0">
              Подробности проверки ({{ apiResult.steps.length }} шагов)
            </div>
            <div class="collapse-content px-4 pb-3">
              <ul class="steps steps-vertical text-xs">
                <li v-for="(step, i) in apiResult.steps" :key="i" :class="['step', step.ok ? 'step-success' : 'step-error']">
                  <div class="text-left">
                    <span :class="step.ok ? '' : 'text-error font-semibold'">{{ step.label }}</span>
                    <span v-if="step.detail" class="block text-base-content/50">{{ step.detail }}</span>
                  </div>
                </li>
              </ul>
            </div>
          </div>

          <!-- Next action hint -->
          <div v-if="!apiResult.success" class="text-xs text-base-content/60 flex items-center gap-1">
            <Icon name="mingcute:bulb-line" class="text-warning" />
            <template v-if="apiResult.error?.includes('401') || apiResult.error?.includes('Unauthorized')">
              Проверьте TELEGRAM_BOT_TOKEN в .env — токен невалиден или отозван.
            </template>
            <template v-else-if="apiResult.error?.includes('timeout') || apiResult.error?.includes('ETIMEDOUT')">
              Telegram API недоступен. Проверьте сетевое подключение сервера.
            </template>
            <template v-else>
              Проверьте настройки бота и сетевое подключение. Убедитесь, что TELEGRAM_BOT_TOKEN корректен.
            </template>
          </div>
        </template>
      </div>
    </div>

    <!-- Test Send (broadcast) -->
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body p-4 gap-3">
        <div>
          <h3 class="font-bold text-base-content">Тестовая рассылка</h3>
          <p class="text-xs text-base-content/50 mt-0.5">Отправит сообщение во все чаты с включёнными уведомлениями</p>
        </div>
        <form class="flex flex-col gap-2" @submit.prevent="handleTestSend">
          <textarea
            v-model="sendMessage"
            class="textarea w-full"
            placeholder="Текст тестового сообщения..."
            rows="2"
            required
          />
          <button class="btn btn-sm btn-primary self-end" :disabled="sendLoading || !sendMessage.trim()">
            <span v-if="sendLoading" class="loading loading-spinner loading-xs" />
            <Icon v-else name="mingcute:send-line" />
            Отправить всем
          </button>
        </form>
        <template v-if="sendResult">
          <div role="alert" :class="['alert', sendResult.sent ? 'alert-success' : 'alert-warning']">
            <Icon :name="sendResult.sent ? 'mingcute:check-circle-line' : 'mingcute:information-line'" class="text-lg shrink-0" />
            <div>
              <template v-if="sendResult.sent">
                Отправлено в <span class="badge badge-ghost badge-sm">{{ sendResult.chatsCount }}</span> чат(ов).
                Результаты доставки — во вкладке «Доставки».
              </template>
              <template v-else>
                <span class="font-semibold">Не отправлено:</span> {{ sendResult.reason }}
              </template>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Test Chat -->
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body p-4 gap-3">
        <div>
          <h3 class="font-bold text-base-content">Тест отдельного чата</h3>
          <p class="text-xs text-base-content/50 mt-0.5">Отправит сообщение в выбранный чат. Результат сохранится в доставках.</p>
        </div>
        <form class="flex flex-col gap-2" @submit.prevent="handleTestChat">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Чат-получатель</legend>
            <select v-model="chatId" class="select select-sm w-full" required>
              <option value="" disabled>Выберите чат...</option>
              <option v-for="c in chats" :key="c.chatId" :value="c.chatId">
                {{ c.title || (c.username ? `@${c.username}` : `Чат ${c.chatId}`) }}
                <template v-if="c.chatType !== 'private'"> ({{ chatTypeLabel(c.chatType) }})</template>
              </option>
            </select>
            <p v-if="!chats.length" class="text-xs text-warning mt-1">
              Нет привязанных чатов. Отправьте боту команду /start, чтобы зарегистрировать чат.
            </p>
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Сообщение (необязательно)</legend>
            <textarea
              v-model="chatMessage"
              class="textarea w-full textarea-sm"
              placeholder="Тестовое сообщение из админки"
              rows="2"
            />
          </fieldset>
          <div class="flex items-center justify-between">
            <span v-if="chatId.trim()" class="text-xs text-base-content/50">
              Отправка в: <span class="font-semibold">{{ selectedChatName }}</span>
              <code class="font-mono text-base-content/40 ml-1">({{ chatId }})</code>
            </span>
            <button class="btn btn-sm btn-primary" :disabled="chatLoading || !chatId.trim()">
              <span v-if="chatLoading" class="loading loading-spinner loading-xs" />
              <Icon v-else name="mingcute:chat-3-line" />
              Отправить в чат
            </button>
          </div>
        </form>
        <template v-if="chatResult">
          <div role="alert" :class="['alert', chatResult.success ? 'alert-success' : 'alert-error']">
            <Icon :name="chatResult.success ? 'mingcute:check-circle-line' : 'mingcute:close-circle-line'" class="text-lg shrink-0" />
            <div>
              <template v-if="chatResult.success">
                Сообщение доставлено в <span class="font-semibold">{{ selectedChatName }}</span>
                <span class="badge badge-ghost badge-sm ml-1">Telegram ID: {{ chatResult.messageId }}</span>
              </template>
              <template v-else>
                <span class="font-semibold">Ошибка доставки:</span> {{ humanReadableError(chatResult.error ?? null) }}
              </template>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
