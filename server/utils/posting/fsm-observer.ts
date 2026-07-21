/**
 * Phase FSM observability-слой (PR2A).
 *
 * Тонкая обёртка для логирования прохождения фаз и записи PostingJob.stateData
 * ПОВЕРХ существующего линейного runner'а. НЕ меняет порядок исполнения, retry,
 * backoff, recovery — это делает worker.ts / poster-runner (не тронуты).
 *
 * Гарантии:
 *   - Флаг YOUTUBE_POSTING_FSM_ENABLED !== "true" → createPhaseObserver вернёт
 *     NOOP-наблюдатель: все методы мгновенно резолвятся, НИ ОДНОГО запроса к БД,
 *     НИ ОДНОЙ записи в лог. Flag OFF = 0 изменений поведения.
 *   - Все методы best-effort: внутренняя ошибка глушится (console.warn), наружу
 *     НИКОГДА не пробрасывается — чтобы observability не могла повлиять на постинг.
 *
 * PR2B заменит линейный вызов на PhaseRunner, итерирующий phase-policy таблицу.
 *
 * @see docs/architecture/youtube-posting-fsm.md
 */

import type { Prisma } from "../../../app/generated/prisma/client"
import {
  YOUTUBE_POSTING_FSM_VERSION,
  type PhaseObserver,
  type YouTubePostingPhase,
  type YouTubePostingProgress,
  type YouTubePostingStateData,
} from "../../../shared/types/youtube-posting-fsm"
import type { PostingPhase } from "../../automation/posters/types"
import { prisma } from "../prisma"
import { resolvePostingFsmMode } from "./fsm-config"
import { classifyPostingError } from "./error-taxonomy"
import { appendJobLog } from "./job-service"

/**
 * Единственный источник истины «включён ли FSM для платформы». PR1: делегирует в
 * resolvePostingFsmMode (env_enabled → env_default → code_default), platform-aware:
 * FSM-able {youtube, instagram}; платформа вне множества (TikTok и пр.) → всегда
 * false. Без platform — глобальный дефолтный резолв (для legacy-вызовов).
 */
export function isPostingFsmEnabled(platform?: string | null): boolean {
  return resolvePostingFsmMode(platform).enabled
}

/**
 * @deprecated PR1: используйте isPostingFsmEnabled(platform). Оставлено как alias
 * на 1 PR для безопасности импортов (worker.ts / тесты). Поведение идентично.
 */
export const isYoutubePostingFsmEnabled = isPostingFsmEnabled

/**
 * Маппинг poster-фазы (PostingPhaseError.phase, 13 значений) → каноническая
 * YouTubePostingPhase (16). Нужен для centralized failPhase в poster-runner,
 * где известна только err.phase.
 */
export function mapPostingPhaseToFsmPhase(phase: PostingPhase): YouTubePostingPhase {
  switch (phase) {
    case "session_start":
      return "session_start"
    case "cdp_connect":
      return "connect_browser"
    case "browser_leak_check":
      return "browser_leak_check"
    case "login_check":
      return "login_check"
    case "navigate_upload":
      return "navigate_upload"
    case "file_upload":
      return "file_upload"
    case "caption":
    case "details":
    case "altered_content":
      return "fill_details"
    case "made_for_kids":
      return "set_audience"
    case "visibility":
      return "set_visibility"
    case "submit":
      return "publish"
    case "extract_url":
      return "verify_published"
    // Instagram-фазы (PR1): метки совпадают 1:1 в обоих enum'ах.
    case "ig_open_create":
      return "ig_open_create"
    case "ig_select_file":
      return "ig_select_file"
    case "ig_crop_next":
      return "ig_crop_next"
    case "ig_edit_next":
      return "ig_edit_next"
    case "ig_caption":
      return "ig_caption"
    case "ig_share":
      return "ig_share"
    case "ig_verify":
      return "ig_verify"
    default: {
      // Исчерпывающая проверка — при добавлении PostingPhase здесь будет ошибка типа.
      const _exhaustive: never = phase
      void _exhaustive
      return "session_start"
    }
  }
}

/**
 * Terminal housekeeping-фазы: всегда выполняются (finally) уже после провала/успеха
 * бизнес-логики. Их enter/exit только логируются и НЕ мутируют currentPhase /
 * lastCompletedPhase — иначе они затрут "где упало" / "последняя успешная бизнес-фаза".
 */
const HOUSEKEEPING_PHASES = new Set<YouTubePostingPhase>(["save_snapshot", "cleanup"])
function isHousekeepingPhase(phase: YouTubePostingPhase): boolean {
  return HOUSEKEEPING_PHASES.has(phase)
}

const NOOP_OBSERVER: PhaseObserver = Object.freeze({
  enabled: false,
  async enterPhase() {},
  async exitPhase() {},
  async failPhase() {},
  async updateProgress() {},
  async markFileAttached() {},
  async captureDraft() {},
  async captureShortcode() {},
  async markPublishClicked() {},
  async acknowledgeDuplicateRisk() {},
  async setUploadMeta() {},
})

interface ObserverOptions {
  jobId: string
  buildMarker: string
  /** PR5B: платформа job'а. non-youtube → observer всегда NOOP (FSM YouTube-only). */
  platform?: string | null
}

/**
 * Создать наблюдатель фаз. NOOP когда FSM выключен для платформы (PR1
 * platform-gate): FSM-able {youtube, instagram}, прочие и выключенные → NOOP,
 * не пишут stateData → worker идёт legacy. Instagram при дефолте OFF → NOOP.
 */
export function createPhaseObserver(opts: ObserverOptions): PhaseObserver {
  if (!isPostingFsmEnabled(opts.platform)) return NOOP_OBSERVER
  return new ActivePhaseObserver(opts.jobId, opts.buildMarker)
}

function freshState(buildMarker: string, phase: YouTubePostingPhase): YouTubePostingStateData {
  return {
    fsmVersion: YOUTUBE_POSTING_FSM_VERSION,
    buildMarker,
    currentPhase: phase,
    progress: "file_not_attached",
    draftVideoId: null,
    phaseAttempts: {},
    classWindows: {},
    lastTransitionAt: new Date().toISOString(),
    lastCompletedPhase: null,
  }
}

class ActivePhaseObserver implements PhaseObserver {
  readonly enabled = true

  constructor(
    private readonly jobId: string,
    private readonly buildMarker: string,
  ) {}

  /** best-effort: глушит любые ошибки, наружу не пробрасывает. */
  private async guard(fn: () => Promise<void>): Promise<void> {
    try {
      await fn()
    } catch (err) {
      console.warn(
        `[fsm-observer] job=${this.jobId}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /** read-modify-write stateData. Возвращает новое состояние (или null если job исчез). */
  private async patch(
    mutate: (s: YouTubePostingStateData) => YouTubePostingStateData,
  ): Promise<YouTubePostingStateData | null> {
    const row = await prisma.postingJob.findUnique({
      where: { id: this.jobId },
      select: { stateData: true },
    })
    if (!row) return null
    const prev = (row.stateData as YouTubePostingStateData | null) ?? null
    const base: YouTubePostingStateData =
      prev && typeof prev.fsmVersion === "number"
        ? prev
        : freshState(this.buildMarker, "session_start")
    const next = mutate({ ...base })
    next.lastTransitionAt = new Date().toISOString()
    await prisma.postingJob.update({
      where: { id: this.jobId },
      data: { stateData: next as unknown as Prisma.InputJsonValue },
    })
    return next
  }

  async enterPhase(phase: YouTubePostingPhase): Promise<void> {
    await this.guard(async () => {
      // cleanup — terminal housekeeping в finally (выполняется ПОСЛЕ catch/failPhase).
      // НЕ мутируем currentPhase, иначе затрём упавшую/последнюю бизнес-фазу. Только лог.
      if (isHousekeepingPhase(phase)) {
        await appendJobLog(this.jobId, "info", `STATE_ENTER ${phase}`, {
          fsm: true,
          event: "STATE_ENTER",
          phase,
          housekeeping: true,
        })
        return
      }
      const next = await this.patch((s) => {
        s.currentPhase = phase
        s.phaseAttempts = {
          ...s.phaseAttempts,
          [phase]: (s.phaseAttempts[phase] ?? 0) + 1,
        }
        return s
      })
      await appendJobLog(this.jobId, "info", `STATE_ENTER ${phase}`, {
        fsm: true,
        event: "STATE_ENTER",
        phase,
        attempt: next?.phaseAttempts[phase] ?? 1,
        buildMarker: this.buildMarker,
      })
    })
  }

  async exitPhase(phase: YouTubePostingPhase): Promise<void> {
    await this.guard(async () => {
      // Housekeeping не должен становиться "последней успешной бизнес-фазой".
      if (isHousekeepingPhase(phase)) {
        await appendJobLog(this.jobId, "info", `STATE_EXIT ${phase}`, {
          fsm: true,
          event: "STATE_EXIT",
          phase,
          housekeeping: true,
        })
        return
      }
      await this.patch((s) => {
        s.lastCompletedPhase = phase
        return s
      })
      await appendJobLog(this.jobId, "info", `STATE_EXIT ${phase}`, {
        fsm: true,
        event: "STATE_EXIT",
        phase,
      })
    })
  }

  async failPhase(phase: YouTubePostingPhase, error: unknown): Promise<void> {
    await this.guard(async () => {
      const message = error instanceof Error ? error.message : String(error)
      // Классификация внутри patch (нужен s.progress) — только для богатого лога
      // и stateData.lastError*. НЕ влияет на retry (это worker.handleFailure).
      let cls: ReturnType<typeof classifyPostingError> | undefined
      const next = await this.patch((s) => {
        cls = classifyPostingError({ message, phase, progress: s.progress })
        s.currentPhase = phase
        s.lastErrorClass = cls.errorClass
        s.lastErrorPhase = phase
        return s
      })
      const c =
        cls ?? classifyPostingError({ message, phase, progress: next?.progress })
      await appendJobLog(this.jobId, "error", `STATE_FAIL ${phase}`, {
        fsm: true,
        event: "STATE_FAIL",
        phase,
        errorClass: c.errorClass,
        disposition: c.disposition,
        message,
        progress: next?.progress ?? null,
        stateSummary: next
          ? {
              currentPhase: next.currentPhase,
              progress: next.progress,
              lastCompletedPhase: next.lastCompletedPhase ?? null,
            }
          : null,
      })
    })
  }

  async updateProgress(progress: YouTubePostingProgress): Promise<void> {
    await this.guard(async () => {
      await this.patch((s) => {
        s.progress = progress
        return s
      })
      await appendJobLog(this.jobId, "info", `STATE_PROGRESS ${progress}`, {
        fsm: true,
        event: "STATE_PROGRESS",
        progress,
      })
    })
  }

  async markFileAttached(): Promise<void> {
    await this.guard(async () => {
      const now = new Date().toISOString()
      await this.patch((s) => {
        s.progress = "file_attached_unconfirmed"
        s.fileAttachedAt = now
        return s
      })
      await appendJobLog(this.jobId, "info", "STATE_PROGRESS file_attached_unconfirmed", {
        fsm: true,
        event: "STATE_PROGRESS",
        progress: "file_attached_unconfirmed",
        fileAttachedAt: now,
      })
    })
  }

  async captureDraft(draftVideoId: string, draftUrl?: string): Promise<void> {
    await this.guard(async () => {
      await this.patch((s) => {
        s.draftVideoId = draftVideoId
        if (draftUrl !== undefined) s.draftUrl = draftUrl
        return s
      })
      await appendJobLog(this.jobId, "info", `DRAFT_ID_CAPTURED ${draftVideoId}`, {
        fsm: true,
        event: "DRAFT_ID_CAPTURED",
        draftVideoId,
        draftUrl: draftUrl ?? null,
      })
    })
  }

  async captureShortcode(shortcode: string, url: string): Promise<void> {
    await this.guard(async () => {
      await this.patch((s) => {
        s.platformPostShortcode = shortcode
        s.platformPostUrl = url
        return s
      })
      await appendJobLog(this.jobId, "info", `SHORTCODE_CAPTURED ${shortcode}`, {
        fsm: true,
        event: "SHORTCODE_CAPTURED",
        shortcode,
        url,
      })
    })
  }

  async markPublishClicked(): Promise<void> {
    await this.guard(async () => {
      const now = new Date().toISOString()
      await this.patch((s) => {
        s.progress = "publish_clicked"
        s.publishClickedAt = now
        return s
      })
      await appendJobLog(this.jobId, "info", "STATE_PROGRESS publish_clicked", {
        fsm: true,
        event: "STATE_PROGRESS",
        progress: "publish_clicked",
        publishClickedAt: now,
      })
    })
  }

  async acknowledgeDuplicateRisk(): Promise<void> {
    await this.guard(async () => {
      await this.patch((s) => {
        s.duplicateRiskAcknowledged = true
        return s
      })
      await appendJobLog(this.jobId, "warn", "DUPLICATE_RISK_ACK: bounded re-upload израсходован", {
        fsm: true,
        event: "DUPLICATE_RISK_ACK",
      })
    })
  }

  async setUploadMeta(uploadTitleFingerprint: string, uploadedFileName: string): Promise<void> {
    await this.guard(async () => {
      await this.patch((s) => {
        s.uploadTitleFingerprint = uploadTitleFingerprint
        s.uploadedFileName = uploadedFileName
        return s
      })
      await appendJobLog(this.jobId, "info", "UPLOAD_META", {
        fsm: true,
        event: "UPLOAD_META",
        uploadTitleFingerprint,
        uploadedFileName,
      })
    })
  }
}
