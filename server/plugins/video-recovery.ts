/**
 * Nitro-плагин: подхват видео-прогонов, прерванных рестартом процесса.
 *
 * Деплой или падение воркера убивает runVideoPipeline на середине, и ролик
 * остаётся в промежуточном статусе навсегда: очередь такие записи не смотрит, а
 * блокировка снимается только в finally мёртвого процесса. Оператору приходилось
 * ходить по списку и жать «возобновить» руками — при том что механизм
 * возобновления давно есть и шаги умеют переподключаться к незавершённым внешним
 * задачам (reattach), то есть повторно за них не платят.
 *
 * Правило отбора кандидатов — чистая функция planStalledVideoRecovery
 * (video-pipeline-run-policy.ts): что берём, что пропускаем и что хороним, решает
 * она, а плагин только ходит в БД и исполняет решения.
 */

import { resumeVideoPipeline } from "../utils/video-pipeline"
import { forceReleaseLock } from "../utils/video-pipeline-db"
import {
  planStalledVideoRecovery,
  RESUMABLE_VIDEO_STATUSES,
  STALLED_VIDEO_BATCH_LIMIT,
  type StalledVideoCandidate,
  type StalledVideoDecision,
} from "../utils/video-pipeline-run-policy"

/**
 * Раз в 5 минут: восстановление не срочное (ролик уже стоит), а каждый проход —
 * это сканирование таблицы и потенциальный залп в платных провайдеров.
 */
const RECOVERY_INTERVAL_MS = 5 * 60_000

/** Сколько записей вообще смотрим за проход — решение по ним всё равно фильтрует политика. */
const SCAN_LIMIT = 50

/**
 * Сколько ждать, прежде чем считать «поднятый нами» ролик снова кандидатом.
 *
 * Возобновление асинхронное: resumeVideoPipeline возвращается сразу, а пайплайн
 * ещё только разгоняется. Без этого окна следующий проход увидел бы тот же ролик
 * (updatedAt мог не сдвинуться дальше порога простоя) и запустил его вторично.
 */
const REDISPATCH_COOLDOWN_MS = 30 * 60_000

/**
 * Сколько раз ЭТОТ процесс готов поднимать один и тот же ролик.
 *
 * Ролик, который стабильно умирает после каждого возобновления, — фантом:
 * дальше его добьёт правило возраста из политики, а до тех пор молотить по нему
 * бессмысленно.
 */
const MAX_DISPATCHES_PER_VIDEO = 3

interface DispatchState {
  lastAtMs: number
  count: number
}

export default defineNitroPlugin((nitro) => {
  // Гейт scheduler'ов (тестовая инфраструктура). См. .env.test.
  // Семантика «выключено только при явном false»: в проде переменную никто не
  // выставляет, и проверка на "true" молча похоронила бы всё восстановление.
  if (process.env.SCHEDULERS_ENABLED === "false") return

  // Собственный рубильник: возобновление тратит деньги, у оператора должен быть
  // способ выключить его, не гася заодно все планировщики процесса.
  if (process.env.VIDEO_RECOVERY_ENABLED === "false") return

  // Кого этот процесс уже поднимал. В памяти, потому что колонки под счётчик
  // восстановлений в схеме нет, а переживать рестарт этому состоянию и не нужно:
  // новый процесс — новые попытки, ограниченные правилом возраста.
  const dispatched = new Map<number, DispatchState>()

  /** Ролик, которого этот процесс уже поднимал слишком недавно или слишком часто. */
  const suppressedByDispatchGuard = (videoId: number, now: number): boolean => {
    const state = dispatched.get(videoId)
    if (!state) return false
    if (state.count >= MAX_DISPATCHES_PER_VIDEO) return true
    return now - state.lastAtMs < REDISPATCH_COOLDOWN_MS
  }

  const loadCandidates = async (now: number): Promise<StalledVideoCandidate[]> => {
    const rows = await prisma.video.findMany({
      where: { status: { in: RESUMABLE_VIDEO_STATUSES as never } },
      select: {
        id: true,
        status: true,
        isLocked: true,
        lockedAt: true,
        startedAt: true,
        createdAt: true,
        updatedAt: true,
        run: { select: { status: true } },
        steps: { select: { attemptCount: true, maxAttempts: true } },
      },
      // Самые залежавшиеся вперёд: лимит партии должен доставаться им, а не
      // ролику, который встал минуту назад.
      orderBy: { updatedAt: "asc" },
      take: SCAN_LIMIT,
    })

    return rows.map(row => ({
      id: row.id,
      status: String(row.status),
      isLocked: row.isLocked,
      lockedAt: row.lockedAt,
      startedAt: row.startedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      workflowRunStatus: row.run ? String(row.run.status) : null,
      // maxAttempts у шага никто не проверяет по ходу прогона, так что это
      // единственное место, где счётчик попыток вообще что-то значит.
      hasExhaustedStep: row.steps.some(step => step.attemptCount >= step.maxAttempts),
      recentlyDispatched: suppressedByDispatchGuard(row.id, now),
    }))
  }

  const abandon = async (decision: StalledVideoDecision): Promise<void> => {
    if (decision.releaseStaleLock) await forceReleaseLock(decision.videoId)

    const message = decision.reason === "attempts_exhausted"
      ? "Прогон прерван и не возобновлён: у шага исчерпаны попытки. Возобновление — вручную."
      : "Прогон прерван и висел слишком долго, автоматическое возобновление прекращено."

    // failed, а не timeout: ручная кнопка «возобновить» принимает только
    // failed/canceled, и статус timeout запер бы ролик наглухо.
    // updateMany с фильтром по статусу — чтобы не затереть ролик, который
    // как раз в этот момент ожил.
    await prisma.video.updateMany({
      where: { id: decision.videoId, status: { in: RESUMABLE_VIDEO_STATUSES as never } },
      data: { status: "failed" as never, errorMessage: message, finishedAt: new Date() },
    })
  }

  const recover = async (): Promise<void> => {
    const now = Date.now()
    const candidates = await loadCandidates(now)
    if (candidates.length === 0) return

    const decisions = planStalledVideoRecovery(candidates, { now, limit: STALLED_VIDEO_BATCH_LIMIT })

    let resumedCount = 0
    let abandonedCount = 0

    for (const decision of decisions) {
      if (decision.action === "skip") continue

      if (decision.action === "abandon") {
        await abandon(decision).catch(() => {})
        abandonedCount += 1
        await logAgent('video-recovery', 'warn',
          `Видео ${decision.videoId} помечено ошибкой при восстановлении (${decision.reason})`,
          { videoId: decision.videoId },
        ).catch(() => {})
        continue
      }

      const state = dispatched.get(decision.videoId)
      dispatched.set(decision.videoId, { lastAtMs: now, count: (state?.count ?? 0) + 1 })

      // Блокировка мёртвого прогона: без её срыва runVideoPipeline внутри
      // возобновления просто бросит «уже запущен».
      if (decision.releaseStaleLock) await forceReleaseLock(decision.videoId).catch(() => {})

      try {
        await resumeVideoPipeline(decision.videoId)
        resumedCount += 1
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await logAgent('video-recovery', 'error',
          `Не удалось возобновить видео ${decision.videoId}: ${message}`,
          { videoId: decision.videoId },
        ).catch(() => {})
      }
    }

    if (resumedCount > 0 || abandonedCount > 0) {
      await logAgent('video-recovery', 'info',
        `Восстановление видео: просмотрено ${candidates.length}, возобновлено ${resumedCount}, помечено ${abandonedCount}`,
      ).catch(() => {})
    }
  }

  const tick = async (): Promise<void> => {
    try {
      await recover()
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await logAgent('video-recovery', 'error', `Восстановление видео: ${message}`).catch(() => {})
    }
  }

  // Первый проход сразу после старта — рестарт и есть основной повод для этой задачи.
  void tick()

  const timer = trackedInterval(
    'video-recovery',
    'Возобновление прерванных видео-прогонов',
    RECOVERY_INTERVAL_MS,
    tick,
  )
  timer.unref?.()

  nitro.hooks.hook("close", () => {
    clearInterval(timer)
  })
})
