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

const isOpen = ref(false)
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
  isOpen.value = true
  refreshAccounts()
  refreshVideos()
}

function close() {
  isOpen.value = false
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
  <UiModal :open="isOpen" size="lg" :persistent="submitting" @close="close">
    <template #header>
      <span class="flex flex-wrap items-baseline gap-2">
        Распределить ролики по аккаунтам
        <span class="tnum font-mono text-sm font-normal text-subtle">шаг {{ step }} из 4</span>
      </span>
    </template>

    <!-- Шаг 1: платформа и аккаунты -->
    <div v-if="step === 1" class="flex flex-col gap-3">
      <div class="flex w-fit overflow-hidden rounded-md border border-border">
        <button
          v-for="p in (['youtube', 'instagram'] as const)"
          :key="p"
          type="button"
          class="h-7 cursor-pointer px-3 text-sm"
          :class="platform === p ? 'bg-accent text-on-accent' : 'bg-card text-muted hover:text-fg'"
          @click="platform = p"
        >
          {{ p === 'youtube' ? 'YouTube' : 'Instagram' }}
        </button>
      </div>

      <p class="text-sm text-muted">
        Массовое распределение работает только для аккаунтов, публикующих через устройство:
        через официальный API ролики ставятся по одному. В списке — активные аккаунты выбранной платформы.
      </p>

      <UiEmptyState
        v-if="!browserAccounts.length"
        variant="search"
        title="Подходящих аккаунтов нет"
        :description="`Для ${isInstagram ? 'Instagram' : 'YouTube'} нет активных аккаунтов с публикацией через устройство.`"
      />

      <div v-else class="max-h-[45vh] overflow-y-auto rounded-md border border-border">
        <label
          v-for="acc in browserAccounts"
          :key="acc.id"
          class="flex cursor-pointer items-center gap-2.5 border-b border-divider px-2.5 py-2 last:border-b-0 hover:bg-card"
        >
          <input
            type="checkbox"
            class="size-3.5 shrink-0 cursor-pointer accent-(--color-accent)"
            :checked="selectedAccountIds.has(acc.id)"
            @change="toggleAccount(acc.id)"
          >
          <span class="min-w-0 flex-1 truncate font-mono text-sm">
            {{ (acc as { displayName?: string }).displayName ?? `аккаунт #${acc.id}` }}
          </span>
          <AccountReadinessBadge :account="acc" />
        </label>
      </div>
    </div>

    <!-- Шаг 2: ролики -->
    <div v-else-if="step === 2" class="flex flex-col gap-3">
      <p class="text-sm text-muted">
        <template v-if="isInstagram">
          Текст берётся из подписи ролика: подпись вместе с хэштегами должна уложиться
          в 2200 символов, иначе пара будет пропущена.
        </template>
        <template v-else>
          Текст берётся из утверждённой подписи для YouTube. Ролики без неё будут пропущены.
        </template>
      </p>

      <UiEmptyState
        v-if="!videos.length"
        variant="first"
        title="Собранных роликов нет"
        description="В список попадают только ролики, дошедшие до готового файла."
      />

      <div v-else class="max-h-[45vh] overflow-y-auto rounded-md border border-border">
        <label
          v-for="v in videos"
          :key="v.id"
          class="flex cursor-pointer items-center gap-2.5 border-b border-divider px-2.5 py-2 last:border-b-0 hover:bg-card"
        >
          <input
            type="checkbox"
            class="size-3.5 shrink-0 cursor-pointer accent-(--color-accent)"
            :checked="selectedVideoIds.has(v.id)"
            @change="toggleVideo(v.id)"
          >
          <span class="min-w-0 flex-1 truncate text-sm">
            Ролик {{ v.id }}
            <template v-if="v.scenario?.variants?.[0]?.title"> · {{ v.scenario.variants[0].title }}</template>
          </span>
          <span v-if="v.duration" class="tnum shrink-0 font-mono text-micro text-subtle">{{ v.duration }} с</span>
        </label>
      </div>

      <p
        v-if="tooManyPairs"
        class="flex items-center gap-2 rounded-md border border-danger-border bg-danger-bg p-2.5 text-sm text-danger"
      >
        <Icon name="mingcute:warning-line" class="shrink-0" />
        Пар получилось больше {{ BULK_PAIRS_LIMIT }} — сократите выбор.
      </p>
    </div>

    <!-- Шаг 3: настройки -->
    <div v-else-if="step === 3" class="flex flex-col gap-4">
      <template v-if="isYoutube">
        <UiField label="Кто увидит ролик" hint="Одинаково для всех задач этой партии.">
          <PostingVisibilitySelector :visibility="visibility" @update:visibility="onVisibilityUpdate" />
        </UiField>

        <UiField label="Ролик для детей">
          <div class="flex flex-col gap-2">
            <label class="flex cursor-pointer items-center gap-2.5 rounded-md border border-border bg-card p-2.5 text-sm">
              <input
                type="radio"
                class="size-3.5 cursor-pointer accent-(--color-accent)"
                :checked="madeForKids === false"
                @change="madeForKids = false"
              >
              Нет, не для детей
            </label>
            <label class="flex cursor-pointer items-center gap-2.5 rounded-md border border-border bg-card p-2.5 text-sm">
              <input
                type="radio"
                class="size-3.5 cursor-pointer accent-(--color-accent)"
                :checked="madeForKids === true"
                @change="madeForKids = true"
              >
              Да, для детей — YouTube отключит комментарии и персонализацию
            </label>
          </div>
        </UiField>
      </template>

      <p v-else class="flex gap-2 rounded-md border border-info-border bg-info-bg p-2.5 text-sm">
        <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
        <span>
          У Instagram нет ни видимости, ни отметки «для детей». Текст и хэштеги
          берутся из подписи каждого ролика — вместе не длиннее 2200 символов.
        </span>
      </p>

      <div class="grid gap-3 sm:grid-cols-2">
        <UiField label="Окно публикации, с">
          <UiInput v-model="windowStartLocal" type="datetime-local" />
        </UiField>
        <UiField label="Окно публикации, по">
          <UiInput v-model="windowEndLocal" type="datetime-local" />
        </UiField>
      </div>

      <UiField
        :label="`Пауза между публикациями одного аккаунта · ${minIntervalHours} ч`"
        hint="Меньше четырёх часов платформа считает подозрительным."
      >
        <input v-model.number="minIntervalHours" type="range" min="1" max="24" class="w-full accent-(--color-accent)">
      </UiField>
    </div>

    <!-- Шаг 4: что получится -->
    <div v-else-if="step === 4" class="flex flex-col gap-3">
      <div class="grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-panel sm:grid-cols-4">
        <div class="flex flex-col gap-1 border-r border-divider p-2.5 px-3.5">
          <span class="text-micro tracking-[.06em] text-subtle uppercase">Будут созданы</span>
          <span class="tnum text-2xl font-semibold text-success">{{ pairsToCreateCount }}</span>
        </div>
        <div class="flex flex-col gap-1 border-divider p-2.5 px-3.5 sm:border-r">
          <span class="text-micro tracking-[.06em] text-subtle uppercase">Без подписи</span>
          <span class="tnum text-2xl font-semibold text-warning">{{ pairsWithoutCaption.length }}</span>
        </div>
        <div v-if="isInstagram" class="flex flex-col gap-1 border-t border-r border-divider p-2.5 px-3.5 sm:border-t-0">
          <span class="text-micro tracking-[.06em] text-subtle uppercase">Подпись длиннее 2200</span>
          <span class="tnum text-2xl font-semibold text-warning">{{ pairsOverLimit.size }}</span>
        </div>
        <div class="flex flex-col gap-1 border-t border-divider p-2.5 px-3.5 sm:border-t-0">
          <span class="text-micro tracking-[.06em] text-subtle uppercase">Не поместились</span>
          <span class="tnum text-2xl font-semibold" :class="schedule.unscheduled.length ? 'text-danger' : ''">
            {{ schedule.unscheduled.length }}
          </span>
        </div>
      </div>

      <div class="max-h-[40vh] overflow-y-auto">
        <UiTable columns="120px 120px 132px minmax(160px,1fr)" min-width="560px">
          <UiTableHead>
            <span>Аккаунт</span>
            <span>Ролик</span>
            <span>Когда</span>
            <span>Что будет</span>
          </UiTableHead>

          <UiTableRow
            v-for="s in schedule.scheduled"
            :key="`${s.socialAccountId}-${s.videoId}-${s.scheduledAt}`"
            :clickable="false"
          >
            <span class="tnum font-mono text-sm">#{{ s.socialAccountId }}</span>
            <span class="tnum font-mono text-sm">#{{ s.videoId }}</span>
            <span class="tnum font-mono text-sm text-muted">
              {{ new Date(s.scheduledAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) }}
            </span>
            <span>
              <span
                v-if="!captionMap[s.videoId]"
                class="rounded-sm border border-warning-border bg-warning-bg px-1.5 py-0.5 text-micro text-warning"
              >
                пропустим — нет подписи
              </span>
              <span
                v-else-if="pairsOverLimit.has(s.videoId)"
                class="rounded-sm border border-warning-border bg-warning-bg px-1.5 py-0.5 text-micro text-warning"
              >
                пропустим — подпись длиннее 2200
              </span>
              <span
                v-else
                class="rounded-sm border border-success-border bg-success-bg px-1.5 py-0.5 text-micro text-success"
              >
                поставим в очередь
              </span>
            </span>
          </UiTableRow>

          <UiTableRow
            v-for="u in schedule.unscheduled"
            :key="`u-${u.socialAccountId}-${u.videoId}`"
            :clickable="false"
          >
            <span class="tnum font-mono text-sm">#{{ u.socialAccountId }}</span>
            <span class="tnum font-mono text-sm">#{{ u.videoId }}</span>
            <span class="text-sm text-subtle">—</span>
            <span
              class="rounded-sm border border-danger-border bg-danger-bg px-1.5 py-0.5 text-micro text-danger"
              :title="u.reason"
            >
              не поместился в окно
            </span>
          </UiTableRow>
        </UiTable>
      </div>

      <p
        v-if="submitError"
        class="flex gap-2 rounded-md border border-warning-border bg-warning-bg p-2.5 text-sm"
      >
        <Icon name="mingcute:warning-line" class="mt-0.5 shrink-0 text-warning" />
        {{ submitError }}
      </p>

      <p class="text-micro text-subtle">
        Время внутри окна расставлено случайно с соблюдением паузы — так публикации
        не выходят по будильнику. Перед отправкой сервер проверит каждую пару заново.
      </p>
    </div>

    <template #footer>
      <UiButton v-if="step > 1" variant="ghost" :disabled="submitting" @click="goToStep((step - 1) as 1 | 2 | 3)">
        Назад
      </UiButton>
      <UiButton v-else variant="ghost" @click="close">Отмена</UiButton>
      <span class="flex-1" />
      <UiButton
        v-if="step === 1"
        variant="primary"
        :disabled="!selectedAccountIds.size"
        @click="goToStep(2)"
      >
        Дальше · аккаунтов {{ selectedAccountIds.size }}
      </UiButton>
      <UiButton
        v-else-if="step === 2"
        variant="primary"
        :disabled="!selectedVideoIds.size || tooManyPairs"
        @click="goToStep(3)"
      >
        Дальше · пар {{ pairs.length }}
      </UiButton>
      <UiButton v-else-if="step === 3" variant="primary" :disabled="!settingsValid" @click="goToStep(4)">
        Показать, что получится
      </UiButton>
      <UiButton v-else variant="primary" :loading="submitting" :disabled="!canSubmit" @click="submit">
        <Icon v-if="!submitting" name="mingcute:send-line" />
        Поставить {{ pairsToCreateCount }} публикаций
      </UiButton>
    </template>
  </UiModal>
</template>
