<script setup lang="ts">
/**
 * Instagram-секция в PostingJobCreateModal (PR6, параллель PostingJobYoutubeFields).
 *
 * Отличия от YouTube (см. shared/types/posting-instagram.ts):
 *   - НЕТ title / visibility / madeForKids — десктоп-веб публикует Reel без них.
 *   - caption + хэштеги считаются КАК ОДНО ПОЛЕ → суммарная длина ≤ 2200
 *     (computeInstagramCaptionLength — единый источник для UI и серверного
 *     валидатора instagram-snapshot-validator.ts).
 *   - hashtags: ≤ 30 шт, каждый без пробелов, нормализация # (parseHashtagsInput
 *     стрипает # — то же что использует youtube-секция).
 *
 * Preload из Caption (платформа instagram) — best-effort, чтобы оператор не
 * начинал с пустой формы. Не перезаписываем поля, которые оператор уже трогал.
 *
 * Emit'ит form-state (caption + hashtags) + valid флаг родителю. Родитель строит
 * итоговый contentSnapshot через buildInstagramContentSnapshot.
 */
import {
  INSTAGRAM_CAPTION_MAX,
  INSTAGRAM_HASHTAGS_MAX_COUNT,
  computeInstagramCaptionLength,
} from "~~/shared/types/posting-instagram"
import { parseHashtagsInput } from "~~/shared/types/posting-youtube"
import { useCaptionPreload } from "~~/app/composables/useCaptionPreload"

const props = defineProps<{
  /** Видео для preload Caption (id используется). */
  video: { id: number } | null
  disabled?: boolean
}>()

const emit = defineEmits<{
  /** Текущее состояние формы — родитель собирает body запроса. */
  update: [payload: { caption: string; hashtags: string[] }]
  /** true если форма валидна (длина/число тегов в пределах лимитов). */
  "update:valid": [valid: boolean]
}>()

// --- Form state ---
const captionRaw = ref<string>("")
const hashtagsRaw = ref<string>("")
const userEditedCaption = ref(false)
const userEditedHashtags = ref(false)

const hashtags = computed<string[]>(() => parseHashtagsInput(hashtagsRaw.value))

/** Длина caption + хэштеги вместе — так, как считает Instagram (одно поле). */
const totalLength = computed(() =>
  computeInstagramCaptionLength(captionRaw.value, hashtags.value),
)

const lengthValid = computed(() => totalLength.value <= INSTAGRAM_CAPTION_MAX)
const hashtagsCountValid = computed(
  () => hashtags.value.length <= INSTAGRAM_HASHTAGS_MAX_COUNT,
)

/**
 * Хотя бы что-то в посте есть. Серверный validateInstagramSnapshot принимает и
 * полностью пустой snapshot (caption опционален), но создавать Reel вообще без
 * подписи и хэштегов бессмысленно — поэтому пустую форму считаем невалидной на
 * стороне UI. Достаточно непустого caption ИЛИ хотя бы одного хэштега
 * («есть caption, нет hashtags» — валидно).
 */
const hasContent = computed(
  () => captionRaw.value.trim().length > 0 || hashtags.value.length > 0,
)

const formValid = computed(
  () => lengthValid.value && hashtagsCountValid.value && hasContent.value,
)

// --- Caption preload (платформа instagram) ---
const videoIdRef = computed<number | null>(() => props.video?.id ?? null)
const captionPreload = useCaptionPreload({ videoId: videoIdRef })

const captionLoading = computed(() => captionPreload.loading.value)
const lastPreloadedFromCaptionId = ref<number | null>(null)
const captionSourceFound = ref(false)

watch(
  [() => captionPreload.loaded.value, () => props.video?.id],
  ([loaded, id]) => {
    if (!loaded || !id) return
    if (lastPreloadedFromCaptionId.value === id) return

    // Приоритет: родной Instagram caption → fallback на любой другой Caption.
    const ig = captionPreload.captionForPlatform("instagram", false)
    const caption = ig ?? captionPreload.pickBestCaption()
    if (!caption) {
      captionSourceFound.value = false
      lastPreloadedFromCaptionId.value = id
      return
    }
    captionSourceFound.value = true

    if (!userEditedCaption.value) {
      // У IG caption — единое поле: title + description склеиваем (description опц.).
      const desc = caption.description ?? ""
      captionRaw.value = desc.trim().length > 0
        ? `${caption.title}\n\n${desc}`.trim()
        : caption.title
    }
    if (!userEditedHashtags.value) {
      // Caption.hashtags в БД БЕЗ # — для UI добавляем # для читаемости,
      // parseHashtagsInput на submit'е стрипает обратно.
      hashtagsRaw.value = caption.hashtags.map((h) => `#${h}`).join(" ")
    }
    lastPreloadedFromCaptionId.value = id
  },
  { immediate: true },
)

// --- Emit обновлений родителю ---
watch(
  () => ({ caption: captionRaw.value, hashtags: hashtags.value }),
  (val) => emit("update", val),
  { deep: true, immediate: true },
)

watch(formValid, (v) => emit("update:valid", v), { immediate: true })
</script>

<template>
  <div class="flex flex-col gap-4">
    <div>
      <div class="mb-[5px] flex items-baseline justify-between gap-2">
        <span class="text-[11.5px] text-muted">Подпись</span>
        <span class="tnum font-mono text-micro" :class="!lengthValid ? 'text-danger' : 'text-subtle'">
          {{ totalLength }} из {{ INSTAGRAM_CAPTION_MAX }}
        </span>
      </div>
      <UiTextarea
        v-model="captionRaw"
        :rows="4"
        :invalid="!lengthValid"
        placeholder="Текст поста. Хэштеги задаются отдельным полем и входят в тот же лимит."
        :disabled="disabled || captionLoading"
        @update:model-value="userEditedCaption = true"
      />
      <p v-if="captionLoading" class="mt-1 text-micro text-subtle">Загружаю подпись…</p>
      <p v-else-if="captionSourceFound" class="mt-1 flex items-center gap-1 text-micro text-success">
        <Icon name="mingcute:check-circle-line" />
        Подставлена подпись ролика — её можно поправить
      </p>
      <p v-if="!lengthValid" class="mt-1 flex items-center gap-1 text-micro text-danger">
        <Icon name="mingcute:warning-line" />
        Подпись вместе с хэштегами длиннее {{ INSTAGRAM_CAPTION_MAX }} символов
      </p>
    </div>

    <div>
      <div class="mb-[5px] flex items-baseline justify-between gap-2">
        <span class="text-[11.5px] text-muted">Хэштеги</span>
        <span class="tnum font-mono text-micro" :class="!hashtagsCountValid ? 'text-danger' : 'text-subtle'">
          {{ hashtags.length }} из {{ INSTAGRAM_HASHTAGS_MAX_COUNT }}
        </span>
      </div>
      <UiInput
        v-model="hashtagsRaw"
        :invalid="!hashtagsCountValid"
        placeholder="#мебель #ремонт"
        :disabled="disabled || captionLoading"
        @update:model-value="userEditedHashtags = true"
      />
      <p v-if="!hashtagsCountValid" class="mt-1 flex items-center gap-1 text-micro text-danger">
        <Icon name="mingcute:warning-line" />
        Instagram принимает не больше {{ INSTAGRAM_HASHTAGS_MAX_COUNT }} хэштегов
      </p>
      <p class="mt-1 text-micro text-subtle">
        Хэштеги входят в общий лимит подписи. Видимости и отметки «для детей» у Instagram нет.
      </p>
    </div>
  </div>
</template>
