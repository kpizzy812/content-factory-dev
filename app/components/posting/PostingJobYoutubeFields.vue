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
  <div class="flex flex-col gap-4">
    <div>
      <div class="mb-[5px] flex items-baseline justify-between gap-2">
          <span class="text-[11.5px] text-muted">Заголовок</span>
          <span class="tnum font-mono text-micro" :class="title.length > YOUTUBE_LIMITS.TITLE_MAX ? 'text-danger' : 'text-subtle'">
            {{ title.length }} из {{ YOUTUBE_LIMITS.TITLE_MAX }}
          </span>
        </div>
        <UiInput
          v-model="title"
          :invalid="!titleValid && title.length > 0"
          placeholder="Название ролика на YouTube"
          :disabled="disabled || captionLoading"
          @update:model-value="userEditedTitle = true"
        />
        <p v-if="captionLoading" class="mt-1 text-micro text-subtle">Загружаю подпись…</p>
        <p
          v-else-if="captionSourcePlatform === 'youtube' && captionApproved === true"
          class="mt-1 flex items-center gap-1 text-micro text-success"
        >
          <Icon name="mingcute:check-circle-line" />
          Подставлена утверждённая подпись для YouTube
        </p>
        <p
          v-else-if="captionSourcePlatform === 'youtube' && captionApproved === false"
          class="mt-1 flex items-center gap-1 text-micro text-warning"
        >
          <Icon name="mingcute:warning-line" />
          Подпись не утверждена — поправьте здесь или утвердите на странице ролика
        </p>
        <p
          v-else-if="captionSourcePlatform === 'tiktok' || captionSourcePlatform === 'instagram'"
          class="mt-1 flex items-center gap-1 text-micro text-info"
        >
          <Icon name="mingcute:information-line" />
          Подставлена подпись из {{ captionSourcePlatform === 'tiktok' ? 'TikTok' : 'Instagram' }} —
        для YouTube своей ещё нет
      </p>
    </div>

    <div>
      <div class="mb-[5px] flex items-baseline justify-between gap-2">
        <span class="text-[11.5px] text-muted">Описание</span>
        <span class="tnum font-mono text-micro" :class="!descriptionValid ? 'text-danger' : 'text-subtle'">
          {{ description.length }} из {{ YOUTUBE_LIMITS.DESCRIPTION_MAX }}
        </span>
      </div>
      <UiTextarea
        v-model="description"
        :rows="3"
        :invalid="!descriptionValid"
        placeholder="Текст под роликом. Хэштеги допишутся в конец сами."
        :disabled="disabled || captionLoading"
        @update:model-value="userEditedDescription = true"
      />
    </div>

    <div>
      <div class="mb-[5px] flex items-baseline justify-between gap-2">
        <span class="text-[11.5px] text-muted">Хэштеги</span>
        <span class="tnum font-mono text-micro" :class="!hashtagsValid ? 'text-danger' : 'text-subtle'">
          {{ hashtagsTotalChars }} из {{ YOUTUBE_LIMITS.HASHTAGS_TOTAL_MAX }} символов
        </span>
      </div>
      <UiInput
        v-model="hashtagsRaw"
        :invalid="!hashtagsValid"
        placeholder="#shorts #мебель"
        :disabled="disabled || captionLoading"
        @update:model-value="userEditedHashtags = true"
      />
    </div>

    <UiField label="Кто увидит ролик">
      <PostingVisibilitySelector
        :visibility="visibility"
        :disabled="disabled"
        @update:visibility="onVisibilityUpdate"
      />
    </UiField>

    <UiField label="Ролик для детей">
      <div class="flex flex-col gap-2">
        <label
          class="flex items-start gap-2.5 rounded-md border border-border bg-card p-2.5"
          :class="disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'"
        >
          <input
            type="radio"
            class="mt-0.5 size-3.5 shrink-0 cursor-pointer accent-(--color-accent)"
            :checked="madeForKids === false"
            :disabled="disabled"
            @change="madeForKids = false"
          >
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">Нет, не для детей</span>
            <span class="block text-sm text-muted">Обычный выбор для рекламных роликов.</span>
          </span>
        </label>
        <label
          class="flex items-start gap-2.5 rounded-md border border-border bg-card p-2.5"
          :class="disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'"
        >
          <input
            type="radio"
            class="mt-0.5 size-3.5 shrink-0 cursor-pointer accent-(--color-accent)"
            :checked="madeForKids === true"
            :disabled="disabled"
            @change="madeForKids = true"
          >
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">Да, для детей</span>
            <span class="block text-sm text-muted">
              YouTube отключит комментарии и персонализированную рекламу.
            </span>
          </span>
        </label>
      </div>
      <p
        v-if="madeForKids === null"
        class="mt-2 flex gap-2 rounded-md border border-info-border bg-info-bg p-2.5 text-sm"
      >
        <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
        Без этого выбора YouTube не примет публикацию.
      </p>
    </UiField>

    <UiField label="Готовность к публикации">
      <PostingYoutubePreflightChecklist :state="preflightState" @action="onPreflightAction" />
    </UiField>
  </div>
</template>
