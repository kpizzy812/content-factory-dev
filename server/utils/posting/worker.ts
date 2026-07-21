/**
 * Worker PostingJob — крутится в scheduler'е каждые 30с (по умолчанию).
 *
 * Один tick делает:
 *   1. scheduled → queued (где scheduledAt <= now).
 *   2. retry_queued → queued (где retryAt <= now).
 *   3. Берёт top-N queued, claim'ит атомарно через updateMany WHERE status=queued
 *      → preparing (count===0 = race lost, skip).
 *   4. Запускает executeJob fire-and-forget для каждого захваченного job.
 *
 * executeJob:
 *   - validateJobPreconditions (account active + proxy healthy через assertProxyHealthyBeforeSession)
 *   - transition → uploading
 *   - browser_automation → runBrowserPosting; api → терминальный fail в проде
 *     (mock runner только под POSTING_MOCK_RUNNER=true для dev/test)
 *   - success: → published, обновить SocialAccount.lastPostedAt + totalPostsPublished++
 *   - error: categorizeError → shouldRetry? → retry_queued + retryAt; иначе failed + Telegram alert
 */

import { bestEffortPowerOffJobDevice, runBrowserPosting } from "../../automation/poster-runner"
import {
  PostingPhaseError,
  type YouTubePosterOptions,
  type YouTubeVisibility,
} from "../../automation/posters/types"
import { prisma } from "../prisma"
import { assertProxyHealthyBeforeSession } from "../proxy/proxy-checker"
import { sendTelegramAlert } from "../telegram/alerts"
import type { PostingJob, Prisma } from "../../../app/generated/prisma/client"
import type { YouTubePostingStateData } from "../../../shared/types/youtube-posting-fsm"
import { ApiPostingUnsupportedError, categorizeError, DEVICE_COOLDOWN_RETRY_MS, isDeviceCooldownError } from "./error-classifier"
import { isPostingFsmEnabled } from "./fsm-observer"
import { fsmHandleFailure } from "./fsm-retry"
import { appendJobLog, transitionJob } from "./job-service"
import { resolveStuckUploadingAction } from "./resume-policy"
import { sendToRunner } from "./runner-mock"
import { nextRetryAt, shouldRetry } from "./state-machine"

/** PR4: лимит «застревания» job'а в uploading (heartbeat lastTransitionAt). Env-override. */
const STUCK_UPLOADING_MS = Number(process.env.POSTING_STUCK_UPLOADING_MS) || 25 * 60 * 1000

const YOUTUBE_VISIBILITY_VALUES: ReadonlySet<YouTubeVisibility> = new Set([
  "public",
  "unlisted",
  "private",
])

/**
 * Shorts detection — единственный источник правды на нашей стороне.
 * Критерии YouTube Shorts: вертикальное видео (portrait) короче 60 секунд.
 * Видео без duration считаем НЕ shorts (conservative — обычное видео всегда
 * допустимо публиковать; Shorts-тоггл может зависеть от auto-detect YouTube).
 */
export function detectIsShorts(video: {
  format: string
  duration: number | null
}): boolean {
  if (video.format !== "portrait") return false
  if (video.duration === null || video.duration <= 0) return false
  return video.duration < 60
}

interface YoutubeSnapshot {
  title?: unknown
  description?: unknown
  hashtags?: unknown
  visibility?: unknown
  madeForKids?: unknown
}

/**
 * Парсинг platform-namespace для YouTube из contentSnapshot.
 * Бросает Error если структура невалидна — попадёт в handleFailure с
 * категорией unknown (internal_error на стороне нашего кода). UI должен
 * присылать валидный snapshot всегда (валидация на edge в POST /posting-jobs).
 */
export function parseYoutubeSnapshot(snapshot: Record<string, unknown>): {
  title: string
  description: string
  hashtags: string[]
  youtube: Omit<YouTubePosterOptions, "isShorts">
} {
  const title = typeof snapshot.title === "string" ? snapshot.title : ""
  if (!title.trim()) {
    throw new Error("YouTube snapshot: title обязателен")
  }
  const description =
    typeof snapshot.description === "string" ? snapshot.description : ""
  const hashtagsRaw = Array.isArray(snapshot.hashtags) ? snapshot.hashtags : []
  const hashtags = hashtagsRaw.filter((h): h is string => typeof h === "string")

  const yt = (snapshot.youtube ?? {}) as YoutubeSnapshot
  const visibilityRaw = yt.visibility
  if (
    typeof visibilityRaw !== "string" ||
    !YOUTUBE_VISIBILITY_VALUES.has(visibilityRaw as YouTubeVisibility)
  ) {
    throw new Error(
      "YouTube snapshot: youtube.visibility обязателен (public|unlisted|private)",
    )
  }
  const madeForKidsRaw = yt.madeForKids
  if (typeof madeForKidsRaw !== "boolean") {
    throw new Error("YouTube snapshot: youtube.madeForKids обязателен (boolean)")
  }

  return {
    title,
    description,
    hashtags,
    youtube: {
      visibility: visibilityRaw as YouTubeVisibility,
      madeForKids: madeForKidsRaw,
    },
  }
}

/**
 * In-memory флаг, защищающий от двойного tick'а если предыдущий ещё выполняется.
 * НЕ работает на multi-instance деплое — нужен distributed lock (но в текущей
 * single-instance Nitro этого достаточно).
 */
let isRunning = false

const CLAIM_BATCH = 3

/**
 * Один цикл worker'а.
 */
export async function postingWorkerTick(): Promise<void> {
  if (isRunning) return
  isRunning = true

  try {
    const now = new Date()

    // 0. Stuck-preparing recovery. preparing — короткая стадия (claim → load →
    //    validate → transition uploading, секунды). Если job висит в preparing
    //    дольше STUCK_PREPARING_MS — значит worker-процесс умер посреди
    //    executeJob (типично: рестарт Nitro при deploy убил in-flight fire-and-
    //    forget). Без этого recovery такой job orphaned навсегда: worker берёт
    //    только queued, а manual retry только из failed. Переводим в failed,
    //    чтобы оператор мог Retry (сброс attemptCount=0) либо отработал retry.
    const STUCK_PREPARING_MS = 10 * 60 * 1000
    const stuckThreshold = new Date(now.getTime() - STUCK_PREPARING_MS)
    const stuckPreparing = await prisma.postingJob.findMany({
      where: { status: "preparing", startedAt: { lt: stuckThreshold } },
      select: { id: true, startedAt: true },
    })
    for (const j of stuckPreparing) {
      await prisma.postingJob.updateMany({
        where: { id: j.id, status: "preparing" },
        data: {
          status: "failed",
          lastError: "Orphaned preparing — worker-процесс прервался посреди обработки (вероятно рестарт при deploy). Авто-переведён в failed для повторного retry.",
          errorCategory: "network_error",
        },
      })
      await appendJobLog(
        j.id,
        "warn",
        `Stuck-preparing recovery: job висел в preparing с ${j.startedAt?.toISOString() ?? "?"} (> ${STUCK_PREPARING_MS / 60000} мин) → failed`,
      ).catch(() => {})
      // Мёртвый процесс мог не дойти до powerOff в движке → гасим устройство, чтобы
      // не висело ON и не жгло биллинг DuoPlus (best-effort, no-op для api/off).
      await bestEffortPowerOffJobDevice(j.id)
    }

    // 0b. Stuck-uploading recovery (PR4, ТОЛЬКО FSM-job). uploading с FSM-stateData,
    //     где heartbeat observer'а (stateData.lastTransitionAt) старше лимита →
    //     worker-процесс умер посреди Studio-фаз (рестарт Nitro / browser завис).
    //     Без recovery такой job orphaned в uploading навсегда (worker берёт только
    //     queued). Решение по progress (resolveStuckUploadingAction): до publish —
    //     retry_queued (след. заход ОБЯЗАН пройти resume_check duplicate-guard);
    //     publish_clicked+ — failed requires_human (republish запрещён). Non-FSM
    //     uploading НЕ трогаем. Коарс-фильтр по startedAt (lastTransitionAt >= startedAt).
    const uploadingThreshold = new Date(now.getTime() - STUCK_UPLOADING_MS)
    const stuckUploading = await prisma.postingJob.findMany({
      where: { status: "uploading", startedAt: { lt: uploadingThreshold } },
      select: { id: true, stateData: true },
    })
    for (const j of stuckUploading) {
      await recoverStuckUploading(j.id, j.stateData, now)
      // Процесс умер посреди uploading — устройство почти наверняка осталось ON.
      // Гасим, чтобы осиротевшее железо не висело включённым (best-effort).
      await bestEffortPowerOffJobDevice(j.id)
    }

    // 1. scheduled → queued
    await prisma.postingJob.updateMany({
      where: { status: "scheduled", scheduledAt: { lte: now } },
      data: { status: "queued" },
    })

    // 2. retry_queued → queued
    await prisma.postingJob.updateMany({
      where: { status: "retry_queued", retryAt: { lte: now } },
      data: { status: "queued" },
    })

    // 3. Берём top-N queued, отсортированных по дате создания.
    //    Цель C (CPU-relief): подтягиваем postingMethod аккаунта, чтобы
    //    сериализовать browser_automation — каждый такой job поднимает свой
    //    Indigo-профиль (Chromium через mobile proxy), параллельный запуск
    //    нескольких множит CPU. api-джобы (mock/OAuth runner) НЕ ограничиваем.
    const candidates = await prisma.postingJob.findMany({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
      take: CLAIM_BATCH,
      select: {
        id: true,
        socialAccount: { select: { postingMethod: true } },
      },
    })

    if (candidates.length === 0) return

    // Цель C: сколько browser_automation-джоб УЖЕ активны (preparing/uploading).
    //   Если >= 1 — в этом тике не claim'им НИ ОДНОГО нового browser_automation
    //   (останутся queued до след. тика, когда активный завершится). Активность
    //   считаем по БД (надёжнее in-memory mutex — переживает рестарт Nitro).
    const activeBaCount = await prisma.postingJob.count({
      where: {
        status: { in: ["preparing", "uploading"] },
        socialAccount: { is: { postingMethod: "browser_automation" } },
      },
    })

    // 4. Атомарный claim для каждого. Race lost → skip.
    //    claimedBaThisTick — локальный счётчик, чтобы за один тик не захватить
    //    два browser_automation подряд (один Indigo за раз).
    const claimedIds: string[] = []
    let claimedBaThisTick = 0
    for (const candidate of candidates) {
      const isBrowserAutomation =
        candidate.socialAccount?.postingMethod === "browser_automation"

      // Цель C skip-логика: browser_automation пропускаем если уже есть активный
      // BA в БД ИЛИ мы уже claim'нули один BA в этом тике. api — без ограничений.
      if (isBrowserAutomation && (activeBaCount > 0 || claimedBaThisTick > 0)) {
        continue
      }

      const claimNow = new Date()
      const claim = await prisma.postingJob.updateMany({
        where: { id: candidate.id, status: "queued" },
        data: {
          status: "preparing",
          startedAt: claimNow,
          attemptCount: { increment: 1 },
        },
      })
      if (claim.count > 0) {
        claimedIds.push(candidate.id)
        if (isBrowserAutomation) claimedBaThisTick++
      }
    }

    // 5. Fire-and-forget execute
    for (const id of claimedIds) {
      executeJob(id).catch(() => {
        // executeJob сам логирует и обновляет статус. Здесь просто гасим reject.
      })
    }
  } finally {
    isRunning = false
  }
}

/**
 * PR4 stuck-uploading recovery для одного job. Решение — pure
 * resolveStuckUploadingAction (resume-policy); здесь только атомарный DB-переход
 * (where status=uploading — защита от гонки с живым executeJob) + лог.
 */
async function recoverStuckUploading(
  jobId: string,
  stateDataRaw: unknown,
  now: Date,
): Promise<void> {
  const sd = (stateDataRaw as YouTubePostingStateData | null) ?? null
  const action = resolveStuckUploadingAction(sd, now, STUCK_UPLOADING_MS)
  if (action === "skip") return

  const progress = sd?.progress ?? "file_not_attached"
  const lastMs = sd?.lastTransitionAt ? new Date(sd.lastTransitionAt).getTime() : now.getTime()
  const ageMin = Math.round((now.getTime() - lastMs) / 60_000)

  if (action === "requires_human") {
    // Publish мог сработать — НЕ retry, НЕ republish. failed + finalReason requires_human.
    const claim = await prisma.postingJob.updateMany({
      where: { id: jobId, status: "uploading" },
      data: {
        status: "failed",
        lastError: `STUCK_UPLOADING_REQUIRES_HUMAN: job завис в uploading (progress=${progress}, heartbeat ${ageMin} мин назад). Publish мог сработать — republish запрещён, нужна ручная проверка канала.`,
        errorCategory: "account_locked",
        stateData: { ...sd, finalReason: "requires_human" } as unknown as Prisma.InputJsonValue,
      },
    })
    if (claim.count > 0) {
      await appendJobLog(jobId, "error", "STUCK_UPLOADING_REQUIRES_HUMAN", {
        fsm: true,
        event: "STUCK_UPLOADING_REQUIRES_HUMAN",
        progress,
        heartbeatAgeMin: ageMin,
      }).catch(() => {})
    }
    return
  }

  // retry_resume: progress < publish_clicked → retry_queued, safe backoff 2 мин.
  // stateData НЕ трогаем (progress/draftVideoId сохраняются — след. заход обязан
  // пройти resume_check; finalReason terminal НЕ ставим).
  const retryAt = new Date(now.getTime() + 2 * 60_000)
  const claim = await prisma.postingJob.updateMany({
    where: { id: jobId, status: "uploading" },
    data: {
      status: "retry_queued",
      retryAt,
      lastError: `STUCK_UPLOADING_RECOVERED: job завис в uploading (progress=${progress}, heartbeat ${ageMin} мин назад) → retry_queued; на след. заходе resume_check.`,
      errorCategory: "network_error",
    },
  })
  if (claim.count > 0) {
    await appendJobLog(jobId, "warn", "STUCK_UPLOADING_RECOVERED", {
      fsm: true,
      event: "STUCK_UPLOADING_RECOVERED",
      progress,
      heartbeatAgeMin: ageMin,
      retryAt: retryAt.toISOString(),
    }).catch(() => {})
  }
}

interface JobWithIncludes extends PostingJob {
  socialAccount: {
    id: number
    status: "active" | "expired" | "revoked"
    proxyId: string | null
    displayName: string
    /** Part D: branching на runBrowserPosting когда browser_automation. */
    postingMethod: "api" | "browser_automation"
    // Внутренний тип — совпадает с Prisma select (device-профиль для browser-постинга).
    deviceProfileId: string | null
  }
}

async function loadJobForExecution(jobId: string): Promise<JobWithIncludes | null> {
  const job = await prisma.postingJob.findUnique({
    where: { id: jobId },
    include: {
      socialAccount: {
        select: {
          id: true,
          status: true,
          proxyId: true,
          displayName: true,
          postingMethod: true,
          deviceProfileId: true,
        },
      },
    },
  })
  return job as JobWithIncludes | null
}

/**
 * Pre-flight checks. Бросают Error если пройти нельзя.
 *
 * - SocialAccount.status === active
 * - Hard-block: proxyId обязателен (1:1:1 защита от мгновенного бана при постинге с реального IP)
 * - proxy.status === healthy перед стартом сессии (assertProxyHealthyBeforeSession)
 */
async function validateJobPreconditions(job: JobWithIncludes): Promise<void> {
  if (job.socialAccount.status !== "active") {
    throw createError({
      statusCode: 412,
      message: `SocialAccount #${job.socialAccount.id} в статусе ${job.socialAccount.status}, постинг невозможен`,
    })
  }

  if (!job.socialAccount.proxyId) {
    throw createError({
      statusCode: 412,
      statusMessage: "no_proxy",
      message: `Аккаунт #${job.socialAccount.id} не имеет прокси. Постинг запрещён (защита от бана).`,
      data: {
        code: "no_proxy",
        accountId: job.socialAccount.id,
        suggestion: "Привяжите рабочий прокси к аккаунту перед постингом.",
      },
    })
  }

  // Бросает 503 при leak/dead — будет категоризирован как proxy_dead
  await assertProxyHealthyBeforeSession(job.socialAccount.proxyId)

  // 1:1:1 НЕ гейтится в execution-пути намеренно.
  //
  // Целостность 1:1:1 для browser_automation обеспечивается двумя слоями ВНЕ исполнения:
  //   (а) application-guard на МУТАЦИЯХ аккаунта (proxy.put / credentials.put /
  //       создание job в posting-jobs/index.post.ts + bulk.post.ts) — даёт оператору
  //       понятный 409 ДО запуска постинга;
  //   (б) partial UNIQUE INDEX в БД (миграция 20260603070743_one_to_one_browser_automation)
  //       — атомарный физический инвариант.
  //
  // Guard на исполнении был бы (1) НЕ атомарен (race между проверкой и стартом сессии)
  // и (2) РЕТРОАКТИВЕН: YouTube — тоже browser_automation. Легитимные (до PR4) YouTube-
  // аккаунты, шарящие прокси, получили бы 409 → categorizeError отнёс бы это к proxy_dead
  // (не-retryable) → рабочая YouTube-джоба упала бы в failed. Поэтому в execution guard НЕ зовём.
}

/**
 * Запуск конкретного job. Вызывается fire-and-forget из postingWorkerTick.
 */
export async function executeJob(jobId: string): Promise<void> {
  const job = await loadJobForExecution(jobId)
  if (!job) return

  // Pre-flight
  try {
    await validateJobPreconditions(job)
  } catch (err: unknown) {
    await handleFailure(job, err)
    return
  }

  // preparing → uploading
  try {
    await transitionJob(jobId, "uploading")
  } catch (err: unknown) {
    // race с cancel? просто логируем
    await appendJobLog(jobId, "warn", "Не удалось перейти preparing → uploading", {
      error: err instanceof Error ? err.message : String(err),
    })
    return
  }

  // Run
  try {
    // Part D: branching по postingMethod.
    //   - api → mock runner (заменится на реальный OAuth runner в будущем)
    //   - browser_automation → poster-runner (Indigo CDP + puppeteer)
    const snapshot = (job.contentSnapshot ?? {}) as Record<string, unknown>
    const caption =
      typeof snapshot.caption === "string"
        ? snapshot.caption
        : typeof snapshot.description === "string"
          ? snapshot.description
          : ""
    const hashtagsRaw = Array.isArray(snapshot.hashtags) ? snapshot.hashtags : []
    const hashtags = hashtagsRaw.filter(
      (h): h is string => typeof h === "string",
    )

    let result: { platformPostId: string; platformPostUrl: string; apiMadeWarning: boolean }
    if (job.socialAccount.postingMethod === "browser_automation") {
      // Платформо-специфичная подготовка snapshot.
      if (job.platform === "youtube") {
        // Подгружаем Video.format + duration для shorts detection.
        const video = await prisma.video.findUnique({
          where: { id: job.videoId },
          select: { format: true, duration: true },
        })
        if (!video) {
          throw new Error(`Video #${job.videoId} не найден при подготовке YouTube post`)
        }
        const isShorts = detectIsShorts(video)
        const yt = parseYoutubeSnapshot(snapshot)
        result = await runBrowserPosting({
          jobId: job.id,
          videoId: job.videoId,
          socialAccountId: job.socialAccountId,
          deviceProfileId: job.socialAccount.deviceProfileId,
          caption: yt.description, // TikTok-fallback не используется YouTube poster, но контракт требует string
          hashtags: yt.hashtags,
          title: yt.title,
          description: yt.description,
          youtube: {
            visibility: yt.youtube.visibility,
            madeForKids: yt.youtube.madeForKids,
            isShorts,
          },
          platform: job.platform,
        })
      } else {
        // TikTok / Instagram — единое поле caption (как было).
        result = await runBrowserPosting({
          jobId: job.id,
          videoId: job.videoId,
          socialAccountId: job.socialAccountId,
          deviceProfileId: job.socialAccount.deviceProfileId,
          caption,
          hashtags,
          platform: job.platform,
        })
      }
    } else if (process.env.POSTING_MOCK_RUNNER === "true") {
      // DEV/TEST-ONLY мок (флаг POSTING_MOCK_RUNNER=true). В проде НИКОГДА не
      // вызывается — иначе фейкал бы «published» с mock-post URL без реального поста.
      result = await sendToRunner({ id: job.id, platform: job.platform })
    } else {
      // ПРОД: реального API-раннера не существует (по решению проекта IG/TikTok
      // постят ТОЛЬКО через browser_automation, Graph API отвергнут). Раньше тут
      // вызывался мок-раннер, который фейкал «Опубликовано» с выдуманным URL —
      // реального поста не было. Теперь честно валим job терминально (internal_error,
      // НЕ retryable → не зациклится в retry).
      const apiUnsupported = new ApiPostingUnsupportedError(
        "API-постинг не реализован (postingMethod=api, реального API-раннера нет). "
          + "Переключите аккаунт на browser_automation („Через браузер“) "
          + "+ привяжите прокси/Indigo + залогиньтесь.",
      )
      throw apiUnsupported
    }

    await transitionJob(jobId, "published", {
      platformPostId: result.platformPostId,
      platformPostUrl: result.platformPostUrl,
      apiMadeWarning: result.apiMadeWarning,
      lastError: null,
      errorCategory: null,
      // Part D: успешный run очищает phase/screenshot
      lastErrorPhase: null,
      lastErrorScreenshotKey: null,
    })

    // Обновляем счётчики аккаунта (round-robin lastPostedAt + totalPostsPublished)
    await prisma.socialAccount
      .update({
        where: { id: job.socialAccountId },
        data: {
          lastPostedAt: new Date(),
          totalPostsPublished: { increment: 1 },
        },
      })
      .catch(() => {})

    await appendJobLog(jobId, "info", "Job опубликован успешно", {
      platformPostId: result.platformPostId,
      platformPostUrl: result.platformPostUrl,
    })
  } catch (err: unknown) {
    await handleFailure(job, err)
  }
}

/**
 * Обработать неудачную попытку.
 *
 * - Категоризируем ошибку.
 * - Если retry уместен — переход в retry_queued + retryAt.
 * - Иначе → failed + Telegram alert.
 *
 * Учитывает что текущий статус может быть preparing (не дошли до uploading) или uploading.
 */
async function handleFailure(job: JobWithIncludes, err: unknown): Promise<void> {
  // PR3: policy-driven retry для FSM-job'ов (флаг ON + stateData.fsmVersion).
  // PR1: platform-aware — FSM-able {youtube, instagram}; для прочих платформ
  // (TikTok) и выключенных резолвер вернёт false, и legacy-ветка отработает БЕЗ
  // изменений. fsmHandleFailure также вернёт false, если job не под FSM (нет
  // stateData) → legacy fallback сохранён. IG при дефолте OFF → legacy.
  if (isPostingFsmEnabled(job.platform)) {
    if (await fsmHandleFailure(job, err)) return
  }

  const message = err instanceof Error ? err.message : String(err)
  const category = categorizeError(err)

  // Part D: вытаскиваем phase и screenshotKey из PostingPhaseError
  let phase: string | null = null
  let screenshotKey: string | null = null
  if (err instanceof PostingPhaseError) {
    phase = err.phase
    screenshotKey = err.screenshotKey ?? null
  }

  // attemptCount уже инкрементирован при claim'е, поэтому передаём как есть
  const retry = shouldRetry(category, job.attemptCount, job.maxAttempts)

  // Текущий статус читаем заново (могли уйти в cancelled между claim и сюда)
  const fresh = await prisma.postingJob.findUnique({
    where: { id: job.id },
    select: { status: true },
  })
  if (!fresh || fresh.status === "cancelled") return

  // Final resilience (узко): browser_connect_failed из-за dead DevTools port
  // (Indigo agent не отдаёт рабочий CDP после internal session_start retry) —
  // не terminal, а retry_queued с backoff, чтобы поймать "good window" Indigo.
  // Fingerprint строго: только этот класс ошибок, не любой browser_connect_failed.
  const isDeadPortIndigo =
    category === "browser_connect_failed"
    && (/DevTools endpoint not ready/i.test(message)
      || /Unable to connect/i.test(message)
      || /не отдал рабочий CDP-порт/i.test(message))
  if (isDeadPortIndigo) {
    const MARKER = "browser_connect_failed_retryable"
    const MAX_INDIGO_RETRIES = 7
    const RETRY_WINDOW_MS = 90 * 60 * 1000

    // Счётчик прошлых таких retry + начало окна — по job log (отдельно от
    // attemptCount/maxAttempts, которые тут не применяем).
    const priorLogs = await prisma.postingJobLog.findMany({
      where: { jobId: job.id, message: { contains: MARKER } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    })
    const priorRetries = priorLogs.length
    const windowStart = priorLogs[0]?.createdAt ?? new Date()
    const windowElapsedMs = Date.now() - windowStart.getTime()
    const windowRemainingMs = RETRY_WINDOW_MS - windowElapsedMs

    const iaMatch = message.match(/(\d+)\s+internal attempts/)
    const internalAttempts = iaMatch ? Number(iaMatch[1]) : null
    const portMatch = message.match(/port[=\s]+(\d+)/i)
    const lastPort = portMatch ? Number(portMatch[1]) : null

    if (priorRetries < MAX_INDIGO_RETRIES && windowRemainingMs > 0) {
      // Backoff: первый — 5 мин, далее 10, после 3-го — 15 мин. Без мгновенных
      // подряд (минимум 5 мин даёт Indigo agent время восстановиться).
      const backoffMs = priorRetries === 0 ? 5 * 60_000 : priorRetries < 3 ? 10 * 60_000 : 15 * 60_000
      const at = new Date(Date.now() + backoffMs)
      try {
        await transitionJob(job.id, "retry_queued", {
          lastError: message,
          errorCategory: category,
          retryAt: at,
          lastErrorPhase: phase,
          lastErrorScreenshotKey: screenshotKey,
        })
      } catch (transErr: unknown) {
        await appendJobLog(job.id, "error", "browser_connect_failed_retryable: переход в retry_queued не удался", {
          transitionError: transErr instanceof Error ? transErr.message : String(transErr),
        })
        return
      }
      await appendJobLog(
        job.id,
        "warn",
        `${MARKER}: Indigo нестабилен, job ждёт good window (retry ${priorRetries + 1}/${MAX_INDIGO_RETRIES})`,
        {
          internalAttempts,
          lastPort,
          nextRetryAt: at.toISOString(),
          retryWindowRemainingMs: windowRemainingMs,
          priorRetries,
          backoffMs,
        },
      )
      // TG: НЕ сирена на каждый dead port. "custom" один раз при первом таком fail.
      if (priorRetries === 0) {
        await sendTelegramAlert(
          "custom",
          `PostingJob #${job.id}: ожидание стабильного окна Indigo`,
          `Indigo agent нестабилен (browser_connect_failed). Job авто-retry с backoff (до ${MAX_INDIGO_RETRIES}× за 90 мин). Аккаунт: ${job.socialAccount.displayName} (#${job.socialAccount.id}).`,
        ).catch(() => {})
      }
      return
    }

    // Окно/лимит исчерпаны → final fail. Категория остаётся browser_connect_failed
    // (enum не трогаем), пометка indigo_unstable в message + log.finalReason.
    try {
      await transitionJob(job.id, "failed", {
        lastError: `indigo_unstable (retry window exhausted, ${priorRetries} retries / ${Math.round(windowElapsedMs / 60_000)} мин): ${message}`,
        errorCategory: category,
        lastErrorPhase: phase,
        lastErrorScreenshotKey: screenshotKey,
      })
    } catch (transErr: unknown) {
      await appendJobLog(job.id, "error", "Не удалось перейти в failed (indigo_unstable)", {
        transitionError: transErr instanceof Error ? transErr.message : String(transErr),
      })
      return
    }
    await appendJobLog(job.id, "error", `browser_connect_failed_final: окно good-window Indigo исчерпано`, {
      finalReason: "indigo_unstable",
      priorRetries,
      windowElapsedMs,
      internalAttempts,
      lastPort,
    })
    await sendTelegramAlert(
      "critical_error",
      `PostingJob #${job.id} провален: indigo_unstable`,
      `Indigo agent не стабилизировался за ${priorRetries} retries / ${Math.round(windowElapsedMs / 60_000)} мин. Аккаунт: ${job.socialAccount.displayName} (#${job.socialAccount.id})\nОшибка: ${message}`,
    ).catch(() => {})
    return
  }

  // Final resilience (узко, вариант 1 — выбран 2026-05-28): browser_lost.
  // Indigo Chromium недетерминированно теряет page/target ВНУТРИ pipeline
  // (detached Frame / Target closed / Session closed / Execution context destroyed).
  // Evidence: cmppcseye 12:08:41 — "Attempted to use detached Frame" в upload-фазе.
  // Сырая puppeteer-ошибка из необёрнутых waitForSelector в youtube-poster
  // всплывает в poster-runner dispatch catch и помечается phase=session_start,
  // category=unknown — поэтому ловим по MESSAGE, а не по phase (строгий phase-guard
  // на upload-фазы был бы no-op против реального падения). Это transient (браузер
  // умер) → retry с cooldown ловит good window, как dead-port. НЕ путать с dead-port
  // (browser_connect_failed + DevTools-сообщения — у него отдельный fingerprint выше).
  const BROWSER_LOST_RE = /Attempted to use detached Frame|detached Frame|Target closed|Session closed|Execution context was destroyed/i
  const isBrowserLost = !isDeadPortIndigo && BROWSER_LOST_RE.test(message)
  if (isBrowserLost) {
    const MARKER = "browser_lost_retryable"
    const MAX_BROWSER_LOST_RETRIES = 5
    const RETRY_WINDOW_MS = 90 * 60 * 1000

    // Rolling window: считаем только маркеры за последние 90 мин. Это даёт
    // attempts-cap (MAX за окно) И естественно освобождает бюджет для manual
    // Retry после простоя > окна (markers стареют). windowStart — самый ранний
    // в окне (для отчётности elapsed).
    const windowFloor = new Date(Date.now() - RETRY_WINDOW_MS)
    const priorLogs = await prisma.postingJobLog.findMany({
      where: { jobId: job.id, message: { contains: MARKER }, createdAt: { gte: windowFloor } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    })
    const priorRetries = priorLogs.length
    const windowStart = priorLogs[0]?.createdAt ?? new Date()
    const windowElapsedMs = Date.now() - windowStart.getTime()

    // errorCategory: храним network_error — в этом codebase это устоявшаяся
    // категория transient browser death (ср. login_check store-empty и navigate
    // "page/CDP detached"). Новый enum browser_lost НЕ вводим (избегаем
    // DB-миграции; класс однозначно виден по маркеру browser_lost в логе/message).
    const storedCategory = "network_error" as const

    if (priorRetries < MAX_BROWSER_LOST_RETRIES) {
      // Cooldown 5-10 мин — даёт Indigo agent восстановиться + перезапустить
      // профиль. stopProfile/cleanup уже гарантирован finally в poster-runner
      // (session.close + stopIndigoSession), поэтому здесь только пауза + reschedule.
      const backoffMs = priorRetries === 0 ? 5 * 60_000 : priorRetries < 3 ? 7 * 60_000 : 10 * 60_000
      const at = new Date(Date.now() + backoffMs)
      try {
        await transitionJob(job.id, "retry_queued", {
          lastError: `browser_lost (${phase ?? "?"}): ${message}`,
          errorCategory: storedCategory,
          retryAt: at,
          lastErrorPhase: phase,
          lastErrorScreenshotKey: screenshotKey,
        })
      } catch (transErr: unknown) {
        await appendJobLog(job.id, "error", "browser_lost_retryable: переход в retry_queued не удался", {
          transitionError: transErr instanceof Error ? transErr.message : String(transErr),
        })
        return
      }
      // Duplicate-risk (вариант 1 п.4): если браузер умер ПОСЛЕ начала file_upload,
      // файл мог частично уйти в YouTube → на канале может остаться orphaned draft.
      // Dedup-логики (поиск существующего draft/duplicate) у нас НЕТ, retry грузит
      // заново. Phase ненадёжен (часто session_start из-за wrap), поэтому фиксируем
      // риск в логе всегда, а не только для post-upload фаз.
      await appendJobLog(
        job.id,
        "warn",
        `${MARKER}: Indigo потерял browser/page, job ждёт good window (retry ${priorRetries + 1}/${MAX_BROWSER_LOST_RETRIES})`,
        {
          phase: phase ?? null,
          nextRetryAt: at.toISOString(),
          priorRetries,
          backoffMs,
          windowElapsedMs,
          duplicateRisk:
            "Если браузер умер после начала file_upload — на YouTube мог остаться orphaned draft (dedup-логики нет, retry грузит заново).",
        },
      )
      // TG: НЕ сирена на каждый browser_lost. "custom" один раз при первом.
      if (priorRetries === 0) {
        await sendTelegramAlert(
          "custom",
          `PostingJob #${job.id}: browser_lost, ожидание стабильного окна Indigo`,
          `Indigo потерял browser/page внутри pipeline (фаза: ${phase ?? "?"}). Job авто-retry с cooldown (до ${MAX_BROWSER_LOST_RETRIES}× за 90 мин). Аккаунт: ${job.socialAccount.displayName} (#${job.socialAccount.id}).`,
        ).catch(() => {})
      }
      return
    }

    // Лимит за окно исчерпан → final fail. Категория остаётся network_error,
    // пометка browser_lost_final в message + log.finalReason.
    try {
      await transitionJob(job.id, "failed", {
        lastError: `browser_lost_final (${priorRetries} retries / ${Math.round(windowElapsedMs / 60_000)} мин в окне): ${message}`,
        errorCategory: storedCategory,
        lastErrorPhase: phase,
        lastErrorScreenshotKey: screenshotKey,
      })
    } catch (transErr: unknown) {
      await appendJobLog(job.id, "error", "Не удалось перейти в failed (browser_lost_final)", {
        transitionError: transErr instanceof Error ? transErr.message : String(transErr),
      })
      return
    }
    await appendJobLog(job.id, "error", "browser_lost_final: окно good-window Indigo исчерпано", {
      finalReason: "browser_lost",
      priorRetries,
      windowElapsedMs,
      phase: phase ?? null,
    })
    await sendTelegramAlert(
      "critical_error",
      `PostingJob #${job.id} провален: browser_lost`,
      `Indigo терял browser/page ${priorRetries}× за ${Math.round(windowElapsedMs / 60_000)} мин (последняя фаза: ${phase ?? "?"}). Аккаунт: ${job.socialAccount.displayName} (#${job.socialAccount.id})\nОшибка: ${message}`,
    ).catch(() => {})
    return
  }

  if (retry) {
    // Этап 3 (per-device кулдаун): device_busy/device_cooldown (DuoPlus pre-check)
    // классифицируются как network_error (retryable), но устройство ещё занято/
    // configuring ~180с — generic-backoff (1 мин) повторил бы впустую. Держим ≥180с.
    const generic = nextRetryAt(job.attemptCount)
    const at = isDeviceCooldownError(err)
      ? new Date(Math.max(generic.getTime(), Date.now() + DEVICE_COOLDOWN_RETRY_MS))
      : generic
    try {
      await transitionJob(job.id, "retry_queued", {
        lastError: message,
        errorCategory: category,
        retryAt: at,
        lastErrorPhase: phase,
        lastErrorScreenshotKey: screenshotKey,
      })
      await appendJobLog(
        job.id,
        "warn",
        `Job уйдёт в retry (${category}), попытка ${job.attemptCount}/${job.maxAttempts}, retryAt=${at.toISOString()}`,
        { error: message, category },
      )
    } catch (transErr: unknown) {
      // переход не разрешён (например, мы в preparing → retry_queued — да, но если статус ушёл другой)
      await appendJobLog(job.id, "error", "Не удалось перейти в retry_queued", {
        error: message,
        transitionError: transErr instanceof Error ? transErr.message : String(transErr),
      })
    }
    return
  }

  // Не retryable или попытки исчерпаны → failed
  try {
    await transitionJob(job.id, "failed", {
      lastError: message,
      errorCategory: category,
      lastErrorPhase: phase,
      lastErrorScreenshotKey: screenshotKey,
    })
  } catch (transErr: unknown) {
    await appendJobLog(job.id, "error", "Не удалось перейти в failed", {
      error: message,
      transitionError: transErr instanceof Error ? transErr.message : String(transErr),
    })
    return
  }

  await appendJobLog(job.id, "error", `Job провалился окончательно (${category})`, {
    error: message,
    category,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
  })

  // Telegram alert для всех окончательных провалов
  await sendTelegramAlert(
    "critical_error",
    `PostingJob #${job.id} провален: ${category}`,
    `Аккаунт: ${job.socialAccount.displayName} (#${job.socialAccount.id})\nПлатформа: ${job.platform}\nОшибка: ${message}\nПопытки: ${job.attemptCount}/${job.maxAttempts}`,
  ).catch(() => {})
}
