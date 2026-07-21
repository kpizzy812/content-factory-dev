<script setup lang="ts">
/**
 * Бейджи на карточке PostingJob для YouTube job: isShorts (если true),
 * visibility (цветом — public/unlisted/private), madeForKids (если true).
 *
 * Source: contentSnapshot.youtube.visibility, contentSnapshot.youtube.madeForKids.
 * isShorts источник: contentSnapshot.youtube.isShorts ИЛИ video.format===portrait
 * + duration<60 (но обычно poster записывает в snapshot, см. worker.ts).
 *
 * Если snapshot невалиден (старая структура / TikTok/IG job) — компонент рендерит
 * пустой fragment без ошибок.
 */
import { extractYoutubeSnapshot } from "~~/shared/types/posting-youtube"
import type { PostingJobDto } from "~~/shared/types/posting-job"

const props = defineProps<{
  job: PostingJobDto
}>()

const snapshot = computed(() => extractYoutubeSnapshot(props.job))

// isShorts может прийти двумя путями:
//  1. В snapshot если бэк его туда положит (на будущее)
//  2. Из video.duration < 60 + format===portrait (косвенно)
const isShorts = computed<boolean>(() => {
  const raw = props.job.contentSnapshot as Record<string, unknown>
  const youtube = raw.youtube as Record<string, unknown> | undefined
  if (youtube && typeof youtube.isShorts === "boolean") {
    return youtube.isShorts
  }
  // Косвенный путь через video summary (если есть).
  const v = props.job.video
  if (!v || typeof v.duration !== "number") return false
  return v.duration > 0 && v.duration < 60
})

const VISIBILITY_CONFIG = {
  public: {
    label: "Публично",
    icon: "mingcute:earth-line",
    badgeClass: "badge-error",
    tooltip: "Доступно всем — opened для поиска YouTube",
  },
  unlisted: {
    label: "По ссылке",
    icon: "mingcute:link-line",
    badgeClass: "badge-info",
    tooltip: "Только по прямой ссылке, не в поиске",
  },
  private: {
    label: "Приватно",
    icon: "mingcute:lock-line",
    badgeClass: "badge-warning",
    tooltip: "Только владелец канала",
  },
} as const
</script>

<template>
  <div v-if="snapshot" class="flex flex-wrap items-center gap-1.5">
    <span
      v-if="isShorts"
      class="badge badge-xs badge-primary gap-1"
      title="Видео определено как YouTube Shorts (вертикаль <60с)"
    >
      <Icon name="mingcute:youtube-line" class="text-xs" />
      Shorts
    </span>
    <span
      class="tooltip tooltip-bottom"
      :data-tip="VISIBILITY_CONFIG[snapshot.youtube.visibility].tooltip"
    >
      <span
        class="badge badge-xs gap-1"
        :class="VISIBILITY_CONFIG[snapshot.youtube.visibility].badgeClass"
      >
        <Icon
          :name="VISIBILITY_CONFIG[snapshot.youtube.visibility].icon"
          class="text-xs"
        />
        {{ VISIBILITY_CONFIG[snapshot.youtube.visibility].label }}
      </span>
    </span>
    <span
      v-if="snapshot.youtube.madeForKids"
      class="badge badge-xs badge-accent gap-1"
      title="Видео помечено как 'для детей'"
    >
      <Icon name="mingcute:baby-line" class="text-xs" />
      Для детей
    </span>
  </div>
</template>
