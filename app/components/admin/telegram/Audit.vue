<script setup lang="ts">
/**
 * Аудит команд бота.
 *
 * Строка отвечает предложением, а не кодом команды: «@ivan остановил цикл»
 * читается, а «/stop success» требует расшифровки. Сама команда стоит рядом
 * мелким — она нужна, когда ищут конкретный случай.
 *
 * Относительное время («5 мин назад») зависит от «сейчас» и живёт в
 * `ClientOnly`: на сервере оно посчиталось бы другим.
 */
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

const COMMAND_OPTIONS = [
  { value: '', label: 'Все команды' },
  { value: '/start', label: '/start — начало работы' },
  { value: '/link', label: '/link — привязка аккаунта' },
  { value: '/status', label: '/status — состояние завода' },
  { value: '/stop', label: '/stop — остановка цикла' },
  { value: '/start_cycle', label: '/start_cycle — запуск цикла' },
  { value: '/help', label: '/help — справка' },
  { value: 'video_url', label: 'ссылка на видео — разбор' },
]

const STATUS_OPTIONS = [
  { value: '', label: 'Все исходы' },
  { value: 'success', label: 'Выполнено' },
  { value: 'error', label: 'Ошибка' },
  { value: 'unauthorized', label: 'Нет доступа' },
  { value: 'not_found', label: 'Не найдено' },
]

const STATUS_ENTITY = {
  success: 'done',
  error: 'failed',
  unauthorized: 'blocked',
  not_found: 'review',
} as const

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

const filtered = computed(() => !!filterCommand.value || !!filterStatus.value)

/** «Сейчас» берём после монтирования: относительное время ломает гидратацию. */
const now = ref<number | null>(null)
onMounted(() => { now.value = Date.now() })

function setCommand(value: string | number) {
  filterCommand.value = String(value)
  page.value = 1
}

function setStatus(value: string | number) {
  filterStatus.value = String(value)
  page.value = 1
}

function resetFilters() {
  filterCommand.value = ''
  filterStatus.value = ''
  page.value = 1
}

function chatDisplayName(entry: AuditEntry): string {
  if (entry.chat?.title) return entry.chat.title
  if (entry.chat?.username) return `@${entry.chat.username}`
  return String(entry.chatId)
}

function statusLabel(status: string): string {
  return STATUS_OPTIONS.find(o => o.value === status)?.label ?? status
}

function humanReadableEvent(entry: AuditEntry): string {
  const user = entry.telegramUsername ? `@${entry.telegramUsername}` : `пользователь ${entry.telegramUserId}`
  switch (entry.command) {
    case '/start': return `${user} начал работу с ботом`
    case '/link': return `${user} привязал аккаунт`
    case '/status': return `${user} спросил состояние завода`
    case '/stop': return `${user} остановил цикл`
    case '/start_cycle': return `${user} запустил цикл`
    case '/help': return `${user} открыл справку`
    case 'video_url': return `${user} прислал видео на разбор`
    default: return `${user} выполнил ${entry.command}`
  }
}

function formatArgs(args: Record<string, unknown> | string | null): string {
  if (!args) return ''
  if (typeof args === 'string') return args
  return Object.keys(args).length ? JSON.stringify(args) : ''
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('ru-RU')
}

function timeAgo(value: string): string {
  if (now.value == null) return ''
  const diff = now.value - new Date(value).getTime()
  if (diff < 60_000) return 'только что'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин назад`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ч назад`
  return `${Math.floor(diff / 86_400_000)} дн назад`
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div>
      <h3 class="text-base font-semibold">Аудит команд</h3>
      <p class="text-sm text-subtle">Что люди делали через бота и чем это закончилось.</p>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <UiSelect class="w-64" :model-value="filterCommand" :options="COMMAND_OPTIONS" @update:model-value="setCommand" />
      <UiSelect class="w-44" :model-value="filterStatus" :options="STATUS_OPTIONS" @update:model-value="setStatus" />
      <UiButton v-if="filtered" variant="ghost" @click="resetFilters">
        <Icon name="mingcute:close-line" />
        Сбросить
      </UiButton>
      <span class="flex-1" />
      <UiButton variant="ghost" @click="refresh()">
        <Icon name="mingcute:refresh-2-line" />
        Обновить
      </UiButton>
    </div>

    <UiEmptyState
      v-if="!items.length"
      title="Записей нет"
      :description="filtered
        ? 'Под выбранные условия ничего не попало — снимите фильтры.'
        : 'Аудит заполнится, как только с ботом начнут разговаривать.'"
    />

    <div v-else class="flex flex-col gap-1.5">
      <article
        v-for="entry in items"
        :key="entry.id"
        class="rounded-md border border-border bg-panel"
      >
        <button
          type="button"
          class="flex w-full cursor-pointer flex-wrap items-center gap-2 px-2.5 py-2 text-left"
          :aria-expanded="expandedId === entry.id"
          @click="expandedId = expandedId === entry.id ? null : entry.id"
        >
          <UiStatusBadge :status="STATUS_ENTITY[entry.resultStatus] ?? 'draft'" size="xs" icon-only />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm">{{ humanReadableEvent(entry) }}</span>
            <span class="flex flex-wrap items-center gap-2 text-micro text-subtle">
              <span class="font-mono">{{ entry.command }}</span>
              <span v-if="entry.relatedEntityType" class="rounded-sm border border-divider px-1.5">
                {{ entry.relatedEntityType }}#{{ entry.relatedEntityId }}
              </span>
            </span>
          </span>
          <span class="shrink-0 text-sm text-muted">{{ statusLabel(entry.resultStatus) }}</span>
          <ClientOnly>
            <span class="shrink-0 text-micro text-subtle">{{ timeAgo(entry.createdAt) }}</span>
          </ClientOnly>
        </button>

        <div v-if="expandedId === entry.id" class="border-t border-divider px-2.5 py-2">
          <ClientOnly>
            <UiKeyValue
              :items="[
                { label: 'Чат', value: `${chatDisplayName(entry)} (${entry.chatId})` },
                {
                  label: 'В Telegram',
                  value: entry.telegramUsername ? `@${entry.telegramUsername}` : String(entry.telegramUserId),
                },
                { label: 'Время', value: formatDate(entry.createdAt) },
                ...(formatArgs(entry.parsedArgs) ? [{ label: 'Аргументы', value: formatArgs(entry.parsedArgs) }] : []),
              ]"
            />
          </ClientOnly>
          <p
            v-if="entry.errorMessage"
            class="mt-2 flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-1.5 text-sm text-fg"
          >
            <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-danger" />
            <span class="min-w-0 flex-1">{{ entry.errorMessage }}</span>
          </p>
        </div>
      </article>

      <div v-if="meta.totalPages > 1" class="flex items-center justify-center gap-2 pt-1">
        <UiButton variant="ghost" :disabled="page <= 1" aria-label="Предыдущая" @click="page--">
          <Icon name="mingcute:left-line" />
        </UiButton>
        <span class="tnum font-mono text-sm text-muted">{{ meta.page }} / {{ meta.totalPages }}</span>
        <UiButton variant="ghost" :disabled="page >= meta.totalPages" aria-label="Следующая" @click="page++">
          <Icon name="mingcute:right-line" />
        </UiButton>
      </div>

      <p class="tnum text-center font-mono text-micro text-subtle">всего {{ meta.total }}</p>
    </div>
  </div>
</template>
