<script setup lang="ts">
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

const EVENT_TYPES = [
  { value: 'cycle_started', label: 'Цикл запущен', icon: 'mingcute:play-circle-line' },
  { value: 'upload_success', label: 'Загрузка ОК', icon: 'mingcute:upload-2-line' },
  { value: 'critical_error', label: 'Крит. ошибка', icon: 'mingcute:alert-line' },
  { value: 'idea_created', label: 'Идея создана', icon: 'mingcute:bulb-line' },
  { value: 'test', label: 'Тест', icon: 'mingcute:bug-line' },
  { value: 'custom', label: 'Пользовательское', icon: 'mingcute:settings-3-line' },
  { value: 'scenario_ready', label: 'Сценарий готов', icon: 'mingcute:movie-line' },
  { value: 'video_complete', label: 'Видео завершено', icon: 'mingcute:video-line' },
] as const

const editingTagsId = ref<number | null>(null)
const deleteConfirmId = ref<number | null>(null)
const testingId = ref<number | null>(null)
const togglingId = ref<number | null>(null)
const error = ref('')
const testFeedback = ref<{ chatId: number; success: boolean; message: string } | null>(null)
const confirmModalRef = ref<{ open: () => void; close: () => void; setBusy: (v: boolean) => void } | null>(null)

function openDeleteConfirm(id: number) {
  deleteConfirmId.value = id
  confirmModalRef.value?.open()
}

async function onConfirmDelete() {
  const id = deleteConfirmId.value
  if (id === null) return
  confirmModalRef.value?.setBusy(true)
  try {
    await deleteChat(id)
    deleteConfirmId.value = null
    confirmModalRef.value?.close()
    await refresh()
  } catch (e: unknown) {
    error.value = (e as Error).message || 'Ошибка удаления'
  } finally {
    confirmModalRef.value?.setBusy(false)
  }
}

function chatTypeLabel(type: string): string {
  if (type === 'private') return 'Личный'
  if (type === 'group') return 'Группа'
  if (type === 'supergroup') return 'Супергруппа'
  if (type === 'channel') return 'Канал'
  return type
}

function chatTypeIcon(type: string): string {
  if (type === 'private') return 'mingcute:user-3-line'
  if (type === 'group' || type === 'supergroup') return 'mingcute:group-line'
  if (type === 'channel') return 'mingcute:broadcast-line'
  return 'mingcute:chat-3-line'
}

function userName(user: ChatUser | null): string {
  if (!user) return ''
  return [user.name, user.surname].filter(Boolean).join(' ') || user.email
}

async function toggleAlerts(chat: Chat) {
  togglingId.value = chat.id
  try {
    await updateChat(chat.id, { alertsEnabled: !chat.alertsEnabled })
    await refresh()
  } catch (e: unknown) {
    error.value = (e as Error).message || 'Ошибка обновления'
  } finally {
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
  } catch (e: unknown) {
    error.value = (e as Error).message || 'Ошибка обновления тегов'
  }
}

async function confirmDelete(id: number) {
  try {
    await deleteChat(id)
    deleteConfirmId.value = null
    await refresh()
  } catch (e: unknown) {
    error.value = (e as Error).message || 'Ошибка удаления'
  }
}

async function sendTest(chat: Chat) {
  testingId.value = chat.id
  testFeedback.value = null
  try {
    const res = await testChat(chat.chatId, 'Тестовое сообщение из панели администратора') as { success: boolean; error?: string }
    testFeedback.value = {
      chatId: chat.id,
      success: res.success,
      message: res.success ? 'Сообщение доставлено' : (res.error || 'Не удалось отправить'),
    }
  } catch (e: unknown) {
    testFeedback.value = {
      chatId: chat.id,
      success: false,
      message: (e as Error).message || 'Ошибка тестовой отправки',
    }
  } finally {
    testingId.value = null
    setTimeout(() => { testFeedback.value = null }, 5000)
  }
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function routingDescription(tags: string[]): string {
  if (tags.length === 0) return 'Получает все типы уведомлений'
  const labels = tags.map(t => EVENT_TYPES.find(e => e.value === t)?.label ?? t)
  return `Только: ${labels.join(', ')}`
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-lg font-semibold">Привязанные чаты</h3>
        <p class="text-xs text-base-content/50">Чаты автоматически регистрируются при первом сообщении боту. Привяжите аккаунт командой /link</p>
      </div>
    </div>

    <!-- Error -->
    <div v-if="error" role="alert" class="alert alert-error alert-soft">
      <Icon name="mingcute:warning-line" />
      <span>{{ error }}</span>
      <button class="btn btn-ghost btn-xs" @click="error = ''">✕</button>
    </div>

    <!-- Test feedback -->
    <div v-if="testFeedback" role="alert" :class="['alert alert-sm', testFeedback.success ? 'alert-success' : 'alert-error']">
      <Icon :name="testFeedback.success ? 'mingcute:check-circle-line' : 'mingcute:close-circle-line'" />
      <span>{{ testFeedback.message }}</span>
      <button class="btn btn-ghost btn-xs" @click="testFeedback = null">✕</button>
    </div>

    <!-- Chat cards -->
    <div v-if="chats.length" class="grid gap-3">
      <div v-for="chat in chats" :key="chat.id" class="card bg-base-100 shadow-sm">
        <div class="card-body p-4">
          <div class="flex items-start justify-between gap-3">
            <!-- Chat info -->
            <div class="flex items-center gap-3 min-w-0">
              <div class="avatar placeholder shrink-0">
                <div :class="['rounded-full w-10 h-10 flex items-center justify-center', chat.alertsEnabled ? 'bg-primary/10 text-primary' : 'bg-base-200 text-base-content/40']">
                  <Icon :name="chatTypeIcon(chat.chatType)" class="text-lg" />
                </div>
              </div>
              <div class="min-w-0">
                <div class="font-semibold truncate">
                  {{ chat.title ? chat.title : (chat.username ? `@${chat.username}` : `Чат ${chat.chatId}`) }}
                </div>
                <div class="flex items-center gap-2 text-xs text-base-content/50 flex-wrap">
                  <span class="badge badge-xs badge-outline">{{ chatTypeLabel(chat.chatType) }}</span>
                  <code class="font-mono">{{ chat.chatId }}</code>
                  <span v-if="chat.user" class="text-info">{{ userName(chat.user) }}</span>
                </div>
              </div>
            </div>

            <!-- Controls -->
            <div class="flex items-center gap-2 shrink-0">
              <div class="tooltip" data-tip="Тестовая отправка">
                <button
                  class="btn btn-ghost btn-xs"
                  :disabled="testingId === chat.id"
                  @click="sendTest(chat)"
                >
                  <span v-if="testingId === chat.id" class="loading loading-spinner loading-xs" />
                  <Icon v-else name="mingcute:send-line" class="size-4" />
                </button>
              </div>
              <div class="tooltip" data-tip="Удалить привязку">
                <button
                  class="btn btn-ghost btn-xs text-error"
                  @click="openDeleteConfirm(chat.id)"
                >
                  <Icon name="mingcute:delete-2-line" class="size-4" />
                </button>
              </div>
            </div>
          </div>

          <div class="divider my-1" />

          <!-- Status row -->
          <div class="flex items-center justify-between flex-wrap gap-2">
            <div class="flex items-center gap-3 text-sm">
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  class="toggle toggle-sm toggle-success"
                  :checked="chat.alertsEnabled"
                  :disabled="togglingId === chat.id"
                  @change="toggleAlerts(chat)"
                />
                <span class="text-xs">Уведомления</span>
              </label>
              <span :class="['badge badge-xs', chat.isAuthorized ? 'badge-success' : 'badge-ghost']">
                {{ chat.isAuthorized ? 'Авторизован' : 'Не авторизован' }}
              </span>
            </div>
            <div class="flex items-center gap-3 text-xs text-base-content/50">
              <span>Доставок: {{ chat._count?.deliveries ?? 0 }}</span>
              <span>Команд: {{ chat._count?.commandAudits ?? 0 }}</span>
            </div>
          </div>

          <!-- Routing tags -->
          <div class="mt-2">
            <div class="text-xs text-base-content/50 mb-1">
              <Icon name="mingcute:route-line" class="inline text-sm" />
              Маршрутизация:
              <span class="text-base-content/70">{{ routingDescription(chat.routingTags) }}</span>
            </div>
            <div v-if="editingTagsId === chat.id" class="flex flex-wrap gap-1 mt-1">
              <button
                v-for="evt in EVENT_TYPES"
                :key="evt.value"
                :class="['btn btn-xs gap-1', chat.routingTags.includes(evt.value) ? 'btn-primary' : 'btn-ghost btn-outline']"
                @click="toggleTag(chat, evt.value)"
              >
                <Icon :name="evt.icon" class="size-3" />
                {{ evt.label }}
              </button>
              <button class="btn btn-xs btn-ghost text-success" @click="editingTagsId = null">
                <Icon name="mingcute:check-line" class="size-4" />
                Готово
              </button>
            </div>
            <button
              v-else
              class="btn btn-ghost btn-xs mt-1"
              @click="editingTagsId = chat.id"
            >
              <Icon name="mingcute:edit-line" class="size-3" />
              Настроить теги
            </button>
          </div>
          <div class="mt-1 text-xs text-base-content/40">
            Подключён {{ formatDate(chat.createdAt) }}
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="flex flex-col items-center gap-3 py-12 text-base-content/50">
      <Icon name="mingcute:chat-3-line" class="text-4xl" />
      <div class="text-center">
        <p class="font-medium">Нет привязанных чатов</p>
        <p class="text-xs mt-1 max-w-sm">
          Чтобы привязать чат, отправьте боту команду <kbd class="kbd kbd-xs">/start</kbd>,
          затем <kbd class="kbd kbd-xs">/link ваш@email.com</kbd>
        </p>
      </div>
    </div>

    <!-- Delete confirm modal -->
    <SharedConfirmModal
      ref="confirmModalRef"
      title="Удалить чат?"
      message="Привязка чата будет удалена. Это действие нельзя отменить."
      confirm-label="Удалить"
      variant="danger"
      @confirm="onConfirmDelete"
      @cancel="deleteConfirmId = null"
    />
  </div>
</template>
