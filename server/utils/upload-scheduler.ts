/**
 * Тик планировщика официальных публикаций (Upload).
 *
 * За один заход делает три вещи:
 *   1. плановые (scheduled) — запускает, либо помечает blocked_by_env, если
 *      публикация выключена флагом;
 *   2. blocked_by_env — возвращает в очередь, когда флаг включили. Без этого
 *      обещание «загрузка будет выполнена после включения» было ложью: после
 *      включения такие записи не поднимал никто;
 *   3. failed — автоповтор с backoff, пока не исчерпаны попытки и пока ошибка
 *      не терминальная (см. upload-retry-policy).
 *
 * Гонки: записи берём ограниченной пачкой, каждый переход делаем updateMany с
 * проверкой прежнего статуса — два тика (или тик и оператор) не запустят один
 * и тот же Upload дважды. Статус uploading не трогаем вообще.
 */

import { MAX_UPLOAD_ATTEMPTS, planUploadRetry } from "./upload-retry-policy"

/** Сколько записей берём за один заход в каждой из трёх выборок. */
const BATCH_SIZE = 10

export interface UploadSchedulerTickResult {
  /** Запущено плановых загрузок. */
  started: number
  /** Помечено blocked_by_env (публикация выключена флагом). */
  blocked: number
  /** Возвращено в работу после включения флага. */
  resumed: number
  /** Отправлено на автоповтор после падения. */
  retried: number
  /** Возвращено в расписание (флаг включили, но время публикации ещё не настало). */
  rescheduled: number
  /** Упавшие загрузки, которые повторять не стали (терминальная ошибка / backoff / лимит). */
  skipped: number
}

/**
 * Атомарный захват: переводим в pending только из ожидаемого статуса.
 * count === 0 означает, что запись успел забрать кто-то другой — молча выходим.
 */
async function claimAndRun(id: number, fromStatus: string): Promise<boolean> {
  const claimed = await prisma.upload.updateMany({
    where: { id, status: fromStatus as never },
    data: {
      status: "pending" as never,
      blockedByEnv: false,
      errorMessage: null,
    },
  })
  if (claimed.count === 0) return false
  runUploadPipeline(id).catch(() => {})
  return true
}

export async function runUploadSchedulerTick(
  now: Date = new Date(),
): Promise<UploadSchedulerTickResult> {
  // Флаг читаем на каждом заходе: смысл всей задачи — подхватить загрузки
  // после его включения, а не после рестарта процесса.
  const socialPostingEnabled = process.env.ENABLE_SOCIAL_POSTING === "true"

  const result: UploadSchedulerTickResult = {
    started: 0,
    blocked: 0,
    resumed: 0,
    retried: 0,
    rescheduled: 0,
    skipped: 0,
  }

  // ── 1. Плановые загрузки ────────────────────────────────────────────────
  const scheduled = await prisma.upload.findMany({
    where: { status: "scheduled", scheduledAt: { lte: now } },
    select: { id: true },
    orderBy: { scheduledAt: "asc" },
    take: BATCH_SIZE,
  })

  for (const upload of scheduled) {
    if (!socialPostingEnabled) {
      const blocked = await prisma.upload.updateMany({
        where: { id: upload.id, status: "scheduled" },
        data: {
          status: "blocked_by_env" as never,
          blockedByEnv: true,
          errorMessage:
            "Публикация отключена (ENABLE_SOCIAL_POSTING=false). Загрузка вернётся в очередь автоматически, как только флаг включат.",
        },
      })
      result.blocked += blocked.count
      continue
    }
    if (await claimAndRun(upload.id, "scheduled")) result.started++
  }

  // Пока флаг выключен, разблокировать и повторять нечего.
  if (!socialPostingEnabled) return result

  // ── 2. Разблокировка после включения флага ──────────────────────────────
  const blockedUploads = await prisma.upload.findMany({
    where: { status: "blocked_by_env" },
    select: { id: true, scheduledAt: true },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  })

  for (const upload of blockedUploads) {
    // Отложенную публикацию нельзя стартовать раньше времени — возвращаем её
    // в расписание, а не в pending.
    if (upload.scheduledAt && upload.scheduledAt.getTime() > now.getTime()) {
      const back = await prisma.upload.updateMany({
        where: { id: upload.id, status: "blocked_by_env" },
        data: { status: "scheduled" as never, blockedByEnv: false, errorMessage: null },
      })
      result.rescheduled += back.count
      continue
    }
    if (await claimAndRun(upload.id, "blocked_by_env")) result.resumed++
  }

  // ── 3. Автоповтор упавших ───────────────────────────────────────────────
  const failedUploads = await prisma.upload.findMany({
    where: { status: "failed", attemptCount: { lt: MAX_UPLOAD_ATTEMPTS } },
    select: { id: true, attemptCount: true, lastAttemptAt: true, errorMessage: true },
    orderBy: { lastAttemptAt: "asc" },
    take: BATCH_SIZE,
  })

  for (const upload of failedUploads) {
    const decision = planUploadRetry(upload, now)
    if (!decision.retry) {
      result.skipped++
      continue
    }
    if (await claimAndRun(upload.id, "failed")) result.retried++
  }

  return result
}
