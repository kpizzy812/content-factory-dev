<script setup lang="ts">
import type {
  Upload,
  UploadPostingJobLink,
  UploadSocialAccountDto,
} from "~~/shared/types/upload"
import type { AccountDiagnosticError } from "~~/shared/types/account-diagnostic"

const props = defineProps<{
  upload: Pick<
    Upload,
    | "id"
    | "status"
    | "title"
    | "platformPostUrl"
    | "createdAt"
    | "scheduledAt"
    | "errorMessage"
    | "blockedByEnv"
    | "attemptCount"
    | "lastAttemptAt"
  > & {
    socialAccount?: UploadSocialAccountDto
    video?: {
      id: number
      status: string
      fileUrl: string | null
    }
    postingJob?: UploadPostingJobLink | null
  }
}>()

// Конфиг платформенных бейджей — по образцу AccountCard.vue
// (badge-soft + цвет платформы для контраста с background на тёмных темах).
const platformConfig: Record<
  string,
  { label: string; icon: string; badgeClass: string }
> = {
  youtube: {
    label: "YouTube",
    icon: "mingcute:youtube-line",
    badgeClass: "badge-error badge-soft",
  },
  tiktok: {
    label: "TikTok",
    icon: "mingcute:tiktok-line",
    badgeClass: "badge-neutral badge-soft",
  },
  instagram: {
    label: "Instagram",
    icon: "mingcute:ins-line",
    badgeClass: "badge-secondary badge-soft",
  },
}

// Совместимость для шаблонов: иконка/лейбл для бейджей AccountCard-like.
const platformIcons = computed<Record<string, string>>(() =>
  Object.fromEntries(
    Object.entries(platformConfig).map(([k, v]) => [k, v.icon]),
  ),
)
const platformLabels = computed<Record<string, string>>(() =>
  Object.fromEntries(
    Object.entries(platformConfig).map(([k, v]) => [k, v.label]),
  ),
)

const dateFormatted = computed(() => {
  return new Date(props.upload.createdAt).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
})

// 1:1:1 anti-detect: те же бейджи что и на PostingJobCard / AccountCard.
const socialAccount = computed(() => props.upload.socialAccount)
const postingMethod = computed(() => socialAccount.value?.postingMethod ?? null)
const proxy = computed(() => socialAccount.value?.proxy ?? null)
const proxyId = computed(() => socialAccount.value?.proxyId ?? null)
const deviceProfileId = computed(
  () => socialAccount.value?.deviceProfileId ?? null,
)

// Proxy gating preview — Upload-track не имеет серверного 412 gating
// (это PostingJob feature), но UI всё равно подсвечивает риск.
const proxyGating = computed(() => {
  if (!proxyId.value) {
    return {
      label: "Нет прокси — постинг с реального IP опасен",
      tip: "Привяжите рабочий прокси в /accounts → Редактировать → Доступы.",
    }
  }
  if (proxy.value && proxy.value.status !== "healthy") {
    return {
      label: `Прокси ${proxy.value.status}`,
      tip: "Проверьте прокси в /proxies, дождитесь статуса healthy.",
    }
  }
  return null
})

// Маппинг error/blockedByEnv в AccountDiagnosticError для переиспользования
// AccountDiagnosticPanel (тоггл JSON↔human, копирование). Совпадает с подходом
// в PostingJobCard.
const diagnosticError = computed<AccountDiagnosticError | null>(() => {
  const u = props.upload
  if (u.blockedByEnv) {
    return {
      message: u.errorMessage ?? "Публикация отключена ENV-флагом ENABLE_SOCIAL_POSTING",
      phase: "env_gating",
      cause: "blocked_by_env",
      suggestion:
        "Включите ENABLE_SOCIAL_POSTING=true в окружении или используйте PostingJob track (browser_automation).",
      raw: { uploadId: u.id, blockedByEnv: true, errorMessage: u.errorMessage },
      timestamp: u.lastAttemptAt ?? u.createdAt,
    }
  }
  if (u.errorMessage) {
    return {
      message: u.errorMessage,
      phase: "upload_pipeline",
      cause: u.status === "failed" ? "upload_failed" : undefined,
      raw: {
        uploadId: u.id,
        status: u.status,
        attemptCount: u.attemptCount,
      },
      timestamp: u.lastAttemptAt ?? u.createdAt,
    }
  }
  return null
})

// Связь с PostingJob — chip с переходом и snapshot статуса.
const postingJobLink = computed(() => props.upload.postingJob ?? null)
const postingJobStatusLabel: Record<UploadPostingJobLink["status"], string> = {
  scheduled: "Запланирован",
  queued: "В очереди",
  preparing: "Подготовка",
  uploading: "Загрузка",
  published: "Опубликовано",
  failed: "Ошибка",
  retry_queued: "Retry",
  cancelled: "Отменён",
}
const postingJobStatusClass: Record<UploadPostingJobLink["status"], string> = {
  scheduled: "badge-info",
  queued: "badge-neutral",
  preparing: "badge-warning",
  uploading: "badge-warning",
  published: "badge-success",
  failed: "badge-error",
  retry_queued: "badge-warning",
  cancelled: "badge-ghost",
}

function goToDetail() {
  navigateTo(`/uploads/${props.upload.id}`)
}

function goToPostingJobs(e: Event) {
  e.stopPropagation()
  if (!postingJobLink.value) return
  // Список /posting-jobs с pre-фильтром по socialAccountId, чтобы привести
  // оператора как можно ближе к нужной джобе.
  const acc = socialAccount.value?.id
  navigateTo(
    acc
      ? `/posting-jobs?socialAccountId=${acc}`
      : "/posting-jobs",
  )
}
</script>

<template>
  <div
    class="card bg-base-100 shadow-sm cursor-pointer transition-shadow hover:shadow-md"
    @click="goToDetail"
  >
    <div class="card-body p-4 gap-3">
      <!-- Статус и платформа -->
      <div class="flex items-center gap-2 flex-wrap">
        <UploadStatusBadge :status="upload.status" />
        <span
          v-if="upload.socialAccount"
          class="badge badge-sm gap-1"
          :class="
            platformConfig[upload.socialAccount.platform]?.badgeClass
              ?? 'badge-ghost'
          "
        >
          <Icon
            :name="platformIcons[upload.socialAccount.platform] ?? 'mingcute:share-2-line'"
            class="text-xs"
          />
          {{ platformLabels[upload.socialAccount.platform] ?? upload.socialAccount.platform }}
        </span>
      </div>

      <!-- 1:1:1 устройство бейджи -->
      <div
        v-if="postingMethod || proxy || deviceProfileId"
        class="flex items-center gap-1.5 flex-wrap"
      >
        <span
          v-if="postingMethod === 'browser_automation'"
          class="badge badge-xs badge-warning gap-1"
          title="Аккаунт переключён на browser_automation. Этот Upload остаётся API-track — реальный постинг ушёл бы через PostingJob."
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
      </div>

      <!-- Proxy gating preview (Upload-track 412 у нас нет, но UI о риске сигнализирует) -->
      <div
        v-if="proxyGating"
        role="alert"
        class="alert alert-warning alert-soft py-2 text-xs gap-2"
        :title="proxyGating.tip"
      >
        <Icon name="mingcute:warning-line" class="text-sm shrink-0" />
        <span>{{ proxyGating.label }}</span>
      </div>

      <!-- Название -->
      <h3 class="font-semibold text-base-content text-sm line-clamp-2">
        {{ upload.title }}
      </h3>

      <!-- Аккаунт -->
      <p v-if="upload.socialAccount" class="text-xs text-base-content/60">
        {{ upload.socialAccount.displayName }}
      </p>

      <!-- Связанный PostingJob (1:1 opt-in) -->
      <button
        v-if="postingJobLink"
        type="button"
        class="badge badge-sm gap-1.5 cursor-pointer w-fit"
        :class="postingJobStatusClass[postingJobLink.status]"
        :title="`PostingJob ${postingJobLink.id.slice(0, 8)} — открыть очередь постинга`"
        @click="goToPostingJobs"
      >
        <Icon name="mingcute:send-line" class="text-xs" />
        PostingJob #{{ postingJobLink.id.slice(0, 8) }}
        · {{ postingJobStatusLabel[postingJobLink.status] }}
      </button>

      <!-- Ссылка на пост -->
      <a
        v-if="upload.status === 'published' && upload.platformPostUrl"
        :href="upload.platformPostUrl"
        target="_blank"
        rel="noopener"
        class="link link-primary text-xs"
        @click.stop
      >
        Открыть пост
      </a>

      <!-- Дата -->
      <p class="text-xs text-base-content/50">
        {{ dateFormatted }}
      </p>

      <!-- Диагностика ошибки / blockedByEnv через переиспользуемую панель -->
      <AccountDiagnosticPanel
        :error="diagnosticError"
        @click.stop
      />
    </div>
  </div>
</template>
