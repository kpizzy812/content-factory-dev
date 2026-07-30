<script setup lang="ts">
import type { SocialPlatform } from '~~/shared/types/caption'
import type { PostingJobDto } from '~~/shared/types/posting-job'
import {
  buildGenericContentSnapshot,
  buildYoutubeContentSnapshot,
  parseHashtagsInput,
} from '~~/shared/types/posting-youtube'
import { useCaptionPreload } from '~~/app/composables/useCaptionPreload'

const { can } = usePermissions()

const props = defineProps<{
  videoId: number
  videoFormat: string
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  created: []
}>()

interface ActiveAccount {
  id: number
  displayName: string
  platform: SocialPlatform
  status: string
  postingMethod?: 'api' | 'browser_automation'
  proxyId?: string | null
  deviceProfileId?: string | null
  proxy?: {
    id: string
    label: string
    status: string
  } | null
  loginCheckedStatus?: boolean | null
  loginCheckedAt?: string | null
  loginCheckedUsername?: string | null
}

const { legacyModules, loadLegacyModules } = useLegacyModules()
loadLegacyModules()

// Загрузить список аккаунтов и групп
const accountFilters = computed(() => ({}))
const groupFilters = computed(() => ({}))
const { data: accountsData } = useAccounts(accountFilters)
const { data: groupsData } = useAccountGroups(groupFilters)

const accounts = computed(() => accountsData.value?.data ?? [])
const groups = computed(() => groupsData.value?.data ?? [])

const activeAccounts = computed(() =>
  accounts.value.filter((a: { status: string }) => a.status === 'active'),
)

// Шаг
const step = ref<1 | 2>(1)

// Шаг 1: выбор аккаунтов
const selectedAccountIds = ref<number[]>([])
const selectedGroupId = ref<number | undefined>(undefined)

// Шаг 2: мета-данные
const title = ref('')
const description = ref('')
const hashtagsRaw = ref('')
const scheduledAt = ref('')

// Флаги ручного редактирования — preload из Caption не должен затирать ввод оператора.
const userEditedTitle = ref(false)
const userEditedDescription = ref(false)
const userEditedHashtags = ref(false)

// Caption preload через единый composable (тот же что использует
// useYoutubePreflight + PostingJobYoutubeFields — один fetch, одна семантика).
const videoIdRef = computed(() => props.videoId)
const captionPreload = useCaptionPreload({ videoId: videoIdRef })

const { createUploads, isCreating, error } = useUploadActions()

// Hashtags: parser стрипает # префикс (фикс ## баг — раньше Upload не стрипал,
// poster добавлял свой # → ##fyp). Теперь единый источник правды.
const hashtags = computed<string[]>(() => parseHashtagsInput(hashtagsRaw.value))

const hasSelection = computed(() =>
  selectedAccountIds.value.length > 0 || !!selectedGroupId.value,
)

/**
 * true если среди выбранных аккаунтов есть хотя бы один с postingMethod=browser_automation.
 * UploadCreateModal — это legacy OAuth API flow (TikTok Business / YouTube Data / IG Graph).
 * Browser_automation аккаунты должны идти через /posting-jobs → "+ Создать задачу"
 * (PostingJobCreateModal Phase 2) — там Indigo + Chromium + pre-flight checklist.
 */
const hasBrowserAutomationSelected = computed(() => {
  for (const id of selectedAccountIds.value) {
    const acc = activeAccounts.value.find(
      (a: { id: number }) => a.id === id,
    ) as { postingMethod?: string } | undefined
    if (acc?.postingMethod === "browser_automation") return true
  }
  return false
})

/**
 * Aggregate pre-flight для browser_automation accounts (P2.1).
 *
 * UploadCreateModal — bulk-flow с выбором многих аккаунтов. Полноценный
 * 5-точечный checklist per account (как в PostingJobYoutubeFields) был бы
 * громоздок. Вместо этого собираем aggregate:
 *   - Сколько browser-аккаунтов выбрано
 *   - Сколько из них имеют readiness blocker (no proxy / no indigo / no login)
 *
 * Если есть blocker — показываем warning со списком проблемных аккаунтов.
 * Submit не блокируем (сервер всё равно вернёт 412 per account в errors[]),
 * но оператор видит проблемы до клика.
 *
 * useYoutubePreflight для каждого account на лету был бы дорог (N×$fetch
 * captions). Здесь читаем proxy/indigo/login напрямую из account-объекта.
 */
interface BrowserAccountIssue {
  accountId: number
  displayName: string
  platform: SocialPlatform
  reasons: string[]
}

const browserAccountsIssues = computed<BrowserAccountIssue[]>(() => {
  const issues: BrowserAccountIssue[] = []
  for (const id of selectedAccountIds.value) {
    const acc = activeAccounts.value.find(
      (a: { id: number }) => a.id === id,
    ) as ActiveAccount | undefined
    if (!acc || acc.postingMethod !== "browser_automation") continue

    const reasons: string[] = []
    // Reuse pre-flight семантики из useYoutubePreflight: те же blocker'ы.
    if (!acc.proxyId) {
      reasons.push("нет прокси (постинг с реального IP сервера = бан)")
    }
    else if (
      (acc as { proxy?: { status?: string } }).proxy?.status !== "healthy"
    ) {
      const st = (acc as { proxy?: { status?: string } }).proxy?.status ?? "?"
      reasons.push(`прокси не healthy (${st})`)
    }
    if (!acc.deviceProfileId) {
      reasons.push("нет device-профиля")
    }
    const loginStatus = (acc as { loginCheckedStatus?: boolean | null }).loginCheckedStatus
    if (loginStatus !== true) {
      reasons.push(
        loginStatus === false
          ? "не залогинен (login-check показал false)"
          : "login-check не выполнялся",
      )
    }

    if (reasons.length > 0) {
      issues.push({
        accountId: acc.id,
        displayName: acc.displayName,
        platform: acc.platform,
        reasons,
      })
    }
  }
  return issues
})

const hasBrowserPreflightBlockers = computed(
  () => browserAccountsIssues.value.length > 0,
)

function toggleAccount(id: number) {
  const idx = selectedAccountIds.value.indexOf(id)
  if (idx >= 0) {
    selectedAccountIds.value.splice(idx, 1)
  } else {
    selectedAccountIds.value.push(id)
  }
}

/**
 * Заполняет form fields из лучшего Caption под выбранные аккаунты.
 *
 * Логика выбора Caption делегирована в useCaptionPreload.pickBestCaption —
 * единая семантика с PostingJobYoutubeFields.
 *
 * Поля которые оператор уже редактировал (userEdited флаги) — НЕ перезаписываем.
 * Запускается каждый раз при step→2 и при изменении selectedAccountIds (платформы
 * могут поменяться → caption под другую платформу).
 */
function preloadFormFromCaptions() {
  if (!captionPreload.loaded.value) return

  // Платформы выбранных аккаунтов — для priority выбора Caption.
  const selectedPlatforms: SocialPlatform[] = []
  for (const accId of selectedAccountIds.value) {
    const acc = activeAccounts.value.find((a: { id: number }) => a.id === accId)
    if (acc) {
      const p = (acc as { platform: SocialPlatform }).platform
      if (!selectedPlatforms.includes(p)) selectedPlatforms.push(p)
    }
  }
  const prefer: SocialPlatform[] = selectedPlatforms.length > 0
    ? ['youtube', 'tiktok', 'instagram'].filter(
      p => selectedPlatforms.includes(p as SocialPlatform),
    ) as SocialPlatform[]
    : []

  const caption = captionPreload.pickBestCaption(prefer.length > 0 ? prefer : undefined)
  if (!caption) return

  if (!userEditedTitle.value && !title.value) {
    title.value = caption.title
  }
  if (!userEditedDescription.value && !description.value) {
    description.value = caption.description ?? ''
  }
  if (!userEditedHashtags.value && !hashtagsRaw.value) {
    // Caption.hashtags в БД БЕЗ #. Для UI добавляем #-префикс для читаемости.
    // parseHashtagsInput на submit'е стрипает обратно (фикс ## баг).
    hashtagsRaw.value = caption.hashtags.map((h) => `#${h}`).join(' ')
  }
}

async function goToStep2() {
  if (hasSelection.value) {
    step.value = 2
    // Если caption уже подгрузился (фоновый fetch при open) — preload сразу.
    // Если ещё нет — preload отработает через watch ниже когда loaded станет true.
    preloadFormFromCaptions()
  }
}

function goBackToStep1() {
  step.value = 1
}

function closeModal() {
  emit('update:open', false)
  resetForm()
}

function resetForm() {
  step.value = 1
  selectedAccountIds.value = []
  selectedGroupId.value = undefined
  title.value = ''
  description.value = ''
  hashtagsRaw.value = ''
  scheduledAt.value = ''
  userEditedTitle.value = false
  userEditedDescription.value = false
  userEditedHashtags.value = false
  error.value = null
}

// Caption preload работает автоматически через useCaptionPreload (watch на
// videoId с debounce + AbortController). На step→2 / при изменении выбранных
// аккаунтов автозаполняем form fields из лучшего Caption.
watch(
  () => captionPreload.loaded.value,
  (loaded) => {
    if (loaded && step.value === 2) preloadFormFromCaptions()
  },
)
watch(selectedAccountIds, () => {
  if (step.value === 2) preloadFormFromCaptions()
}, { deep: true })

/** Сообщение после submit — про browser_automation routing / env-guard / частичные ошибки. */
const postSubmitNotice = ref<string | null>(null)
const isSubmittingPostingJobs = ref(false)

/**
 * Разводит выбранные аккаунты на два пути:
 *   - postingMethod='api' → POST /api/uploads/create (legacy OAuth flow, requires
 *     verified API tokens + ENABLE_SOCIAL_POSTING=true).
 *   - postingMethod='browser_automation' → POST /api/posting-jobs per account
 *     (Phase 2 Indigo + Chromium flow, всегда работает если 1:1:1 готов).
 *
 * Для YouTube browser_automation accounts требуется structured contentSnapshot:
 *   { title, description, hashtags, youtube: { visibility, madeForKids } }
 * UploadCreateModal — bulk-flow, не имеет UI для per-account visibility/madeForKids.
 * Дефолтим visibility=private + madeForKids=false (fail-safe — private видит только
 * владелец канала). Оператор может позже изменить через YouTube Studio или создать
 * job точечно через /posting-jobs с другими параметрами.
 */
function splitAccountsByMethod(): {
  api: ActiveAccount[]
  browser: ActiveAccount[]
} {
  const ids = new Set(selectedAccountIds.value)
  const api: ActiveAccount[] = []
  const browser: ActiveAccount[] = []
  for (const acc of activeAccounts.value as ActiveAccount[]) {
    if (!ids.has(acc.id)) continue
    if (acc.postingMethod === 'browser_automation') {
      browser.push(acc)
    }
    else {
      api.push(acc)
    }
  }
  return { api, browser }
}

async function createPostingJobsForBrowserAccounts(
  accounts: ActiveAccount[],
  scheduledAtIso: string | null,
): Promise<{ created: number; errors: string[] }> {
  const errors: string[] = []
  let created = 0

  // Device-постинг относится к унаследованному контуру: его API отдаёт 404, когда
  // зона выключена. Говорим об этом прямо, а не роняем оператора в невнятную ошибку.
  if (accounts.length && !legacyModules.value.deviceAutomation) {
    return {
      created: 0,
      errors: accounts.map(acc =>
        `${acc.displayName}: постинг через устройство отключён в этой установке`),
    }
  }

  for (const acc of accounts) {
    // Платформо-специфичный contentSnapshot через shared builders из
    // shared/types/posting-youtube.ts — единый источник правды (тот же что
    // использует PostingJobCreateModal Phase 2). YouTube требует structured
    // youtube namespace; TikTok/Instagram — generic caption snapshot.
    //
    // Fail-safe дефолты YouTube: visibility='private' (только владелец видит),
    // madeForKids=false. Оператор может изменить через YouTube Studio или
    // создать job вручную через /posting-jobs для точной настройки.
    const contentSnapshot
      = acc.platform === 'youtube'
        ? buildYoutubeContentSnapshot({
          title: title.value,
          description: description.value,
          hashtags: hashtags.value,
          visibility: 'private',
          madeForKids: false,
        })
        : buildGenericContentSnapshot({
          caption: title.value,
          description: description.value,
          hashtags: hashtags.value,
        })

    try {
      await $fetch<{ data: PostingJobDto }>('/api/posting-jobs', {
        method: 'POST',
        body: {
          videoId: props.videoId,
          socialAccountId: acc.id,
          platform: acc.platform,
          contentSnapshot,
          scheduledAt: scheduledAtIso,
        },
      })
      created += 1
    }
    catch (err: unknown) {
      const e = err as {
        statusCode?: number
        data?: { message?: string; data?: { code?: string } }
        message?: string
      }
      const code = e?.data?.data?.code
      const msg
        = e?.data?.message
          ?? e?.message
          ?? 'unknown error'
      errors.push(`${acc.displayName} (${acc.platform}): ${code ?? e?.statusCode ?? ''} ${msg}`)
    }
  }
  return { created, errors }
}

async function handleSubmit(schedule: boolean) {
  postSubmitNotice.value = null
  error.value = null

  const scheduledAtIso = schedule && scheduledAt.value
    ? new Date(scheduledAt.value).toISOString()
    : null

  const { api, browser } = splitAccountsByMethod()

  // Безопасный gate: для YouTube/Instagram browser_automation accounts нужны
  // healthy proxy + indigo profile. Серверный POST /api/posting-jobs всё равно
  // вернёт 412 если что-то не так — пробрасываем в errors[].
  let apiCreated = 0
  let apiBlockedByEnv = false

  // 1. Старый flow для api accounts (если есть).
  if (api.length > 0 || selectedGroupId.value) {
    const params = {
      videoId: props.videoId,
      accountIds: api.length > 0 ? api.map(a => a.id) : undefined,
      // groupId передаём как был — backend сам отфильтрует api accounts из группы.
      groupId: selectedGroupId.value,
      title: title.value.trim(),
      description: description.value.trim() || undefined,
      hashtags: hashtags.value.length > 0 ? hashtags.value : undefined,
      scheduledAt: schedule && scheduledAt.value ? scheduledAt.value : undefined,
    }
    const result = await createUploads(params)
    if (result) {
      const meta = (result as { meta?: { blockedByEnv?: boolean; created?: number } }).meta
      apiCreated = meta?.created ?? 0
      apiBlockedByEnv = meta?.blockedByEnv ?? false
    }
    // Если ошибка от createUploads — она уже в error.value (показывается отдельно).
  }

  // 2. Новый flow для browser_automation accounts.
  let browserCreated = 0
  let browserErrors: string[] = []
  if (browser.length > 0) {
    isSubmittingPostingJobs.value = true
    try {
      const result = await createPostingJobsForBrowserAccounts(browser, scheduledAtIso)
      browserCreated = result.created
      browserErrors = result.errors
    }
    finally {
      isSubmittingPostingJobs.value = false
    }
  }

  // Собираем итоговое уведомление: что создано, что упало, где смотреть прогресс.
  const notices: string[] = []
  if (browserCreated > 0) {
    const youtubeBrowser = browser.filter(a => a.platform === 'youtube').length
    notices.push(
      `Создано ${browserCreated} задач постинга через браузер.`
      + (youtubeBrowser > 0
        ? ' YouTube опубликует как private (можно изменить в Studio или /posting-jobs).'
        : ''),
    )
  }
  if (apiCreated > 0 && !apiBlockedByEnv) {
    notices.push(`Создано ${apiCreated} OAuth загрузок (TikTok/YT Data/IG Graph).`)
  }
  if (apiBlockedByEnv) {
    notices.push(
      `Создано ${apiCreated} OAuth загрузок, но публикация через API отключена на сервере `
      + '(ENABLE_SOCIAL_POSTING=false). Эти видео НЕ загрузятся.',
    )
  }
  if (browserErrors.length > 0) {
    notices.push(`Не удалось создать ${browserErrors.length} browser-задач:\n${browserErrors.join('\n')}`)
  }

  if (notices.length === 0 && error.value === null) {
    // Нечего показать — но и не успешно (никто не выбран). Безопаснее остаться.
    return
  }

  postSubmitNotice.value = notices.join('\n\n')

  // Закрываем модалку только если хоть что-то создалось без блокеров.
  if ((browserCreated > 0 || (apiCreated > 0 && !apiBlockedByEnv))
    && browserErrors.length === 0
    && !apiBlockedByEnv) {
    closeModal()
    emit('created')
  }
}
</script>

<template>
  <dialog v-if="can('canRunAgent')" class="modal" :class="{ 'modal-open': open }">
    <div class="modal-box max-w-lg">
      <h3 class="font-bold text-lg mb-1">Загрузить в соцсети</h3>
      <p class="text-xs text-base-content/60 mb-4">
        Выберите аккаунты, заполните мета-данные и опубликуйте сейчас или по расписанию.
      </p>

      <!-- Шаг 1: Выбор аккаунтов -->
      <template v-if="step === 1">
        <p class="text-xs text-base-content/60 mb-3">Выберите аккаунты или пачку</p>

        <!-- Пачка -->
        <fieldset v-if="groups.length > 0" class="fieldset mb-4">
          <legend class="fieldset-legend">Пачка аккаунтов</legend>
          <select v-model="selectedGroupId" class="select select-sm w-full">
            <option :value="undefined">Не выбрана</option>
            <option
              v-for="group in groups"
              :key="group.id"
              :value="group.id"
            >
              {{ group.name }} ({{ group.members.length }} аккаунтов)
            </option>
          </select>
        </fieldset>

        <!-- Аккаунты -->
        <div v-if="activeAccounts.length > 0" class="space-y-2">
          <p class="text-sm font-medium text-base-content/70">Или выберите аккаунты:</p>
          <label
            v-for="acc in activeAccounts"
            :key="acc.id"
            class="flex items-center gap-3 p-2 rounded-lg hover:bg-base-200 cursor-pointer"
          >
            <input
              type="checkbox"
              class="checkbox checkbox-sm checkbox-primary"
              :checked="selectedAccountIds.includes(acc.id)"
              @change="toggleAccount(acc.id)"
            />
            <Icon
              :name="acc.platform === 'youtube' ? 'mingcute:youtube-line' : acc.platform === 'tiktok' ? 'mingcute:tiktok-line' : 'mingcute:instagram-line'"
              class="text-lg"
            />
            <span class="text-sm flex-1 min-w-0 truncate">{{ acc.displayName }}</span>
            <span
              v-if="acc.postingMethod === 'browser_automation'"
              class="badge badge-xs badge-warning gap-1 shrink-0"
              title="Этот аккаунт постит через устройство DuoPlus"
            >
              <Icon name="mingcute:robot-line" class="text-xs" />
              Browser
            </span>
            <AccountReadinessBadge
              v-if="acc.postingMethod === 'browser_automation'"
              :account="acc"
            />
          </label>
        </div>

        <!-- Info если выбраны browser_automation аккаунты — публикация через Indigo. -->
        <div
          v-if="hasBrowserAutomationSelected && !hasBrowserPreflightBlockers"
          role="alert"
          class="alert alert-info alert-soft text-xs"
        >
          <Icon name="mingcute:information-line" class="text-sm shrink-0" />
          <div class="flex-1">
            <div class="font-medium mb-0.5">
              Browser-аккаунты опубликуют через Indigo + Chromium
            </div>
            <div>
              Для каждого browser-аккаунта будет создана задача постинга
              (видно в <NuxtLink to="/posting-jobs" class="link link-primary">/posting-jobs</NuxtLink>).
              YouTube videos опубликуются с visibility=<span class="font-mono">private</span> и
              made-for-kids=<span class="font-mono">no</span> по умолчанию. Для точной настройки
              видимости (public/unlisted) используйте /posting-jobs → "+ Создать задачу".
            </div>
          </div>
        </div>

        <!-- Aggregate pre-flight: список проблемных browser-аккаунтов -->
        <div
          v-if="hasBrowserPreflightBlockers"
          role="alert"
          class="alert alert-warning alert-soft text-xs"
        >
          <Icon name="mingcute:warning-line" class="text-sm shrink-0" />
          <div class="flex-1">
            <div class="font-medium mb-1">
              Часть выбранных browser-аккаунтов не готова к публикации:
            </div>
            <ul class="space-y-0.5 list-disc list-inside">
              <li v-for="iss in browserAccountsIssues" :key="iss.accountId">
                <span class="font-medium">{{ iss.displayName }}</span>
                ({{ iss.platform }}):
                <span class="text-base-content/70">{{ iss.reasons.join(', ') }}</span>
              </li>
            </ul>
            <div class="mt-1 text-base-content/60">
              Эти аккаунты получат 412-ошибку от сервера. Исправьте на странице
              <NuxtLink to="/accounts" class="link link-primary">/accounts</NuxtLink>
              или снимите выбор — остальные аккаунты создадутся успешно.
            </div>
          </div>
        </div>

        <div v-if="activeAccounts.length === 0 && groups.length === 0" class="py-6 text-center">
          <p class="text-sm text-base-content/50">Нет активных аккаунтов. Подключите аккаунт на странице "Аккаунты".</p>
        </div>

        <div class="modal-action">
          <button class="btn btn-sm btn-ghost" @click="closeModal">Отмена</button>
          <button class="btn btn-sm btn-primary" :disabled="!hasSelection" @click="goToStep2">
            Далее
          </button>
        </div>
      </template>

      <!-- Шаг 2: Мета-данные -->
      <template v-if="step === 2">
        <UploadMetaForm
          v-model:title="title"
          v-model:description="description"
          v-model:hashtags-raw="hashtagsRaw"
          v-model:scheduled-at="scheduledAt"
          :cache-scope="String(videoId)"
          @edit:title="userEditedTitle = true"
          @edit:description="userEditedDescription = true"
          @edit:hashtags="userEditedHashtags = true"
        />

        <!-- Caption preload hint -->
        <div
          v-if="captionPreload.captions.value.length > 0"
          class="alert alert-info alert-soft text-xs mt-2"
        >
          <Icon name="mingcute:information-line" class="text-sm shrink-0" />
          <span>
            Подтянут утверждённый caption из видео.
            Можно отредактировать или сгенерировать новый AI-кнопкой.
          </span>
        </div>

        <!-- Ошибка -->
        <div v-if="error" role="alert" class="alert alert-error alert-soft text-sm mt-3">
          <Icon name="mingcute:warning-line" />
          <span>{{ error }}</span>
        </div>

        <!-- Post-submit notice: blocked_by_env / browser_automation routing -->
        <div
          v-if="postSubmitNotice"
          role="alert"
          class="alert alert-warning alert-soft text-xs mt-3"
        >
          <Icon name="mingcute:warning-line" class="text-sm shrink-0" />
          <div class="flex-1">
            <div class="font-medium mb-0.5">Видео НЕ опубликовано</div>
            <div class="break-words">{{ postSubmitNotice }}</div>
            <NuxtLink
              to="/posting-jobs"
              class="link link-primary font-medium text-xs mt-1 inline-block"
            >
              → Перейти к Posting Jobs
            </NuxtLink>
          </div>
        </div>

        <div class="modal-action">
          <button class="btn btn-sm btn-ghost" @click="goBackToStep1">Назад</button>
          <button
            class="btn btn-sm btn-primary"
            :disabled="!title.trim() || isCreating || isSubmittingPostingJobs"
            @click="handleSubmit(false)"
          >
            <span
              v-if="isCreating || isSubmittingPostingJobs"
              class="loading loading-spinner loading-xs"
            />
            Загрузить сейчас
          </button>
          <button
            v-if="scheduledAt"
            class="btn btn-sm btn-warning"
            :disabled="!title.trim() || isCreating || isSubmittingPostingJobs"
            @click="handleSubmit(true)"
          >
            Запланировать
          </button>
        </div>
      </template>
    </div>

    <form method="dialog" class="modal-backdrop">
      <button @click="closeModal">close</button>
    </form>
  </dialog>
</template>
