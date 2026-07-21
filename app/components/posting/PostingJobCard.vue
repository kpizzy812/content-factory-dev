<script setup lang="ts">
import {
  POSTING_JOB_ACTIVE_STATUSES,
  type PostingJobDto,
} from "~~/shared/types/posting-job"
import type { AccountDiagnosticError } from "~~/shared/types/account-diagnostic"

const props = defineProps<{
  job: PostingJobDto
  /** Режим bulk-выбора (показывает чекбокс). */
  selectable?: boolean
  /** Выбрана ли карточка в bulk-режиме. */
  selected?: boolean
}>()

const emit = defineEmits<{
  cancel: [job: PostingJobDto]
  retry: [job: PostingJobDto]
  logs: [job: PostingJobDto]
  delete: [job: PostingJobDto]
  "toggle-select": [job: PostingJobDto]
}>()

const platformIcon: Record<PostingJobDto["platform"], string> = {
  tiktok: "mingcute:tiktok-line",
  instagram: "mingcute:ins-line",
  youtube: "mingcute:youtube-line",
}

const { can } = usePermissions()
const canDeletePerm = computed(() => can("canDelete"))

const isActive = computed(() =>
  POSTING_JOB_ACTIVE_STATUSES.includes(props.job.status),
)
// Cancel — для активных (queued/scheduled/preparing/uploading/retry_queued).
// failed теперь тоже cancellable на сервере, но на failed-карточке предлагаем
// Retry + Удалить (delete чище — освобождает idempotencyKey). См. план D.
const canCancel = computed(() => isActive.value)
const canRetry = computed(() => props.job.status === "failed")
// Удалять можно всё (guard на сервере + confirm/force в модалке).
const canDelete = computed(() => canDeletePerm.value)

const shortId = computed(() => props.job.id.slice(0, 8))

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

const scheduledLabel = computed(() => {
  if (props.job.scheduledAt) return `План: ${formatDate(props.job.scheduledAt)}`
  return `Создан: ${formatDate(props.job.createdAt)}`
})

const finishedLabel = computed(() => {
  if (!props.job.finishedAt) return null
  return `Финиш: ${formatDate(props.job.finishedAt)}`
})

const accountLabel = computed(() =>
  props.job.socialAccount?.displayName
  ?? `Account #${props.job.socialAccountId}`,
)

const videoFileUrl = computed(() => props.job.video?.fileUrl ?? null)

// 1:1:1 anti-detect: метод постинга / прокси / Indigo бейджи.
const socialAccount = computed(() => props.job.socialAccount)
const postingMethod = computed(() => socialAccount.value?.postingMethod ?? null)
const proxy = computed(() => socialAccount.value?.proxy ?? null)
const proxyId = computed(() => socialAccount.value?.proxyId ?? null)
const deviceProfileId = computed(
  () => socialAccount.value?.deviceProfileId ?? null,
)

// DuoPlus device-контекст: оператор видит, через какое устройство идёт постинг
// и его last-known статус. null для чистого api-постинга (нет привязки).
const device = computed(() => socialAccount.value?.device ?? null)
// Browser-постинг идёт через DuoPlus-движок → устройство включается и
// тарифицируется. Cost-предупреждение показываем для browser_automation.
const isBrowserPosting = computed(
  () => postingMethod.value === "browser_automation",
)

// Proxy gating — согласовано с серверным 412 в worker.validateJobPreconditions
// и в POST /api/posting-jobs.
const proxyGating = computed(() => {
  if (!proxyId.value) {
    return {
      kind: "no_proxy" as const,
      label: "Нет прокси — постинг заблокирован",
      tip: "Привяжите рабочий прокси к аккаунту. Без него worker остановит задачу на pre-flight.",
    }
  }
  if (proxy.value && proxy.value.status !== "healthy") {
    return {
      kind: "proxy_unhealthy" as const,
      label: `Прокси ${proxy.value.status} — постинг заблокирован`,
      tip: "Проверьте прокси в /proxies, дождитесь статуса healthy.",
    }
  }
  return null
})

// Маппинг error-полей PostingJob в формат AccountDiagnosticError,
// чтобы переиспользовать существующий AccountDiagnosticPanel
// (тоггл JSON↔human, кнопка «Открыть скриншот», копирование).
const diagnosticError = computed<AccountDiagnosticError | null>(() => {
  const job = props.job
  if (
    !job.lastError
    && !job.errorCategory
    && !job.lastErrorPhase
    && !job.lastErrorScreenshotKey
  ) {
    return null
  }
  return {
    message: job.lastError ?? "Неизвестная ошибка постинга",
    phase: job.lastErrorPhase ?? undefined,
    cause: job.errorCategory ?? undefined,
    screenshotKey: job.lastErrorScreenshotKey ?? undefined,
    postingPhase: job.lastErrorPhase ?? undefined,
    suggestion: suggestionFor(job.errorCategory),
    raw: {
      jobId: job.id,
      attemptCount: job.attemptCount,
      maxAttempts: job.maxAttempts,
      errorCategory: job.errorCategory,
      lastErrorPhase: job.lastErrorPhase,
      lastErrorScreenshotKey: job.lastErrorScreenshotKey,
    },
    timestamp: job.finishedAt ?? job.updatedAt,
  }
})

// Подсказки по категориям ошибок — соответствуют PostingErrorCategory enum
// из prisma/schema.prisma + комментарии Part D.
function suggestionFor(
  category: PostingJobDto["errorCategory"],
): string | undefined {
  switch (category) {
    case "proxy_dead":
      return "Прокси отвалился. Проверьте в /proxies, замените на healthy."
    case "auth_failed":
      return "Аккаунт разлогинен. Обновите OAuth-токен или залогиньтесь через устройство DuoPlus."
    case "login_required":
      return "browser_automation: сессия разлогинена. Залогиньтесь через устройство DuoPlus, проверьте login-check."
    case "browser_connect_failed":
      return "puppeteer.connect упал. Проверьте профиль устройства (automation enabled, port открыт)."
    case "selector_not_found":
      return "Платформа обновила вёрстку. Обновите poster (server/automation/posters/)."
    case "upload_failed":
      return "Загрузка файла не дождалась processing indicator. Retry разрешён."
    case "platform_rate_limit":
      return "Платформа лимитирует. Увеличьте интервалы постинга для этого аккаунта."
    case "platform_5xx":
      return "Временная ошибка платформы. Worker автоматически попробует ещё раз."
    case "account_locked":
      return "Аккаунт заблокирован платформой. Проверьте профиль вручную."
    default:
      return undefined
  }
}
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 gap-3">
      <!-- Header: id + status -->
      <div class="flex items-start justify-between gap-2 flex-wrap">
        <div class="flex items-center gap-2 min-w-0">
          <input
            v-if="selectable"
            type="checkbox"
            class="checkbox checkbox-sm shrink-0"
            :checked="selected"
            aria-label="Выбрать задачу"
            @change="emit('toggle-select', job)"
          />
          <Icon
            :name="platformIcon[job.platform]"
            class="text-xl text-base-content/70 shrink-0"
          />
          <div class="flex flex-col gap-0.5 min-w-0">
            <code class="text-xs bg-base-200 px-1.5 py-0.5 rounded w-fit">
              {{ shortId }}
            </code>
            <span class="text-sm font-medium text-base-content truncate">
              {{ accountLabel }}
            </span>
          </div>
        </div>
        <PostingJobStatusBadge :status="job.status" size="sm" />
      </div>

      <!-- 1:1:1 устройство бейджи: postingMethod + DuoPlus + proxy -->
      <div
        v-if="postingMethod || proxy || deviceProfileId"
        class="flex items-center gap-1.5 flex-wrap"
      >
        <span
          v-if="postingMethod === 'browser_automation'"
          class="badge badge-xs badge-warning gap-1"
          title="Постинг через автоматизацию облачного устройства DuoPlus"
        >
          <Icon name="mingcute:robot-line" class="text-xs" />
          Auto-Browser
        </span>
        <span
          v-else-if="postingMethod === 'api'"
          class="badge badge-xs badge-ghost gap-1"
          title="Постинг через official API платформы"
        >
          <Icon name="mingcute:code-line" class="text-xs" />
          API
        </span>
        <span
          v-if="deviceProfileId"
          class="badge badge-xs badge-ghost gap-1"
          title="Привязан профиль устройства DuoPlus"
        >
          <Icon name="mingcute:safari-line" class="text-xs" />
          DuoPlus
        </span>
        <ProxyHealthBadge
          v-if="proxy"
          :status="proxy.status"
          size="sm"
        />
        <PostingJobYoutubeBadges
          v-if="job.platform === 'youtube'"
          :job="job"
        />
      </div>

      <!-- DuoPlus device-контекст: устройство + last-known статус. Оператор видит
           «постинг на устройстве X, статус Y». -->
      <div
        v-if="device"
        class="flex flex-col gap-1.5 rounded-box bg-base-200/60 px-2.5 py-2 text-xs"
      >
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="flex items-center gap-1.5 min-w-0">
            <Icon
              name="mingcute:cellphone-2-line"
              class="text-sm shrink-0 text-base-content/60"
            />
            <span class="font-medium text-base-content truncate">
              {{ device.deviceName }}
            </span>
          </div>
          <DeviceStatusBadge :status="device.deviceStatus" size="xs" />
        </div>
        <code
          v-if="device.deviceImageId"
          class="text-[10px] text-base-content/50 truncate"
          :title="`DuoPlus image_id: ${device.deviceImageId}`"
        >
          image_id: {{ device.deviceImageId }}
        </code>
        <!-- Деньги: browser-постинг включает устройство → тарифицируется поминутно. -->
        <DeviceCostWarning v-if="isBrowserPosting" variant="inline" />
      </div>

      <!-- Proxy gating alert: согласован с серверным 412 в worker
           и в POST /api/posting-jobs (no_proxy / proxy_unhealthy) -->
      <div
        v-if="proxyGating"
        role="alert"
        class="alert alert-error alert-soft py-2 text-xs gap-2"
        :title="proxyGating.tip"
      >
        <Icon name="mingcute:warning-line" class="text-sm shrink-0" />
        <span>{{ proxyGating.label }}</span>
      </div>

      <!-- Video preview (если есть fileUrl) -->
      <div
        v-if="videoFileUrl"
        class="aspect-video bg-base-200 rounded-box overflow-hidden flex items-center justify-center"
      >
        <video
          :src="videoFileUrl"
          class="w-full h-full object-cover"
          muted
          preload="metadata"
        />
      </div>
      <div
        v-else
        class="aspect-video bg-base-200 rounded-box flex items-center justify-center text-base-content/30"
      >
        <Icon name="mingcute:video-line" class="text-4xl" />
      </div>

      <!-- Meta -->
      <div class="flex flex-col gap-1.5 text-sm text-base-content/70">
        <div class="flex items-center gap-1.5">
          <Icon name="mingcute:calendar-line" class="text-sm shrink-0" />
          <span class="truncate">{{ scheduledLabel }}</span>
        </div>

        <div v-if="finishedLabel" class="flex items-center gap-1.5">
          <Icon name="mingcute:flag-4-line" class="text-sm shrink-0" />
          <span class="truncate">{{ finishedLabel }}</span>
        </div>

        <div class="flex items-center gap-1.5">
          <Icon name="mingcute:refresh-3-line" class="text-sm shrink-0" />
          <span>
            Попытки: {{ job.attemptCount }} / {{ job.maxAttempts }}
          </span>
        </div>

        <div v-if="job.platformPostUrl" class="flex items-center gap-1.5">
          <Icon name="mingcute:link-line" class="text-sm shrink-0" />
          <a
            :href="job.platformPostUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="link link-primary truncate"
          >
            Открыть пост
          </a>
        </div>

        <div
          v-if="job.cancelReason"
          class="flex items-start gap-1.5 text-base-content/60"
        >
          <Icon name="mingcute:forbid-circle-line" class="text-sm shrink-0 mt-0.5" />
          <span class="text-xs break-words">{{ job.cancelReason }}</span>
        </div>
      </div>

      <!-- Диагностика последней ошибки — выпадашка с тогглом JSON↔human,
           кнопкой «Открыть скриншот», копированием. Скрывается когда job
           активен (queued/preparing/uploading) — иначе оператор видит
           старую ошибку поверх текущего статуса «Загрузка» и думает что
           retry не запустился. -->
      <AccountDiagnosticPanel
        v-if="!isActive"
        :error="diagnosticError"
        :job-id="job.id"
      />

      <!-- Actions -->
      <div class="card-actions justify-end mt-1 flex-wrap gap-1">
        <button
          class="btn btn-xs btn-ghost gap-1"
          @click="emit('logs', job)"
        >
          <Icon name="mingcute:document-line" class="text-sm" />
          Логи
        </button>
        <button
          v-if="canRetry"
          class="btn btn-xs btn-warning btn-soft gap-1"
          @click="emit('retry', job)"
        >
          <Icon name="mingcute:refresh-3-line" class="text-sm" />
          Retry
        </button>
        <button
          v-if="canCancel"
          class="btn btn-xs btn-error btn-outline gap-1"
          @click="emit('cancel', job)"
        >
          <Icon name="mingcute:forbid-circle-line" class="text-sm" />
          Отменить
        </button>
        <button
          v-if="canDelete"
          class="btn btn-xs btn-error gap-1"
          @click="emit('delete', job)"
        >
          <Icon name="mingcute:delete-2-line" class="text-sm" />
          Удалить
        </button>
      </div>
    </div>
  </div>
</template>
