/**
 * CRUD-сервис для PostingJob.
 *
 * - createPostingJob: идемпотентное создание (по sha256-ключу).
 * - transitionJob: переход между статусами с проверкой canTransition + auto finishedAt/durationMs.
 * - appendJobLog: добавление строки в PostingJobLog.
 * - cancelJob: отмена job (с проверкой что не terminal).
 */

import { createHash } from "node:crypto"
import { prisma } from "../prisma"
import type {
  Platform,
  PostingErrorCategory,
  PostingJob,
  PostingJobStatus,
  Prisma,
} from "../../../app/generated/prisma/client"
import { canTransition, isTerminal } from "./state-machine"

export interface CreatePostingJobInput {
  videoId: number
  socialAccountId: number
  platform: Platform
  scheduledAt?: Date | null
  contentSnapshot: Prisma.InputJsonValue
  runId?: number | null
  pipelineId?: number | null
  uploadId?: number | null
  maxAttempts?: number
  createdById?: number | null
}

/** Дефолт попыток для browser_automation (antidetect-браузер). */
export const DEFAULT_MAX_ATTEMPTS_BROWSER = 5
/** Дефолт попыток для прочих методов (api). */
export const DEFAULT_MAX_ATTEMPTS_GENERIC = 3

/**
 * Дефолт PostingJob.maxAttempts по методу постинга.
 *
 * browser_automation идёт через antidetect-браузер (Multilogin/Indigo): сессии бывают
 * медленные/флаки (residential proxy + тяжёлый Studio SPA + Mimic на Debian), attach
 * видео иногда не подтверждается с первого раза при ЖИВОЙ сессии. Больше job-ретраев =
 * больше шансов попасть на быструю сессию (каждый ретрай — свежая сессия). 5 (было 3).
 *
 * api-джобы в проде фейлятся терминально (наш api-раннер не поддерживается, IG/TikTok
 * api заблокированы на эндпоинте) → доп. попытки бессмысленны, оставляем 3.
 */
export function defaultMaxAttemptsForMethod(postingMethod: string | null | undefined): number {
  return postingMethod === "browser_automation"
    ? DEFAULT_MAX_ATTEMPTS_BROWSER
    : DEFAULT_MAX_ATTEMPTS_GENERIC
}

/**
 * Сборка идемпотентного ключа (PR5/B2).
 *
 * - runId > 0 (pipeline-путь): sha256(`videoId:socialAccountId:run:<runId>`).slice(0, 32).
 *   Гарантирует идемпотентность ВНУТРИ одного прогона конвейера (повторный enqueue той же
 *   ноды/видео/аккаунта в рамках run → тот же job), но разные прогоны не схлопываются.
 * - runId null/undefined/<=0 (ручной/bulk asap или scheduled путь): ТЕКУЩАЯ схема
 *   sha256(`videoId:socialAccountId:scheduledAtISO|asap`).slice(0, 32) — БАЙТ-В-БАЙТ как
 *   до PR5 (backward-compatible: существующие PostingJob.idempotencyKey в БД продолжают матчиться).
 *
 * Гарантирует что повторный POST с тем же видео+аккаунтом+временем (или внутри того же run)
 * вернёт существующий job вместо создания дубля.
 */
export function buildIdempotencyKey(opts: {
  videoId: number
  socialAccountId: number
  scheduledAt?: Date | null
  runId?: number | null
}): string {
  const runId = opts.runId ?? 0
  if (runId > 0) {
    const raw = `${opts.videoId}:${opts.socialAccountId}:run:${runId}`
    return createHash("sha256").update(raw).digest("hex").slice(0, 32)
  }
  // backward-compatible ручной путь — НЕ менять формат строки/алгоритм.
  const slot = opts.scheduledAt ? opts.scheduledAt.toISOString() : "asap"
  const raw = `${opts.videoId}:${opts.socialAccountId}:${slot}`
  return createHash("sha256").update(raw).digest("hex").slice(0, 32)
}

/**
 * Идемпотентное создание PostingJob.
 *
 * - Если по idempotencyKey уже есть запись в active-state (queued/preparing/uploading/published) —
 *   возвращаем её без изменений.
 * - Если есть запись в failed — кидаем 409 (operator делает retry через /retry endpoint).
 * - Если есть в cancelled — ВОСКРЕШАЕМ ту же запись (idempotencyKey unique, второй
 *   row не создать): сброс в queued/scheduled с новыми данными, attemptCount=0,
 *   stateData сохраняем (resolveResumePlan защищает от дубля). Иначе был циклический
 *   тупик: retry-endpoint для cancelled велит "create новый", а create велел "retry".
 */
export async function createPostingJob(
  opts: CreatePostingJobInput,
): Promise<PostingJob> {
  const idempotencyKey = buildIdempotencyKey({
    videoId: opts.videoId,
    socialAccountId: opts.socialAccountId,
    scheduledAt: opts.scheduledAt ?? null,
    runId: opts.runId ?? null,
  })

  const existing = await prisma.postingJob.findUnique({
    where: { idempotencyKey },
  })

  const initialStatus: PostingJobStatus = opts.scheduledAt
    ? "scheduled"
    : "queued"

  if (existing) {
    const activeStatuses: PostingJobStatus[] = [
      "scheduled",
      "queued",
      "preparing",
      "uploading",
      "retry_queued",
      "published",
    ]
    if (activeStatuses.includes(existing.status)) {
      return existing
    }
    if (existing.status === "cancelled") {
      // Cancelled терминальный, но НЕ retryable (retry.post.ts принимает только
      // failed). Раньше тут был 409 "используйте retry" — циклический тупик:
      // retry-эндпоинт для cancelled велит "cancel + create новый", а create
      // велел "retry". Воскрешаем ТОТ ЖЕ row (idempotencyKey unique → второй
      // создать нельзя): сброс в initialStatus + новые данные, attemptCount=0,
      // очистка cancel/error/timing-полей. stateData СОХРАНЯЕМ — resolveResumePlan
      // защитит от дубля так же, как manual retry из failed (есть draftVideoId →
      // resume без re-upload; нет прогресса → fresh).
      const resurrected = await prisma.postingJob.update({
        where: { id: existing.id },
        data: {
          status: initialStatus,
          scheduledAt: opts.scheduledAt ?? null,
          contentSnapshot: opts.contentSnapshot,
          maxAttempts: opts.maxAttempts ?? existing.maxAttempts,
          runId: opts.runId ?? null,
          pipelineId: opts.pipelineId ?? null,
          uploadId: opts.uploadId ?? null,
          attemptCount: 0,
          cancelReason: null,
          cancelledAt: null,
          cancelledById: null,
          lastError: null,
          errorCategory: null,
          retryAt: null,
          lastErrorPhase: null,
          lastErrorScreenshotKey: null,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          platformPostId: null,
          platformPostUrl: null,
        },
      })
      await appendJobLog(
        resurrected.id,
        "info",
        `PostingJob воскрешён из cancelled в ${initialStatus} (повторное создание тем же ключом)`,
        {
          videoId: opts.videoId,
          socialAccountId: opts.socialAccountId,
          previousStatus: "cancelled",
        },
      )
      return resurrected
    }
    // failed (и прочие terminal) — explicit retry endpoint (для failed) или иной scheduledAt.
    throw createError({
      statusCode: 409,
      message: `PostingJob с этим ключом уже существует в статусе ${existing.status}. Используйте retry (доступен для failed) или измените scheduledAt.`,
      data: { existingJobId: existing.id, status: existing.status },
    })
  }

  const job = await prisma.postingJob.create({
    data: {
      videoId: opts.videoId,
      socialAccountId: opts.socialAccountId,
      platform: opts.platform,
      status: initialStatus,
      scheduledAt: opts.scheduledAt ?? null,
      idempotencyKey,
      contentSnapshot: opts.contentSnapshot,
      runId: opts.runId ?? null,
      pipelineId: opts.pipelineId ?? null,
      uploadId: opts.uploadId ?? null,
      maxAttempts: opts.maxAttempts ?? 3,
      createdById: opts.createdById ?? null,
    },
  })

  await appendJobLog(job.id, "info", `PostingJob создан в статусе ${initialStatus}`, {
    videoId: opts.videoId,
    socialAccountId: opts.socialAccountId,
    platform: opts.platform,
    scheduledAt: opts.scheduledAt?.toISOString() ?? null,
  })

  return job
}

export interface TransitionPatch {
  platformPostId?: string | null
  platformPostUrl?: string | null
  apiMadeWarning?: boolean
  lastError?: string | null
  errorCategory?: PostingErrorCategory | null
  retryAt?: Date | null
  attemptCount?: number
  startedAt?: Date | null
  cancelReason?: string | null
  cancelledById?: number | null
  cancelledAt?: Date | null
  /** Part D: фаза в которой упал runner. */
  lastErrorPhase?: string | null
  /** Part D: storageKey скриншота ошибки в zavodcamp/posting-errors/. */
  lastErrorScreenshotKey?: string | null
  /** PR3: persisted phase-FSM stateData (classWindows/finalReason и т.п.). */
  stateData?: Prisma.InputJsonValue
}

/**
 * Переход PostingJob в новый статус.
 *
 * - Проверяет canTransition, кидает 409 если переход недопустим.
 * - Для terminal (published/cancelled/failed) автоматически проставляет finishedAt и durationMs.
 * - НЕ выполняет атомарный claim — для claim'а используется отдельный updateMany в worker.ts.
 */
export async function transitionJob(
  jobId: string,
  newStatus: PostingJobStatus,
  patch?: TransitionPatch,
): Promise<PostingJob> {
  const current = await prisma.postingJob.findUnique({ where: { id: jobId } })
  if (!current) {
    throw createError({ statusCode: 404, message: `PostingJob ${jobId} не найден` })
  }

  if (!canTransition(current.status, newStatus)) {
    throw createError({
      statusCode: 409,
      message: `Недопустимый переход PostingJob: ${current.status} → ${newStatus}`,
      data: { jobId, from: current.status, to: newStatus },
    })
  }

  // failed считаем условно-terminal для расчёта duration (job больше не работает,
  // но может быть переоткрыт через manual retry).
  const stopsExecution: PostingJobStatus[] = ["published", "cancelled", "failed"]
  // НЕ перештамповываем уже завершённую job. Кейс: failed→cancelled — job уже был
  // failed (finishedAt/durationMs проставлены реальной точкой завершения). Cancel
  // спустя часы/дни иначе пересчитал бы durationMs от startedAt до МОМЕНТА CANCEL
  // (искажение аналитики). Штампуем ТОЛЬКО когда finishedAt ещё null
  // (нормальный путь queued/uploading→terminal, где finishedAt не проставлен).
  const shouldStamp = stopsExecution.includes(newStatus) && current.finishedAt === null

  const finishedAt = shouldStamp ? new Date() : null
  const durationMs =
    shouldStamp && current.startedAt
      ? finishedAt!.getTime() - current.startedAt.getTime()
      : null

  const data: Prisma.PostingJobUpdateInput = {
    status: newStatus,
  }
  if (patch?.platformPostId !== undefined) data.platformPostId = patch.platformPostId
  if (patch?.platformPostUrl !== undefined) data.platformPostUrl = patch.platformPostUrl
  if (patch?.apiMadeWarning !== undefined) data.apiMadeWarning = patch.apiMadeWarning
  if (patch?.lastError !== undefined) data.lastError = patch.lastError
  if (patch?.errorCategory !== undefined) data.errorCategory = patch.errorCategory
  if (patch?.retryAt !== undefined) data.retryAt = patch.retryAt
  if (patch?.attemptCount !== undefined) data.attemptCount = patch.attemptCount
  if (patch?.startedAt !== undefined) data.startedAt = patch.startedAt
  if (patch?.cancelReason !== undefined) data.cancelReason = patch.cancelReason
  if (patch?.cancelledById !== undefined) data.cancelledById = patch.cancelledById
  if (patch?.cancelledAt !== undefined) data.cancelledAt = patch.cancelledAt
  if (patch?.lastErrorPhase !== undefined) data.lastErrorPhase = patch.lastErrorPhase
  if (patch?.lastErrorScreenshotKey !== undefined)
    data.lastErrorScreenshotKey = patch.lastErrorScreenshotKey
  if (patch?.stateData !== undefined) data.stateData = patch.stateData

  if (shouldStamp) {
    data.finishedAt = finishedAt
    if (durationMs !== null) data.durationMs = durationMs
  }

  const updated = await prisma.postingJob.update({
    where: { id: jobId },
    data,
  })

  return updated
}

export type PostingJobLogLevel = "info" | "warn" | "error"

export async function appendJobLog(
  jobId: string,
  level: PostingJobLogLevel,
  message: string,
  data?: Prisma.InputJsonValue,
): Promise<void> {
  await prisma.postingJobLog
    .create({
      data: {
        jobId,
        level,
        message,
        data: data ?? undefined,
      },
    })
    .catch(() => {
      // Лог job — best-effort, не должен валить основной flow
    })
}

/**
 * Отменить job. Работает только если current status НЕ terminal.
 * Если job в queued/preparing/uploading — просто помечаем cancelled. Worker увидит
 * cancellation на следующем тике и не запустит executeJob (или прервёт его на проверке).
 *
 * Note: реальная остановка in-flight Indigo-сессии будет в итерации 4 через signal/cancel в runner.
 * В mock-режиме executeJob и так короткий, race не критичен.
 */
export async function cancelJob(
  jobId: string,
  userId: number,
  reason: string,
): Promise<PostingJob> {
  const current = await prisma.postingJob.findUnique({ where: { id: jobId } })
  if (!current) {
    throw createError({ statusCode: 404, message: `PostingJob ${jobId} не найден` })
  }

  if (isTerminal(current.status)) {
    throw createError({
      statusCode: 409,
      message: `Нельзя отменить job в terminal-статусе ${current.status}`,
      data: { jobId, status: current.status },
    })
  }

  // P1 (D-a): cancel из failed теперь разрешён (failed→cancelled добавлен в
  // ALLOWED_TRANSITIONS). Мягкая альтернатива delete: снять с retry, сохранив запись.
  // (failed→cancelled держит idempotencyKey → новый create воскресит — тот же эффект что retry).
  // Раньше тут была спец-ветка 409 «используйте retry или удаление» — убрана.

  const job = await transitionJob(jobId, "cancelled", {
    cancelReason: reason,
    cancelledById: userId,
    cancelledAt: new Date(),
  })

  await appendJobLog(jobId, "info", `Job отменён оператором: ${reason}`, {
    cancelledById: userId,
  })

  return job
}

// ---------------------------------------------------------------------------
// DELETE / BULK-DELETE (полный CRUD, P0/P1)
// ---------------------------------------------------------------------------

/**
 * Окно «живого воркера» (ms). preparing/uploading со startedAt свежее этого окна
 * считаются потенциально in-flight (воркер может ещё работать) → требуют cancel/force.
 * Старше окна (или startedAt=null) — труп, удаляем свободно.
 *
 * Обоснование 3 мин: preparing — секундная стадия (STUCK_PREPARING_MS=10мин уже
 * считает >10мин мёртвым); живой воркер от claim до transition uploading укладывается
 * в секунды. 3 мин — консервативный буфер с запасом против медленного proxy-чека.
 */
export const DELETE_LIVE_WINDOW_MS = 3 * 60 * 1000

/**
 * Статусы, удаляемые свободно (воркер их не исполняет либо ещё не взял в работу).
 * preparing/uploading НЕ здесь — для них отдельный liveness-расчёт по startedAt.
 */
export const POSTING_JOB_FREELY_DELETABLE: PostingJobStatus[] = [
  "failed",
  "cancelled",
  "scheduled",
  "queued",
  "retry_queued",
]

/** Структурный код причины 409 при delete (для UI). */
export type PostingJobDeleteBlockCode = "published_needs_confirm" | "job_in_flight"

export interface DeletePostingJobOptions {
  /** Подтверждение удаления published (re-post риск). */
  confirm?: boolean
  /** Принудительное удаление свежей in-flight (требует isAdmin). */
  force?: boolean
  /** Есть ли у вызывающего canAdmin (гейт для force). */
  isAdmin?: boolean
}

export interface DeletePostingJobResult {
  id: string
  deleted: true
  status: PostingJobStatus
}

/**
 * Вычислить: считается ли preparing/uploading job свежей in-flight (воркер может работать).
 * STALE (startedAt=null или старше окна) → false (труп, удалять свободно).
 */
function isFreshInFlight(
  status: PostingJobStatus,
  startedAt: Date | null,
  now: number,
): boolean {
  if (status !== "preparing" && status !== "uploading") return false
  if (!startedAt) return false // null = воркер не проставил/resurrect → не свежий
  return startedAt.getTime() > now - DELETE_LIVE_WINDOW_MS
}

/**
 * Результат guard-проверки для одной job. Либо разрешено удаление, либо блок с кодом.
 * deletable=true → можно удалять. deletable=false → blockCode объясняет почему.
 */
export interface DeleteGuardDecision {
  deletable: boolean
  blockCode?: PostingJobDeleteBlockCode
  reason?: string
}

/**
 * Pure guard: можно ли удалить job с данным статусом/startedAt при данных opts.
 * НЕ ходит в БД. Переиспользуется single-delete и bulk-delete.
 */
export function evaluateDeleteGuard(
  job: { status: PostingJobStatus; startedAt: Date | null },
  opts: DeletePostingJobOptions,
  now: number = Date.now(),
): DeleteGuardDecision {
  // published — re-post риск, требует confirm.
  if (job.status === "published") {
    if (opts.confirm) return { deletable: true }
    return {
      deletable: false,
      blockCode: "published_needs_confirm",
      reason:
        "Удаление записи об опубликованном посте. Повторный постинг той же пары "
        + "создаст ДУБЛЬ на платформе. Подтвердите удаление (confirm).",
    }
  }

  // Свободно удаляемые статусы.
  if (POSTING_JOB_FREELY_DELETABLE.includes(job.status)) {
    return { deletable: true }
  }

  // Осталось: preparing / uploading.
  if (isFreshInFlight(job.status, job.startedAt, now)) {
    // Свежая in-flight: нужен cancel или force (force гейтится isAdmin отдельно в endpoint).
    if (opts.force) return { deletable: true }
    return {
      deletable: false,
      blockCode: "job_in_flight",
      reason:
        "Задача сейчас выполняется (свежая сессия). Сначала отмените (cancel), "
        + "затем удалите — или используйте принудительное удаление (force, только админ).",
    }
  }

  // STALE preparing/uploading (труп) — удаляем свободно.
  return { deletable: true }
}

/**
 * Hard-delete одной PostingJob с применением guard-правил.
 *
 * HARD delete (НЕ soft): idempotencyKey @unique. Soft-delete оставил бы строку →
 * новый createPostingJob нашёл бы её → снова 409/воскрешение → боль оператора не уйдёт.
 * Hard delete освобождает уникальный ключ → чистый старт.
 *
 * Логи (PostingJobLog) каскадятся сами (onDelete: Cascade в schema.prisma:2345).
 *
 * Worker mid-flight-safe: executeJob `if(!job)return`, handleFailure `if(!fresh)return`,
 * claim/recover через updateMany (count=0 no-op).
 *
 * @throws 404 если не найден, 409 published_needs_confirm | job_in_flight, 403 force без admin.
 */
export async function deletePostingJob(
  jobId: string,
  opts: DeletePostingJobOptions = {},
): Promise<DeletePostingJobResult> {
  const current = await prisma.postingJob.findUnique({
    where: { id: jobId },
    select: { id: true, status: true, startedAt: true },
  })
  if (!current) {
    throw createError({ statusCode: 404, message: `PostingJob ${jobId} не найден` })
  }

  // force гейтится canAdmin (RBAC-философия: force = повышенное действие).
  if (opts.force && !opts.isAdmin) {
    throw createError({
      statusCode: 403,
      message: "Принудительное удаление (force) доступно только администратору",
      data: { jobId, code: "force_requires_admin" },
    })
  }

  const decision = evaluateDeleteGuard(current, opts)
  if (!decision.deletable) {
    throw createError({
      statusCode: 409,
      message: decision.reason ?? "Удаление заблокировано",
      data: { jobId, status: current.status, code: decision.blockCode },
    })
  }

  await prisma.postingJob.delete({ where: { id: jobId } })

  return { id: current.id, deleted: true, status: current.status }
}

export interface BulkDeleteFilter {
  status?: PostingJobStatus[]
  platform?: Platform
  socialAccountId?: number
  /** ISO — удалять только созданные раньше этой даты. */
  olderThan?: string
}

export interface BulkDeletePostingJobsInput {
  ids?: string[]
  filter?: BulkDeleteFilter
  confirm?: boolean
  force?: boolean
  isAdmin?: boolean
}

export interface BulkDeleteSkippedJob {
  id: string
  status: PostingJobStatus
  // bulk НЕ возвращает "force_requires_admin": force-без-admin понижается до skip
  // с job_in_flight (см. effectiveOpts ниже), а не роняет bulk. Зеркалит shared-тип.
  code: PostingJobDeleteBlockCode
  reason: string
}

export interface BulkDeletePostingJobsResult {
  deleted: number
  deletedIds: string[]
  skipped: BulkDeleteSkippedJob[]
}

/** Лимит кандидатов при удалении по фильтру (safety против массовой ошибки). */
export const BULK_DELETE_FILTER_LIMIT = 500
/** Лимит ids в одном bulk-delete запросе. */
export const BULK_DELETE_IDS_LIMIT = 200

/**
 * Массовое hard-delete. Per-job guard B; нарушители идут в skipped (НЕ роняем весь bulk,
 * паттерн как bulk.post.ts). Удаляемые — одним deleteMany (atomic, логи каскадятся).
 *
 * Дефолт фильтр-чистки (UI «Очистить завалы») = status in [failed, cancelled] —
 * published исключён намеренно (re-post safety).
 */
export async function bulkDeletePostingJobs(
  input: BulkDeletePostingJobsInput,
): Promise<BulkDeletePostingJobsResult> {
  const opts: DeletePostingJobOptions = {
    confirm: input.confirm,
    force: input.force,
    isAdmin: input.isAdmin,
  }

  // Собрать кандидатов.
  let candidates: { id: string; status: PostingJobStatus; startedAt: Date | null }[]

  if (input.ids && input.ids.length > 0) {
    candidates = await prisma.postingJob.findMany({
      where: { id: { in: input.ids } },
      select: { id: true, status: true, startedAt: true },
    })
  } else if (input.filter) {
    const f = input.filter
    const where: Prisma.PostingJobWhereInput = {}
    if (f.status && f.status.length > 0) where.status = { in: f.status }
    if (f.platform) where.platform = f.platform
    if (typeof f.socialAccountId === "number") where.socialAccountId = f.socialAccountId
    if (f.olderThan) {
      const d = new Date(f.olderThan)
      if (!Number.isNaN(d.getTime())) where.createdAt = { lt: d }
    }
    candidates = await prisma.postingJob.findMany({
      where,
      select: { id: true, status: true, startedAt: true },
      take: BULK_DELETE_FILTER_LIMIT,
      orderBy: { createdAt: "asc" },
    })
  } else {
    candidates = []
  }

  const now = Date.now()
  const deletableIds: string[] = []
  const skipped: BulkDeleteSkippedJob[] = []

  for (const job of candidates) {
    // force без admin: не удаляем свежие in-flight, репортим skip (не 403 на весь bulk).
    const effectiveOpts: DeletePostingJobOptions =
      opts.force && !opts.isAdmin ? { ...opts, force: false } : opts

    const decision = evaluateDeleteGuard(job, effectiveOpts, now)
    if (decision.deletable) {
      deletableIds.push(job.id)
    } else {
      skipped.push({
        id: job.id,
        status: job.status,
        // blockCode всегда задан, когда deletable=false; ?? — защита от undefined
        // в типе skipped.code (single-delete возвращает 403, в bulk force-без-admin
        // понижается до skip с job_in_flight).
        code: decision.blockCode ?? "job_in_flight",
        reason: decision.reason ?? "Удаление заблокировано",
      })
    }
  }

  let deleted = 0
  if (deletableIds.length > 0) {
    const res = await prisma.postingJob.deleteMany({
      where: { id: { in: deletableIds } },
    })
    deleted = res.count
  }

  return { deleted, deletedIds: deletableIds, skipped }
}

// ---------------------------------------------------------------------------
// UPDATE (P2 — минимальный PATCH)
// ---------------------------------------------------------------------------

export interface UpdatePostingJobInput {
  scheduledAt?: string | null
  maxAttempts?: number
  /** id оператора, выполнившего правку (audit в PostingJobLog). */
  updatedById?: number | null
}

/** Статусы, в которых job редактируема (ещё не взята воркером, не terminal). */
export const POSTING_JOB_EDITABLE_STATUSES: PostingJobStatus[] = ["scheduled", "queued"]

/**
 * Минимальный UPDATE: только scheduledAt + maxAttempts, только для scheduled/queued.
 *
 * contentSnapshot НЕ редактируется (комментарий схемы: «гарантирует идемпотентность
 * retries»). idempotencyKey persisted в строке — PATCH его НЕ пересчитывает, значит
 * идемпотентность создания не ломается (просто будущий create с новым scheduledAt
 * даст другой ключ — это ОК).
 *
 * @throws 404 если не найден, 409 not_editable, 400 валидация.
 */
export async function updatePostingJob(
  jobId: string,
  patch: UpdatePostingJobInput,
): Promise<PostingJob> {
  const current = await prisma.postingJob.findUnique({
    where: { id: jobId },
    select: { id: true, status: true },
  })
  if (!current) {
    throw createError({ statusCode: 404, message: `PostingJob ${jobId} не найден` })
  }

  if (!POSTING_JOB_EDITABLE_STATUSES.includes(current.status)) {
    throw createError({
      statusCode: 409,
      message: `Редактирование доступно только для scheduled/queued. Текущий статус: ${current.status}`,
      data: { jobId, status: current.status, code: "not_editable" },
    })
  }

  const data: Prisma.PostingJobUpdateInput = {}

  if (patch.maxAttempts !== undefined) {
    if (
      typeof patch.maxAttempts !== "number"
      || !Number.isInteger(patch.maxAttempts)
      || patch.maxAttempts < 1
      || patch.maxAttempts > 10
    ) {
      throw createError({
        statusCode: 400,
        message: "maxAttempts должен быть целым числом 1..10",
      })
    }
    data.maxAttempts = patch.maxAttempts
  }

  if (patch.scheduledAt !== undefined) {
    if (patch.scheduledAt === null) {
      data.scheduledAt = null
    } else {
      const d = new Date(patch.scheduledAt)
      if (Number.isNaN(d.getTime())) {
        throw createError({ statusCode: 400, message: "scheduledAt: невалидная дата (ожидается ISO)" })
      }
      data.scheduledAt = d
    }
  }

  if (Object.keys(data).length === 0) {
    throw createError({
      statusCode: 400,
      message: "Нечего обновлять (передайте scheduledAt и/или maxAttempts)",
    })
  }

  const updated = await prisma.postingJob.update({
    where: { id: jobId },
    data,
  })

  await appendJobLog(jobId, "info", "PostingJob отредактирован оператором", {
    scheduledAt: patch.scheduledAt,
    maxAttempts: patch.maxAttempts,
    updatedById: patch.updatedById ?? null,
  })

  return updated
}
