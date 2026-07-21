<script setup lang="ts">
import type { WarmupAction, WarmupActionKind } from "~~/shared/types/warmup"

defineProps<{
  actions: WarmupAction[]
  /** Опционально лимитировать показ. */
  limit?: number
}>()

const ICONS: Record<WarmupActionKind, string> = {
  view: "mingcute:eye-line",
  scroll: "mingcute:scroll-line",
  like: "mingcute:heart-line",
  follow: "mingcute:user-add-line",
  comment: "mingcute:chat-2-line",
  share: "mingcute:share-2-line",
  save: "mingcute:bookmark-line",
}

const LABELS: Record<WarmupActionKind, string> = {
  view: "Просмотр",
  scroll: "Скролл",
  like: "Лайк",
  follow: "Подписка",
  comment: "Комментарий",
  share: "Поделиться",
  save: "Сохранение",
}

const COLORS: Record<WarmupActionKind, string> = {
  view: "text-info",
  scroll: "text-base-content/60",
  like: "text-error",
  follow: "text-success",
  comment: "text-primary",
  share: "text-secondary",
  save: "text-warning",
}

function describeDetails(action: WarmupAction): string {
  switch (action.kind) {
    case "view":
      return `по ключу «${action.keyword}»`
    case "scroll":
      return `~${action.itemCount} постов`
    case "follow":
      return `категория ${action.targetCategory}`
    case "comment":
      return `«${action.text}» (${action.language})`
    default:
      return ""
  }
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec} сек`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s > 0 ? `${m} мин ${s} сек` : `${m} мин`
}
</script>

<template>
  <ul class="timeline timeline-vertical timeline-compact text-sm">
    <li
      v-for="(action, idx) in (limit ? actions.slice(0, limit) : actions)"
      :key="action.index"
    >
      <hr v-if="idx > 0" class="bg-base-300" />
      <div class="timeline-middle">
        <Icon :name="ICONS[action.kind]" class="text-lg" :class="COLORS[action.kind]" />
      </div>
      <div class="timeline-end ms-2 pb-3">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-xs text-base-content/40">#{{ action.index + 1 }}</span>
          <span class="font-medium">{{ LABELS[action.kind] }}</span>
          <span class="badge badge-sm badge-ghost">
            {{ formatDuration(action.durationSec) }}
          </span>
        </div>
        <p
          v-if="describeDetails(action)"
          class="text-xs text-base-content/60 truncate"
        >
          {{ describeDetails(action) }}
        </p>
      </div>
      <hr v-if="idx < actions.length - 1" class="bg-base-300" />
    </li>
  </ul>
  <p
    v-if="limit && actions.length > limit"
    class="text-xs text-base-content/50 text-center mt-2"
  >
    + ещё {{ actions.length - limit }} действий
  </p>
</template>
