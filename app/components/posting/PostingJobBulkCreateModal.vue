<script setup lang="ts">
/**
 * Bulk-create модалка для YouTube postинга (Phase 3).
 *
 * Workflow:
 *   1. Выбор аккаунтов (YouTube + browser_automation, ≥3/4 readiness)
 *   2. Выбор видео (status=completed)
 *   3. YouTube settings (visibility/madeForKids) + Window/MinInterval
 *   4. Pre-flight таблица: scheduled vs unscheduled, по нажатию Submit
 *      идёт POST /api/posting-jobs/bulk
 *
 * Содержимое contentSnapshot per pair:
 *   - title/description/hashtags подгружаются из approved YouTube Caption per video
 *   - youtube.visibility/madeForKids единые для bulk
 *
 * Лимит 50 пар; идемпотентность через createPostingJob; partial success через 207.
 */
import type { PostingJobDto, BulkCreatePair } from "~~/shared/types/posting-job"
import type { YoutubeVisibility } from "~~/shared/types/posting-youtube"
import {
  buildInstagramContentSnapshot,
  computeInstagramCaptionLength,
  INSTAGRAM_CAPTION_MAX,
} from "~~/shared/types/posting-instagram"
import type { CaptionSnapshot, SocialPlatform } from "~~/shared/types/caption"
import {
  generateBulkSchedule,
  BULK_PAIRS_LIMIT,
  MIN_INTERVAL_MS,
} from "~~/app/composables/useBulkPostingSchedule"
import { useAccountReadiness } from "~~/app/composables/useAccountReadiness"
import type { PreflightAccount } from "~~/app/composables/useYoutubePreflight"

/** Платформы, поддерживаемые bulk-постингом (browser_automation). TikTok не поддержан бэком. */
type BulkPlatform = "youtube" | "instagram"

const emit = defineEmits<{
  created: [created: PostingJobDto[]]
}>()

function onVisibilityUpdate(v: YoutubeVisibility) {
  visibility.value = v
}

const modalRef = ref<HTMLDialogElement>()
const step = ref<1 | 2 | 3 | 4>(1)
const submitting = ref(false)
const submitError = ref<string | null>(null)

// --- Выбор платформы (YouTube | Instagram) ---
const platform = ref<BulkPlatform>("youtube")
const isYoutube = computed(() => platform.value === "youtube")
const isInstagram = computed(() => platform.value === "instagram")

// --- Data sources ---
const accountFilters = computed<{ status?: string; platform?: string }>(() => ({
  status: "active",
  platform: platform.value,
}))
const { data: accountsData, refresh: refreshAccounts } = useAccounts(
  accountFilters as Ref<{ status?: string; platform?: string }>,
)
const accounts = computed<PreflightAccount[]>(
  () => (accountsData.value?.data ?? []) as PreflightAccount[],
)

const videoFilters = ref<{ status?: string; perPage?: number }>({
  status: "completed",
  perPage: 100,
})
const { data: videosData, refresh: refreshVideos } = useVideos(
  videoFilters as Ref<{ status?: string; perPage?: number }>,
)
const videos = computed<
  Array<{
    id: number
    status: string
    duration: number | null
    scenario?: { variants?: Array<{ title: string }> } | null
  }>
>(() => (videosData.value?.data ?? []) as never)

// --- Form state ---
const selectedAccountIds = ref<Set<number>>(new Set())
const selectedVideoIds = ref<Set<number>>(new Set())
const visibility = ref<YoutubeVisibility | null>(null)
const madeForKids = ref<boolean | null>(null)
const windowStartLocal = ref<string>("")
const windowEndLocal = ref<string>("")
const minIntervalHours = ref<number>(4)
const captionMap = ref<Record<number, CaptionSnapshot>>({})

// --- Account/video pickers data ---
// Browser-automation аккаунты выбранной платформы (YouTube | Instagram).
const browserAccounts = computed(() =>
  accounts.value.filter(
    (a) =>
      a.postingMethod === "browser_automation"
      && a.platform === platform.value,
  ),
)

function toggleAccount(id: number) {
  if (selectedAccountIds.value.has(id)) selectedAccountIds.value.delete(id)
  else selectedAccountIds.value.add(id)
  selectedAccountIds.value = new Set(selectedAccountIds.value)
}

function toggleVideo(id: number) {
  if (selectedVideoIds.value.has(id)) selectedVideoIds.value.delete(id)
  else selectedVideoIds.value.add(id)
  selectedVideoIds.value = new Set(selectedVideoIds.value)
}

// --- Caption preload для всех выбранных видео ---
async function preloadCaptions() {
  const ids = Array.from(selectedVideoIds.value)
  await Promise.all(
    ids.map(async (videoId) => {
      if (captionMap.value[videoId]) return
      try {
        const res = await $fetch<{ data: CaptionSnapshot[] }>(
          `/api/videos/${videoId}/captions`,
        )
        const target = platform.value as SocialPlatform
        // Приоритет: approved caption под выбранную платформу. Для Instagram
        // допускаем и unapproved (мягче, чем YouTube) — лишь бы был текст.
        const approved = res.data.find(
          (c) => c.platform === target && c.approvedAt !== null,
        )
        const any = res.data.find((c) => c.platform === target)
        const picked = isInstagram.value ? (approved ?? any) : approved
        if (picked) captionMap.value[videoId] = picked
      } catch {
        // Best-effort; видео без approved caption попадёт в skipped на pre-flight
      }
    }),
  )
}

// --- Bulk schedule + pairs ---
const pairs = computed(() => {
  const list: Array<{ socialAccountId: number; videoId: number }> = []
  for (const aid of selectedAccountIds.value) {
    for (const vid of selectedVideoIds.value) {
      list.push({ socialAccountId: aid, videoId: vid })
    }
  }
  return list
})

const tooManyPairs = computed(() => pairs.value.length > BULK_PAIRS_LIMIT)

const schedule = computed(() => {
  const windowStartMs = new Date(windowStartLocal.value).getTime()
  const windowEndMs = new Date(windowEndLocal.value).getTime()
  if (
    Number.isNaN(windowStartMs)
    || Number.isNaN(windowEndMs)
    || windowStartMs >= windowEndMs
    || pairs.value.length === 0
  ) {
    return { scheduled: [], unscheduled: [] }
  }
  return generateBulkSchedule({
    pairs: pairs.value,
    windowStartMs,
    windowEndMs,
    minIntervalMs: minIntervalHours.value * 60 * 60 * 1000,
    seed: `bulk-${Date.now()}-${pairs.value.length}`,
  })
})

const settingsValid = computed(() => {
  const windowOk =
    windowStartLocal.value !== ""
    && windowEndLocal.value !== ""
    && !tooManyPairs.value
  if (isInstagram.value) {
    // Instagram: нет visibility/madeForKids — достаточно валидного окна.
    return windowOk
  }
  return visibility.value !== null && madeForKids.value !== null && windowOk
})

const canSubmit = computed(
  () =>
    !submitting.value
    && settingsValid.value
    && schedule.value.scheduled.length > 0,
)

/**
 * Склеивает caption Instagram из title + description в одно поле (у IG нет
 * отдельного title). Хэштеги идут отдельным полем snapshot.hashtags.
 */
function instagramCaptionText(caption: CaptionSnapshot): string {
  const desc = (caption.description ?? "").trim()
  return desc.length > 0 ? `${caption.title}\n\n${desc}`.trim() : caption.title
}

// --- Подготовка contentSnapshot для каждой пары ---
function buildPairsForSubmit(): BulkCreatePair[] {
  const result: BulkCreatePair[] = []

  if (isInstagram.value) {
    // Instagram: { caption, hashtags, instagram: { shareAsReel: true } }.
    // Совпадает с validateInstagramSnapshot. Пары, превышающие лимит 2200, и
    // пары без caption отбрасываем (попадут в skipped на pre-flight).
    for (const s of schedule.value.scheduled) {
      const caption = captionMap.value[s.videoId]
      if (!caption) continue
      const text = instagramCaptionText(caption)
      if (
        computeInstagramCaptionLength(text, caption.hashtags)
        > INSTAGRAM_CAPTION_MAX
      ) {
        continue
      }
      result.push({
        socialAccountId: s.socialAccountId,
        videoId: s.videoId,
        scheduledAt: s.scheduledAt,
        contentSnapshot: buildInstagramContentSnapshot({
          caption: text,
          hashtags: caption.hashtags,
        }) as unknown as BulkCreatePair["contentSnapshot"],
      })
    }
    return result
  }

  // YouTube: structured { title, description, hashtags, youtube: {...} }.
  if (visibility.value === null || madeForKids.value === null) return result
  for (const s of schedule.value.scheduled) {
    const caption = captionMap.value[s.videoId]
    if (!caption) continue // skipped — нет approved caption
    result.push({
      socialAccountId: s.socialAccountId,
      videoId: s.videoId,
      scheduledAt: s.scheduledAt,
      contentSnapshot: {
        title: caption.title.slice(0, 100),
        description: caption.description ?? undefined,
        hashtags: caption.hashtags,
        youtube: {
          visibility: visibility.value,
          madeForKids: madeForKids.value,
        },
      },
    })
  }
  return result
}

/**
 * videoId'ы среди запланированных пар, у которых caption ЕСТЬ, но суммарная
 * длина (caption + хэштеги) превышает лимит Instagram 2200. Такие пары
 * отбрасываются в buildPairsForSubmit и должны показываться оператору
 * отдельной причиной — иначе он подумает что у видео нет caption (а он есть,
 * просто длинный). Только для Instagram (у YouTube своя структура без лимита 2200).
 */
const pairsOverLimit = computed<Set<number>>(() => {
  const out = new Set<number>()
  if (!isInstagram.value) return out
  for (const s of schedule.value.scheduled) {
    const caption = captionMap.value[s.videoId]
    if (!caption) continue
    const text = instagramCaptionText(caption)
    if (
      computeInstagramCaptionLength(text, caption.hashtags)
      > INSTAGRAM_CAPTION_MAX
    ) {
      out.add(s.videoId)
    }
  }
  return out
})

// «Нет caption» — только реально отсутствующие caption. Пары с длинным caption
// учитываются отдельно через pairsOverLimit, чтобы причина пропуска была честной.
const pairsWithoutCaption = computed(() =>
  schedule.value.scheduled.filter((s) => !captionMap.value[s.videoId]),
)

/** Кол-во пар, которые реально будут созданы (есть caption и он в пределах лимита). */
const pairsToCreateCount = computed(
  () =>
    schedule.value.scheduled.length
    - pairsWithoutCaption.value.length
    - pairsOverLimit.value.size,
)

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  submitError.value = null

  const pairsForSubmit = buildPairsForSubmit()
  if (pairsForSubmit.length === 0) {
    submitError.value = isInstagram.value
      ? "У выбранных видео нет Instagram caption (или caption превышает лимит 2200)"
      : "Все выбранные видео не имеют утверждённого YouTube caption"
    submitting.value = false
    return
  }

  try {
    const res = await $fetch<{
      data: { created: PostingJobDto[]; skipped: Array<{ message: string }> }
    }>("/api/posting-jobs/bulk", {
      method: "POST",
      body: {
        platform: platform.value,
        pairs: pairsForSubmit,
        windowStart: new Date(windowStartLocal.value).toISOString(),
        windowEnd: new Date(windowEndLocal.value).toISOString(),
        minIntervalMs: minIntervalHours.value * 60 * 60 * 1000,
      },
    })
    emit("created", res.data.created)
    if (res.data.skipped.length > 0) {
      submitError.value = `Создано ${res.data.created.length} из ${pairsForSubmit.length}. Пропущено: ${res.data.skipped.map((s) => s.message).join("; ")}`
    } else {
      close()
    }
  } catch (err: unknown) {
    const e = err as { data?: { message?: string }; message?: string }
    submitError.value = e?.data?.message ?? e?.message ?? "Не удалось создать bulk"
  } finally {
    submitting.value = false
  }
}

// Смена платформы инвалидирует выбор аккаунтов (они привязаны к платформе),
// подтянутые caption (другая платформа = другой текст) И выбранные видео:
// иначе на Step 4 остались бы видео, отобранные под прошлую платформу (их
// caption/лимиты считаются по правилам другой соцсети). Откатываемся на Step 1
// для консистентного перезапуска флоу.
watch(platform, () => {
  selectedAccountIds.value = new Set()
  selectedVideoIds.value = new Set()
  captionMap.value = {}
  if (step.value > 1) step.value = 1
})

function open(initial?: { platform?: BulkPlatform }) {
  platform.value = initial?.platform ?? "youtube"
  step.value = 1
  selectedAccountIds.value = new Set()
  selectedVideoIds.value = new Set()
  visibility.value = null
  madeForKids.value = null
  // По умолчанию окно: с +1ч до +24ч от сейчас
  const now = Date.now()
  const fmt = (ms: number) => {
    const d = new Date(ms)
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  windowStartLocal.value = fmt(now + 60 * 60 * 1000)
  windowEndLocal.value = fmt(now + 24 * 60 * 60 * 1000)
  minIntervalHours.value = 4
  captionMap.value = {}
  submitError.value = null
  submitting.value = false
  modalRef.value?.showModal()
  refreshAccounts()
  refreshVideos()
}

function close() {
  modalRef.value?.close()
}

async function goToStep(next: 1 | 2 | 3 | 4) {
  if (next === 4) {
    await preloadCaptions()
  }
  step.value = next
}

defineExpose({ open, close })
</script>

<template>
  <dialog ref="modalRef" class="modal">
    <div class="modal-box max-w-5xl max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-lg font-bold">
          Массовое создание задач: {{ isInstagram ? "Instagram" : "YouTube" }}
        </h3>
        <span class="badge badge-sm">{{ step }}/4</span>
      </div>

      <!-- Шаг 1: Платформа + Аккаунты -->
      <div v-if="step === 1">
        <!-- Выбор платформы -->
        <div role="tablist" class="tabs tabs-box mb-3">
          <button
            role="tab"
            class="tab gap-1"
            :class="{ 'tab-active': isYoutube }"
            @click="platform = 'youtube'"
          >
            <Icon name="mingcute:youtube-line" />
            YouTube
          </button>
          <button
            role="tab"
            class="tab gap-1"
            :class="{ 'tab-active': isInstagram }"
            @click="platform = 'instagram'"
          >
            <Icon name="mingcute:ins-line" />
            Instagram
          </button>
        </div>

        <p class="text-sm text-base-content/60 mb-3">
          Выберите {{ isInstagram ? "Instagram" : "YouTube" }} аккаунты с browser_automation.
          Видны только активные с готовностью.
        </p>
        <div
          v-if="browserAccounts.length === 0"
          class="py-6 text-center text-sm text-base-content/50"
        >
          Нет готовых browser_automation аккаунтов для {{ isInstagram ? "Instagram" : "YouTube" }}.
        </div>
        <div class="space-y-2 max-h-[55vh] overflow-y-auto">
          <label
            v-for="acc in browserAccounts"
            :key="acc.id"
            class="label cursor-pointer justify-start gap-3 p-2 rounded-box border border-base-300"
          >
            <input
              type="checkbox"
              class="checkbox checkbox-sm"
              :checked="selectedAccountIds.has(acc.id)"
              @change="toggleAccount(acc.id)"
            />
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-medium text-sm">{{ (acc as { displayName?: string }).displayName ?? `#${acc.id}` }}</span>
                <AccountReadinessBadge :account="acc" />
              </div>
            </div>
          </label>
        </div>
        <div class="modal-action">
          <button class="btn btn-sm" @click="close">Отмена</button>
          <button
            class="btn btn-sm btn-primary"
            :disabled="selectedAccountIds.size === 0"
            @click="goToStep(2)"
          >
            Далее ({{ selectedAccountIds.size }} аккаунтов)
          </button>
        </div>
      </div>

      <!-- Шаг 2: Видео -->
      <div v-else-if="step === 2">
        <p class="text-sm text-base-content/60 mb-3">
          Выберите видео (только completed).
          <template v-if="isInstagram">
            Для Instagram подтягивается caption видео (≤ 2200 символов) — видео без него попадут в skipped.
          </template>
          <template v-else>
            Caption для YouTube должен быть утверждён — невыбранные видео попадут в skipped.
          </template>
        </p>
        <div class="space-y-2 max-h-[55vh] overflow-y-auto">
          <label
            v-for="v in videos"
            :key="v.id"
            class="label cursor-pointer justify-start gap-3 p-2 rounded-box border border-base-300"
          >
            <input
              type="checkbox"
              class="checkbox checkbox-sm"
              :checked="selectedVideoIds.has(v.id)"
              @change="toggleVideo(v.id)"
            />
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-medium text-sm">
                  #{{ v.id }}
                  {{ v.scenario?.variants?.[0]?.title ? ` — ${v.scenario.variants[0].title}` : "" }}
                </span>
                <span class="text-xs text-base-content/60">
                  {{ v.duration ? `· ${v.duration}с` : "" }}
                </span>
              </div>
            </div>
          </label>
        </div>
        <div class="modal-action">
          <button class="btn btn-sm" @click="goToStep(1)">Назад</button>
          <button
            class="btn btn-sm btn-primary"
            :disabled="selectedVideoIds.size === 0"
            @click="goToStep(3)"
          >
            Далее ({{ pairs.length }} пар)
          </button>
        </div>
        <div
          v-if="tooManyPairs"
          role="alert"
          class="alert alert-error alert-soft mt-2 text-xs"
        >
          <Icon name="mingcute:warning-line" />
          Превышен лимит {{ BULK_PAIRS_LIMIT }} пар. Уменьшите выбор.
        </div>
      </div>

      <!-- Шаг 3: Settings -->
      <div v-else-if="step === 3" class="space-y-3">
        <!-- YouTube-специфичные настройки (visibility/madeForKids) -->
        <template v-if="isYoutube">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Видимость (одна на все задачи)</legend>
            <PostingVisibilitySelector
              :visibility="visibility"
              @update:visibility="onVisibilityUpdate"
            />
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">Made for kids (одна на все задачи)</legend>
            <div class="grid gap-2">
              <label class="label cursor-pointer justify-start gap-3 p-2 rounded-box border border-base-300">
                <input
                  type="radio"
                  class="radio radio-sm"
                  :checked="madeForKids === false"
                  @change="madeForKids = false"
                />
                <span class="font-medium text-sm">Не для детей</span>
              </label>
              <label class="label cursor-pointer justify-start gap-3 p-2 rounded-box border border-base-300">
                <input
                  type="radio"
                  class="radio radio-sm"
                  :checked="madeForKids === true"
                  @change="madeForKids = true"
                />
                <span class="font-medium text-sm">Для детей (COPPA)</span>
              </label>
            </div>
          </fieldset>
        </template>

        <!-- Instagram: нет visibility/madeForKids -->
        <div
          v-else
          role="alert"
          class="alert alert-info alert-soft text-xs"
        >
          <Icon name="mingcute:information-line" class="text-sm shrink-0" />
          <span>
            У Instagram нет настроек видимости и «для детей». Текст и хэштеги
            берутся из caption каждого видео (≤ 2200 символов вместе).
          </span>
        </div>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Окно публикации</legend>
          <div class="grid grid-cols-2 gap-2">
            <label class="form-control">
              <span class="label-text text-xs">С</span>
              <input
                v-model="windowStartLocal"
                type="datetime-local"
                class="input input-sm w-full"
              />
            </label>
            <label class="form-control">
              <span class="label-text text-xs">По</span>
              <input
                v-model="windowEndLocal"
                type="datetime-local"
                class="input input-sm w-full"
              />
            </label>
          </div>
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">
            Min interval между постами одного аккаунта: {{ minIntervalHours }}ч
          </legend>
          <input
            v-model.number="minIntervalHours"
            type="range"
            min="1"
            max="24"
            class="range range-sm range-primary"
          />
          <span class="text-xs text-base-content/60">
            Рекомендуется ≥ 4ч (anti-detect). Меньше — повышенный риск бана.
          </span>
        </fieldset>

        <div class="modal-action">
          <button class="btn btn-sm" @click="goToStep(2)">Назад</button>
          <button
            class="btn btn-sm btn-primary"
            :disabled="!settingsValid"
            @click="goToStep(4)"
          >
            Далее — Pre-flight
          </button>
        </div>
      </div>

      <!-- Шаг 4: Pre-flight + submit -->
      <div v-else-if="step === 4" class="space-y-3">
        <div class="stats stats-vertical sm:stats-horizontal shadow w-full">
          <div class="stat">
            <div class="stat-title text-xs">Будут созданы</div>
            <div class="stat-value text-2xl text-success">
              {{ pairsToCreateCount }}
            </div>
          </div>
          <div class="stat">
            <div class="stat-title text-xs">Skipped (нет caption)</div>
            <div class="stat-value text-2xl text-warning">
              {{ pairsWithoutCaption.length }}
            </div>
          </div>
          <div v-if="isInstagram" class="stat">
            <div class="stat-title text-xs">Caption &gt; 2200 (пропущены)</div>
            <div class="stat-value text-2xl text-warning">
              {{ pairsOverLimit.size }}
            </div>
          </div>
          <div class="stat">
            <div class="stat-title text-xs">Unscheduled</div>
            <div class="stat-value text-2xl text-error">
              {{ schedule.unscheduled.length }}
            </div>
          </div>
        </div>

        <div class="overflow-x-auto max-h-[40vh] overflow-y-auto">
          <table class="table table-xs">
            <thead>
              <tr>
                <th>Аккаунт</th>
                <th>Видео</th>
                <th>Когда</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in schedule.scheduled" :key="`${s.socialAccountId}-${s.videoId}-${s.scheduledAt}`">
                <td>#{{ s.socialAccountId }}</td>
                <td>#{{ s.videoId }}</td>
                <td class="font-mono text-xs">
                  {{ new Date(s.scheduledAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) }}
                </td>
                <td>
                  <span
                    v-if="!captionMap[s.videoId]"
                    class="badge badge-xs badge-warning"
                    :title="isInstagram ? 'Нет Instagram caption для видео' : 'Caption для YouTube не утверждён'"
                  >
                    skip (no caption)
                  </span>
                  <span
                    v-else-if="pairsOverLimit.has(s.videoId)"
                    class="badge badge-xs badge-warning"
                    title="Caption вместе с хэштегами превышает лимит 2200 символов"
                  >
                    skip (&gt; 2200)
                  </span>
                  <span v-else class="badge badge-xs badge-success">scheduled</span>
                </td>
              </tr>
              <tr
                v-for="u in schedule.unscheduled"
                :key="`u-${u.socialAccountId}-${u.videoId}`"
                class="text-error"
              >
                <td>#{{ u.socialAccountId }}</td>
                <td>#{{ u.videoId }}</td>
                <td>—</td>
                <td>
                  <span class="badge badge-xs badge-error" :title="u.reason">
                    unscheduled
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div
          v-if="submitError"
          role="alert"
          class="alert alert-warning alert-soft text-xs"
        >
          <Icon name="mingcute:warning-line" class="text-sm shrink-0" />
          <span>{{ submitError }}</span>
        </div>

        <div class="modal-action">
          <button class="btn btn-sm" @click="goToStep(3)">Назад</button>
          <button
            class="btn btn-sm btn-primary"
            :disabled="!canSubmit"
            @click="submit"
          >
            <span v-if="submitting" class="loading loading-spinner loading-xs" />
            <Icon v-else name="mingcute:send-line" />
            Создать {{ pairsToCreateCount }} задач
          </button>
        </div>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="close">close</button>
    </form>
  </dialog>
</template>
