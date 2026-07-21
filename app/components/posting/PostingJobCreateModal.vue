<script setup lang="ts">
/**
 * Модалка ручного создания PostingJob с UI-видимостью 1:1:1 и proxy gating.
 *
 * Источник истины ошибок — серверный POST /api/posting-jobs:
 *   - 412 no_proxy           → у аккаунта нет прокси
 *   - 412 proxy_unhealthy    → прокси не healthy
 *   - 400 / 404              → валидация / not found
 *
 * Все ошибки от сервера разворачиваются через toDiagnosticError в
 * AccountDiagnosticPanel (тоггл JSON↔human, копирование). UI также делает
 * client-side pre-check 1:1:1, чтобы не отправлять заранее проигрышные
 * запросы — но финальный gating всегда серверный.
 *
 * YouTube branch:
 *   - PostingJobYoutubeFields подменяет общие caption/description/hashtags
 *   - Pre-flight checklist (5 проверок) + 412 fail-safe defaults
 *   - structured contentSnapshot: { title, description, hashtags, youtube: {visibility, madeForKids} }
 */
import {
  toDiagnosticError,
  type AccountDiagnosticError,
} from "~~/shared/types/account-diagnostic"
import type {
  PostingJobDto,
  PostingPlatform,
} from "~~/shared/types/posting-job"
import {
  buildGenericContentSnapshot,
  buildYoutubeContentSnapshot,
  parseHashtagsInput,
  type PreflightCheck,
  type YoutubeVisibility,
} from "~~/shared/types/posting-youtube"
import { buildInstagramContentSnapshot } from "~~/shared/types/posting-instagram"
import type { LoginCheckResult } from "~~/shared/types/login-check"
import { useLoginCheck } from "~~/app/composables/useLoginCheck"

const emit = defineEmits<{
  created: [job: PostingJobDto]
}>()

const modalRef = ref<HTMLDialogElement>()
const submitting = ref(false)
const error = ref<AccountDiagnosticError | null>(null)

// Live-результат последнего login-check (из кнопки «Запустить login-check»).
// Имеет приоритет над persisted loginCheckedStatus: transient (Indigo CDP
// отвалился при валидном snapshot) → warn, не blocker.
const liveLoginResult = ref<LoginCheckResult | null>(null)

// --- Form state (общее) ---
const socialAccountId = ref<number | null>(null)
const videoId = ref<number | null>(null)
const scheduledMode = ref<"asap" | "scheduled">("asap")
const scheduledAtLocal = ref<string>("")

// --- Form state для TikTok / Instagram ---
const caption = ref<string>("")
const description = ref<string>("")
const hashtagsRaw = ref<string>("")

// --- Form state для YouTube (объект из PostingJobYoutubeFields) ---
interface YoutubeFormState {
  title: string
  description: string
  hashtags: string[]
  visibility: YoutubeVisibility | null
  madeForKids: boolean | null
}
const youtubeForm = ref<YoutubeFormState>({
  title: "",
  description: "",
  hashtags: [],
  visibility: null,
  madeForKids: null,
})
const youtubeValid = ref(false)

// --- Form state для Instagram (объект из PostingJobInstagramFields) ---
interface InstagramFormState {
  caption: string
  hashtags: string[]
}
const instagramForm = ref<InstagramFormState>({
  caption: "",
  hashtags: [],
})
// false по умолчанию: до первого emit из PostingJobInstagramFields пустой
// IG-snapshot не должен быть отправляемым. Компонент при mounted эмитит
// update:valid (watch immediate) — пустая форма (нет caption и нет hashtags)
// остаётся невалидной.
const instagramValid = ref(false)

// --- Data sources ---
const accountFilters = ref<{ status?: string }>({ status: "active" })
const { data: accountsData, refresh: refreshAccounts } = useAccounts(
  accountFilters as Ref<{ status?: string }>,
)
const accounts = computed<AccountListItem[]>(
  () => (accountsData.value?.data ?? []) as AccountListItem[],
)

const videoFilters = ref<{ status?: string; perPage?: number }>({
  status: "completed",
  perPage: 50,
})
const { data: videosData, refresh: refreshVideos } = useVideos(
  videoFilters as Ref<{ status?: string; perPage?: number }>,
)
const videos = computed<VideoListItem[]>(
  () => (videosData.value?.data ?? []) as VideoListItem[],
)

interface AccountListItem {
  id: number
  displayName: string
  platform: PostingPlatform
  status: "active" | "expired" | "revoked"
  postingMethod?: "api" | "browser_automation"
  proxyId?: string | null
  deviceProfileId?: string | null
  proxy?: {
    id: string
    label: string
    status: "unverified" | "healthy" | "degraded" | "dead" | "expired"
  } | null
  loginCheckedStatus?: boolean | null
  loginCheckedAt?: string | null
  loginCheckedUsername?: string | null
}

interface VideoListItem {
  id: number
  status: string
  fileUrl: string | null
  duration: number | null
  scenario?: {
    id: number
    variants?: Array<{ title: string }>
  } | null
}

const selectedAccount = computed<AccountListItem | null>(() => {
  if (!socialAccountId.value) return null
  return accounts.value.find((a) => a.id === socialAccountId.value) ?? null
})

const selectedVideo = computed<VideoListItem | null>(() => {
  if (!videoId.value) return null
  return videos.value.find((v) => v.id === videoId.value) ?? null
})

const isYoutube = computed(() => selectedAccount.value?.platform === "youtube")
const isInstagram = computed(() => selectedAccount.value?.platform === "instagram")

const accountReadinessIssue = computed<string | null>(() => {
  const a = selectedAccount.value
  if (!a) return null
  if (a.status !== "active") return `Аккаунт в статусе ${a.status}.`
  if (!a.proxyId) return "Аккаунт без прокси — postingJob будет отклонён (412)."
  if (a.proxy && a.proxy.status !== "healthy") {
    return `Прокси ${a.proxy.status} — postingJob будет отклонён (412).`
  }
  if (a.postingMethod === "browser_automation" && !a.deviceProfileId) {
    return "browser_automation требует привязанный профиль устройства."
  }
  if (
    a.postingMethod === "browser_automation"
    && a.loginCheckedStatus === false
  ) {
    // Live-результат имеет приоритет: transient/confirmed для этого аккаунта
    // означает, что persisted false устарел (Indigo CDP отвалился при валидном
    // snapshot ИЛИ только что подтвердили вход) — не блокируем.
    const live = liveLoginResult.value
    const liveOverrides
      = live != null
      && live.accountId === a.id
      && (live.outcome === "transient" || live.outcome === "confirmed")
    if (!liveOverrides) {
      return "Login-check показал: аккаунт не залогинен на устройстве DuoPlus."
    }
  }
  return null
})

// Live login-check (transient/confirmed) для выбранного аккаунта перекрывает
// persisted loginCheckedStatus. Используется чтобы скрыть statiчный
// AccountLoginStatusBadge (он рисует persisted false) и не противоречить
// AccountReadinessBadge, который уже учитывает live-результат.
const liveLoginOverride = computed(() => {
  const live = liveLoginResult.value
  const a = selectedAccount.value
  return (
    live != null
    && a != null
    && live.accountId === a.id
    && (live.outcome === "transient" || live.outcome === "confirmed")
  )
})

/**
 * Список конкретных причин почему submit заблокирован. Показывается над
 * кнопкой "Создать задачу" чтобы оператор сразу видел что починить.
 * Пустой массив → можно сабмитить.
 */
const submitBlockers = computed<string[]>(() => {
  const out: string[] = []
  if (!socialAccountId.value) out.push("Выберите аккаунт")
  if (!videoId.value) out.push("Выберите видео")
  if (scheduledMode.value === "scheduled" && !scheduledAtLocal.value) {
    out.push("Укажите время публикации")
  }
  if (isYoutube.value) {
    if (!youtubeForm.value.title.trim()) out.push("Заголовок обязателен")
    if (youtubeForm.value.visibility === null) out.push("Выберите видимость")
    if (youtubeForm.value.madeForKids === null) out.push("Выберите 'для детей / не для детей'")
    if (!youtubeValid.value && youtubeForm.value.visibility !== null
        && youtubeForm.value.madeForKids !== null && youtubeForm.value.title.trim()) {
      // youtubeValid=false при не пустых обязательных полях → проблема в pre-flight.
      out.push("Pre-flight: исправьте красные пункты в чек-листе")
    }
  }
  if (isInstagram.value && !instagramValid.value) {
    out.push("Заполните подпись или хэштеги (≤ 2200 символов, ≤ 30 хэштегов)")
  }
  return out
})

const canSubmit = computed(() => {
  if (submitting.value) return false
  if (!socialAccountId.value || !videoId.value) return false
  if (scheduledMode.value === "scheduled" && !scheduledAtLocal.value) return false
  // Для YouTube требуем дополнительную валидацию формы (visibility/madeForKids/title/preflight).
  if (isYoutube.value && !youtubeValid.value) return false
  // Для Instagram блокируем submit при превышении лимитов caption/хэштегов.
  if (isInstagram.value && !instagramValid.value) return false
  return true
})

const platformLabel: Record<PostingPlatform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
}

const platformIcon: Record<PostingPlatform, string> = {
  tiktok: "mingcute:tiktok-line",
  instagram: "mingcute:ins-line",
  youtube: "mingcute:youtube-line",
}

const { runCheck: runLoginCheck, isBusy: loginCheckBusy } = useLoginCheck()

async function handlePreflightAction(check: PreflightCheck) {
  if (!check.actionType) return
  const accountId = socialAccountId.value
  switch (check.actionType) {
    case "run_login_check":
      if (accountId) {
        // Сохраняем live-результат: transient (CDP-сбой при валидном snapshot)
        // → гейт покажет warn, а не blocker. refreshAccounts подтянет persisted
        // status (для confirmed/logged_out сервер его обновил; для transient —
        // нет, поэтому live-результат и нужен).
        const result = await runLoginCheck(accountId)
        liveLoginResult.value = result
        await refreshAccounts()
      }
      break
    case "open_caption_editor":
      if (videoId.value) {
        // Открываем редактор captions в новой вкладке — оператор апрувит и возвращается.
        window.open(`/videos/${videoId.value}#captions`, "_blank")
      }
      break
    case "open_indigo_profile":
      // Открываем страницу устройств DuoPlus — привязать/проверить устройство аккаунта.
      window.open(`/devices`, "_blank")
      break
    case "select_proxy":
    case "select_video":
      // Эти action info-only — UI уже показал что нужно выбрать.
      break
    case "run_deep_check":
      if (accountId) {
        try {
          await $fetch(`/api/accounts/${accountId}/deep-proxy-check`, {
            method: "POST",
          })
          await refreshAccounts()
        } catch {
          // Ошибки покажет toast в будущем — пока без блокировки.
        }
      }
      break
  }
}

function open(initial?: { accountId?: number }) {
  resetForm()
  if (initial?.accountId) socialAccountId.value = initial.accountId
  modalRef.value?.showModal()
  refreshAccounts()
  refreshVideos()
}

function close() {
  modalRef.value?.close()
  resetForm()
}

function resetForm() {
  socialAccountId.value = null
  videoId.value = null
  scheduledMode.value = "asap"
  scheduledAtLocal.value = ""
  caption.value = ""
  description.value = ""
  hashtagsRaw.value = ""
  youtubeForm.value = {
    title: "",
    description: "",
    hashtags: [],
    visibility: null,
    madeForKids: null,
  }
  youtubeValid.value = false
  instagramForm.value = { caption: "", hashtags: [] }
  instagramValid.value = false
  liveLoginResult.value = null
  error.value = null
  submitting.value = false
}

function fillRandomTime() {
  const minMs = 60 * 60 * 1000
  const maxMs = 24 * 60 * 60 * 1000
  const offset = minMs + Math.random() * (maxMs - minMs)
  const target = new Date(Date.now() + offset)
  const pad = (n: number) => String(n).padStart(2, "0")
  scheduledAtLocal.value =
    `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`
    + `T${pad(target.getHours())}:${pad(target.getMinutes())}`
  if (scheduledMode.value !== "scheduled") {
    scheduledMode.value = "scheduled"
  }
}

async function submit() {
  if (!canSubmit.value) return
  const account = selectedAccount.value
  if (!account) return

  error.value = null
  submitting.value = true

  const scheduledAtIso = scheduledMode.value === "scheduled" && scheduledAtLocal.value
    ? new Date(scheduledAtLocal.value).toISOString()
    : null

  // Платформо-специфичный contentSnapshot через shared builders из
  // shared/types/posting-youtube.ts — единый источник правды для UploadCreateModal
  // и PostingJobCreateModal.
  let contentSnapshot: Record<string, unknown>
  if (isYoutube.value) {
    const yt = youtubeForm.value
    contentSnapshot = buildYoutubeContentSnapshot({
      title: yt.title,
      description: yt.description,
      hashtags: yt.hashtags,
      // non-null guarded canSubmit'ом — если null до сюда не дошли бы.
      visibility: yt.visibility!,
      madeForKids: yt.madeForKids!,
    }) as unknown as Record<string, unknown>
  } else if (isInstagram.value) {
    // Instagram: { caption, hashtags, instagram: { shareAsReel: true } } — ровно
    // то, что ждёт validateInstagramSnapshot и воркер. Без youtube-полей.
    contentSnapshot = buildInstagramContentSnapshot({
      caption: instagramForm.value.caption,
      hashtags: instagramForm.value.hashtags,
    }) as unknown as Record<string, unknown>
  } else {
    contentSnapshot = buildGenericContentSnapshot({
      caption: caption.value,
      description: description.value,
      hashtags: parseHashtagsInput(hashtagsRaw.value),
    }) as unknown as Record<string, unknown>
  }

  const body = {
    videoId: videoId.value!,
    socialAccountId: socialAccountId.value!,
    platform: account.platform,
    contentSnapshot,
    scheduledAt: scheduledAtIso,
  }

  try {
    const res = await $fetch<{ data: PostingJobDto }>(
      "/api/posting-jobs",
      { method: "POST", body },
    )
    emit("created", res.data)
    close()
  } catch (e: unknown) {
    error.value = toDiagnosticError(e, {
      phase: "posting_job_create",
      url: "/api/posting-jobs",
    })
  } finally {
    submitting.value = false
  }
}

defineExpose({ open, close })
</script>

<template>
  <dialog ref="modalRef" class="modal">
    <div class="modal-box max-w-2xl max-h-[90vh] flex flex-col">
      <h3 class="font-bold text-lg mb-1">Создать задачу постинга</h3>
      <p class="text-xs text-base-content/60 mb-3">
        Worker возьмёт её в очередь через 30с. Pre-flight проверит прокси и аккаунт -
        при провале статус станет <code>failed</code> с диагностикой.
      </p>

      <div class="flex-1 overflow-y-auto space-y-3 pr-1">
        <!-- Account picker -->
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Аккаунт *</legend>
          <select
            v-model="socialAccountId"
            class="select select-sm w-full"
            :disabled="submitting"
          >
            <option :value="null" disabled>Выберите аккаунт…</option>
            <option
              v-for="acc in accounts"
              :key="acc.id"
              :value="acc.id"
            >
              {{ acc.displayName }} ({{ platformLabel[acc.platform] }})
              {{ acc.postingMethod === "browser_automation" ? " · Browser" : "" }}
              {{ acc.proxy ? ` · proxy ${acc.proxy.status}` : " · no proxy" }}
            </option>
          </select>
        </fieldset>

        <!-- Account readiness diagnostics -->
        <div
          v-if="selectedAccount"
          class="flex flex-wrap items-center gap-1.5"
        >
          <span class="badge badge-xs gap-1">
            <Icon
              :name="platformIcon[selectedAccount.platform]"
              class="text-xs"
            />
            {{ platformLabel[selectedAccount.platform] }}
          </span>
          <span
            v-if="selectedAccount.postingMethod === 'browser_automation'"
            class="badge badge-xs badge-warning gap-1"
          >
            <Icon name="mingcute:robot-line" class="text-xs" />
            Auto-Browser
          </span>
          <span
            v-else-if="selectedAccount.postingMethod === 'api'"
            class="badge badge-xs badge-ghost gap-1"
          >
            <Icon name="mingcute:code-line" class="text-xs" />
            API
          </span>
          <span
            v-if="selectedAccount.deviceProfileId"
            class="badge badge-xs badge-ghost gap-1"
          >
            <Icon name="mingcute:safari-line" class="text-xs" />
            Indigo
          </span>
          <ProxyHealthBadge
            v-if="selectedAccount.proxy"
            :status="selectedAccount.proxy.status"
            size="sm"
          />
          <span
            v-else
            class="badge badge-xs badge-error gap-1"
          >
            <Icon name="mingcute:warning-line" class="text-xs" />
            Без прокси
          </span>
          <AccountLoginStatusBadge
            v-if="selectedAccount.postingMethod === 'browser_automation' && !liveLoginOverride"
            :login-checked-at="selectedAccount.loginCheckedAt"
            :login-checked-status="selectedAccount.loginCheckedStatus"
            :login-checked-username="selectedAccount.loginCheckedUsername"
          />
          <AccountReadinessBadge
            :account="selectedAccount"
            :live-login-result="liveLoginResult"
          />
        </div>

        <div
          v-if="accountReadinessIssue"
          role="alert"
          class="alert alert-warning alert-soft py-2 text-xs"
        >
          <Icon name="mingcute:warning-line" class="text-sm shrink-0" />
          <span>{{ accountReadinessIssue }}</span>
        </div>

        <!-- Video picker -->
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Видео * (status=completed)</legend>
          <select
            v-model="videoId"
            class="select select-sm w-full"
            :disabled="submitting"
          >
            <option :value="null" disabled>Выберите видео…</option>
            <option
              v-for="v in videos"
              :key="v.id"
              :value="v.id"
            >
              #{{ v.id }}
              {{ v.scenario?.variants?.[0]?.title ? ` — ${v.scenario.variants[0].title}` : "" }}
              {{ v.duration ? ` · ${v.duration}с` : "" }}
            </option>
          </select>
        </fieldset>

        <!-- Schedule -->
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Когда публиковать *</legend>
          <div class="flex gap-2 flex-wrap items-center">
            <label class="label cursor-pointer gap-1.5">
              <input
                v-model="scheduledMode"
                type="radio"
                value="asap"
                class="radio radio-xs"
                :disabled="submitting"
              />
              <span class="label-text text-sm">Как можно скорее</span>
            </label>
            <label class="label cursor-pointer gap-1.5">
              <input
                v-model="scheduledMode"
                type="radio"
                value="scheduled"
                class="radio radio-xs"
                :disabled="submitting"
              />
              <span class="label-text text-sm">По расписанию</span>
            </label>
          </div>
          <div
            v-if="scheduledMode === 'scheduled'"
            class="flex gap-2 items-center mt-1 flex-wrap"
          >
            <input
              v-model="scheduledAtLocal"
              type="datetime-local"
              class="input input-sm"
              :disabled="submitting"
            />
            <button
              type="button"
              class="btn btn-xs btn-ghost gap-1"
              :disabled="submitting"
              title="Anti-detect: рандомное время в окне 1–24 часа"
              @click="fillRandomTime"
            >
              <Icon name="mingcute:shuffle-line" />
              Рандомно (1–24 ч)
            </button>
          </div>
        </fieldset>

        <!-- YouTube branch: подменяет caption/description/hashtags на structured form -->
        <PostingJobYoutubeFields
          v-if="isYoutube"
          :account="selectedAccount"
          :video="selectedVideo"
          :live-login-result="liveLoginResult"
          :disabled="submitting || loginCheckBusy"
          @update="(payload) => (youtubeForm = payload)"
          @update:valid="(v) => (youtubeValid = v)"
          @preflight-action="handlePreflightAction"
        />

        <!-- Instagram branch: caption (≤2200 c хэштегами) + hashtags (≤30) -->
        <PostingJobInstagramFields
          v-else-if="isInstagram"
          :video="selectedVideo"
          :disabled="submitting"
          @update="(payload) => (instagramForm = payload)"
          @update:valid="(v) => (instagramValid = v)"
        />

        <!-- TikTok branch: общий contentSnapshot как был -->
        <template v-else>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Заголовок / Caption</legend>
            <input
              v-model="caption"
              type="text"
              class="input input-sm w-full"
              maxlength="150"
              placeholder="Краткое название поста"
              :disabled="submitting"
            />
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">Описание</legend>
            <textarea
              v-model="description"
              class="textarea textarea-sm w-full"
              rows="2"
              maxlength="2200"
              placeholder="Текст описания. Для TikTok эмбедится в description."
              :disabled="submitting"
            />
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">Хэштеги (через пробел или запятую)</legend>
            <input
              v-model="hashtagsRaw"
              type="text"
              class="input input-sm w-full"
              placeholder="#fitness #motivation"
              :disabled="submitting"
            />
          </fieldset>
        </template>

        <!-- Серверная ошибка -->
        <AccountDiagnosticPanel :error="error" />

        <!-- Summary: что мешает создать задачу -->
        <div
          v-if="!canSubmit && submitBlockers.length > 0"
          role="alert"
          class="alert alert-warning alert-soft text-xs"
        >
          <Icon name="mingcute:warning-line" class="text-sm shrink-0" />
          <div class="flex-1">
            <div class="font-medium mb-0.5">Что нужно сделать чтобы создать задачу:</div>
            <ul class="list-disc list-inside space-y-0.5">
              <li v-for="b in submitBlockers" :key="b">{{ b }}</li>
            </ul>
          </div>
        </div>
      </div>

      <div class="modal-action mt-4 pt-3 border-t border-base-300 sticky bottom-0 bg-base-100">
        <button
          class="btn btn-sm btn-ghost"
          :disabled="submitting"
          @click="close"
        >
          Отмена
        </button>
        <button
          class="btn btn-sm btn-primary gap-1"
          :disabled="!canSubmit"
          @click="submit"
        >
          <span v-if="submitting" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:send-line" />
          Создать задачу
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="close">close</button>
    </form>
  </dialog>
</template>
