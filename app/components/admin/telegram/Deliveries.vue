<script setup lang="ts">
/**
 * История доставок.
 *
 * Ошибки Telegram переводятся на человеческий прямо в строке: «chat not found»
 * оператору ничего не говорит, а «бота удалили из чата» говорит, что делать.
 * Исходный текст остаётся в раскрытии — с ним идут к инженеру.
 *
 * Повтор доступен только у упавшей доставки: у отправленной он создал бы
 * второе сообщение в чате.
 */
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

const { resendDelivery } = useAdminTelegramActions()
const toast = useToast()

const STATUS_OPTIONS = [
  { value: '', label: 'Все состояния' },
  { value: 'pending', label: 'Ожидает' },
  { value: 'sent', label: 'Отправлено' },
  { value: 'failed', label: 'Ошибка' },
]

const EVENT_OPTIONS = [
  { value: '', label: 'Все события' },
  { value: 'cycle_started', label: 'Цикл запущен' },
  { value: 'upload_success', label: 'Загрузка прошла' },
  { value: 'critical_error', label: 'Критическая ошибка' },
  { value: 'idea_created', label: 'Идея создана' },
  { value: 'test', label: 'Тест' },
  { value: 'custom', label: 'Своё событие' },
]

const STATUS_ENTITY = {
  sent: 'done',
  failed: 'failed',
  pending: 'queued',
} as const

const filterStatus = ref('')
const filterEventType = ref('')
const page = ref(1)
const expandedId = ref<number | null>(null)
const resendingId = ref<number | null>(null)

const params = computed(() => ({
  page: page.value,
  ...(filterStatus.value && { status: filterStatus.value }),
  ...(filterEventType.value && { eventType: filterEventType.value }),
}))

const { data: raw, refresh } = useAdminTelegramDeliveries(params)

const items = computed<Delivery[]>(() => (raw.value as any)?.data ?? (raw.value as any)?.items ?? [])
const meta = computed<Meta>(() => (raw.value as any)?.meta ?? { page: 1, limit: 20, total: 0, totalPages: 1 })

const filtered = computed(() => !!filterStatus.value || !!filterEventType.value)

function setStatus(value: string | number) {
  filterStatus.value = String(value)
  page.value = 1
}

function setEventType(value: string | number) {
  filterEventType.value = String(value)
  page.value = 1
}

function chatDisplayName(d: Delivery): string {
  if (d.chat?.title) return d.chat.title
  if (d.chat?.username) return `@${d.chat.username}`
  return String(d.targetChatId)
}

function eventLabel(eventType: string): string {
  return EVENT_OPTIONS.find(o => o.value === eventType)?.label ?? eventType
}

function statusLabel(status: string): string {
  return STATUS_OPTIONS.find(o => o.value === status)?.label ?? status
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

/** Ответ Telegram → что это значит для оператора. */
function humanReadableError(error: string | null): string {
  if (!error) return ''
  if (error.includes('chat not found')) return 'Чат не найден — скорее всего бота удалили из чата'
  if (error.includes('bot was blocked')) return 'Пользователь заблокировал бота'
  if (error.includes('FLOOD_WAIT')) return 'Telegram придержал отправку: слишком часто'
  if (error.includes('Too Many Requests')) return 'Превышен лимит запросов к Telegram'
  if (error.includes('Forbidden')) return 'У бота нет прав писать в этот чат'
  if (error.includes('timeout') || error.includes('ETIMEDOUT')) return 'Telegram не ответил вовремя'
  if (error.includes('Unauthorized') || error.includes('401')) return 'Токен бота не принят'
  return error
}

function toggleExpand(id: number) {
  expandedId.value = expandedId.value === id ? null : id
}

async function handleResend(delivery: Delivery) {
  resendingId.value = delivery.id
  try {
    const res = await resendDelivery(delivery.id) as { success: boolean; error?: string }
    if (res.success) toast.success('Отправлено повторно')
    else toast.error(res.error || 'Повторная отправка не удалась')
    await refresh()
  }
  catch (e: any) {
    toast.error(e?.data?.message || e?.message || 'Не удалось отправить повторно')
  }
  finally {
    resendingId.value = null
  }
}

const COLUMNS = '156px minmax(140px,1fr) 116px minmax(0,1.4fr) 116px 32px'
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <div class="min-w-0 flex-1">
        <h3 class="text-base font-semibold">История доставок</h3>
        <p class="text-sm text-subtle">Что уходило в чаты и что из этого не дошло.</p>
      </div>
      <UiSelect class="w-44" :model-value="filterStatus" :options="STATUS_OPTIONS" @update:model-value="setStatus" />
      <UiSelect class="w-52" :model-value="filterEventType" :options="EVENT_OPTIONS" @update:model-value="setEventType" />
    </div>

    <UiEmptyState
      v-if="!items.length"
      title="Доставок нет"
      :description="filtered
        ? 'Под выбранные условия ничего не попало — снимите фильтры.'
        : 'Отправьте тестовое сообщение на вкладке «Диагностика».'"
    />

    <template v-else>
      <UiTable :columns="COLUMNS" min-width="900px">
        <UiTableHead>
          <span>Событие</span>
          <span>Чат</span>
          <span>Состояние</span>
          <span>Что не так</span>
          <span>Отправлено</span>
          <span />
        </UiTableHead>

        <template v-for="delivery in items" :key="delivery.id">
          <UiTableRow
            role="button"
            tabindex="0"
            :selected="expandedId === delivery.id"
            @click="toggleExpand(delivery.id)"
            @keydown.enter="toggleExpand(delivery.id)"
          >
            <span class="truncate text-sm">{{ eventLabel(delivery.eventType) }}</span>

            <span class="min-w-0">
              <span class="block truncate text-sm">{{ chatDisplayName(delivery) }}</span>
              <span class="block truncate font-mono text-micro text-subtle">{{ delivery.targetChatId }}</span>
            </span>

            <span class="flex items-center gap-1.5">
              <UiStatusBadge :status="STATUS_ENTITY[delivery.status] ?? 'draft'" size="xs" icon-only />
              <span class="truncate text-sm text-muted">{{ statusLabel(delivery.status) }}</span>
            </span>

            <span class="min-w-0 truncate text-sm" :class="delivery.errorMessage ? 'text-danger' : 'text-subtle'">
              {{ delivery.errorMessage ? humanReadableError(delivery.errorMessage) : (delivery.template?.title ?? '—') }}
            </span>

            <ClientOnly>
              <span class="tnum truncate font-mono text-sm text-muted">{{ formatDate(delivery.sentAt) }}</span>
              <template #fallback><span /></template>
            </ClientOnly>

            <span class="flex justify-end" @click.stop>
              <UiButton
                v-if="delivery.status === 'failed'"
                variant="ghost"
                :loading="resendingId === delivery.id"
                title="Отправить повторно"
                @click="handleResend(delivery)"
              >
                <Icon v-if="resendingId !== delivery.id" name="mingcute:refresh-2-line" />
              </UiButton>
            </span>
          </UiTableRow>

          <div
            v-if="expandedId === delivery.id"
            class="grid gap-3 border-b border-divider bg-card px-3 py-2.5 md:grid-cols-2"
          >
            <div class="flex min-w-0 flex-col gap-1">
              <span class="text-micro tracking-[.06em] text-subtle uppercase">Текст сообщения</span>
              <pre
                v-if="delivery.messageText"
                class="max-h-48 overflow-y-auto rounded-md bg-surface p-2.5 text-sm break-words whitespace-pre-wrap text-muted"
              >{{ delivery.messageText }}</pre>
              <span v-else class="text-sm text-subtle">Текст не сохранён.</span>
            </div>

            <div class="flex min-w-0 flex-col gap-2">
              <ClientOnly>
                <UiKeyValue
                  :items="[
                    { label: 'Номер', value: delivery.id },
                    { label: 'Создано', value: formatDate(delivery.createdAt) },
                    ...(delivery.telegramMessageId
                      ? [{ label: 'ID в Telegram', value: delivery.telegramMessageId }]
                      : []),
                    ...(delivery.relatedEntityType
                      ? [{ label: 'Связь', value: `${delivery.relatedEntityType}#${delivery.relatedEntityId}` }]
                      : []),
                  ]"
                />
              </ClientOnly>
              <div v-if="delivery.errorMessage" class="flex flex-col gap-1">
                <span class="text-micro tracking-[.06em] text-danger uppercase">Ответ Telegram</span>
                <pre
                  class="overflow-x-auto rounded-md bg-surface p-2.5 font-mono text-micro break-words whitespace-pre-wrap text-danger"
                >{{ delivery.errorMessage }}</pre>
              </div>
            </div>
          </div>
        </template>
      </UiTable>

      <div v-if="meta.totalPages > 1" class="flex items-center justify-center gap-2">
        <UiButton variant="ghost" :disabled="page <= 1" aria-label="Предыдущая" @click="page--">
          <Icon name="mingcute:left-line" />
        </UiButton>
        <span class="tnum font-mono text-sm text-muted">{{ meta.page }} / {{ meta.totalPages }}</span>
        <UiButton variant="ghost" :disabled="page >= meta.totalPages" aria-label="Следующая" @click="page++">
          <Icon name="mingcute:right-line" />
        </UiButton>
      </div>

      <p class="tnum text-center font-mono text-micro text-subtle">всего {{ meta.total }}</p>
    </template>
  </div>
</template>
