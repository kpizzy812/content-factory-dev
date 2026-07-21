<script setup lang="ts">
/**
 * Orchestrator YouTube-секции в PostingJobCreateModal.
 *
 * Объединяет:
 *   - title input (≤100, обязателен)
 *   - description textarea (≤5000, опц.)
 *   - hashtags input (≤500 chars суммарно)
 *   - VisibilitySelector
 *   - madeForKids select (без дефолта — null до явного выбора)
 *   - YoutubePreflightChecklist + useYoutubePreflight
 *
 * Preload из Caption (если для videoId есть approved youtube caption):
 *   - грузим через /api/videos/:id/captions при изменении videoId
 *   - заполняем title/description/hashtags только если оператор ещё не редактировал
 *
 * Emit'ит form state + valid флаг родителю.
 */
import {
  YOUTUBE_LIMITS,
  parseHashtagsInput,
  type YoutubeVisibility,
} from "~~/shared/types/posting-youtube"
import type {
  PreflightAccount,
  PreflightVideo,
} from "~~/app/composables/useYoutubePreflight"
import type { PreflightCheck } from "~~/shared/types/posting-youtube"
import type { LoginCheckResult } from "~~/shared/types/login-check"
import { useYoutubePreflight } from "~~/app/composables/useYoutubePreflight"

const props = defineProps<{
  account: PreflightAccount | null
  video: PreflightVideo | null
  disabled?: boolean
  /** Live-результат login-check (transient → warn вместо blocker в pre-flight). */
  liveLoginResult?: LoginCheckResult | null
}>()

const emit = defineEmits<{
  /** Текущее состояние формы — родитель собирает body запроса. */
  update: [
    payload: {
      title: string
      description: string
      hashtags: string[]
      visibility: YoutubeVisibility | null
      madeForKids: boolean | null
    },
  ]
  /** true если форма валидна и pre-flight не блокирует. */
  "update:valid": [valid: boolean]
  /** Оператор кликнул action на pre-flight check (login-check / open caption editor / ...). */
  "preflight-action": [check: PreflightCheck]
}>()

// --- Form state ---
const title = ref<string>("")
const description = ref<string>("")
const hashtagsRaw = ref<string>("")
const visibility = ref<YoutubeVisibility | null>(null)
const madeForKids = ref<boolean | null>(null)
// userEdited — оператор уже трогал input → не перезаписываем caption preload.
const userEditedTitle = ref(false)
const userEditedDescription = ref(false)
const userEditedHashtags = ref(false)

const hashtags = computed<string[]>(() => parseHashtagsInput(hashtagsRaw.value))

const hashtagsTotalChars = computed(() => {
  let total = 0
  for (const h of hashtags.value) total += h.length + 1
  return total
})

// --- Pre-flight + Caption (единый useCaptionPreload через useYoutubePreflight) ---
const accountRef = computed<PreflightAccount | null>(() => props.account)
const videoRef = computed<PreflightVideo | null>(() => props.video)
const liveLoginRef = computed<LoginCheckResult | null>(() => props.liveLoginResult ?? null)
const { state: preflightState, captionPreload } = useYoutubePreflight({
  account: accountRef,
  video: videoRef,
  liveLoginResult: liveLoginRef,
})

const captionLoading = computed(() => captionPreload.loading.value)
/** true если подтянут approved YT caption, false если только не-approved, null если нет. */
const captionApproved = computed<boolean | null>(() => {
  const s = captionPreload.youtubeApprovalState.value
  if (s === "approved") return true
  if (s === "unapproved") return false
  return null
})

/**
 * Источник подтянутого caption для UI hint'а. Может быть:
 *   - 'youtube' — родной YouTube caption (approved/unapproved выше через captionApproved)
 *   - 'tiktok' / 'instagram' — fallback с другой платформы (когда YouTube caption ещё нет)
 *   - null — caption не подтянут
 */
const captionSourcePlatform = ref<"youtube" | "tiktok" | "instagram" | null>(null)

// --- Preload form fields из caption ---
// Логика выбора:
//   1. Approved YouTube caption — идеал.
//   2. Unapproved YouTube caption — если есть.
//   3. Любой Caption (TikTok/IG) — fallback чтобы оператор не остался с пустой
//      формой если YouTube caption ещё не сгенерирован. Title/description могут
//      потребовать ручной правки под YouTube лимиты, hint в UI это указывает.
//
// Не перезаписываем userEdited поля + не перезаписываем при тех же videoId.
const lastPreloadedFromCaptionId = ref<number | null>(null)

watch(
  [() => captionPreload.loaded.value, () => props.video?.id],
  ([loaded, id]) => {
    if (!loaded || !id) return
    if (props.account?.platform !== "youtube") return
    if (lastPreloadedFromCaptionId.value === id) return

    // Приоритет: YouTube → fallback на любой другой Caption.
    const yt = captionPreload.captionForPlatform("youtube", true)
    const caption = yt ?? captionPreload.pickBestCaption()
    if (!caption) {
      captionSourcePlatform.value = null
      return
    }
    captionSourcePlatform.value = caption.platform as "youtube" | "tiktok" | "instagram"

    if (!userEditedTitle.value) {
      title.value = caption.title.slice(0, YOUTUBE_LIMITS.TITLE_MAX)
    }
    if (!userEditedDescription.value) {
      description.value = (caption.description ?? "").slice(0, YOUTUBE_LIMITS.DESCRIPTION_MAX)
    }
    if (!userEditedHashtags.value) {
      // Caption.hashtags в БД хранится БЕЗ # — для UI добавляем # для удобства,
      // parseHashtagsInput на submit'е стрипает обратно.
      hashtagsRaw.value = caption.hashtags.map((h) => `#${h}`).join(" ")
    }
    lastPreloadedFromCaptionId.value = id
  },
  { immediate: true },
)

// --- Validity ---
const titleValid = computed(
  () => title.value.trim().length > 0 && title.value.length <= YOUTUBE_LIMITS.TITLE_MAX,
)
const descriptionValid = computed(
  () => description.value.length <= YOUTUBE_LIMITS.DESCRIPTION_MAX,
)
const hashtagsValid = computed(
  () => hashtagsTotalChars.value <= YOUTUBE_LIMITS.HASHTAGS_TOTAL_MAX,
)
const visibilityValid = computed(() => visibility.value !== null)
const madeForKidsValid = computed(() => madeForKids.value !== null)

const formValid = computed(
  () =>
    titleValid.value
    && descriptionValid.value
    && hashtagsValid.value
    && visibilityValid.value
    && madeForKidsValid.value,
)

const allValid = computed(() => formValid.value && !preflightState.value.blocking)

// --- Emit обновлений ---
watch(
  () => ({
    title: title.value,
    description: description.value,
    hashtags: hashtags.value,
    visibility: visibility.value,
    madeForKids: madeForKids.value,
  }),
  (val) => {
    emit("update", val)
  },
  { deep: true, immediate: true },
)

watch(allValid, (v) => emit("update:valid", v), { immediate: true })

function onVisibilityUpdate(v: YoutubeVisibility) {
  visibility.value = v
}

function onPreflightAction(check: PreflightCheck) {
  emit("preflight-action", check)
}
</script>

<template>
  <div class="space-y-3">
    <!-- Title -->
    <fieldset class="fieldset">
      <legend class="fieldset-legend flex items-center justify-between gap-2">
        <span>Заголовок * (YouTube ≤ {{ YOUTUBE_LIMITS.TITLE_MAX }})</span>
        <span class="text-xs" :class="title.length > YOUTUBE_LIMITS.TITLE_MAX ? 'text-error' : 'text-base-content/40'">
          {{ title.length }}/{{ YOUTUBE_LIMITS.TITLE_MAX }}
        </span>
      </legend>
      <input
        v-model="title"
        type="text"
        class="input input-sm w-full"
        :class="!titleValid && title.length > 0 ? 'input-error' : ''"
        :maxlength="YOUTUBE_LIMITS.TITLE_MAX + 5"
        placeholder="Название видео на YouTube"
        :disabled="disabled || captionLoading"
        @input="userEditedTitle = true"
      />
      <span v-if="captionLoading" class="text-xs text-base-content/40">
        Загружаю caption…
      </span>
      <span
        v-else-if="captionSourcePlatform === 'youtube' && captionApproved === true"
        class="text-xs text-success flex items-center gap-1 mt-0.5"
      >
        <Icon name="mingcute:check-circle-line" class="text-xs" />
        Подтянут утверждённый YouTube caption
      </span>
      <span
        v-else-if="captionSourcePlatform === 'youtube' && captionApproved === false"
        class="text-xs text-warning flex items-center gap-1 mt-0.5"
      >
        <Icon name="mingcute:warning-line" class="text-xs" />
        Caption не утверждён — отредактируйте или утвердите на /videos/:id
      </span>
      <span
        v-else-if="captionSourcePlatform === 'tiktok' || captionSourcePlatform === 'instagram'"
        class="text-xs text-info flex items-center gap-1 mt-0.5"
      >
        <Icon name="mingcute:information-line" class="text-xs" />
        Подтянут caption из {{ captionSourcePlatform === 'tiktok' ? 'TikTok' : 'Instagram' }}
        — YouTube caption ещё не создан. Можно отредактировать или сгенерировать на /videos/:id.
      </span>
    </fieldset>

    <!-- Description -->
    <fieldset class="fieldset">
      <legend class="fieldset-legend flex items-center justify-between gap-2">
        <span>Описание (≤ {{ YOUTUBE_LIMITS.DESCRIPTION_MAX }})</span>
        <span class="text-xs" :class="!descriptionValid ? 'text-error' : 'text-base-content/40'">
          {{ description.length }}/{{ YOUTUBE_LIMITS.DESCRIPTION_MAX }}
        </span>
      </legend>
      <textarea
        v-model="description"
        class="textarea textarea-sm w-full"
        :class="!descriptionValid ? 'textarea-error' : ''"
        rows="3"
        placeholder="Описание видео. Хэштеги добавятся в конец автоматически."
        :disabled="disabled || captionLoading"
        @input="userEditedDescription = true"
      />
    </fieldset>

    <!-- Hashtags -->
    <fieldset class="fieldset">
      <legend class="fieldset-legend flex items-center justify-between gap-2">
        <span>Хэштеги (≤ {{ YOUTUBE_LIMITS.HASHTAGS_TOTAL_MAX }} chars суммарно)</span>
        <span class="text-xs" :class="!hashtagsValid ? 'text-error' : 'text-base-content/40'">
          {{ hashtagsTotalChars }}/{{ YOUTUBE_LIMITS.HASHTAGS_TOTAL_MAX }}
        </span>
      </legend>
      <input
        v-model="hashtagsRaw"
        type="text"
        class="input input-sm w-full"
        :class="!hashtagsValid ? 'input-error' : ''"
        placeholder="#shorts #motivation"
        :disabled="disabled || captionLoading"
        @input="userEditedHashtags = true"
      />
    </fieldset>

    <!-- Visibility -->
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Видимость *</legend>
      <PostingVisibilitySelector
        :visibility="visibility"
        :disabled="disabled"
        @update:visibility="onVisibilityUpdate"
      />
    </fieldset>

    <!-- Made for kids -->
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Made for kids *</legend>
      <div class="grid gap-2">
        <label class="label cursor-pointer justify-start gap-3 p-2 rounded-box border border-base-300">
          <input
            type="radio"
            class="radio radio-sm"
            :checked="madeForKids === false"
            :disabled="disabled"
            @change="madeForKids = false"
          />
          <div class="flex-1">
            <div class="font-medium text-sm">Не для детей</div>
            <div class="text-xs text-base-content/60 mt-0.5">
              Стандартный выбор для marketing creatives. Видео доступно в обычной аудитории.
            </div>
          </div>
        </label>
        <label class="label cursor-pointer justify-start gap-3 p-2 rounded-box border border-base-300">
          <input
            type="radio"
            class="radio radio-sm"
            :checked="madeForKids === true"
            :disabled="disabled"
            @change="madeForKids = true"
          />
          <div class="flex-1">
            <div class="font-medium text-sm">Для детей (COPPA)</div>
            <div class="text-xs text-base-content/60 mt-0.5">
              YouTube наложит ограничения: нет комментариев, нет персонализированной рекламы.
            </div>
          </div>
        </label>
      </div>
      <div
        v-if="madeForKids === null"
        role="alert"
        class="alert alert-info alert-soft py-2 text-xs mt-1"
      >
        <Icon name="mingcute:information-line" class="text-sm shrink-0" />
        <span>YouTube требует обязательный выбор аудитории — публикация не пройдёт без этого.</span>
      </div>
    </fieldset>

    <!-- Pre-flight checklist -->
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Готовность к публикации</legend>
      <PostingYoutubePreflightChecklist
        :state="preflightState"
        @action="onPreflightAction"
      />
    </fieldset>
  </div>
</template>
