/**
 * Чистый policy-движок retry для phase-FSM (PR3).
 *
 * Воспроизводит ЧИСЛОМ-В-ЧИСЛО решения legacy worker.handleFailure, но источник
 * счётчиков/окон — stateData.classWindows (а не подсчёт маркеров в PostingJobLog),
 * а лимиты/backoff — декларативная CLASS_RETRY_POLICY (phase-policy.ts).
 *
 * Без side-effects (БД/Telegram/transition — в fsm-retry.ts). Полностью
 * unit-тестируемо: на вход err/stateData/attempts/now, на выход — decision.
 *
 * Парность с legacy (worker.ts):
 *   - базовая категория = categorizeError(err) (тот же классификатор) → routing
 *     не расходится с legacy;
 *   - dead-port: category=browser_connect_failed + DEAD_PORT_RE → indigo_unstable,
 *     max 7, окно 90 мин (deadline), backoff 5/10/10/15;
 *   - browser_lost: BROWSER_LOST_RE (не dead-port) → browser_lost, max 5, окно
 *     90 мин (rolling), backoff 5/7/7/10;
 *   - generic (network_error/upload_failed/platform_5xx/platform_rate_limit) →
 *     job.attemptCount<maxAttempts, backoff nextRetryAt;
 *   - остальное → terminal.
 *
 * PR3 НЕ меняет поведение, НЕ добавляет duplicate guard (duplicate_risk
 * трактуется как browser_lost — guard будет в PR4).
 *
 * @see docs/architecture/youtube-posting-fsm.md
 */

import type { PostingErrorCategory } from "../../../shared/types/posting-job"
import {
  YOUTUBE_POSTING_PROGRESS_ORDER,
  type ClassWindowState,
  type YouTubePostingProgress,
  type YouTubePostingStateData,
} from "../../../shared/types/youtube-posting-fsm"
import { PostingPhaseError } from "../../automation/posters/types"
import { categorizeError, DEVICE_COOLDOWN_RETRY_MS, isDeviceCooldownError } from "./error-classifier"
import { BROWSER_LOST_RE, DEAD_PORT_RE } from "./error-taxonomy"
import { backoffForRetry, getClassRetryPolicy } from "./phase-policy"
import { nextRetryAt } from "./state-machine"

/**
 * Класс с rolling/deadline-окном. PR4 добавил duplicate_risk (browser_lost ПОСЛЕ
 * attach) — те же window/backoff, что browser_lost (rolling 90м, max 5, 5/7/7/10),
 * но retry ведёт в resume_check на следующем заходе.
 */
export type WindowedClass = "indigo_unstable" | "browser_lost" | "duplicate_risk"

/** «Файл уже прикреплён» = прогресс ≥ file_attached_unconfirmed (PR4). */
function isAfterAttach(progress: YouTubePostingProgress | undefined): boolean {
  if (!progress) return false
  return (
    YOUTUBE_POSTING_PROGRESS_ORDER.indexOf(progress)
    >= YOUTUBE_POSTING_PROGRESS_ORDER.indexOf("file_attached_unconfirmed")
  )
}

export type FsmFailureDecision =
  | {
      kind: "indigo_unstable_retry"
      persistedCategory: PostingErrorCategory
      retryAt: Date
      backoffMs: number
      priorRetries: number
      maxRetries: number
      windowElapsedMs: number
      alertNow: boolean
      classWindows: Record<string, ClassWindowState>
    }
  | {
      kind: "indigo_unstable_final"
      persistedCategory: PostingErrorCategory
      priorRetries: number
      windowElapsedMs: number
      classWindows: Record<string, ClassWindowState>
      finalReason: "indigo_unstable"
    }
  | {
      kind: "browser_lost_retry"
      persistedCategory: PostingErrorCategory
      retryAt: Date
      backoffMs: number
      priorRetries: number
      maxRetries: number
      windowElapsedMs: number
      alertNow: boolean
      classWindows: Record<string, ClassWindowState>
    }
  | {
      kind: "browser_lost_final"
      persistedCategory: PostingErrorCategory
      priorRetries: number
      windowElapsedMs: number
      classWindows: Record<string, ClassWindowState>
      finalReason: "browser_lost"
    }
  | {
      kind: "duplicate_risk_retry"
      persistedCategory: PostingErrorCategory
      retryAt: Date
      backoffMs: number
      priorRetries: number
      maxRetries: number
      windowElapsedMs: number
      alertNow: boolean
      classWindows: Record<string, ClassWindowState>
    }
  | {
      kind: "duplicate_risk_final"
      persistedCategory: PostingErrorCategory
      priorRetries: number
      windowElapsedMs: number
      classWindows: Record<string, ClassWindowState>
      finalReason: "duplicate_risk"
    }
  | {
      kind: "generic_retry"
      category: PostingErrorCategory
      retryAt: Date
    }
  | {
      kind: "terminal"
      category: PostingErrorCategory
      /** PR4: семантическая причина (duplicate_risk/requires_human) поверх persisted enum. */
      finalReason?: string
    }

export interface ResolveFailureInput {
  err: unknown
  message: string
  phase: string | null
  stateData: YouTubePostingStateData
  attemptCount: number
  maxAttempts: number
  now?: Date
}

// --- spec-named pure helpers ---

/** Базовая категория + маршрут (parity с legacy worker.handleFailure; PR4: +duplicate_risk). */
export function classifyFailureForPolicy(
  err: unknown,
  message: string,
  progress?: YouTubePostingProgress,
): {
  category: PostingErrorCategory
  route: "indigo_unstable" | "browser_lost" | "duplicate_risk" | "generic" | "terminal"
} {
  // PR4: явный terminal-сигнал resume_check (duplicate_blocked / verify-fail) —
  // высший приоритет, минуя regex/categorize. НИКОГДА не retry, НИКОГДА не browser_lost.
  if (err instanceof PostingPhaseError && err.terminalReason) {
    const category: PostingErrorCategory =
      err.terminalReason === "requires_human" ? "account_locked" : "network_error"
    return { category, route: "terminal" }
  }
  const category = categorizeError(err)
  const isDeadPort = category === "browser_connect_failed" && DEAD_PORT_RE.test(message)
  if (isDeadPort) return { category, route: "indigo_unstable" }
  if (BROWSER_LOST_RE.test(message)) {
    // PR4: browser_lost ПОСЛЕ attach → duplicate_risk (тот же window/backoff, но
    // retry ведёт в resume_check, не в слепой file_upload). ДО attach — как раньше.
    if (isAfterAttach(progress)) return { category, route: "duplicate_risk" }
    return { category, route: "browser_lost" }
  }
  // generic — те же категории, что в legacy RETRYABLE (state-machine).
  if (
    category === "network_error" ||
    category === "platform_5xx" ||
    category === "platform_rate_limit" ||
    category === "upload_failed"
  ) {
    return { category, route: "generic" }
  }
  return { category, route: "terminal" }
}

export function getRetryPolicy(errorClass: WindowedClass) {
  return getClassRetryPolicy(errorClass)
}

/**
 * Прочитать окно класса с учётом режима (deadline/rolling). Возвращает priorRetries
 * (сколько retry уже было) + windowStartAt + elapsed. Для rolling: если окно истекло
 * — считается сброшенным (priorRetries=0, новое windowStartAt).
 */
export function applyRetryWindow(
  stateData: YouTubePostingStateData,
  errorClass: WindowedClass,
  now: Date,
): { priorRetries: number; windowStartAt: string; windowElapsedMs: number; prev: ClassWindowState | undefined } {
  const pol = getClassRetryPolicy(errorClass)
  const windowMs = pol.windowMs ?? 0
  const prev = stateData.classWindows?.[errorClass]
  if (!prev) {
    return { priorRetries: 0, windowStartAt: now.toISOString(), windowElapsedMs: 0, prev: undefined }
  }
  const elapsed = now.getTime() - new Date(prev.windowStartAt).getTime()
  if (pol.windowMode === "rolling" && elapsed >= windowMs) {
    // Окно истекло → rolling сброс (legacy: маркеры старше окна выпадают).
    return { priorRetries: 0, windowStartAt: now.toISOString(), windowElapsedMs: 0, prev: undefined }
  }
  return { priorRetries: prev.count, windowStartAt: prev.windowStartAt, windowElapsedMs: elapsed, prev }
}

export function computeNextRetryAt(errorClass: WindowedClass, priorRetries: number, now: Date): { retryAt: Date; backoffMs: number } {
  const backoffMs = backoffForRetry(errorClass, priorRetries)
  return { retryAt: new Date(now.getTime() + backoffMs), backoffMs }
}

/**
 * Можно ли retry для оконного класса.
 *   - deadline (indigo_unstable): priorRetries<max И elapsed<window (legacy: priorRetries<7 && windowRemaining>0).
 *   - rolling (browser_lost): priorRetries<max (окно уже сброшено в applyRetryWindow при истечении).
 */
export function shouldRetryWindowed(errorClass: WindowedClass, priorRetries: number, windowElapsedMs: number): boolean {
  const pol = getClassRetryPolicy(errorClass)
  const max = pol.maxAttempts ?? 0
  if (pol.windowMode === "deadline") {
    return priorRetries < max && windowElapsedMs < (pol.windowMs ?? 0)
  }
  return priorRetries < max
}

function bumpWindow(
  prev: ClassWindowState | undefined,
  windowStartAt: string,
  priorRetries: number,
  now: Date,
  phase: string | null,
  message: string,
): ClassWindowState {
  const alertNow = !prev || prev.alertedAt == null
  return {
    count: priorRetries + 1,
    windowStartAt,
    alertedAt: alertNow ? now.toISOString() : prev!.alertedAt,
    lastErrorAt: now.toISOString(),
    lastPhase: phase,
    lastMessage: message.slice(0, 300),
  }
}

/**
 * Главная функция: воспроизводит решение legacy handleFailure через policy +
 * classWindows. Pure — без БД/TG.
 */
export function resolveFsmFailure(input: ResolveFailureInput): FsmFailureDecision {
  const now = input.now ?? new Date()
  const { message, phase, stateData, attemptCount, maxAttempts } = input
  const { category, route } = classifyFailureForPolicy(input.err, message, stateData.progress)

  if (route === "indigo_unstable" || route === "browser_lost" || route === "duplicate_risk") {
    const errorClass: WindowedClass = route
    const pol = getClassRetryPolicy(errorClass)
    const { priorRetries, windowStartAt, windowElapsedMs, prev } = applyRetryWindow(stateData, errorClass, now)

    if (shouldRetryWindowed(errorClass, priorRetries, windowElapsedMs)) {
      const { retryAt, backoffMs } = computeNextRetryAt(errorClass, priorRetries, now)
      const win = bumpWindow(prev, windowStartAt, priorRetries, now, phase, message)
      const alertNow = !prev || prev.alertedAt == null
      const classWindows = { ...(stateData.classWindows ?? {}), [errorClass]: win }
      if (errorClass === "indigo_unstable") {
        return {
          kind: "indigo_unstable_retry",
          persistedCategory: pol.persistedCategory,
          retryAt,
          backoffMs,
          priorRetries,
          maxRetries: pol.maxAttempts ?? 0,
          windowElapsedMs,
          alertNow,
          classWindows,
        }
      }
      if (errorClass === "duplicate_risk") {
        return {
          kind: "duplicate_risk_retry",
          persistedCategory: pol.persistedCategory,
          retryAt,
          backoffMs,
          priorRetries,
          maxRetries: pol.maxAttempts ?? 0,
          windowElapsedMs,
          alertNow,
          classWindows,
        }
      }
      return {
        kind: "browser_lost_retry",
        persistedCategory: pol.persistedCategory,
        retryAt,
        backoffMs,
        priorRetries,
        maxRetries: pol.maxAttempts ?? 0,
        windowElapsedMs,
        alertNow,
        classWindows,
      }
    }

    // Окно/лимит исчерпаны → terminal (classWindows не инкрементим, как legacy).
    const classWindows = stateData.classWindows ?? {}
    if (errorClass === "indigo_unstable") {
      return {
        kind: "indigo_unstable_final",
        persistedCategory: pol.persistedCategory,
        priorRetries,
        windowElapsedMs,
        classWindows,
        finalReason: "indigo_unstable",
      }
    }
    if (errorClass === "duplicate_risk") {
      return {
        kind: "duplicate_risk_final",
        persistedCategory: pol.persistedCategory,
        priorRetries,
        windowElapsedMs,
        classWindows,
        finalReason: "duplicate_risk",
      }
    }
    return {
      kind: "browser_lost_final",
      persistedCategory: pol.persistedCategory,
      priorRetries,
      windowElapsedMs,
      classWindows,
      finalReason: "browser_lost",
    }
  }

  if (route === "generic") {
    // Legacy generic: shouldRetry(category, attemptCount, maxAttempts) + nextRetryAt.
    if (attemptCount < maxAttempts) {
      // Этап 3 (per-device кулдаун): device_busy/device_cooldown — устройство ещё
      // занято/configuring (~180с). Generic-backoff (1 мин) повторил бы слишком
      // рано → берём max(generic, DEVICE_COOLDOWN_RETRY_MS), чтобы дождаться окна.
      // Якорь — Date.now() (как nextRetryAt), а не инжектированный now, чтобы оба
      // слагаемых считались от одних часов.
      const generic = nextRetryAt(attemptCount)
      const retryAt = isDeviceCooldownError(input.err)
        ? new Date(Math.max(generic.getTime(), Date.now() + DEVICE_COOLDOWN_RETRY_MS))
        : generic
      return { kind: "generic_retry", category, retryAt }
    }
    return { kind: "terminal", category }
  }

  // PR4: terminal resume-сигнал несёт семантический finalReason (поверх persisted enum).
  const finalReason =
    input.err instanceof PostingPhaseError ? input.err.terminalReason : undefined
  return { kind: "terminal", category, finalReason }
}
