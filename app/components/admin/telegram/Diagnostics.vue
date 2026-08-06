<script setup lang="ts">
/**
 * Диагностика Telegram.
 *
 * Три проверки по нарастающей: жив ли токен, доходит ли до чатов вообще,
 * доходит ли до конкретного. В таком порядке их и делают, когда «уведомления
 * не приходят», — каждая следующая имеет смысл, только если прошла предыдущая.
 *
 * Ответы Telegram переводятся на человеческий: «chat not found» ничего не
 * говорит оператору, «бота удалили из чата» говорит, что делать.
 */
const { testApi, testSend, testChat } = useAdminTelegramActions()
const { data: chatsData } = useAdminTelegramChats()

const chats = computed(() => {
  const raw = (chatsData.value as any)?.data ?? chatsData.value ?? []
  return raw as Array<{
    id: number
    chatId: string
    title: string | null
    username: string | null
    chatType: string
    alertsEnabled: boolean
  }>
})

const CHAT_TYPE_LABELS: Record<string, string> = {
  group: 'группа',
  supergroup: 'супергруппа',
  channel: 'канал',
  private: 'личный',
}

function chatLabel(chat: { title: string | null; username: string | null; chatId: string; chatType: string }): string {
  const name = chat.title || (chat.username ? `@${chat.username}` : `Чат ${chat.chatId}`)
  return chat.chatType === 'private' ? name : `${name} · ${CHAT_TYPE_LABELS[chat.chatType] ?? chat.chatType}`
}

/** Ответ Telegram → что это значит для оператора. */
function humanReadableError(error: string | null | undefined): string {
  if (!error) return ''
  if (error.includes('chat not found')) return 'Чат не найден — скорее всего бота удалили из чата'
  if (error.includes('bot was blocked')) return 'Пользователь заблокировал бота'
  if (error.includes('Forbidden')) return 'У бота нет прав писать в этот чат'
  if (error.includes('FLOOD_WAIT')) return 'Telegram придержал отправку: слишком часто'
  if (error.includes('Too Many Requests')) return 'Превышен лимит запросов к Telegram'
  if (error.includes('timeout') || error.includes('ETIMEDOUT')) return 'Telegram не ответил вовремя'
  if (error.includes('Unauthorized') || error.includes('401')) return 'Токен бота не принят'
  return error
}

// ── 1. Токен ──────────────────────────────────────────────────────────────
interface ApiStep { label: string; ok: boolean; detail?: string }

const apiLoading = ref(false)
const apiResult = ref<{
  success: boolean
  botUsername?: string
  botName?: string
  error?: string
  steps: ApiStep[]
} | null>(null)

/** Что делать дальше — выводится из текста отказа, а не из общих слов. */
const apiHint = computed(() => {
  const error = apiResult.value?.error
  if (!apiResult.value || apiResult.value.success || !error) return null
  if (error.includes('401') || error.includes('Unauthorized')) {
    return 'Проверьте TELEGRAM_BOT_TOKEN в окружении: токен отозван или скопирован не полностью.'
  }
  if (error.includes('timeout') || error.includes('ETIMEDOUT')) {
    return 'Telegram недоступен с этого сервера — вопрос к сети, а не к настройкам бота.'
  }
  return 'Проверьте TELEGRAM_BOT_TOKEN и доступ сервера в интернет.'
})

async function handleTestApi() {
  apiLoading.value = true
  apiResult.value = null
  const steps: ApiStep[] = []
  try {
    steps.push({ label: 'Запрос getMe к Telegram', ok: true })
    const res = await testApi() as { success: boolean; botUsername?: string; botName?: string; error?: string }
    if (res.success) {
      steps.push({ label: 'Токен принят', ok: true, detail: res.botUsername ? `@${res.botUsername}` : undefined })
      steps.push({ label: 'Бот отвечает', ok: true, detail: res.botName })
    }
    else {
      steps.push({ label: 'Токен не принят', ok: false, detail: res.error || 'Telegram вернул ошибку' })
    }
    apiResult.value = { ...res, steps }
  }
  catch (e: any) {
    const message = e?.data?.message || e?.message || 'Сервер не ответил'
    steps.push({ label: 'Соединение с сервером', ok: false, detail: message })
    apiResult.value = { success: false, error: message, steps }
  }
  finally {
    apiLoading.value = false
  }
}

// ── 2. Рассылка ───────────────────────────────────────────────────────────
const sendMessage = ref('')
const sendLoading = ref(false)
const sendResult = ref<{ sent: boolean; chatsCount?: number; reason?: string } | null>(null)

async function handleTestSend() {
  if (!sendMessage.value.trim()) return
  sendLoading.value = true
  sendResult.value = null
  try {
    sendResult.value = await testSend(sendMessage.value) as { sent: boolean; chatsCount?: number; reason?: string }
  }
  catch (e: any) {
    sendResult.value = { sent: false, reason: e?.data?.message || e?.message || 'Не удалось отправить' }
  }
  finally {
    sendLoading.value = false
  }
}

// ── 3. Один чат ───────────────────────────────────────────────────────────
const chatId = ref<string>('')
const chatMessage = ref('')
const chatLoading = ref(false)
const chatResult = ref<{ success: boolean; messageId?: number; error?: string } | null>(null)

const chatOptions = computed(() => [
  { value: '', label: chats.value.length ? 'Выберите чат' : 'Привязанных чатов нет' },
  ...chats.value.map(c => ({ value: c.chatId, label: chatLabel(c) })),
])

const selectedChatName = computed(() => {
  const chat = chats.value.find(c => c.chatId === chatId.value)
  return chat ? chatLabel(chat) : chatId.value
})

async function handleTestChat() {
  if (!chatId.value) return
  chatLoading.value = true
  chatResult.value = null
  try {
    chatResult.value = await testChat(
      chatId.value,
      chatMessage.value || undefined,
    ) as { success: boolean; messageId?: number; error?: string }
  }
  catch (e: any) {
    chatResult.value = { success: false, error: e?.data?.message || e?.message || 'Не удалось отправить' }
  }
  finally {
    chatLoading.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <section class="overflow-hidden rounded-lg border border-border bg-panel">
      <header class="flex flex-wrap items-center gap-2 border-b border-divider bg-card px-3 py-2.5">
        <span class="min-w-0 flex-1">
          <span class="block text-base font-medium">Токен и связь</span>
          <span class="block text-sm text-subtle">Жив ли токен и отвечает ли Telegram</span>
        </span>
        <UiButton variant="primary" :loading="apiLoading" @click="handleTestApi">
          <Icon v-if="!apiLoading" name="mingcute:radar-line" />
          Проверить
        </UiButton>
      </header>

      <div v-if="apiResult" class="flex flex-col gap-2 px-3 py-3">
        <p
          class="flex items-start gap-2 rounded-md border px-2.5 py-2 text-sm text-fg"
          :class="apiResult.success
            ? 'border-success-border bg-success-bg'
            : 'border-danger-border bg-danger-bg'"
        >
          <Icon
            :name="apiResult.success ? 'mingcute:check-line' : 'mingcute:alert-line'"
            class="mt-0.5 shrink-0"
            :class="apiResult.success ? 'text-success' : 'text-danger'"
          />
          <span class="min-w-0 flex-1">
            <template v-if="apiResult.success">
              <span class="block font-medium">Бот подключён</span>
              <span class="block font-mono text-micro text-muted">
                @{{ apiResult.botUsername }}<template v-if="apiResult.botName"> · {{ apiResult.botName }}</template>
              </span>
            </template>
            <template v-else>
              <span class="block font-medium">Проверка не прошла</span>
              <span class="block text-micro text-muted">{{ humanReadableError(apiResult.error) }}</span>
            </template>
          </span>
        </p>

        <UiDisclosure title="Как шла проверка" :count="apiResult.steps.length">
          <div class="flex flex-col gap-1">
            <div
              v-for="(step, index) in apiResult.steps"
              :key="index"
              class="flex items-start gap-2 text-sm"
            >
              <span class="mt-1.5 size-1.5 shrink-0 rounded-full" :class="step.ok ? 'bg-success' : 'bg-danger'" />
              <span class="min-w-0 flex-1">
                <span class="block" :class="!step.ok && 'text-danger'">{{ step.label }}</span>
                <span v-if="step.detail" class="block text-micro text-subtle">{{ step.detail }}</span>
              </span>
            </div>
          </div>
        </UiDisclosure>

        <p v-if="apiHint" class="flex items-start gap-2 text-sm text-muted">
          <Icon name="mingcute:bulb-line" class="mt-0.5 shrink-0 text-warning" />
          <span>{{ apiHint }}</span>
        </p>
      </div>
    </section>

    <section class="overflow-hidden rounded-lg border border-border bg-panel">
      <header class="border-b border-divider bg-card px-3 py-2.5">
        <span class="block text-base font-medium">Рассылка по всем чатам</span>
        <span class="block text-sm text-subtle">Уйдёт во все чаты с включёнными уведомлениями</span>
      </header>

      <form class="flex flex-col gap-2 px-3 py-3" @submit.prevent="handleTestSend">
        <UiTextarea v-model="sendMessage" :rows="2" placeholder="Текст тестового сообщения" />
        <div class="flex items-center gap-2">
          <span class="flex-1" />
          <UiButton
            type="submit"
            variant="primary"
            :loading="sendLoading"
            :disabled="!sendMessage.trim()"
          >
            <Icon v-if="!sendLoading" name="mingcute:send-line" />
            Отправить всем
          </UiButton>
        </div>

        <p
          v-if="sendResult"
          class="flex items-start gap-2 rounded-md border px-2.5 py-2 text-sm text-fg"
          :class="sendResult.sent
            ? 'border-success-border bg-success-bg'
            : 'border-warning-border bg-warning-bg'"
        >
          <Icon
            :name="sendResult.sent ? 'mingcute:check-line' : 'mingcute:information-line'"
            class="mt-0.5 shrink-0"
            :class="sendResult.sent ? 'text-success' : 'text-warning'"
          />
          <span v-if="sendResult.sent">
            Ушло в {{ sendResult.chatsCount }} чат(ов). Что из этого дошло — на вкладке «Доставки».
          </span>
          <span v-else>Не отправлено: {{ sendResult.reason }}</span>
        </p>
      </form>
    </section>

    <section class="overflow-hidden rounded-lg border border-border bg-panel">
      <header class="border-b border-divider bg-card px-3 py-2.5">
        <span class="block text-base font-medium">Отправка в один чат</span>
        <span class="block text-sm text-subtle">Результат попадёт в историю доставок</span>
      </header>

      <form class="flex flex-col gap-3 px-3 py-3" @submit.prevent="handleTestChat">
        <UiField
          label="Чат"
          :hint="chats.length ? undefined : 'Отправьте боту /start, чтобы чат появился в списке'"
        >
          <UiSelect v-model="chatId" :options="chatOptions" :disabled="!chats.length" />
        </UiField>

        <UiField label="Сообщение" hint="Пусто — уйдёт стандартный текст проверки">
          <UiTextarea v-model="chatMessage" :rows="2" placeholder="Тестовое сообщение из админки" />
        </UiField>

        <div class="flex flex-wrap items-center gap-2">
          <span v-if="chatId" class="min-w-0 flex-1 truncate text-sm text-subtle">
            уйдёт в {{ selectedChatName }}
          </span>
          <span v-else class="flex-1" />
          <UiButton type="submit" variant="primary" :loading="chatLoading" :disabled="!chatId">
            <Icon v-if="!chatLoading" name="mingcute:chat-3-line" />
            Отправить
          </UiButton>
        </div>

        <p
          v-if="chatResult"
          class="flex items-start gap-2 rounded-md border px-2.5 py-2 text-sm text-fg"
          :class="chatResult.success
            ? 'border-success-border bg-success-bg'
            : 'border-danger-border bg-danger-bg'"
        >
          <Icon
            :name="chatResult.success ? 'mingcute:check-line' : 'mingcute:alert-line'"
            class="mt-0.5 shrink-0"
            :class="chatResult.success ? 'text-success' : 'text-danger'"
          />
          <span v-if="chatResult.success">
            Доставлено в {{ selectedChatName }}
            <span class="font-mono text-micro text-muted">· сообщение {{ chatResult.messageId }}</span>
          </span>
          <span v-else>{{ humanReadableError(chatResult.error) }}</span>
        </p>
      </form>
    </section>
  </div>
</template>
