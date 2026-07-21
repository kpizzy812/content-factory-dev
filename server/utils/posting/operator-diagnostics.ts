/**
 * Operator-диагностика YouTube posting FSM (PR5A, impure-сборка).
 *
 * Собирает БЕЗОПАСНЫЕ для отдачи в API/логи структуры из stateData + policy:
 *   - buildFsmDiagnostics(job)  → FsmDiagnosticsSummary для /api/posting-jobs/[id]
 *                                 (НЕТ cookies/proxy-secrets/tokens — только FSM-состояние);
 *   - buildFsmLogData(input)    → канонический structured `data` для FSM-логов
 *                                 (FSM_POLICY_DECISION/FSM_OPERATOR_ACTION/…);
 *   - decisionToOperatorClass() → FsmFailureDecision → OperatorErrorClass (для логов/TG).
 *
 * Чистая сборка поверх stateData — НЕ принимает runtime-решений и НЕ мутирует
 * состояние (это retry-policy/fsm-retry/observer). Используется только для
 * наблюдаемости (PR5A diagnostics polish).
 *
 * @see shared/utils/posting-operator-format.ts (formatPostingFailureForOperator)
 * @see docs/architecture/youtube-posting-fsm.md
 */

import type { PostingErrorCategory } from "../../../shared/types/posting-job"
import type { FsmDiagnosticsClassWindow, FsmDiagnosticsSummary } from "../../../shared/types/posting-job"
import {
  type OperatorErrorClass,
  formatPostingFailureForOperator,
  toOperatorErrorClass,
} from "../../../shared/utils/posting-operator-format"
import type { YouTubePostingStateData } from "../../../shared/types/youtube-posting-fsm"
import { CLASS_RETRY_POLICY } from "./phase-policy"
import type { FsmFailureDecision } from "./retry-policy"

/** windowMs класса (если оконный) — для расчёта windowExpiresAt. null для не-оконных. */
function windowMsForClass(cls: OperatorErrorClass): number | null {
  if (cls in CLASS_RETRY_POLICY) {
    return CLASS_RETRY_POLICY[cls as keyof typeof CLASS_RETRY_POLICY].windowMs ?? null
  }
  return null
}

function windowExpiresAt(cls: OperatorErrorClass, windowStartAt: string | null | undefined): string | null {
  if (!windowStartAt) return null
  const ms = windowMsForClass(cls)
  if (ms == null) return null
  const start = new Date(windowStartAt).getTime()
  if (Number.isNaN(start)) return null
  return new Date(start + ms).toISOString()
}

/** Безопасное чтение windowStartAt класса из classWindows (ключи — подмножество operator-классов). */
function readWindowStart(sd: YouTubePostingStateData | null, cls: OperatorErrorClass): string | null {
  const cw = sd?.classWindows as Record<string, { windowStartAt?: string }> | undefined
  return cw?.[cls]?.windowStartAt ?? null
}

/** Legacy PostingErrorCategory → operator-класс (для generic_retry/terminal). */
export function mapPersistedCategoryToOperatorClass(category: PostingErrorCategory): OperatorErrorClass {
  switch (category) {
    case "proxy_dead":
      return "proxy_dead"
    case "network_error":
    case "platform_5xx":
    case "platform_rate_limit":
      return "network_error"
    case "login_required":
      return "login_required"
    case "auth_failed":
      return "auth_required"
    case "browser_connect_failed":
      return "browser_connect_failed"
    case "selector_not_found":
      return "selector_not_found"
    case "upload_failed":
      return "upload_failed"
    case "account_locked":
      return "requires_human"
    case "content_rejected":
    case "platform_validation":
    case "internal_error":
    case "unknown":
      return "unknown"
    default: {
      const _exhaustive: never = category
      void _exhaustive
      return "unknown"
    }
  }
}

/**
 * FsmFailureDecision (retry-policy) → семантический operator-класс. Для windowed —
 * имя класса напрямую; для generic/terminal — finalReason (если это operator-класс)
 * либо маппинг persisted-категории.
 */
export function decisionToOperatorClass(decision: FsmFailureDecision): OperatorErrorClass {
  switch (decision.kind) {
    case "indigo_unstable_retry":
    case "indigo_unstable_final":
      return "indigo_unstable"
    case "browser_lost_retry":
    case "browser_lost_final":
      return "browser_lost"
    case "duplicate_risk_retry":
    case "duplicate_risk_final":
      return "duplicate_risk"
    case "generic_retry":
      return mapPersistedCategoryToOperatorClass(decision.category)
    case "terminal": {
      if (decision.finalReason) {
        const fromReason = toOperatorErrorClass(decision.finalReason)
        if (fromReason !== "unknown") return fromReason
      }
      return mapPersistedCategoryToOperatorClass(decision.category)
    }
  }
}

export interface FsmLogDataInput {
  jobId: string
  /** Фаза провала (PostingPhaseError.phase) или null. */
  phase?: string | null
  errorClass: OperatorErrorClass
  stateData: YouTubePostingStateData | null
  /** Сколько retry этого класса уже сделано (priorRetries+1) — для retry-веток. */
  retryCount?: number | null
  retryAt?: Date | string | null
  windowStartAt?: string | null
  finalReason?: string | null
}

/**
 * Канонический structured `data` для FSM-логов (единая форма во всех событиях).
 * Поля берутся из stateData + переданного контекста решения. operatorAction —
 * из общего форматтера, чтобы лог/Telegram/UI совпадали.
 */
export function buildFsmLogData(input: FsmLogDataInput): Record<string, unknown> {
  const sd = input.stateData
  const finalReason = input.finalReason ?? sd?.finalReason ?? null
  const view = formatPostingFailureForOperator(
    input.errorClass,
    input.phase ?? sd?.lastErrorPhase ?? null,
    sd?.progress ?? null,
    finalReason,
    sd,
  )
  const windowStartAt = input.windowStartAt ?? readWindowStart(sd, input.errorClass)
  const retryAtIso =
    input.retryAt instanceof Date ? input.retryAt.toISOString() : (input.retryAt ?? null)
  return {
    fsm: true,
    jobId: input.jobId,
    phase: input.phase ?? null,
    currentPhase: sd?.currentPhase ?? null,
    progress: sd?.progress ?? null,
    lastCompletedPhase: sd?.lastCompletedPhase ?? null,
    errorClass: input.errorClass,
    retryCount: input.retryCount ?? null,
    retryAt: retryAtIso,
    windowStartAt,
    windowExpiresAt: windowExpiresAt(input.errorClass, windowStartAt),
    finalReason,
    operatorAction: view.operatorAction,
    severity: view.severity,
    retryable: view.retryable,
    requiresHuman: view.requiresHuman,
    draftVideoId: sd?.draftVideoId ?? null,
    draftUrl: sd?.draftUrl ?? null,
    duplicateRiskAcknowledged: sd?.duplicateRiskAcknowledged ?? false,
  }
}

/** Минимальная форма job для диагностики (то, что отдаёт endpoint). */
export interface FsmDiagnosticsJobInput {
  stateData: unknown
  retryAt: Date | string | null
  status: string
  errorCategory: PostingErrorCategory | string | null
  lastErrorPhase: string | null
}

/**
 * Безопасный FSM-summary для API. Возвращает null если job НЕ под FSM
 * (stateData без fsmVersion) — endpoint просто не добавит блок. НИ ОДНОГО
 * секрета: stateData содержит только FSM-состояние (фазы/progress/draftVideoId/
 * classWindows), без cookies/proxy/tokens.
 */
export function buildFsmDiagnostics(job: FsmDiagnosticsJobInput): FsmDiagnosticsSummary | null {
  const sd = (job.stateData as YouTubePostingStateData | null) ?? null
  if (!sd || typeof sd.fsmVersion !== "number") return null

  // Операторский класс: приоритет — классифицированный FSM-класс (observer.failPhase),
  // иначе persisted errorCategory, иначе unknown.
  const operatorClass: OperatorErrorClass = sd.lastErrorClass
    ? toOperatorErrorClass(sd.lastErrorClass)
    : job.errorCategory
      ? mapPersistedCategoryToOperatorClass(job.errorCategory as PostingErrorCategory)
      : "unknown"

  const operator = sd.lastErrorClass || job.errorCategory
    ? formatPostingFailureForOperator(
        operatorClass,
        sd.lastErrorPhase ?? job.lastErrorPhase ?? null,
        sd.progress ?? null,
        sd.finalReason ?? null,
        sd,
      )
    : null

  const classWindows: FsmDiagnosticsClassWindow[] = Object.entries(sd.classWindows ?? {}).map(
    ([cls, win]) => ({
      errorClass: cls,
      count: win?.count ?? 0,
      windowStartAt: win?.windowStartAt ?? null,
      windowExpiresAt: windowExpiresAt(toOperatorErrorClass(cls), win?.windowStartAt),
      alertedAt: win?.alertedAt ?? null,
      lastPhase: win?.lastPhase ?? null,
      lastErrorAt: win?.lastErrorAt ?? null,
    }),
  )

  const nextRetryAt =
    job.retryAt instanceof Date ? job.retryAt.toISOString() : (job.retryAt ?? null)

  return {
    isFsmManaged: true,
    fsmVersion: sd.fsmVersion,
    buildMarker: sd.buildMarker ?? null,
    currentPhase: sd.currentPhase ?? null,
    lastCompletedPhase: sd.lastCompletedPhase ?? null,
    progress: sd.progress ?? null,
    lastErrorClass: sd.lastErrorClass ?? null,
    lastErrorPhase: sd.lastErrorPhase ?? null,
    finalReason: sd.finalReason ?? null,
    draftVideoId: sd.draftVideoId ?? null,
    draftVideoIdPresent: Boolean(sd.draftVideoId),
    duplicateRiskAcknowledged: Boolean(sd.duplicateRiskAcknowledged),
    classWindows,
    nextRetryAt,
    operatorClass,
    operatorAction: operator?.operatorAction ?? null,
    operator,
  }
}
