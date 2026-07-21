<script setup lang="ts">
import type {
  AccountAgeBucket,
  WarmupSessionDto,
} from "~~/shared/types/warmup"

const props = defineProps<{
  session: WarmupSessionDto
}>()

const emit = defineEmits<{
  view: [session: WarmupSessionDto]
  cancel: [session: WarmupSessionDto]
  delete: [session: WarmupSessionDto]
}>()

const canCancel = computed(() => props.session.status === "planned")
// Удаление разрешено только для terminal-статусов (см. session-service.ts:DELETABLE_STATUSES).
// planned тоже включён, но если canCancel=true, оператор обычно сначала отменяет.
const canDelete = computed(() =>
  ["planned", "cancelled", "failed"].includes(props.session.status),
)

const bucketLabels: Record<AccountAgeBucket, string> = {
  new: "Новый",
  warming: "Прогрев",
  mature: "Зрелый",
}

const bucketBadge: Record<AccountAgeBucket, string> = {
  new: "badge-info",
  warming: "badge-warning",
  mature: "badge-success",
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec} сек`
  const m = Math.floor(sec / 60)
  return `${m} мин`
}

const totalDurationSec = computed(() => props.session.plan?.meta?.totalDurationSec ?? 0)
const actionCount = computed(() => props.session.plan?.meta?.actionCount ?? 0)
</script>

<template>
  <div class="card bg-base-100 shadow-sm card-border">
    <div class="card-body p-4 gap-2">
      <div class="flex items-start justify-between gap-2 flex-wrap">
        <div class="flex flex-col min-w-0">
          <code class="text-xs bg-base-200 px-1.5 py-0.5 rounded w-fit">
            {{ session.id.slice(0, 8) }}
          </code>
          <span class="text-sm text-base-content/60 mt-1">
            {{ session.dayKey }} ({{ formatDate(session.scheduledAt) }})
          </span>
        </div>
        <WarmupSessionStatusBadge :status="session.status" />
      </div>

      <div class="flex items-center gap-2 flex-wrap">
        <span class="badge badge-sm" :class="bucketBadge[session.ageBucket]">
          {{ bucketLabels[session.ageBucket] }}
        </span>
        <span class="badge badge-sm badge-ghost">
          <Icon name="mingcute:list-check-line" class="text-xs" />
          {{ actionCount }} действий
        </span>
        <span class="badge badge-sm badge-ghost">
          <Icon name="mingcute:time-line" class="text-xs" />
          {{ formatDuration(totalDurationSec) }}
        </span>
      </div>

      <div
        v-if="session.errorMessage"
        class="text-xs text-error flex items-start gap-1.5 mt-1"
      >
        <Icon name="mingcute:warning-line" class="text-sm shrink-0 mt-0.5" />
        <span class="break-words">{{ session.errorMessage }}</span>
      </div>

      <div class="card-actions justify-end mt-1">
        <button class="btn btn-xs btn-ghost gap-1" @click="emit('view', session)">
          <Icon name="mingcute:eye-line" class="text-sm" />
          Просмотр
        </button>
        <button
          v-if="canCancel"
          class="btn btn-xs btn-error btn-outline gap-1"
          @click="emit('cancel', session)"
        >
          <Icon name="mingcute:forbid-circle-line" class="text-sm" />
          Отменить
        </button>
        <button
          v-if="canDelete"
          class="btn btn-xs btn-ghost text-error gap-1"
          @click="emit('delete', session)"
        >
          <Icon name="mingcute:delete-2-line" class="text-sm" />
          Удалить
        </button>
      </div>
    </div>
  </div>
</template>
