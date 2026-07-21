/**
 * Orchestrator browser-automation постинга.
 *
 * Вызывается из worker.executeJob когда socialAccount.postingMethod ===
 * 'browser_automation'.
 *
 * Этап 3 (P5 — FSM-интеграция DuoPlus-движка): за канареечным гейтом
 * `DUOPLUS_ENGINE_ENABLED` ветка делегирует в `AdbAutomationEngine` (REST-only
 * A1, powerOn → media-push → нативный постер → powerOff). Гейт по умолчанию
 * ВЫКЛЮЧЕН — до прогона живой канарейки `resolveAutomationEngine` возвращает
 * `NotImplementedAutomationEngine`, который бросает terminal-ошибку
 * `engine_not_implemented` (поведение Этапа 2 не меняется — управляемый rollout).
 *
 * Проброс данных в движок:
 *   - imageId    ← DeviceProfile.indigoId (image_id DuoPlus; через @@map).
 *                  Резолвится по socialAccount.deviceProfileId. Null → terminal
 *                  «устройство не привязано».
 *   - storageKey ← Video.storageKey (GCS-ключ; движок сам резолвит signed URL).
 *   - caption/title/description ← из джобы (worker собирает из contentSnapshot).
 *
 * Классификация ошибок: AdbEngineError (terminal/retryable) → PostingPhaseError
 * с PostingErrorCategory через adbEngineCategory — worker.handleFailure ведёт
 * job в retry_queued (retryable) или failed (terminal) по retry-policy.
 *
 * Сигнатуры (RunBrowserPostingInput/Result, runBrowserPosting) расширены
 * аддитивно (deviceProfileId) — worker зовёт их с минимальным изменением.
 */

import { prisma } from "../utils/prisma"
import { adbEngineCategory } from "../utils/posting/error-classifier"
import { appendJobLog } from "../utils/posting/job-service"
import { AdbAutomationEngine } from "./automation-engine/adb-automation-engine"
import type { AdbPostInput } from "./automation-engine/adb-automation-engine"
import {
  AutomationEngineNotImplementedError,
  NotImplementedAutomationEngine,
} from "./automation-engine/not-implemented-engine"
import type { AutomationEngine } from "./automation-engine/types"
import { PostingPhaseError, type YouTubePosterOptions } from "./posters/types"
import type { Platform } from "../../app/generated/prisma/client"

export interface RunBrowserPostingInput {
  jobId: string
  videoId: number
  socialAccountId: number
  /**
   * DeviceProfile.id привязанного к аккаунту устройства (worker select'ит из
   * socialAccount.deviceProfileId). Поставщик image_id для DuoPlus-движка.
   * null → терминальная ошибка «устройство не привязано».
   */
  deviceProfileId?: string | null
  /** Caption для TikTok/IG. Для YouTube игнорируется. */
  caption: string
  hashtags?: string[]
  /** YouTube: заголовок. */
  title?: string
  /** YouTube: описание. */
  description?: string
  /** YouTube platform options. */
  youtube?: YouTubePosterOptions
  platform: Platform
}

export interface RunBrowserPostingResult {
  platformPostId: string
  platformPostUrl: string
  apiMadeWarning: boolean
}

/**
 * Канареечный гейт DuoPlus-движка. Default OFF (до прогона живой джобы на
 * проде) — `resolveAutomationEngine` возвращает NotImplemented (Этап 2). Когда
 * `DUOPLUS_ENGINE_ENABLED === "true"` — реальный AdbAutomationEngine.
 */
function isDuoplusEngineEnabled(): boolean {
  // Терпим к формату значения env (Saturn хранит "ON"): true/1/on/yes/enabled.
  const v = process.env.DUOPLUS_ENGINE_ENABLED?.trim().toLowerCase()
  return v === "true" || v === "1" || v === "on" || v === "yes" || v === "enabled"
}

/**
 * Резолвер движка автоматизации. За гейтом `DUOPLUS_ENGINE_ENABLED`:
 *   - true  → AdbAutomationEngine (DuoPlus, Этап 3).
 *   - false → NotImplementedAutomationEngine (Этап 2, default).
 *
 * Тайминги движка (poll-интервалы powerOn/media) переопределяются env только в
 * mock-режиме (`DUOPLUS_MOCK_MODE=true`) — прод всегда использует безопасные
 * дефолты движка (≥90с powerOn, ≥120с media), эти env в проде не выставляются.
 */
function resolveAutomationEngine(): AutomationEngine {
  if (isDuoplusEngineEnabled()) {
    return new AdbAutomationEngine(resolveEngineTestOverrides())
  }
  return new NotImplementedAutomationEngine()
}

/**
 * Тайминговые override'ы движка из env — ТОЛЬКО под DUOPLUS_MOCK_MODE (тесты).
 * В проде возвращает {} → движок берёт безопасные дефолты.
 */
function resolveEngineTestOverrides(): {
  powerOnPollIntervalMs?: number
  powerOnTimeoutMs?: number
  mediaPollIntervalMs?: number
  mediaReadyTimeoutMs?: number
} {
  if (process.env.DUOPLUS_MOCK_MODE !== "true") return {}
  const num = (v: string | undefined): number | undefined => {
    const n = Number(v)
    return v != null && Number.isFinite(n) && n > 0 ? n : undefined
  }
  return {
    powerOnPollIntervalMs: num(process.env.DUOPLUS_POWER_ON_POLL_MS),
    powerOnTimeoutMs: num(process.env.DUOPLUS_POWER_ON_TIMEOUT_MS),
    mediaPollIntervalMs: num(process.env.DUOPLUS_MEDIA_POLL_MS),
    mediaReadyTimeoutMs: num(process.env.DUOPLUS_MEDIA_TIMEOUT_MS),
  }
}

/**
 * Резолвит image_id устройства (DeviceProfile.indigoId) + storageKey видео для
 * передачи в AdbAutomationEngine. Бросает PostingPhaseError (terminal,
 * internal_error) если устройство не привязано / у него нет image_id / у видео
 * нет storageKey — повтор бессмыслен до исправления привязки оператором.
 */
async function resolveDeviceContext(input: RunBrowserPostingInput): Promise<{
  imageId: string
  storageKey: string
}> {
  if (!input.deviceProfileId) {
    throw new PostingPhaseError(
      `Аккаунт #${input.socialAccountId} не привязан к устройству (DeviceProfile). `
        + "Привяжите устройство DuoPlus перед постингом.",
      "session_start",
      "internal_error",
      undefined,
      "requires_human",
    )
  }

  const profile = await prisma.deviceProfile.findUnique({
    where: { id: input.deviceProfileId },
    select: { indigoId: true },
  })
  const imageId = profile?.indigoId?.trim()
  if (!imageId) {
    throw new PostingPhaseError(
      `Устройство ${input.deviceProfileId} не имеет image_id DuoPlus (indigoId). `
        + "Засинхронизируйте устройство с DuoPlus.",
      "session_start",
      "internal_error",
      undefined,
      "requires_human",
    )
  }

  const video = await prisma.video.findUnique({
    where: { id: input.videoId },
    select: { storageKey: true },
  })
  const storageKey = video?.storageKey?.trim()
  if (!storageKey) {
    throw new PostingPhaseError(
      `Видео #${input.videoId} не имеет storageKey (GCS) для заливки в устройство.`,
      "file_upload",
      "internal_error",
      undefined,
      "requires_human",
    )
  }

  return { imageId, storageKey }
}

/**
 * Best-effort powerOff устройства джобы (для recovery воркера / финального fail).
 * Резолвит imageId по job → socialAccount.deviceProfileId → DeviceProfile.indigoId
 * и гасит устройство DuoPlus. Зачем: если worker-процесс умер посреди постинга
 * (рестарт Nitro при деплое / краш) ДО `finally`/powerOff в движке, устройство
 * остаётся ON и жжёт биллинг DuoPlus, пока кто-то не возьмётся за него снова.
 * Recovery воркера чинил только статус джобы — теперь гасит и железо.
 *
 * Никогда не бросает: устройство может быть уже выключено / не привязано / api-аккаунт.
 */
export async function bestEffortPowerOffJobDevice(jobId: string): Promise<void> {
  try {
    const job = await prisma.postingJob.findUnique({
      where: { id: jobId },
      select: {
        socialAccount: { select: { postingMethod: true, deviceProfileId: true } },
      },
    })
    const acc = job?.socialAccount
    // Только browser_automation с привязанным устройством — у api-аккаунтов железа нет.
    if (!acc || acc.postingMethod !== "browser_automation" || !acc.deviceProfileId) return
    const profile = await prisma.deviceProfile.findUnique({
      where: { id: acc.deviceProfileId },
      select: { indigoId: true },
    })
    const imageId = profile?.indigoId?.trim()
    if (!imageId) return
    // powerOffDevice сам best-effort (никогда не бросает, getDuoplusClient внутри try).
    await new AdbAutomationEngine().powerOffDevice(imageId)
  } catch {
    // best-effort: recovery воркера не должен падать из-за powerOff.
  }
}

/**
 * Конвертация AdbEngineError (DuoPlus-движок) в PostingPhaseError с persisted
 * PostingErrorCategory. terminal=true → internal_error (НЕ retryable);
 * terminal=false → network_error (retryable, входит в RETRYABLE_CATEGORIES).
 */
function adbErrorToPhaseError(err: {
  message: string
  code: string
  terminal: boolean
}): PostingPhaseError {
  const category = adbEngineCategory(err.code, err.terminal)
  // category union PostingPhaseError содержит internal_error и network_error.
  const phaseCategory = category === "internal_error" ? "internal_error" : "network_error"
  return new PostingPhaseError(
    `[adb:${err.code}] ${err.message}`,
    "session_start",
    phaseCategory,
    undefined,
    // terminal-ошибки движка (config error / нереализованный постер) → requires_human.
    err.terminal ? "requires_human" : undefined,
  )
}

/** Узнаём AdbEngineError по форме (без статического импорта класса для теста-изоляции). */
function isAdbEngineError(
  err: unknown,
): err is { message: string; code: string; terminal: boolean } {
  if (!err || typeof err !== "object") return false
  const e = err as { name?: unknown; code?: unknown; terminal?: unknown }
  return (
    e.name === "AdbEngineError" &&
    typeof e.code === "string" &&
    typeof e.terminal === "boolean"
  )
}

/**
 * Запустить browser-automation постинг.
 *
 * За гейтом OFF (Этап 2): terminal-ошибка engine_not_implemented.
 * За гейтом ON (Этап 3): DuoPlus AdbAutomationEngine — powerOn → media-push →
 * нативный постер (YouTube; TikTok/IG → poster_not_implemented до P8) → powerOff.
 *
 * @throws PostingPhaseError (worker классифицирует через categorizeError).
 */
export async function runBrowserPosting(
  input: RunBrowserPostingInput,
): Promise<RunBrowserPostingResult> {
  const engine = resolveAutomationEngine()

  // Гейт OFF — движок не реализован: лог + terminal-ошибка (Этап 2 без изменений).
  if (engine.kind === "not_implemented") {
    await appendJobLog(
      input.jobId,
      "warn",
      `automation_engine: ${engine.kind} (DuoPlus-движок выключен гейтом DUOPLUS_ENGINE_ENABLED)`,
      {
        engineKind: engine.kind,
        platform: input.platform,
        socialAccountId: input.socialAccountId,
        videoId: input.videoId,
        reason: "engine_not_implemented",
      },
    )
    try {
      await engine.postVideo({
        videoLocalPath: "",
        caption: input.caption,
        hashtags: input.hashtags,
        title: input.title,
        description: input.description,
        youtube: input.youtube,
        jobId: input.jobId,
        platform: input.platform,
      })
      throw new PostingPhaseError(
        "Движок автоматизации вернул пустой результат.",
        "session_start",
        "unknown",
        undefined,
        "requires_human",
      )
    } catch (err) {
      if (err instanceof AutomationEngineNotImplementedError) {
        throw new PostingPhaseError(
          err.message,
          "session_start",
          "unknown",
          undefined,
          "requires_human",
        )
      }
      throw err
    }
  }

  // Гейт ON — DuoPlus AdbAutomationEngine.
  const { imageId, storageKey } = await resolveDeviceContext(input)

  await appendJobLog(
    input.jobId,
    "info",
    `automation_engine: ${engine.kind} (DuoPlus, image_id=${imageId})`,
    {
      engineKind: engine.kind,
      platform: input.platform,
      socialAccountId: input.socialAccountId,
      videoId: input.videoId,
      deviceProfileId: input.deviceProfileId,
      imageId,
    },
  )

  // Handle канала для best-effort захвата URL поста (YouTube): SocialAccount.platformHandle.
  const account = await prisma.socialAccount.findUnique({
    where: { id: input.socialAccountId },
    select: { platformHandle: true },
  })

  const adbInput: AdbPostInput = {
    imageId,
    storageKey,
    videoId: input.videoId,
    channelHandle: account?.platformHandle ?? null,
    // Локальный путь web-постинга не используется — движок сам скачивает видео из
    // GCS в tmp и заливает на устройство через Cloud Drive (push-модель).
    videoLocalPath: "",
    caption: input.caption,
    hashtags: input.hashtags,
    title: input.title,
    description: input.description,
    youtube: input.youtube,
    jobId: input.jobId,
    platform: input.platform,
  }

  try {
    const result = await engine.postVideo(adbInput)
    if (!result.success) {
      // Движок вернул структурированный неуспех без throw — обрабатываем как
      // фазовую ошибку (network_error → retryable, как transient device-сбой).
      throw new PostingPhaseError(
        result.errorMessage ?? "DuoPlus-движок вернул success=false без сообщения.",
        result.phase ?? "submit",
        "network_error",
        result.screenshotKey,
      )
    }
    // Honest-сигнал: публикация подтверждена движком (verifyPublished для YouTube —
    // плитка канала ИЛИ серверный fetch). Пустой URL при device_tile — это НЕ
    // молчаливый фейк «Опубликовано», а норма (страница канала ещё не
    // проиндексировала свежий Short). Фиксируем метод и наличие URL в логе джобы,
    // чтобы «published без ссылки» был явным и отличимым от проблемы.
    const urlCaptured = Boolean(result.platformPostUrl)
    await appendJobLog(
      input.jobId,
      "info",
      `Публикация подтверждена (метод: ${result.verificationMethod ?? "engine"}); `
        + `URL ${urlCaptured ? "захвачен" : "не захвачен (страница канала ещё не проиндексировала Short)"}`,
      {
        verificationMethod: result.verificationMethod ?? null,
        platformPostUrl: result.platformPostUrl ?? "",
        urlCaptured,
      },
    ).catch(() => {})
    return {
      // ADB-постинг (YouTube Short) часто не отдаёт URL из UI-flow сразу — захват
      // отдельной задачей/серверным fetch. Пустой URL = «опубликован, ссылка позже».
      platformPostId: result.platformPostId ?? "",
      platformPostUrl: result.platformPostUrl ?? "",
      apiMadeWarning: result.apiMadeWarning ?? false,
    }
  } catch (err) {
    if (isAdbEngineError(err)) {
      const phaseErr = adbErrorToPhaseError(err)
      await appendJobLog(
        input.jobId,
        "error",
        `adb_engine_error: ${err.code} (terminal=${err.terminal})`,
        {
          engineKind: engine.kind,
          code: err.code,
          terminal: err.terminal,
          mappedCategory: phaseErr.category,
        },
      ).catch(() => {})
      throw phaseErr
    }
    throw err
  }
}
