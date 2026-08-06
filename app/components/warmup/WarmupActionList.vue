<script setup lang="ts">
import type { WarmupAction, WarmupActionKind } from '~~/shared/types/warmup'

/**
 * План прогрева по шагам.
 *
 * `mingcute:scroll-line` в наборе нет — иконка скролла молча не рисовалась;
 * заменена на `mingcute:align-arrow-down-line`.
 */
defineProps<{
  actions: WarmupAction[]
  /** Показать только первые N шагов. */
  limit?: number
}>()

const ICONS: Record<WarmupActionKind, string> = {
  view: 'mingcute:eye-line',
  scroll: 'mingcute:align-arrow-down-line',
  like: 'mingcute:heart-line',
  follow: 'mingcute:user-add-line',
  comment: 'mingcute:chat-2-line',
  share: 'mingcute:share-2-line',
  save: 'mingcute:bookmark-line',
}

const LABELS: Record<WarmupActionKind, string> = {
  view: 'Просмотр',
  scroll: 'Скролл',
  like: 'Лайк',
  follow: 'Подписка',
  comment: 'Комментарий',
  share: 'Репост',
  save: 'Сохранение',
}

const TONES: Record<WarmupActionKind, string> = {
  view: 'text-info',
  scroll: 'text-subtle',
  like: 'text-danger',
  follow: 'text-success',
  comment: 'text-accent-text',
  share: 'text-muted',
  save: 'text-warning',
}

function describeDetails(action: WarmupAction): string {
  switch (action.kind) {
    case 'view':
      return `по ключу «${action.keyword}»`
    case 'scroll':
      return `около ${action.itemCount} постов`
    case 'follow':
      return `категория ${action.targetCategory}`
    case 'comment':
      return `«${action.text}» · ${action.language}`
    default:
      return ''
  }
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec} с`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s > 0 ? `${m} мин ${s} с` : `${m} мин`
}
</script>

<template>
  <div>
    <ol class="flex flex-col">
      <li
        v-for="action in (limit ? actions.slice(0, limit) : actions)"
        :key="action.index"
        class="flex items-start gap-2.5 border-b border-divider py-1.5 last:border-b-0"
      >
        <Icon :name="ICONS[action.kind]" class="mt-0.5 shrink-0" :class="TONES[action.kind]" />
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <span class="tnum font-mono text-micro text-subtle">{{ action.index + 1 }}</span>
            <span class="font-medium">{{ LABELS[action.kind] }}</span>
            <span class="tnum rounded-sm border border-border bg-card px-1.5 font-mono text-micro text-muted">
              {{ formatDuration(action.durationSec) }}
            </span>
          </div>
          <p v-if="describeDetails(action)" class="truncate text-micro text-subtle">
            {{ describeDetails(action) }}
          </p>
        </div>
      </li>
    </ol>
    <p v-if="limit && actions.length > limit" class="mt-2 text-center text-micro text-subtle">
      и ещё {{ actions.length - limit }} действий
    </p>
  </div>
</template>
