/**
 * Policy-driven обработка провала posting-job (PR3, impure-слой).
 *
 * Вызывается из worker.handleFailure ТОЛЬКО когда YOUTUBE_POSTING_FSM_ENABLED=true
 * И у job есть stateData.fsmVersion. Иначе — legacy handleFailure без изменений.
 *
 * Воспроизводит ЧИСЛОМ-В-ЧИСЛО side-effects legacy (transitionJob/appendJobLog/
 * sendTelegramAlert), но:
 *   - счётчики/окна берёт из stateData.classWindows (решение — resolveFsmFailure),
 *     а не подсчётом маркеров в PostingJobLog;
 *   - Telegram-троттлинг — по classWindows[class].alertedAt (та же семантика:
 *     custom один раз на класс/окно; critical на финальный провал).
 *
 * НЕ меняет retry/backoff числа, НЕ добавляет duplicate guard (PR4), НЕ трогает
 * worker.handleFailure legacy-ветку.
 *
 * @see retry-policy.ts (pure decision), worker.ts (branch)
 */

import type { Prisma } from "../../../app/generated/prisma/client"
import type { YouTubePostingStateData } from "../../../shared/types/youtube-posting-fsm"
import { formatPostingFailureForOperator } from "../../../shared/utils/posting-operator-format"
import { PostingPhaseError } from "../../automation/posters/types"
import { prisma } from "../prisma"
import { sendTelegramAlert } from "../telegram/alerts"
import { appendJobLog, transitionJob } from "./job-service"
import { buildFsmLogData, decisionToOperatorClass } from "./operator-diagnostics"
import { resolveFsmFailure } from "./retry-policy"

export interface FsmFailureJob {
  id: string
  attemptCount: number
  maxAttempts: number
  platform: string
  socialAccount: { id: number; displayName: string }
}

/**
 * @returns true если провал обработан policy-путём (caller НЕ должен делать legacy).
 *          false — не наш случай, пусть legacy handleFailure отработает.
 */
export async function fsmHandleFailure(job: FsmFailureJob, err: unknown): Promise<boolean> {
  const message = err instanceof Error ? err.message : String(err)
  let phase: string | null = null
  let screenshotKey: string | null = null
  if (err instanceof PostingPhaseError) {
    phase = err.phase
    screenshotKey = err.screenshotKey ?? null
  }

  // Свежие статус + stateData (observer.failPhase мог обновить stateData во время run).
  const fresh = await prisma.postingJob.findUnique({
    where: { id: job.id },
    select: { status: true, stateData: true },
  })
  if (!fresh || fresh.status === "cancelled") return true
  const stateData = (fresh.stateData as YouTubePostingStateData | null) ?? null
  if (!stateData || typeof stateData.fsmVersion !== "number") return false // не FSM-job → legacy

  const decision = resolveFsmFailure({
    err,
    message,
    phase,
    stateData,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    now: new Date(),
  })

  const mergeState = (patch: Partial<YouTubePostingStateData>): Prisma.InputJsonValue =>
    ({ ...stateData, ...patch }) as unknown as Prisma.InputJsonValue

  // PR5A diagnostics polish: человекочитаемый view + канонический structured-лог.
  // НЕ влияет на runtime-решение (decision уже принят resolveFsmFailure) — только
  // наблюдаемость (FSM_POLICY_DECISION/FSM_NOTIFICATION_THROTTLED/FSM_FINAL_REASON/
  // FSM_OPERATOR_ACTION) + обогащение текста Telegram-критикала операторским действием.
  const operatorClass = decisionToOperatorClass(decision)
  const decisionFinalReason = "finalReason" in decision ? decision.finalReason : (stateData.finalReason ?? null)
  const operatorView = formatPostingFailureForOperator(
    operatorClass,
    phase,
    stateData.progress,
    decisionFinalReason,
    stateData,
  )
  const policyLogData = (extra?: Record<string, unknown>): Prisma.InputJsonValue =>
    ({
      ...buildFsmLogData({
        jobId: job.id,
        phase,
        errorClass: operatorClass,
        stateData,
        retryCount: "priorRetries" in decision ? decision.priorRetries + 1 : null,
        retryAt: "retryAt" in decision ? decision.retryAt : null,
        finalReason: decisionFinalReason,
      }),
      ...extra,
    }) as unknown as Prisma.InputJsonValue
  /** FSM_FINAL_REASON + FSM_OPERATOR_ACTION на терминальном/исчерпанном провале (best-effort). */
  const emitFinalDiagnostics = async (): Promise<void> => {
    await appendJobLog(job.id, "error", `FSM_FINAL_REASON ${operatorView.title}`, policyLogData({ event: "FSM_FINAL_REASON" }))
    await appendJobLog(job.id, "warn", `FSM_OPERATOR_ACTION ${operatorClass}`, policyLogData({
      event: "FSM_OPERATOR_ACTION",
      operatorTitle: operatorView.title,
      shortMessage: operatorView.shortMessage,
    }))
  }
  /** custom-троттлинг: лог факта подавления повторного уведомления в окне класса. */
  const emitThrottledNotice = async (): Promise<void> => {
    await appendJobLog(job.id, "info", `FSM_NOTIFICATION_THROTTLED ${operatorClass}`, policyLogData({
      event: "FSM_NOTIFICATION_THROTTLED",
      reason: "alertedAt уже выставлен в окне класса — custom не дублируется",
    }))
  }
  await appendJobLog(job.id, "info", `FSM_POLICY_DECISION ${decision.kind}`, policyLogData({
    event: "FSM_POLICY_DECISION",
    decisionKind: decision.kind,
  }))

  switch (decision.kind) {
    case "indigo_unstable_retry": {
      try {
        await transitionJob(job.id, "retry_queued", {
          lastError: message,
          errorCategory: decision.persistedCategory,
          retryAt: decision.retryAt,
          lastErrorPhase: phase,
          lastErrorScreenshotKey: screenshotKey,
          stateData: mergeState({ classWindows: decision.classWindows }),
        })
      } catch (transErr) {
        await appendJobLog(job.id, "error", "policy_retry indigo_unstable: переход в retry_queued не удался", {
          transitionError: transErr instanceof Error ? transErr.message : String(transErr),
        })
        return true
      }
      await appendJobLog(
        job.id,
        "warn",
        `STATE_RECOVER indigo_unstable (retry ${decision.priorRetries + 1}/${decision.maxRetries})`,
        {
          fsm: true,
          event: "STATE_RECOVER",
          errorClass: "indigo_unstable",
          priorRetries: decision.priorRetries,
          maxRetries: decision.maxRetries,
          backoffMs: decision.backoffMs,
          nextRetryAt: decision.retryAt.toISOString(),
          windowElapsedMs: decision.windowElapsedMs,
        },
      )
      if (decision.alertNow) {
        await sendTelegramAlert(
          "custom",
          `PostingJob #${job.id}: ожидание стабильного окна Indigo`,
          `Indigo agent нестабилен (browser_connect_failed). Job авто-retry с backoff (до ${decision.maxRetries}× за 90 мин). Аккаунт: ${job.socialAccount.displayName} (#${job.socialAccount.id}).`,
        ).catch(() => {})
      } else {
        await emitThrottledNotice()
      }
      return true
    }

    case "indigo_unstable_final": {
      try {
        await transitionJob(job.id, "failed", {
          lastError: `indigo_unstable (retry window exhausted, ${decision.priorRetries} retries / ${Math.round(decision.windowElapsedMs / 60_000)} мин): ${message}`,
          errorCategory: decision.persistedCategory,
          lastErrorPhase: phase,
          lastErrorScreenshotKey: screenshotKey,
          stateData: mergeState({ finalReason: "indigo_unstable" }),
        })
      } catch (transErr) {
        await appendJobLog(job.id, "error", "Не удалось перейти в failed (indigo_unstable)", {
          transitionError: transErr instanceof Error ? transErr.message : String(transErr),
        })
        return true
      }
      await appendJobLog(job.id, "error", "policy_final_fail indigo_unstable: окно good-window Indigo исчерпано", {
        fsm: true,
        event: "policy_final_fail",
        finalReason: "indigo_unstable",
        priorRetries: decision.priorRetries,
        windowElapsedMs: decision.windowElapsedMs,
      })
      await emitFinalDiagnostics()
      await sendTelegramAlert(
        "critical_error",
        `PostingJob #${job.id} провален: indigo_unstable`,
        `Indigo agent не стабилизировался за ${decision.priorRetries} retries / ${Math.round(decision.windowElapsedMs / 60_000)} мин. Аккаунт: ${job.socialAccount.displayName} (#${job.socialAccount.id})\nОшибка: ${message}\n\nДействие: ${operatorView.operatorAction}`,
      ).catch(() => {})
      return true
    }

    case "browser_lost_retry": {
      try {
        await transitionJob(job.id, "retry_queued", {
          lastError: `browser_lost (${phase ?? "?"}): ${message}`,
          errorCategory: decision.persistedCategory,
          retryAt: decision.retryAt,
          lastErrorPhase: phase,
          lastErrorScreenshotKey: screenshotKey,
          stateData: mergeState({ classWindows: decision.classWindows }),
        })
      } catch (transErr) {
        await appendJobLog(job.id, "error", "policy_retry browser_lost: переход в retry_queued не удался", {
          transitionError: transErr instanceof Error ? transErr.message : String(transErr),
        })
        return true
      }
      await appendJobLog(
        job.id,
        "warn",
        `STATE_RECOVER browser_lost (retry ${decision.priorRetries + 1}/${decision.maxRetries})`,
        {
          fsm: true,
          event: "STATE_RECOVER",
          errorClass: "browser_lost",
          phase: phase ?? null,
          priorRetries: decision.priorRetries,
          maxRetries: decision.maxRetries,
          backoffMs: decision.backoffMs,
          nextRetryAt: decision.retryAt.toISOString(),
          windowElapsedMs: decision.windowElapsedMs,
        },
      )
      if (decision.alertNow) {
        await sendTelegramAlert(
          "custom",
          `PostingJob #${job.id}: browser_lost, ожидание стабильного окна Indigo`,
          `Indigo потерял browser/page внутри pipeline (фаза: ${phase ?? "?"}). Job авто-retry с cooldown (до ${decision.maxRetries}× за 90 мин). Аккаунт: ${job.socialAccount.displayName} (#${job.socialAccount.id}).`,
        ).catch(() => {})
      } else {
        await emitThrottledNotice()
      }
      return true
    }

    case "browser_lost_final": {
      try {
        await transitionJob(job.id, "failed", {
          lastError: `browser_lost_final (${decision.priorRetries} retries / ${Math.round(decision.windowElapsedMs / 60_000)} мин в окне): ${message}`,
          errorCategory: decision.persistedCategory,
          lastErrorPhase: phase,
          lastErrorScreenshotKey: screenshotKey,
          stateData: mergeState({ finalReason: "browser_lost" }),
        })
      } catch (transErr) {
        await appendJobLog(job.id, "error", "Не удалось перейти в failed (browser_lost_final)", {
          transitionError: transErr instanceof Error ? transErr.message : String(transErr),
        })
        return true
      }
      await appendJobLog(job.id, "error", "policy_final_fail browser_lost: окно good-window Indigo исчерпано", {
        fsm: true,
        event: "policy_final_fail",
        finalReason: "browser_lost",
        priorRetries: decision.priorRetries,
        windowElapsedMs: decision.windowElapsedMs,
        phase: phase ?? null,
      })
      await emitFinalDiagnostics()
      await sendTelegramAlert(
        "critical_error",
        `PostingJob #${job.id} провален: browser_lost`,
        `Indigo терял browser/page ${decision.priorRetries}× за ${Math.round(decision.windowElapsedMs / 60_000)} мин (последняя фаза: ${phase ?? "?"}). Аккаунт: ${job.socialAccount.displayName} (#${job.socialAccount.id})\nОшибка: ${message}\n\nДействие: ${operatorView.operatorAction}`,
      ).catch(() => {})
      return true
    }

    case "duplicate_risk_retry": {
      try {
        await transitionJob(job.id, "retry_queued", {
          lastError: `duplicate_risk (${phase ?? "?"}): browser_lost после attach — retry через resume_check: ${message}`,
          errorCategory: decision.persistedCategory,
          retryAt: decision.retryAt,
          lastErrorPhase: phase,
          lastErrorScreenshotKey: screenshotKey,
          stateData: mergeState({ classWindows: decision.classWindows }),
        })
      } catch (transErr) {
        await appendJobLog(job.id, "error", "policy_retry duplicate_risk: переход в retry_queued не удался", {
          transitionError: transErr instanceof Error ? transErr.message : String(transErr),
        })
        return true
      }
      await appendJobLog(
        job.id,
        "warn",
        `STATE_RECOVER duplicate_risk (retry ${decision.priorRetries + 1}/${decision.maxRetries}) → resume_check`,
        {
          fsm: true,
          event: "STATE_RECOVER",
          errorClass: "duplicate_risk",
          phase: phase ?? null,
          priorRetries: decision.priorRetries,
          maxRetries: decision.maxRetries,
          backoffMs: decision.backoffMs,
          nextRetryAt: decision.retryAt.toISOString(),
          windowElapsedMs: decision.windowElapsedMs,
        },
      )
      if (decision.alertNow) {
        await sendTelegramAlert(
          "custom",
          `PostingJob #${job.id}: browser_lost после attach (duplicate-risk guard)`,
          `Браузер умер после attach (фаза: ${phase ?? "?"}). Job авто-retry с resume_check (БЕЗ слепого re-upload, до ${decision.maxRetries}× за 90 мин). Аккаунт: ${job.socialAccount.displayName} (#${job.socialAccount.id}).`,
        ).catch(() => {})
      } else {
        await emitThrottledNotice()
      }
      return true
    }

    case "duplicate_risk_final": {
      try {
        await transitionJob(job.id, "failed", {
          lastError: `duplicate_risk_final (${decision.priorRetries} retries / ${Math.round(decision.windowElapsedMs / 60_000)} мин в окне): ${message}`,
          errorCategory: decision.persistedCategory,
          lastErrorPhase: phase,
          lastErrorScreenshotKey: screenshotKey,
          stateData: mergeState({ finalReason: "duplicate_risk" }),
        })
      } catch (transErr) {
        await appendJobLog(job.id, "error", "Не удалось перейти в failed (duplicate_risk_final)", {
          transitionError: transErr instanceof Error ? transErr.message : String(transErr),
        })
        return true
      }
      await appendJobLog(job.id, "error", "policy_final_fail duplicate_risk: окно good-window исчерпано", {
        fsm: true,
        event: "policy_final_fail",
        finalReason: "duplicate_risk",
        priorRetries: decision.priorRetries,
        windowElapsedMs: decision.windowElapsedMs,
        phase: phase ?? null,
      })
      await emitFinalDiagnostics()
      await sendTelegramAlert(
        "critical_error",
        `PostingJob #${job.id} провален: duplicate_risk`,
        `Браузер терял page после attach ${decision.priorRetries}× за ${Math.round(decision.windowElapsedMs / 60_000)} мин (фаза: ${phase ?? "?"}). Возможен orphaned draft на канале — проверьте вручную. Аккаунт: ${job.socialAccount.displayName} (#${job.socialAccount.id})\nОшибка: ${message}\n\nДействие: ${operatorView.operatorAction}`,
      ).catch(() => {})
      return true
    }

    case "generic_retry": {
      try {
        await transitionJob(job.id, "retry_queued", {
          lastError: message,
          errorCategory: decision.category,
          retryAt: decision.retryAt,
          lastErrorPhase: phase,
          lastErrorScreenshotKey: screenshotKey,
        })
        await appendJobLog(
          job.id,
          "warn",
          `STATE_RECOVER ${decision.category}: попытка ${job.attemptCount}/${job.maxAttempts}, retryAt=${decision.retryAt.toISOString()}`,
          { fsm: true, event: "STATE_RECOVER", errorClass: decision.category, error: message },
        )
      } catch (transErr) {
        await appendJobLog(job.id, "error", "policy_retry generic: переход в retry_queued не удался", {
          error: message,
          transitionError: transErr instanceof Error ? transErr.message : String(transErr),
        })
      }
      return true
    }

    case "terminal": {
      // PR4: семантический finalReason (duplicate_risk/requires_human от resume_check)
      // поверх persisted enum-категории. Для обычных terminal — = decision.category.
      const finalReason = decision.finalReason ?? decision.category
      try {
        await transitionJob(job.id, "failed", {
          lastError: message,
          errorCategory: decision.category,
          lastErrorPhase: phase,
          lastErrorScreenshotKey: screenshotKey,
          stateData: mergeState({ finalReason }),
        })
      } catch (transErr) {
        await appendJobLog(job.id, "error", "Не удалось перейти в failed (policy terminal)", {
          error: message,
          transitionError: transErr instanceof Error ? transErr.message : String(transErr),
        })
        return true
      }
      await appendJobLog(job.id, "error", `policy_final_fail ${finalReason}`, {
        fsm: true,
        event: "policy_final_fail",
        finalReason,
        category: decision.category,
        attemptCount: job.attemptCount,
        maxAttempts: job.maxAttempts,
      })
      await emitFinalDiagnostics()
      await sendTelegramAlert(
        "critical_error",
        `PostingJob #${job.id} провален: ${finalReason}`,
        `Аккаунт: ${job.socialAccount.displayName} (#${job.socialAccount.id})\nПлатформа: ${job.platform}\nОшибка: ${message}\nПопытки: ${job.attemptCount}/${job.maxAttempts}\n\nДействие: ${operatorView.operatorAction}`,
      ).catch(() => {})
      return true
    }
  }
}
