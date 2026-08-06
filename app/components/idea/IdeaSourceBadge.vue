<script setup lang="ts">
import { IDEA_SOURCE_LABELS, IDEA_SYNC_LABELS } from './IdeaStatusMap'

/**
 * Откуда пришла идея и в каком она состоянии синхронизации.
 * Ни то, ни другое не статус сущности — общий словарь тут не подходит,
 * поэтому берём из системы только тон.
 */
defineProps<{
  source: string
  syncStatus?: string | null
  externalId?: number | null
}>()

const SOURCE_ICON: Record<string, string> = {
  manual: 'mingcute:edit-line',
  telegram: 'mingcute:telegram-line',
  pipeline: 'mingcute:settings-3-line',
  marketingcamp: 'mingcute:arrow-right-down-line',
}

const SYNC_TONE: Record<string, string> = {
  synced: 'border-success-border bg-success-bg text-success',
  conflict: 'border-warning-border bg-warning-bg text-warning',
  error: 'border-danger-border bg-danger-bg text-danger',
  pending_export: 'border-info-border bg-info-bg text-info',
  pending_import: 'border-info-border bg-info-bg text-info',
}
</script>

<template>
  <span class="inline-flex items-center gap-1 rounded-sm border border-divider px-1.5 py-0.5 text-micro text-muted">
    <Icon :name="SOURCE_ICON[source] ?? 'mingcute:question-line'" class="shrink-0" />
    {{ IDEA_SOURCE_LABELS[source] ?? source }}
  </span>

  <span
    v-if="syncStatus && syncStatus !== 'none' && IDEA_SYNC_LABELS[syncStatus]"
    class="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-micro"
    :class="SYNC_TONE[syncStatus] ?? 'border-divider text-muted'"
  >
    <Icon name="mingcute:refresh-2-line" class="shrink-0" />
    {{ IDEA_SYNC_LABELS[syncStatus] }}
  </span>
</template>
