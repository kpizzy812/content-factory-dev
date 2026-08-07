<script setup lang="ts">
/**
 * Разбор одной публикации: цепочка происхождения от тренда до продажи,
 * цепочка касаний и переписка автоматизации.
 *
 * Касания сшиваются по `messengerUserId`, поэтому это нижняя оценка — так и
 * подписано. Человек без опознанного идентификатора в цепочку не попадает, и
 * приписывать ему касания мы не имеем права.
 */
import type { PublicationChainResult } from '#shared/types/analytics-funnel'

const props = defineProps<{
  chain: PublicationChainResult
}>()

const toast = useToast()

const KIND_ICON: Record<string, string> = {
  trend: 'mingcute:fire-line',
  scenario: 'mingcute:document-line',
  video: 'mingcute:video-line',
  publication: 'mingcute:send-plane-line',
  result: 'mingcute:trophy-line',
}

const conversationTypes = new Set(['automation_comment', 'automation_direct', 'conversion_submitted', 'sale_attributed'])

const conversation = computed(() =>
  props.chain.events.filter(event => conversationTypes.has(event.type)).slice(0, 6),
)

/** Касания по дням — видно, как быстро публикация «остывает». */
const byDay = computed(() => {
  const counts = new Map<string, number>()
  for (const event of props.chain.events) {
    const day = event.occurredAt.slice(0, 10)
    counts.set(day, (counts.get(day) ?? 0) + 1)
  }
  const days = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
  const peak = Math.max(...days.map(([, count]) => count), 1)
  return days.map(([day, count]) => ({ day, count, share: count / peak }))
})

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

async function copyToken() {
  if (!props.chain.trackingToken) return
  try {
    await navigator.clipboard.writeText(props.chain.trackingToken)
    toast.success('Tracking token скопирован')
  } catch {
    toast.error('Буфер обмена недоступен')
  }
}
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-border bg-panel">
    <header class="flex flex-wrap items-center gap-2.5 border-b border-border bg-card px-3.5 py-2.5">
      <span class="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{{ chain.title }}</span>
      <button
        v-if="chain.trackingToken"
        type="button"
        class="inline-flex h-5.5 items-center gap-1.5 rounded-sm border border-border bg-panel px-2 font-mono text-micro text-muted hover:text-fg"
        @click="copyToken"
      >
        {{ chain.trackingToken }}
        <Icon name="mingcute:copy-2-line" />
      </button>
      <NuxtLink :to="`/analytics/${chain.uploadId}`" class="text-micro">Метрики публикации</NuxtLink>
    </header>

    <div
      v-if="!chain.hasPublication"
      class="flex items-start gap-2 border-b border-divider bg-card px-3.5 py-2 text-sm text-muted"
    >
      <Icon name="mingcute:information-line" class="mt-0.5 shrink-0" />
      <span>
        Публикация не заведена в фабричном контуре: tracking token ей не
        выдавался, событий атрибуции по ней нет и быть не может.
      </span>
    </div>

    <div
      v-else
      class="flex flex-wrap items-center gap-2 border-b border-divider bg-card px-3.5 py-2 text-sm"
    >
      <span class="text-muted">Касаний до заявки:</span>
      <span class="tnum font-mono">{{ chain.touchCount ?? '—' }}</span>
      <template v-if="chain.firstTouch">
        <span class="text-subtle">·</span>
        <span class="text-muted">первое</span>
        <span class="tnum">{{ formatTime(chain.firstTouch.occurredAt) }}</span>
      </template>
      <template v-if="chain.lastTouch">
        <span class="text-subtle">·</span>
        <span class="text-muted">последнее</span>
        <span class="tnum">{{ formatTime(chain.lastTouch.occurredAt) }}</span>
      </template>
      <span class="ml-auto text-[11px] text-subtle">
        нижняя оценка: сшивается только опознанный messengerUserId
      </span>
    </div>

    <div class="flex items-stretch gap-2 overflow-x-auto border-b border-divider px-3.5 py-3">
      <template v-for="(step, index) in chain.chain" :key="step.kind">
        <component
          :is="step.href ? 'NuxtLink' : 'div'"
          :to="step.href ?? undefined"
          class="min-w-[150px] flex-1 rounded-md border px-2.5 py-2.5"
          :class="step.kind === 'result'
            ? 'border-success-border bg-success-bg'
            : 'border-border bg-card hover:border-subtle'"
        >
          <div
            class="flex items-center gap-1.5 text-[10.5px] tracking-[.06em] uppercase"
            :class="step.kind === 'result' ? 'text-success' : 'text-subtle'"
          >
            <Icon :name="KIND_ICON[step.kind] ?? 'mingcute:dot-line'" />
            {{ step.label }}
          </div>
          <div class="mt-1 truncate text-sm">{{ step.title }}</div>
          <div v-if="step.meta" class="tnum mt-1 truncate font-mono text-[10.5px] text-subtle">
            {{ step.meta }}
          </div>
        </component>
        <Icon
          v-if="index < chain.chain.length - 1"
          name="mingcute:arrow-right-line"
          class="shrink-0 self-center text-subtle"
        />
      </template>
    </div>

    <div class="grid gap-0 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div class="border-b border-divider px-3.5 py-3 lg:border-r lg:border-b-0">
        <div class="mb-2 text-[11px] tracking-[.06em] text-subtle uppercase">Касания по дням</div>
        <UiEmptyState
          v-if="!byDay.length"
          title="Касаний нет"
          description="События приходят из мессенджера и conversion sink."
        />
        <div v-else class="flex h-[88px] items-end gap-1.5">
          <div
            v-for="day in byDay"
            :key="day.day"
            class="flex flex-1 flex-col justify-end gap-0.5"
            :title="`${day.day} · событий ${day.count}`"
          >
            <span
              class="rounded-t-[2px] bg-accent"
              :style="{ height: `${Math.max(day.share * 78, 4)}px` }"
            />
            <span class="text-center font-mono text-[10px] text-subtle">
              {{ Number(day.day.slice(8)) }}
            </span>
          </div>
        </div>
      </div>

      <div class="px-3.5 py-3">
        <div class="mb-2 text-[11px] tracking-[.06em] text-subtle uppercase">Комментарии и Direct</div>
        <UiEmptyState
          v-if="!conversation.length"
          title="Переписки нет"
          description="Здесь появляются ответы автоматизации и заявки."
        />
        <ul v-else class="flex flex-col gap-2">
          <li v-for="(event, index) in conversation" :key="index" class="flex gap-2.5 text-sm">
            <span class="mt-0.5 h-5.5 w-5.5 shrink-0 rounded-full border border-border bg-card" />
            <span class="min-w-0">
              <span class="font-mono text-[11px] text-muted">{{ event.label }}</span>
              <span v-if="event.payloadText"> · {{ event.payloadText }}</span>
              <span
                v-if="event.type === 'sale_attributed'"
                class="ml-1.5 inline-flex h-[17px] items-center rounded-sm border border-success-border bg-success-bg px-1.5 align-middle text-[10.5px] text-success"
              >
                продажа
              </span>
            </span>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>
