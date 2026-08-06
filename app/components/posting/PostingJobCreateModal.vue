<script setup lang="ts">
/**
 * Ручная постановка публикации в очередь.
 *
 * Источник истины по отказам — сервер (`POST /api/posting-jobs`): нет прокси,
 * прокси не здоров, не прошла валидация. Клиент проверяет то же самое заранее,
 * чтобы не отправлять заведомо проигрышный запрос, но последнее слово за сервером.
 *
 * У каждой платформы своя форма содержимого: YouTube требует заголовок,
 * видимость и отметку «для детей», Instagram — подпись и хэштеги в своих
 * пределах, TikTok довольствуется общим набором.
 */
import { toDiagnosticError, type AccountDiagnosticError } from '~~/shared/types/account-diagnostic'
import type { PostingJobDto, PostingPlatform } from '~~/shared/types/posting-job'
import {
  buildGenericContentSnapshot,
  buildYoutubeContentSnapshot,
  parseHashtagsInput,
  type PreflightCheck,
  type YoutubeVisibility,
} from '~~/shared/types/posting-youtube'
import { buildInstagramContentSnapshot } from '~~/shared/types/posting-instagram'
import type { LoginCheckResult } from '~~/shared/types/login-check'
import { useLoginCheck } from '~~/app/composables/useLoginCheck'
import { platformMeta } from '~/components/ui/platform-meta'

const emit = defineEmits<{ created: [job: PostingJobDto] }>()

const isOpen = ref(false)
const submitting = ref(false)
const error = ref<AccountDiagnosticError | null>(null)

/**
 * Живой результат проверки входа важнее сохранённого: временный сбой связи с
 * устройством не значит, что аккаунт разлогинен.
 */
const liveLoginResult = ref<LoginCheckResult | null>(null)

// Пустая строка — это «не выбрано» в UiSelect; отдельного null он не отдаёт.
const socialAccountId = ref<number | '' | null>(null)
const videoId = ref<number | '' | null>(null)
const scheduledMode = ref<'asap' | 'scheduled'>('asap')
const scheduledAtLocal = ref<string>('')

const caption = ref('')
const description = ref('')
const hashtagsRaw = ref('')

interface YoutubeFormState {
  title: string
  description: string
  hashtags: string[]
  visibility: YoutubeVisibility | null
  madeForKids: boolean | null
}

const youtubeForm = ref<YoutubeFormState>({
  title: '',
  description: '',
  hashtags: [],
  visibility: null,
  madeForKids: null,
})
const youtubeValid = ref(false)

interface InstagramFormState {
  caption: string
  hashtags: string[]
}

const instagramForm = ref<InstagramFormState>({ caption: '', hashtags: [] })
// Пустая форма Instagram невалидна до первого сигнала от полей — иначе можно
// было бы отправить публикацию вообще без подписи.
const instagramValid = ref(false)

const accountFilters = ref<{ status?: string }>({ status: 'active' })
const { data: accountsData, refresh: refreshAccounts } = useAccounts(
  accountFilters as Ref<{ status?: string }>,
)

const videoFilters = ref<{ status?: string, perPage?: number }>({ status: 'completed', perPage: 50 })
const { data: videosData, refresh: refreshVideos } = useVideos(
  videoFilters as Ref<{ status?: string, perPage?: number }>,
)

interface AccountListItem {
  id: number
  displayName: string
  platform: PostingPlatform
  status: 'active' | 'expired' | 'revoked'
  postingMethod?: 'api' | 'browser_automation'
  proxyId?: string | null
  deviceProfileId?: string | null
  proxy?: { id: string, label: string, status: 'unverified' | 'healthy' | 'degraded' | 'dead' | 'expired' } | null
  loginCheckedStatus?: boolean | null
  loginCheckedAt?: string | null
  loginCheckedUsername?: string | null
}

interface VideoListItem {
  id: number
  status: string
  fileUrl: string | null
  duration: number | null
  scenario?: { id: number, variants?: Array<{ title: string }> } | null
}

const accounts = computed<AccountListItem[]>(() => (accountsData.value?.data ?? []) as AccountListItem[])
const videos = computed<VideoListItem[]>(() => (videosData.value?.data ?? []) as VideoListItem[])

const accountOptions = computed(() => [
  { value: '', label: 'Выберите аккаунт' },
  ...accounts.value.map(a => ({
    value: a.id,
    label: [
      a.displayName,
      platformMeta(a.platform).label,
      a.postingMethod === 'browser_automation' ? 'через устройство' : 'официальный API',
      a.proxy ? `прокси ${a.proxy.status}` : 'без прокси',
    ].join(' · '),
  })),
])

const videoOptions = computed(() => [
  { value: '', label: 'Выберите ролик' },
  ...videos.value.map(v => ({
    value: v.id,
    label: [
      `Ролик ${v.id}`,
      v.scenario?.variants?.[0]?.title,
      v.duration ? `${v.duration} с` : null,
    ].filter(Boolean).join(' · '),
  })),
])

const selectedAccount = computed<AccountListItem | null>(
  () => (socialAccountId.value ? accounts.value.find(a => a.id === socialAccountId.value) ?? null : null),
)
const selectedVideo = computed<VideoListItem | null>(
  () => (videoId.value ? videos.value.find(v => v.id === videoId.value) ?? null : null),
)

const isYoutube = computed(() => selectedAccount.value?.platform === 'youtube')
const isInstagram = computed(() => selectedAccount.value?.platform === 'instagram')

const accountReadinessIssue = computed<string | null>(() => {
  const a = selectedAccount.value
  if (!a) return null
  if (a.status !== 'active') return 'Аккаунт не активен — платформа отклонит публикацию.'
  if (!a.proxyId) return 'У аккаунта нет прокси — сервер отклонит задачу.'
  if (a.proxy && a.proxy.status !== 'healthy') return `Прокси в состоянии «${a.proxy.status}» — сервер отклонит задачу.`
  if (a.postingMethod === 'browser_automation' && !a.deviceProfileId) {
    return 'Публикация через устройство требует привязанного профиля устройства.'
  }
  if (a.postingMethod === 'browser_automation' && a.loginCheckedStatus === false) {
    const live = liveLoginResult.value
    const liveOverrides = live != null
      && live.accountId === a.id
      && (live.outcome === 'transient' || live.outcome === 'confirmed')
    if (!liveOverrides) return 'Проверка показала: на устройстве в аккаунт не вошли.'
  }
  return null
})

const liveLoginOverride = computed(() => {
  const live = liveLoginResult.value
  const a = selectedAccount.value
  return live != null && a != null && live.accountId === a.id
    && (live.outcome === 'transient' || live.outcome === 'confirmed')
})

/** Список того, что мешает отправить — прямо над кнопкой, а не догадками. */
const submitBlockers = computed<string[]>(() => {
  const out: string[] = []
  if (!socialAccountId.value) out.push('Выберите аккаунт')
  if (!videoId.value) out.push('Выберите ролик')
  if (scheduledMode.value === 'scheduled' && !scheduledAtLocal.value) out.push('Укажите время публикации')
  if (isYoutube.value) {
    if (!youtubeForm.value.title.trim()) out.push('Заголовок обязателен')
    if (youtubeForm.value.visibility === null) out.push('Выберите, кто увидит ролик')
    if (youtubeForm.value.madeForKids === null) out.push('Отметьте, ролик для детей или нет')
    if (!youtubeValid.value
      && youtubeForm.value.visibility !== null
      && youtubeForm.value.madeForKids !== null
      && youtubeForm.value.title.trim()) {
      out.push('Проверки перед отправкой: исправьте красные пункты')
    }
  }
  if (isInstagram.value && !instagramValid.value) {
    out.push('Заполните подпись или хэштеги — не длиннее 2200 символов и 30 хэштегов')
  }
  return out
})

const canSubmit = computed(() => {
  if (submitting.value) return false
  if (!socialAccountId.value || !videoId.value) return false
  if (scheduledMode.value === 'scheduled' && !scheduledAtLocal.value) return false
  if (isYoutube.value && !youtubeValid.value) return false
  if (isInstagram.value && !instagramValid.value) return false
  return true
})

const { runCheck: runLoginCheck, isBusy: loginCheckBusy } = useLoginCheck()

async function handlePreflightAction(check: PreflightCheck) {
  if (!check.actionType) return
  const accountId = socialAccountId.value
  switch (check.actionType) {
    case 'run_login_check':
      if (accountId) {
        const result = await runLoginCheck(accountId)
        liveLoginResult.value = result
        await refreshAccounts()
      }
      break
    case 'open_caption_editor':
      if (videoId.value) window.open(`/videos/${videoId.value}#captions`, '_blank')
      break
    case 'open_indigo_profile':
      window.open('/devices', '_blank')
      break
    case 'select_proxy':
    case 'select_video':
      break
    case 'run_deep_check':
      if (accountId) {
        try {
          await $fetch(`/api/accounts/${accountId}/deep-proxy-check`, { method: 'POST' })
          await refreshAccounts()
        }
        catch {
          // Проверка необязательна: её результат появится в чек-листе позже.
        }
      }
      break
  }
}

function resetForm() {
  socialAccountId.value = null
  videoId.value = null
  scheduledMode.value = 'asap'
  scheduledAtLocal.value = ''
  caption.value = ''
  description.value = ''
  hashtagsRaw.value = ''
  youtubeForm.value = { title: '', description: '', hashtags: [], visibility: null, madeForKids: null }
  youtubeValid.value = false
  instagramForm.value = { caption: '', hashtags: [] }
  instagramValid.value = false
  liveLoginResult.value = null
  error.value = null
  submitting.value = false
}

function open(initial?: { accountId?: number }) {
  resetForm()
  if (initial?.accountId) socialAccountId.value = initial.accountId
  isOpen.value = true
  refreshAccounts()
  refreshVideos()
}

function close() {
  isOpen.value = false
  resetForm()
}

/** Публикации не должны выходить по будильнику — время разбрасывается в окне суток. */
function fillRandomTime() {
  const minMs = 60 * 60 * 1000
  const maxMs = 24 * 60 * 60 * 1000
  const offset = minMs + Math.random() * (maxMs - minMs)
  const target = new Date(Date.now() + offset)
  const pad = (n: number) => String(n).padStart(2, '0')
  scheduledAtLocal.value
    = `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`
    + `T${pad(target.getHours())}:${pad(target.getMinutes())}`
  scheduledMode.value = 'scheduled'
}

async function submit() {
  if (!canSubmit.value) return
  const account = selectedAccount.value
  if (!account) return

  error.value = null
  submitting.value = true

  const scheduledAtIso = scheduledMode.value === 'scheduled' && scheduledAtLocal.value
    ? new Date(scheduledAtLocal.value).toISOString()
    : null

  // Снимок содержимого собирают общие сборщики из shared — те же, что у формы
  // публикации, чтобы форма снимка не разошлась между двумя окнами.
  let contentSnapshot: Record<string, unknown>
  if (isYoutube.value) {
    const yt = youtubeForm.value
    contentSnapshot = buildYoutubeContentSnapshot({
      title: yt.title,
      description: yt.description,
      hashtags: yt.hashtags,
      visibility: yt.visibility!,
      madeForKids: yt.madeForKids!,
    }) as unknown as Record<string, unknown>
  }
  else if (isInstagram.value) {
    contentSnapshot = buildInstagramContentSnapshot({
      caption: instagramForm.value.caption,
      hashtags: instagramForm.value.hashtags,
    }) as unknown as Record<string, unknown>
  }
  else {
    contentSnapshot = buildGenericContentSnapshot({
      caption: caption.value,
      description: description.value,
      hashtags: parseHashtagsInput(hashtagsRaw.value),
    }) as unknown as Record<string, unknown>
  }

  try {
    const res = await $fetch<{ data: PostingJobDto }>('/api/posting-jobs', {
      method: 'POST',
      body: {
        videoId: Number(videoId.value),
        socialAccountId: Number(socialAccountId.value),
        platform: account.platform,
        contentSnapshot,
        scheduledAt: scheduledAtIso,
      },
    })
    emit('created', res.data)
    close()
  }
  catch (e: unknown) {
    error.value = toDiagnosticError(e, {
      phase: 'posting_job_create',
      url: '/api/posting-jobs',
    })
  }
  finally {
    submitting.value = false
  }
}

defineExpose({ open, close })
</script>

<template>
  <UiModal :open="isOpen" title="Новая публикация" size="lg" :persistent="submitting" @close="close">
    <div class="flex flex-col gap-4">
      <p class="text-sm text-muted">
        Задачу подхватит воркер. Перед отправкой он ещё раз проверит аккаунт и прокси —
        если проверка не пройдёт, задача упадёт с объяснением.
      </p>

      <UiField label="Аккаунт">
        <UiSelect
          v-model="socialAccountId"
          :options="accountOptions"
          :disabled="submitting"
        />
      </UiField>

      <div v-if="selectedAccount" class="flex flex-wrap items-center gap-1.5">
        <UiPlatformBadge :platform="selectedAccount.platform" />
        <span
          v-if="selectedAccount.postingMethod === 'browser_automation'"
          class="flex h-[22px] items-center gap-1.5 rounded-sm border border-warning-border bg-warning-bg px-2 text-sm text-warning"
        >
          <Icon name="mingcute:robot-line" />
          через устройство
        </span>
        <ProxyHealthBadge v-if="selectedAccount.proxy" :status="selectedAccount.proxy.status" size="sm" />
        <span
          v-else
          class="flex h-[22px] items-center gap-1.5 rounded-sm border border-danger-border bg-danger-bg px-2 text-sm text-danger"
        >
          <Icon name="mingcute:warning-line" />
          без прокси
        </span>
        <AccountLoginStatusBadge
          v-if="selectedAccount.postingMethod === 'browser_automation' && !liveLoginOverride"
          :login-checked-at="selectedAccount.loginCheckedAt"
          :login-checked-status="selectedAccount.loginCheckedStatus"
          :login-checked-username="selectedAccount.loginCheckedUsername"
        />
        <AccountReadinessBadge :account="selectedAccount" :live-login-result="liveLoginResult" />
      </div>

      <p
        v-if="accountReadinessIssue"
        class="flex gap-2 rounded-md border border-warning-border bg-warning-bg p-2.5 text-sm"
      >
        <Icon name="mingcute:warning-line" class="mt-0.5 shrink-0 text-warning" />
        {{ accountReadinessIssue }}
      </p>

      <UiField label="Ролик" hint="В списке только собранные ролики.">
        <UiSelect v-model="videoId" :options="videoOptions" :disabled="submitting" />
      </UiField>

      <UiField label="Когда публиковать">
        <div class="flex flex-wrap items-center gap-4">
          <label class="flex cursor-pointer items-center gap-2 text-sm">
            <input
              v-model="scheduledMode"
              type="radio"
              value="asap"
              class="size-3.5 cursor-pointer accent-(--color-accent)"
              :disabled="submitting"
            >
            Как можно скорее
          </label>
          <label class="flex cursor-pointer items-center gap-2 text-sm">
            <input
              v-model="scheduledMode"
              type="radio"
              value="scheduled"
              class="size-3.5 cursor-pointer accent-(--color-accent)"
              :disabled="submitting"
            >
            К определённому времени
          </label>
        </div>
        <div v-if="scheduledMode === 'scheduled'" class="mt-2 flex flex-wrap items-center gap-2">
          <UiInput v-model="scheduledAtLocal" type="datetime-local" class="max-w-56" :disabled="submitting" />
          <UiButton
            variant="ghost"
            :disabled="submitting"
            title="Разбросать время в ближайшие сутки, чтобы публикации не выходили по будильнику"
            @click="fillRandomTime"
          >
            <Icon name="mingcute:shuffle-line" />
            Случайное время
          </UiButton>
        </div>
      </UiField>

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

      <PostingJobInstagramFields
        v-else-if="isInstagram"
        :video="selectedVideo"
        :disabled="submitting"
        @update="(payload) => (instagramForm = payload)"
        @update:valid="(v) => (instagramValid = v)"
      />

      <template v-else>
        <UiField label="Заголовок">
          <UiInput v-model="caption" placeholder="Краткое название публикации" :disabled="submitting" />
        </UiField>
        <UiField label="Описание">
          <UiTextarea v-model="description" :rows="2" placeholder="Текст под роликом" :disabled="submitting" />
        </UiField>
        <UiField label="Хэштеги" hint="Через пробел или запятую.">
          <UiInput v-model="hashtagsRaw" placeholder="#мебель #ремонт" :disabled="submitting" />
        </UiField>
      </template>

      <AccountDiagnosticPanel :error="error" />

      <div
        v-if="!canSubmit && submitBlockers.length"
        class="flex gap-2 rounded-md border border-warning-border bg-warning-bg p-2.5 text-sm"
      >
        <Icon name="mingcute:warning-line" class="mt-0.5 shrink-0 text-warning" />
        <div>
          <div class="font-medium">Чтобы поставить публикацию, осталось:</div>
          <ul class="mt-0.5 list-inside list-disc">
            <li v-for="b in submitBlockers" :key="b">{{ b }}</li>
          </ul>
        </div>
      </div>
    </div>

    <template #footer>
      <UiButton variant="ghost" :disabled="submitting" @click="close">Отмена</UiButton>
      <UiButton variant="primary" :loading="submitting" :disabled="!canSubmit" @click="submit">
        <Icon v-if="!submitting" name="mingcute:send-line" />
        Поставить в очередь
      </UiButton>
    </template>
  </UiModal>
</template>
