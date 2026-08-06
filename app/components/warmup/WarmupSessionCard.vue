<script setup lang="ts">
import type { AccountAgeBucket, WarmupSessionDto } from '~~/shared/types/warmup'

const props = defineProps<{ session: WarmupSessionDto }>()

const emit = defineEmits<{
  view: [session: WarmupSessionDto]
  cancel: [session: WarmupSessionDto]
  delete: [session: WarmupSessionDto]
}>()

const canCancel = computed(() => props.session.status === 'planned')
/** Удаление разрешено только у завершённых состояний — как на сервере. */
const canDelete = computed(() => ['planned', 'cancelled', 'failed'].includes(props.session.status))

const BUCKET_LABELS: Record<AccountAgeBucket, string> = {
  new: 'Новый аккаунт',
  warming: 'На прогреве',
  mature: 'Зрелый',
}

const BUCKET_TONE: Record<AccountAgeBucket, string> = {
  new: 'border-info-border bg-info-bg text-info',
  warming: 'border-warning-border bg-warning-bg text-warning',
  mature: 'border-success-border bg-success-bg text-success',
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec} с`
  return `${Math.floor(sec / 60)} мин`
}

const totalDurationSec = computed(() => props.session.plan?.meta?.totalDurationSec ?? 0)
const actionCount = computed(() => props.session.plan?.meta?.actionCount ?? 0)
</script>

<template>
  <div class="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
    <div class="flex flex-wrap items-start gap-2">
      <div class="flex min-w-0 flex-1 flex-col">
        <code class="w-fit rounded-sm bg-surface px-1.5 py-0.5 font-mono text-micro">{{ session.id.slice(0, 8) }}</code>
        <span class="tnum mt-1 font-mono text-micro text-subtle">
          {{ session.dayKey }} · {{ formatDate(session.scheduledAt) }}
        </span>
      </div>
      <WarmupSessionStatusBadge :status="session.status" size="xs" />
    </div>

    <div class="flex flex-wrap items-center gap-1.5">
      <span class="rounded-sm border px-1.5 py-0.5 text-micro" :class="BUCKET_TONE[session.ageBucket]">
        {{ BUCKET_LABELS[session.ageBucket] }}
      </span>
      <span class="tnum flex items-center gap-1 rounded-sm border border-border bg-panel px-1.5 py-0.5 text-micro text-muted">
        <Icon name="mingcute:list-check-line" />
        {{ actionCount }} действий
      </span>
      <span class="tnum flex items-center gap-1 rounded-sm border border-border bg-panel px-1.5 py-0.5 text-micro text-muted">
        <Icon name="mingcute:time-line" />
        {{ formatDuration(totalDurationSec) }}
      </span>
    </div>

    <p v-if="session.errorMessage" class="flex items-start gap-1.5 text-micro text-danger">
      <Icon name="mingcute:warning-line" class="mt-0.5 shrink-0" />
      <span class="break-words">{{ session.errorMessage }}</span>
    </p>

    <div class="flex flex-wrap justify-end gap-2">
      <UiButton variant="ghost" @click="emit('view', session)">
        <Icon name="mingcute:eye-line" />
        План
      </UiButton>
      <UiButton v-if="canCancel" @click="emit('cancel', session)">
        <Icon name="mingcute:forbid-circle-line" />
        Отменить
      </UiButton>
      <UiButton v-if="canDelete" variant="danger" @click="emit('delete', session)">
        <Icon name="mingcute:delete-2-line" />
        Удалить
      </UiButton>
    </div>
  </div>
</template>
