<script setup lang="ts">
import type { PostingJobDto } from '~~/shared/types/posting-job'
import { platformMeta } from '~/components/ui/platform-meta'
import { POSTING_ERROR_LABELS, POSTING_STATUS_LABELS } from './PostingStatusMap'

/**
 * Разбор одной задачи постинга без ухода со списка.
 *
 * Причина ошибки показана категорией, а не только текстом платформы: категория
 * отвечает на главный вопрос — повторится задача сама или ждёт человека.
 */
const props = defineProps<{ job: PostingJobDto }>()

function fmt(iso: string | null | undefined) {
  if (!iso) return null
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function fmtDuration(ms: number | null) {
  if (!ms) return null
  if (ms < 1000) return `${ms} мс`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} с`
  return `${Math.floor(s / 60)} мин ${s % 60} с`
}

const account = computed(() => props.job.socialAccount)

const facts = computed(() => [
  { label: 'Аккаунт', value: account.value?.displayName ?? `#${props.job.socialAccountId}` },
  { label: 'Платформа', value: platformMeta(props.job.platform).label, mono: false },
  { label: 'Метод', value: account.value?.postingMethod === 'browser_automation' ? 'через устройство' : 'официальный API', mono: false },
  { label: 'Запланирована', value: fmt(props.job.scheduledAt) },
  { label: 'Создана', value: fmt(props.job.createdAt) },
  { label: 'Начата', value: fmt(props.job.startedAt) },
  { label: 'Закончена', value: fmt(props.job.finishedAt) },
  { label: 'Длительность', value: fmtDuration(props.job.durationMs) },
  { label: 'Попытки', value: `${props.job.attemptCount} из ${props.job.maxAttempts}` },
  { label: 'Следующий повтор', value: fmt(props.job.retryAt) },
  ...(props.job.video?.id ? [{ label: 'Ролик', value: `Ролик ${props.job.video.id}`, to: `/videos/${props.job.video.id}`, mono: false }] : []),
  ...(props.job.uploadId ? [{ label: 'Публикация', value: `Разбор ${props.job.uploadId}`, to: `/uploads/${props.job.uploadId}`, mono: false }] : []),
])

const errorLabel = computed(() =>
  props.job.errorCategory ? POSTING_ERROR_LABELS[props.job.errorCategory] ?? props.job.errorCategory : null,
)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center gap-2">
      <PostingJobStatusBadge :status="job.status" />
      <PostingJobYoutubeBadges v-if="job.platform === 'youtube'" :job="job" />
      <span v-if="job.cancelReason" class="text-sm text-subtle">снята: {{ job.cancelReason }}</span>
    </div>

    <section
      v-if="job.lastError"
      class="flex flex-col gap-2 rounded-md border border-danger-border bg-danger-bg p-2.5 text-sm"
    >
      <div class="flex items-start gap-2">
        <Icon name="mingcute:warning-line" class="mt-0.5 shrink-0 text-danger" />
        <div class="min-w-0">
          <div class="font-medium">
            {{ errorLabel ?? 'Ошибка публикации' }}
          </div>
          <p class="break-words text-muted">{{ job.lastError }}</p>
          <p v-if="job.lastErrorPhase" class="font-mono text-micro text-subtle">
            упало на шаге {{ job.lastErrorPhase }}
          </p>
        </div>
      </div>
      <p v-if="job.status === 'retry_queued'" class="text-muted">
        Повтор произойдёт сам{{ job.retryAt ? ` — ${fmt(job.retryAt)}` : '' }}.
      </p>
    </section>

    <section
      v-if="account?.postingMethod === 'browser_automation'"
      class="flex flex-col gap-1.5 rounded-md border border-border bg-card p-2.5 text-sm"
    >
      <div class="flex items-center gap-2 font-medium">
        <Icon name="mingcute:cellphone-line" class="shrink-0 text-warning" />
        Публикация через устройство
      </div>
      <UiKeyValue
        :items="[
          { label: 'Устройство', value: account.device?.deviceName ?? 'не привязано', mono: false },
          { label: 'Прокси', value: account.proxy ? `${account.proxy.label} · ${account.proxy.status}` : 'не привязан', mono: false },
        ]"
        label-width="120px"
      />
      <p class="text-micro text-subtle">Запуск устройства тарифицируется поминутно.</p>
    </section>

    <section>
      <h3 class="mb-2 text-micro tracking-[.06em] text-subtle uppercase">Свойства</h3>
      <UiKeyValue :items="facts" label-width="150px" />
    </section>

    <section v-if="job.platformPostUrl">
      <h3 class="mb-2 text-micro tracking-[.06em] text-subtle uppercase">Результат</h3>
      <a :href="job.platformPostUrl" target="_blank" rel="noopener" class="flex items-center gap-1.5 text-sm">
        <Icon name="mingcute:external-link-line" />
        Открыть публикацию на платформе
      </a>
      <p v-if="job.apiMadeWarning" class="mt-1.5 text-micro text-warning">
        Платформа отметила ролик как созданный ИИ.
      </p>
    </section>

    <UiDisclosure title="Снимок содержимого" icon="mingcute:file-line">
      <pre class="overflow-x-auto rounded-md border border-border bg-surface p-2 font-mono text-micro whitespace-pre-wrap">{{ JSON.stringify(job.contentSnapshot, null, 2) }}</pre>
    </UiDisclosure>

    <p class="text-micro text-subtle">
      Текущее состояние: {{ POSTING_STATUS_LABELS[job.status] ?? job.status }}.
      Ключ идемпотентности <span class="font-mono">{{ job.idempotencyKey }}</span> —
      по нему платформа не получит дубль.
    </p>
  </div>
</template>
