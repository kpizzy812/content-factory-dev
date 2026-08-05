<script setup lang="ts">
import type { EntityStatus } from '~~/shared/utils/entity-status'

/**
 * Карточка креатива — общая витрина трендов, сценариев и роликов.
 *
 * Тип сущности пишется словом, а не только иконкой: в общем списке из трёх
 * разных сущностей иконку приходится расшифровывать каждый раз.
 */
const props = defineProps<{
  type: 'trend' | 'scenario' | 'video'
  id: number
  title: string
  status: string
  platform: string | null
  createdAt: string
  appName: string | null
}>()

const TYPES = {
  trend: { label: 'Тренд', route: (id: number) => `/trends/${id}` },
  scenario: { label: 'Сценарий', route: (id: number) => `/scenarios/${id}` },
  video: { label: 'Ролик', route: (id: number) => `/videos/${id}` },
} as const

/** Статусы трёх сущностей сведены к общему словарю системы. */
const STATUS_TO_ENTITY: Record<string, EntityStatus> = {
  new: 'draft',
  draft: 'draft',
  reviewed: 'review',
  generated: 'review',
  pending: 'queued',
  in_work: 'running',
  generating_prompts: 'running',
  generating_images: 'running',
  generating_clips: 'running',
  assembling: 'running',
  selected: 'done',
  completed: 'done',
  rejected: 'cancelled',
  dismissed: 'cancelled',
  canceled: 'cancelled',
  failed: 'failed',
}

const meta = computed(() => TYPES[props.type])
const status = computed<EntityStatus>(() => STATUS_TO_ENTITY[props.status] ?? 'draft')

const formattedDate = computed(() =>
  new Date(props.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }),
)
</script>

<template>
  <NuxtLink
    :to="meta.route(id)"
    class="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 transition-colors duration-(--duration-fast) ease-out hover:border-subtle"
  >
    <div class="flex flex-wrap items-center gap-1.5">
      <span class="rounded-sm border border-border bg-panel px-1.5 text-micro text-muted">
        {{ meta.label }}
      </span>
      <UiPlatformBadge v-if="platform" :platform="platform" />
      <UiStatusBadge :status="status" size="xs" dot class="ml-auto" />
    </div>

    <h3 class="line-clamp-2 text-sm font-medium">{{ title }}</h3>

    <div class="flex items-center gap-2">
      <span v-if="appName" class="truncate text-micro text-subtle">{{ appName }}</span>
      <span class="tnum ml-auto font-mono text-micro text-subtle">{{ formattedDate }}</span>
    </div>
  </NuxtLink>
</template>
