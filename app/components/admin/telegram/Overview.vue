<script setup lang="ts">
/**
 * Обзор Telegram-интеграции.
 * Источник: design-preview/catalog/08-settings-admin.dc.html — карточка
 * интеграции в состоянии «отвалилась» и панель правил уведомлений.
 *
 * Предупреждения собраны в одну колонку и не расползаются по экрану: важно не
 * то, сколько их, а что делать. У тех, что чинятся перезапуском, кнопка стоит
 * прямо в строке.
 */
interface TelegramStatus {
  configured: boolean
  transportMode: string
  botInfo: { username?: string; firstName?: string } | null
  health: {
    running: boolean
    lastSuccessfulUpdate: string | null
    lastError: string | null
    lastErrorCategory: 'conflict' | 'auth' | 'network' | 'unknown' | null
    lastSuccessfulSend: string | null
    lastFailedSend: { at: string; error: string | null } | null
  }
  chats: { total: number; alertsEnabled: number; items: Array<Record<string, unknown>> }
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

const props = defineProps<{ status: TelegramStatus | null }>()

const emit = defineEmits<{
  'test-api': []
  'navigate': [tab: string]
}>()

const toast = useToast()
const { restartBot } = useAdminTelegramActions()

const restarting = ref(false)

/** «Сейчас» после монтирования: относительное время расходится при гидратации. */
const now = ref<number | null>(null)
onMounted(() => { now.value = Date.now() })

const d = computed(() => props.status)

async function handleRestart() {
  restarting.value = true
  try {
    await restartBot()
    toast.success('Бот перезапущен — состояние обновится через несколько секунд')
  }
  catch (e: any) {
    toast.error(e?.data?.message || e?.message || 'Не удалось перезапустить бота')
  }
  finally {
    restarting.value = false
  }
}

/** Что мешает работе. Каждая строка — про то, что делать, а не про факт. */
interface Warning {
  text: string
  restartable?: boolean
}

const warnings = computed<Warning[]>(() => {
  const list: Warning[] = []
  const s = d.value
  if (!s) return list
  if (!s.configured) list.push({ text: 'Токен бота не задан в окружении — интеграция выключена целиком' })
  if (!s.health.running) list.push({ text: 'Опрос остановлен: бот не получает сообщений', restartable: true })
  if (s.health.lastError) {
    list.push(s.health.lastErrorCategory === 'conflict'
      ? { text: 'Тот же бот опрашивается другим процессом. Обычно это остаток предыдущего запуска сервера', restartable: true }
      : { text: `Ошибка опроса: ${s.health.lastError}` })
  }
  if (s.chats.total === 0) list.push({ text: 'Чатов нет — уведомлениям некуда уходить' })
  else if (s.chats.alertsEnabled === 0) list.push({ text: 'Ни у одного чата не включены уведомления' })
  if (now.value && s.health.lastSuccessfulUpdate) {
    const diff = now.value - new Date(s.health.lastSuccessfulUpdate).getTime()
    if (diff > 60_000) list.push({ text: 'Обновлений не было больше минуты', restartable: true })
  }
  return list
})

const healthy = computed(() => !!d.value && warnings.value.length === 0)

const TILES = [
  { key: 'chats', label: 'Чатов', tab: 'chats', tone: 'text-fg' },
  { key: 'alerts', label: 'С уведомлениями', tab: 'chats', tone: 'text-success' },
  { key: 'deliveries', label: 'Доставок', tab: 'deliveries', tone: 'text-fg' },
  { key: 'failed', label: 'Не доставлено', tab: 'deliveries', tone: 'text-danger' },
] as const

const tileValues = computed(() => ({
  chats: d.value?.chats.total ?? 0,
  alerts: d.value?.chats.alertsEnabled ?? 0,
  deliveries: d.value?.deliveries.total ?? 0,
  failed: d.value?.deliveries.failed ?? 0,
}))

const recentDeliveries = computed(() => d.value?.deliveries.recent.slice(0, 6) ?? [])

function timeAgo(date: string | null): string {
  if (!date) return 'никогда'
  if (!now.value) return '…'
  const diff = now.value - new Date(date).getTime()
  if (diff < 60_000) return 'только что'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин назад`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ч назад`
  return `${Math.floor(diff / 86_400_000)} дн назад`
}

function chatName(item: { targetChatId: string | number; chat?: { title: string | null; username: string | null } | null }): string {
  if (item.chat?.title) return item.chat.title
  if (item.chat?.username) return `@${item.chat.username}`
  return String(item.targetChatId)
}

const DELIVERY_TONE: Record<string, string> = {
  sent: 'border-success-border bg-success-bg text-success',
  failed: 'border-danger-border bg-danger-bg text-danger',
}

const DELIVERY_LABEL: Record<string, string> = {
  sent: 'доставлено',
  failed: 'не дошло',
  pending: 'в очереди',
}

function formatWhen(value: string): string {
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}
</script>

<template>
  <div v-if="d" class="flex flex-col gap-3">
    <section
      class="overflow-hidden rounded-lg border bg-panel"
      :class="healthy ? 'border-border' : 'border-danger-border'"
    >
      <div class="flex flex-wrap items-center gap-2.5 border-b border-divider px-3.5 py-2.5">
        <span class="flex size-[30px] shrink-0 items-center justify-center rounded-md border border-border bg-card">
          <Icon name="mingcute:telegram-line" class="text-info" />
        </span>
        <span class="min-w-0">
          <span class="block truncate font-medium">{{ d.botInfo?.firstName ?? 'Бот не подключён' }}</span>
          <span v-if="d.botInfo?.username" class="block truncate font-mono text-micro text-subtle">
            @{{ d.botInfo.username }}
          </span>
        </span>

        <span
          class="inline-flex h-5 items-center gap-1.5 rounded-sm border px-[7px] text-sm"
          :class="healthy
            ? 'border-success-border bg-success-bg text-success'
            : 'border-danger-border bg-danger-bg text-danger'"
        >
          <span class="size-1.5 rounded-full bg-current" />
          {{ healthy ? 'работает' : 'нужна починка' }}
        </span>

        <span class="flex-1" />

        <UiButton v-if="!d.health.running || d.health.lastError" :loading="restarting" @click="handleRestart">
          <Icon v-if="!restarting" name="mingcute:refresh-2-line" />
          Перезапустить бота
        </UiButton>
        <UiButton @click="emit('test-api')">
          <Icon name="mingcute:radar-line" />
          Диагностика
        </UiButton>
      </div>

      <div class="grid gap-x-6 gap-y-2 px-3.5 py-3 sm:grid-cols-2 lg:grid-cols-4">
        <span>
          <span class="block text-micro text-subtle">Транспорт</span>
          <span class="block font-mono text-sm">{{ d.transportMode }}</span>
        </span>
        <span>
          <span class="block text-micro text-subtle">Последнее обновление</span>
          <ClientOnly>
            <span class="block text-sm">{{ timeAgo(d.health.lastSuccessfulUpdate) }}</span>
            <template #fallback><span class="block text-sm text-subtle">…</span></template>
          </ClientOnly>
        </span>
        <span>
          <span class="block text-micro text-subtle">Последняя отправка</span>
          <ClientOnly>
            <span class="block text-sm">{{ timeAgo(d.health.lastSuccessfulSend) }}</span>
            <template #fallback><span class="block text-sm text-subtle">…</span></template>
          </ClientOnly>
        </span>
        <span>
          <span class="block text-micro text-subtle">Последняя ошибка отправки</span>
          <ClientOnly>
            <span class="block text-sm" :class="d.health.lastFailedSend && 'text-danger'">
              {{ d.health.lastFailedSend ? timeAgo(d.health.lastFailedSend.at) : 'не было' }}
            </span>
            <template #fallback><span class="block text-sm text-subtle">…</span></template>
          </ClientOnly>
        </span>
      </div>

      <div v-if="warnings.length" class="flex flex-col gap-1.5 border-t border-divider px-3.5 py-3">
        <p
          v-for="(w, i) in warnings"
          :key="i"
          class="flex flex-wrap items-center gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-1.5 text-sm text-fg"
        >
          <Icon name="mingcute:alert-line" class="shrink-0 text-warning" />
          <span class="min-w-0 flex-1">{{ w.text }}</span>
          <UiButton v-if="w.restartable" variant="ghost" :loading="restarting" @click="handleRestart">
            Перезапустить
          </UiButton>
        </p>

        <p
          v-if="d.health.lastFailedSend?.error"
          class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-1.5 font-mono text-micro text-fg"
        >
          <Icon name="mingcute:close-circle-line" class="mt-0.5 shrink-0 text-danger" />
          <span class="min-w-0 flex-1 break-words">{{ d.health.lastFailedSend.error }}</span>
        </p>
      </div>
    </section>

    <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <button
        v-for="tile in TILES"
        :key="tile.key"
        type="button"
        class="cursor-pointer rounded-lg border border-border bg-panel px-3 py-2.5 text-left hover:bg-card"
        @click="emit('navigate', tile.tab)"
      >
        <span class="tnum block font-mono text-2xl font-semibold" :class="tile.tone">
          {{ tileValues[tile.key] }}
        </span>
        <span class="block text-sm text-muted">{{ tile.label }}</span>
      </button>
    </div>

    <section class="overflow-hidden rounded-lg border border-border bg-panel">
      <div class="flex items-center gap-2 border-b border-divider bg-card px-3.5 py-2.5">
        <h2 class="text-base font-medium">Последние доставки</h2>
        <span class="flex-1" />
        <button
          v-if="recentDeliveries.length"
          type="button"
          class="cursor-pointer text-sm text-accent-text"
          @click="emit('navigate', 'deliveries')"
        >
          Все доставки
        </button>
      </div>

      <UiEmptyState
        v-if="!recentDeliveries.length"
        class="m-3.5"
        title="Доставок ещё не было"
        description="Отправьте тестовое сообщение на вкладке «Диагностика» — оно появится здесь."
      />

      <div
        v-for="item in recentDeliveries"
        v-else
        :key="item.id"
        class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-divider px-3.5 py-2 text-sm last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_100px_112px]"
      >
        <span class="truncate font-mono text-micro text-muted">{{ item.eventType }}</span>
        <span class="truncate">{{ chatName(item) }}</span>
        <span
          class="inline-flex h-[18px] w-fit items-center rounded-sm border px-1.5 text-micro"
          :class="DELIVERY_TONE[item.status] ?? 'border-border bg-card text-muted'"
        >{{ DELIVERY_LABEL[item.status] ?? item.status }}</span>
        <ClientOnly>
          <span class="tnum font-mono text-micro text-subtle sm:text-right">
            {{ formatWhen(item.sentAt ?? item.createdAt) }}
          </span>
        </ClientOnly>
        <span v-if="item.errorMessage" class="col-span-full truncate text-micro text-danger">
          {{ item.errorMessage }}
        </span>
      </div>
    </section>
  </div>
</template>
