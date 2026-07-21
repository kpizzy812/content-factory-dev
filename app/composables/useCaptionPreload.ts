/**
 * Единый источник Caption данных для всех модалок постинга.
 *
 * Раньше fetch на /api/videos/:id/captions делался в 3 местах независимо:
 *   1. UploadCreateModal.loadAndPreloadCaptions
 *   2. PostingJobYoutubeFields.fetchYoutubeCaption
 *   3. useYoutubePreflight.fetchCaptionStatus
 * → 2-3 запроса при открытии PostingJobCreateModal с YouTube account, разные
 *   стратегии выбора Caption, race conditions, drift семантики "approved".
 *
 * Теперь — один composable который:
 *   - fetch'ит по videoId с debounce + AbortController
 *   - cache'ит ответ
 *   - предоставляет pickBestCaption(prefer) — multi-platform priority выбор
 *   - предоставляет captionForPlatform(platform) — точечный pick по платформе
 *   - возвращает captionState: loading / approved / unapproved / missing
 *
 * Не делает preload автоматически — caller сам решает заполнять поля или нет
 * (мы не знаем userEdited флагов и формы caller'а).
 */
import { computed, onScopeDispose, ref, watch, type Ref } from "vue"
import type { CaptionSnapshot, SocialPlatform } from "~~/shared/types/caption"

const PLATFORM_PRIORITY: readonly SocialPlatform[] = [
  "youtube", // самые строгие лимиты — безопаснее заполнить под него
  "tiktok",
  "instagram",
] as const

export interface UseCaptionPreloadOptions {
  videoId: Ref<number | null>
  /** Debounce для fetch при смене videoId (ms). Default 200. */
  debounceMs?: number
}

/** Состояние конкретного Caption для UI-индикаторов (badge approved / warn / blocker). */
export type CaptionApprovalState = "loading" | "approved" | "unapproved" | "missing"

export function useCaptionPreload(opts: UseCaptionPreloadOptions) {
  const captions = ref<CaptionSnapshot[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)
  const lastFetchedVideoId = ref<number | null>(null)

  let abortController: AbortController | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  async function doFetch(videoId: number) {
    if (abortController) abortController.abort()
    abortController = new AbortController()
    loading.value = true
    error.value = null
    try {
      const res = await $fetch<{ data: CaptionSnapshot[] }>(
        `/api/videos/${videoId}/captions`,
        { signal: abortController.signal },
      )
      captions.value = res.data
      loaded.value = true
      lastFetchedVideoId.value = videoId
    } catch (err: unknown) {
      const e = err as { name?: string; data?: { message?: string }; message?: string }
      if (e?.name === "AbortError") return // новый запрос летит, текущий cancelled
      captions.value = []
      loaded.value = true
      lastFetchedVideoId.value = videoId
      error.value = e?.data?.message ?? e?.message ?? "Не удалось загрузить caption"
    } finally {
      loading.value = false
    }
  }

  function schedule(videoId: number | null) {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    if (!videoId) {
      captions.value = []
      loaded.value = false
      lastFetchedVideoId.value = null
      return
    }
    // Если уже загружен тот же videoId — не дёргаем.
    if (lastFetchedVideoId.value === videoId && loaded.value) return
    debounceTimer = setTimeout(() => {
      void doFetch(videoId)
    }, opts.debounceMs ?? 200)
  }

  watch(
    () => opts.videoId.value,
    (id) => schedule(id),
    { immediate: true },
  )

  onScopeDispose(() => {
    if (debounceTimer) clearTimeout(debounceTimer)
    if (abortController) abortController.abort()
  })

  // ---- Pickers ----

  /**
   * Найти Caption под конкретную платформу.
   *
   * preferApproved=true (default): приоритет approved. Если approved нет —
   * возвращает unapproved (всё-таки лучше чем null для preload форм).
   */
  function captionForPlatform(
    platform: SocialPlatform,
    preferApproved = true,
  ): CaptionSnapshot | null {
    const matches = captions.value.filter((c) => c.platform === platform)
    if (matches.length === 0) return null
    if (!preferApproved) return matches[0] ?? null
    const approved = matches.find((c) => c.approvedAt !== null)
    return approved ?? matches[0] ?? null
  }

  /**
   * Состояние Caption для платформы — для UI бейджа / preflight check.
   *   - "loading" — fetch не завершён, не fetch'или ещё
   *   - "missing" — fetch завершён, Caption для платформы нет
   *   - "unapproved" — Caption есть, но approvedAt = null
   *   - "approved" — Caption есть и утверждён
   */
  function approvalStateForPlatform(platform: SocialPlatform): CaptionApprovalState {
    if (loading.value || !loaded.value) return "loading"
    const c = captionForPlatform(platform, true)
    if (!c) return "missing"
    return c.approvedAt !== null ? "approved" : "unapproved"
  }

  /**
   * Выбрать "лучший" Caption по приоритету платформ. Если передан preferPlatforms —
   * сначала пробуем платформы из этого набора (в их собственном порядке),
   * иначе общий priority youtube → tiktok → instagram.
   *
   * Используется в UploadCreateModal (bulk-flow с разными платформами).
   */
  function pickBestCaption(
    preferPlatforms?: readonly SocialPlatform[],
  ): CaptionSnapshot | null {
    if (captions.value.length === 0) return null

    const tryOrder: readonly SocialPlatform[] = preferPlatforms?.length
      ? preferPlatforms
      : PLATFORM_PRIORITY

    // 1. Approved Caption под предпочтительные платформы.
    for (const p of tryOrder) {
      const c = captionForPlatform(p, true)
      if (c && c.approvedAt !== null) return c
    }
    // 2. Любой Caption (даже unapproved) под предпочтительные платформы.
    for (const p of tryOrder) {
      const c = captionForPlatform(p, false)
      if (c) return c
    }
    // 3. Любой Caption из остатка.
    return captions.value[0] ?? null
  }

  // ---- Computed для удобства caller'ов ----

  const youtubeApprovalState = computed<CaptionApprovalState>(() =>
    approvalStateForPlatform("youtube"),
  )

  /** Refresh — принудительный re-fetch (например после approve на /videos/:id). */
  async function refresh() {
    const videoId = opts.videoId.value
    if (!videoId) return
    await doFetch(videoId)
  }

  return {
    captions,
    loading,
    loaded,
    error,
    captionForPlatform,
    approvalStateForPlatform,
    youtubeApprovalState,
    pickBestCaption,
    refresh,
  }
}
