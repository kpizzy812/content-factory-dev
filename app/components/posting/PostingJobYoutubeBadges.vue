<script setup lang="ts">
/**
 * Отметки задачи YouTube: короткий формат, кто увидит ролик и «для детей».
 * Если снимок содержимого не от YouTube, компонент не рисует ничего.
 */
import { extractYoutubeSnapshot } from '~~/shared/types/posting-youtube'
import type { PostingJobDto } from '~~/shared/types/posting-job'

const props = defineProps<{ job: PostingJobDto }>()

const snapshot = computed(() => extractYoutubeSnapshot(props.job))

/**
 * Признак Shorts приходит либо прямо в снимке, либо выводится из длительности:
 * вертикальный ролик короче минуты YouTube показывает как Shorts.
 */
const isShorts = computed<boolean>(() => {
  const raw = props.job.contentSnapshot as Record<string, unknown>
  const youtube = raw.youtube as Record<string, unknown> | undefined
  if (youtube && typeof youtube.isShorts === 'boolean') return youtube.isShorts
  const v = props.job.video
  if (!v || typeof v.duration !== 'number') return false
  return v.duration > 0 && v.duration < 60
})

const VISIBILITY = {
  public: {
    label: 'видят все',
    icon: 'mingcute:earth-line',
    tone: 'border-danger-border bg-danger-bg text-danger',
    tooltip: 'Ролик открыт всем и попадает в поиск YouTube',
  },
  unlisted: {
    label: 'по ссылке',
    icon: 'mingcute:link-line',
    tone: 'border-info-border bg-info-bg text-info',
    tooltip: 'Открывается только по прямой ссылке',
  },
  private: {
    label: 'только владельцу',
    icon: 'mingcute:lock-line',
    tone: 'border-warning-border bg-warning-bg text-warning',
    tooltip: 'Виден владельцу канала и приглашённым',
  },
} as const
</script>

<template>
  <div v-if="snapshot" class="flex flex-wrap items-center gap-1.5">
    <span
      v-if="isShorts"
      class="flex h-[18px] items-center gap-1 rounded-sm border border-accent-border bg-accent-bg px-1.5 text-micro"
      title="Вертикальный ролик короче минуты — YouTube покажет его как Shorts"
    >
      Shorts
    </span>
    <UiTooltip :text="VISIBILITY[snapshot.youtube.visibility].tooltip" placement="bottom">
      <span
        class="flex h-[18px] items-center gap-1 rounded-sm border px-1.5 text-micro"
        :class="VISIBILITY[snapshot.youtube.visibility].tone"
      >
        <Icon :name="VISIBILITY[snapshot.youtube.visibility].icon" />
        {{ VISIBILITY[snapshot.youtube.visibility].label }}
      </span>
    </UiTooltip>
    <span
      v-if="snapshot.youtube.madeForKids"
      class="flex h-[18px] items-center gap-1 rounded-sm border border-border bg-card px-1.5 text-micro text-muted"
      title="Ролик помечен как сделанный для детей"
    >
      <Icon name="mingcute:baby-line" />
      для детей
    </span>
  </div>
</template>
