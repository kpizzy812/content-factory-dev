<script setup lang="ts">
/**
 * Привязанные чаты.
 *
 * Главный вопрос карточки — «дойдёт ли сюда уведомление», поэтому переключатель
 * и маршрутизация стоят выше счётчиков доставок: счётчики отвечают на «доходило
 * ли раньше», а это другой вопрос.
 *
 * Маршрутизация редактируется на месте, без модалки: теги переключают по
 * несколько подряд, и модалка на каждый клик мешала бы.
 *
 * `mingcute:broadcast-line` в наборе не существует — у канала стоит
 * `announcement-line`.
 */
interface ChatUser {
  name: string
  surname: string
  email: string
  rolePreset: string
}

interface Chat {
  id: number
  chatId: string
  userId: number | null
  chatType: string
  title: string | null
  username: string | null
  alertsEnabled: boolean
  isAuthorized: boolean
  routingTags: string[]
  createdAt: string
  user: ChatUser | null
  _count: { deliveries: number; commandAudits: number }
}

const { data: chatsData, refresh } = useAdminTelegramChats()
const { updateChat, deleteChat, testChat } = useAdminTelegramActions()

const chats = computed<Chat[]>(() => (chatsData.value as any)?.data ?? chatsData.value ?? [])

const toast = useToast()

const EVENT_TYPES = [
  { value: 'cycle_started', label: 'Цикл запущен' },
  { value: 'upload_success', label: 'Загрузка прошла' },
  { value: 'critical_error', label: 'Критическая ошибка' },
  { value: 'idea_created', label: 'Идея создана' },
  { value: 'scenario_ready', label: 'Сценарий готов' },
  { value: 'video_complete', label: 'Видео готово' },
  { value: 'custom', label: 'Своё событие' },
  { value: 'test', label: 'Тест' },
] as const

const editingTagsId = ref<number | null>(null)
const deleteTarget = ref<Chat | null>(null)
const testingId = ref<number | null>(null)
const togglingId = ref<number | null>(null)

const CHAT_TYPES: Record<string, { label: string; icon: string }> = {
  private: { label: 'Личный', icon: 'mingcute:user-3-line' },
  group: { label: 'Группа', icon: 'mingcute:group-line' },
  supergroup: { label: 'Супергруппа', icon: 'mingcute:group-line' },
  channel: { label: 'Канал', icon: 'mingcute:announcement-line' },
}

function chatType(type: string) {
  return CHAT_TYPES[type] ?? { label: type, icon: 'mingcute:chat-3-line' }
}

function chatTitle(chat: Chat): string {
  if (chat.title) return chat.title
  if (chat.username) return `@${chat.username}`
  return `Чат ${chat.chatId}`
}

function userName(user: ChatUser | null): string {
  if (!user) return ''
  return [user.name, user.surname].filter(Boolean).join(' ') || user.email
}

function routingDescription(tags: string[]): string {
  if (!tags.length) return 'получает все уведомления'
  const labels = tags.map(t => EVENT_TYPES.find(e => e.value === t)?.label ?? t)
  return `только: ${labels.join(', ')}`
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

async function toggleAlerts(chat: Chat) {
  togglingId.value = chat.id
  try {
    await updateChat(chat.id, { alertsEnabled: !chat.alertsEnabled })
    await refresh()
  }
  catch (e: unknown) {
    toast.error((e as Error).message || 'Не удалось изменить чат')
  }
  finally {
    togglingId.value = null
  }
}

async function toggleTag(chat: Chat, tag: string) {
  const tags = chat.routingTags.includes(tag)
    ? chat.routingTags.filter(t => t !== tag)
    : [...chat.routingTags, tag]
  try {
    await updateChat(chat.id, { routingTags: tags })
    await refresh()
  }
  catch (e: unknown) {
    toast.error((e as Error).message || 'Не удалось изменить маршрутизацию')
  }
}

async function sendTest(chat: Chat) {
  testingId.value = chat.id
  try {
    const res = await testChat(
      chat.chatId,
      'Тестовое сообщение из панели администратора',
    ) as { success: boolean; error?: string }
    if (res.success) toast.success(`Сообщение доставлено в «${chatTitle(chat)}»`)
    else toast.error(res.error || 'Сообщение не доставлено')
  }
  catch (e: unknown) {
    toast.error((e as Error).message || 'Не удалось отправить тест')
  }
  finally {
    testingId.value = null
  }
}

async function handleDelete() {
  const target = deleteTarget.value
  deleteTarget.value = null
  if (!target) return
  try {
    await deleteChat(target.id)
    await refresh()
    toast.success('Привязка удалена')
  }
  catch (e: unknown) {
    toast.error((e as Error).message || 'Не удалось удалить привязку')
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div>
      <h3 class="text-base font-semibold">Привязанные чаты</h3>
      <p class="text-sm text-subtle">
        Чат появляется здесь сам после первого сообщения боту. Аккаунт привязывается
        командой <span class="font-mono">/link почта</span>.
      </p>
    </div>

    <UiEmptyState
      v-if="!chats.length"
      title="Чатов нет"
      description="Отправьте боту /start, затем /link ваша@почта — чат появится в списке."
    />

    <article
      v-for="chat in chats"
      :key="chat.id"
      class="flex flex-col gap-2.5 rounded-lg border bg-panel p-3"
      :class="chat.alertsEnabled ? 'border-border' : 'border-divider'"
    >
      <div class="flex items-start gap-2.5">
        <span
          class="flex size-9 shrink-0 items-center justify-center rounded-full border"
          :class="chat.alertsEnabled
            ? 'border-accent-border bg-accent-bg text-accent'
            : 'border-divider bg-card text-subtle'"
        >
          <Icon :name="chatType(chat.chatType).icon" class="text-lg" />
        </span>

        <span class="min-w-0 flex-1">
          <span class="block truncate font-medium">{{ chatTitle(chat) }}</span>
          <span class="flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-subtle">
            <span class="rounded-sm border border-divider px-1.5">{{ chatType(chat.chatType).label }}</span>
            <span class="font-mono">{{ chat.chatId }}</span>
            <span v-if="chat.user" class="text-info">{{ userName(chat.user) }}</span>
          </span>
        </span>

        <div class="flex shrink-0 items-center gap-1">
          <UiButton variant="ghost" :loading="testingId === chat.id" title="Отправить тест" @click="sendTest(chat)">
            <Icon v-if="testingId !== chat.id" name="mingcute:send-line" />
          </UiButton>
          <UiButton variant="ghost" title="Удалить привязку" @click="deleteTarget = chat">
            <Icon name="mingcute:delete-2-line" class="text-danger" />
          </UiButton>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-divider pt-2">
        <UiToggle
          :model-value="chat.alertsEnabled"
          :disabled="togglingId === chat.id"
          label="Уведомления"
          @update:model-value="toggleAlerts(chat)"
        />
        <UiStatusBadge :status="chat.isAuthorized ? 'done' : 'draft'" size="xs" icon-only />
        <span class="text-sm text-subtle">
          {{ chat.isAuthorized ? 'аккаунт привязан' : 'аккаунт не привязан' }}
        </span>
        <span class="flex-1" />
        <span class="tnum font-mono text-micro text-subtle">
          доставок {{ chat._count?.deliveries ?? 0 }} · команд {{ chat._count?.commandAudits ?? 0 }}
        </span>
      </div>

      <div class="flex flex-col gap-1.5">
        <span class="flex flex-wrap items-center gap-1.5 text-sm text-muted">
          <Icon name="mingcute:route-line" class="shrink-0" />
          Маршрутизация: <span class="text-fg">{{ routingDescription(chat.routingTags) }}</span>
        </span>

        <div v-if="editingTagsId === chat.id" class="flex flex-wrap gap-1.5">
          <button
            v-for="event in EVENT_TYPES"
            :key="event.value"
            type="button"
            class="h-7 cursor-pointer rounded-md border px-2 text-sm transition-colors duration-(--duration-fast)"
            :class="chat.routingTags.includes(event.value)
              ? 'border-accent-border bg-accent-bg text-fg'
              : 'border-border bg-card text-muted hover:text-fg'"
            @click="toggleTag(chat, event.value)"
          >
            {{ event.label }}
          </button>
          <UiButton variant="ghost" @click="editingTagsId = null">
            <Icon name="mingcute:check-line" />
            Готово
          </UiButton>
        </div>
        <UiButton v-else variant="ghost" class="w-fit" @click="editingTagsId = chat.id">
          <Icon name="mingcute:edit-line" />
          Настроить маршрутизацию
        </UiButton>
      </div>

      <ClientOnly>
        <span class="tnum font-mono text-micro text-subtle">подключён {{ formatDate(chat.createdAt) }}</span>
      </ClientOnly>
    </article>

    <UiModal :open="!!deleteTarget" size="sm" title="Удалить привязку?" @close="deleteTarget = null">
      <p class="text-sm text-muted">
        Чат «{{ deleteTarget ? chatTitle(deleteTarget) : '' }}» перестанет получать
        уведомления. Он вернётся в список сам, как только напишет боту снова, но
        маршрутизацию придётся настроить заново.
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="deleteTarget = null">Отмена</UiButton>
        <UiButton variant="danger" @click="handleDelete">Удалить</UiButton>
      </template>
    </UiModal>
  </div>
</template>
