/**
 * Асинхронный движок запуска Trendwatcher.
 * Выполняет Apify-парсинг в фоновом режиме с полным server-side state tracking.
 * Не зависит от открытой вкладки — работает на сервере до завершения.
 */

import type { TrendwatcherRunStatus } from "../../app/generated/prisma/client"
import type { ApifyRunInfo, ApifyValidationResult } from "./apify-client"

interface RunContext {
  runId: number
  profileId: number
  /**
   * Сквозной трекинг: WorkflowRun.id пайплайна, из которого инициирован парсинг.
   * Используется для проставления runId/pipelineId на создаваемых Trend,
   * чтобы кнопка «К юниту» могла отфильтровать только те тренды, которые
   * пришли с конкретного запуска pipeline.
   */
  workflowRunId?: number
  workflowPipelineId?: number
}

/** Классификация ошибок */
type ErrorCategory =
  | "profile_validation_error"
  | "apify_start_failed"
  | "apify_run_failed"
  | "apify_timeout"
  | "dataset_empty"
  | "import_failed"
  | "import_partial_failure"
  | "canceled"
  | "watchdog_failed"
  | "unknown_external_error"

interface ErrorDiagnostics {
  errorCategory: ErrorCategory
  errorStep: string
  errorSummary: string
  canRetry: boolean
  needsProfileFix: boolean
  apifyStatus?: string
  apifyStatusMessage?: string
}

/** Формирует human-readable диагностику */
function classifyError(
  rawMessage: string,
  step: string,
  apifyInfo?: ApifyRunInfo | null,
): ErrorDiagnostics {
  const apifyStatus = apifyInfo?.status
  const apifyStatusMessage = apifyInfo?.statusMessage

  // Profile validation
  if (rawMessage.includes("Профиль не найден") || rawMessage.includes("Профиль отключён")) {
    return {
      errorCategory: "profile_validation_error",
      errorStep: step,
      errorSummary: rawMessage,
      canRetry: false,
      needsProfileFix: true,
      apifyStatus,
      apifyStatusMessage,
    }
  }
  if (rawMessage.includes("Нет ключевых слов") || rawMessage.includes("не содержит ключевых")) {
    return {
      errorCategory: "profile_validation_error",
      errorStep: step,
      errorSummary: "Профиль не содержит ключевых слов — добавьте keywords",
      canRetry: false,
      needsProfileFix: true,
      apifyStatus,
      apifyStatusMessage,
    }
  }

  // Apify start failed — with detailed HTTP error classification
  if (step === "starting" || rawMessage.includes("не запустился") || rawMessage.includes("не вернул runId")) {
    // 404 — actor not found
    if (rawMessage.includes("404") || rawMessage.includes("Not Found")) {
      return {
        errorCategory: "apify_start_failed",
        errorStep: step,
        errorSummary: "Актор не найден в Apify (404) — проверьте actorId в профиле",
        canRetry: false,
        needsProfileFix: true,
        apifyStatus,
        apifyStatusMessage,
      }
    }
    // 401/403 — auth/permission issue
    if (rawMessage.includes("401") || rawMessage.includes("403") || rawMessage.includes("Unauthorized") || rawMessage.includes("Forbidden")) {
      return {
        errorCategory: "apify_start_failed",
        errorStep: step,
        errorSummary: "Нет доступа к актору — проверьте APIFY_TOKEN и права доступа",
        canRetry: false,
        needsProfileFix: false,
        apifyStatus,
        apifyStatusMessage,
      }
    }
    // Paid APIs disabled
    if (rawMessage.includes("Платные API отключены")) {
      return {
        errorCategory: "apify_start_failed",
        errorStep: step,
        errorSummary: "Платные API отключены — установите ENABLE_PAID_APIS=true",
        canRetry: false,
        needsProfileFix: false,
        apifyStatus,
        apifyStatusMessage,
      }
    }
    return {
      errorCategory: "apify_start_failed",
      errorStep: step,
      errorSummary: `Apify не смог запустить актор: ${rawMessage.slice(0, 150)}`,
      canRetry: true,
      needsProfileFix: false,
      apifyStatus,
      apifyStatusMessage,
    }
  }

  // Apify timeout
  if (rawMessage.includes("Таймаут") || rawMessage.includes("таймаут") || apifyStatus === "TIMED-OUT") {
    return {
      errorCategory: "apify_timeout",
      errorStep: step,
      errorSummary: "Apify run превысил лимит времени — можно повторить или увеличить таймаут",
      canRetry: true,
      needsProfileFix: false,
      apifyStatus,
      apifyStatusMessage,
    }
  }

  // Apify run failed
  if (apifyStatus === "FAILED" || apifyStatus === "ABORTED" || rawMessage.includes("завершился")) {
    const detail = apifyStatusMessage ? `: ${apifyStatusMessage}` : ""
    return {
      errorCategory: "apify_run_failed",
      errorStep: step,
      errorSummary: `Apify run завершился с ошибкой (${apifyStatus ?? "FAILED"})${detail}`,
      canRetry: true,
      needsProfileFix: false,
      apifyStatus,
      apifyStatusMessage,
    }
  }

  // Dataset errors
  if (rawMessage.includes("Dataset") || rawMessage.includes("dataset")) {
    return {
      errorCategory: "import_failed",
      errorStep: step,
      errorSummary: "Не удалось загрузить результаты из Apify — попробуйте повторить запуск",
      canRetry: true,
      needsProfileFix: false,
      apifyStatus,
      apifyStatusMessage,
    }
  }

  // Cancel
  if (rawMessage.includes("отменён") || rawMessage.includes("Отменён")) {
    return {
      errorCategory: "canceled",
      errorStep: "canceled",
      errorSummary: "Запуск отменён оператором",
      canRetry: true,
      needsProfileFix: false,
      apifyStatus,
      apifyStatusMessage,
    }
  }

  // Default
  return {
    errorCategory: "unknown_external_error",
    errorStep: step,
    errorSummary: `Неизвестная ошибка на шаге "${step}": ${rawMessage.slice(0, 200)}`,
    canRetry: true,
    needsProfileFix: false,
    apifyStatus,
    apifyStatusMessage,
  }
}

/** Сохраняет диагностику ошибки в run */
async function saveErrorDiagnostics(
  runId: number,
  failureReason: string,
  diagnostics: ErrorDiagnostics,
): Promise<void> {
  await prisma.trendwatcherRun.update({
    where: { id: runId },
    data: {
      status: "failed" as TrendwatcherRunStatus,
      failureReason,
      errorCategory: diagnostics.errorCategory,
      errorStep: diagnostics.errorStep,
      errorSummary: diagnostics.errorSummary,
      apifyStatus: diagnostics.apifyStatus ?? null,
      apifyStatusMessage: diagnostics.apifyStatusMessage ?? null,
      canRetry: diagnostics.canRetry,
      needsProfileFix: diagnostics.needsProfileFix,
      completedAt: new Date(),
    },
  })
}

/** Набор активных запусков для защиты от дублей */
const activeRuns = new Map<number, number>() // profileId → runId

/**
 * Проверяет, есть ли активный запуск для профиля.
 */
export function hasActiveRun(profileId: number): boolean {
  return activeRuns.has(profileId)
}

/**
 * Возвращает runId активного запуска для профиля, если есть.
 */
export function getActiveRunId(profileId: number): number | undefined {
  return activeRuns.get(profileId)
}

/**
 * Записывает лог в TrendwatcherRunLog.
 */
async function runLog(
  runId: number,
  level: "info" | "warn" | "error",
  message: string,
  step?: string,
  payload?: unknown,
): Promise<void> {
  await prisma.trendwatcherRunLog.create({
    data: {
      runId,
      level,
      message,
      step: step ?? null,
      payload: payload ?? undefined,
    },
  }).catch(() => {})
}

/**
 * Обновляет статус запуска в БД.
 */
async function updateRunStatus(
  runId: number,
  status: TrendwatcherRunStatus,
  extra?: Record<string, unknown>,
): Promise<void> {
  await prisma.trendwatcherRun.update({
    where: { id: runId },
    data: { status, ...extra },
  })
}

/**
 * Главная функция запуска. Fire-and-forget: вызывается без await.
 * Полностью управляет lifecycle запуска от pending до completed/failed.
 */
export async function executeTrendwatcherRun(ctx: RunContext): Promise<void> {
  const { runId, profileId, workflowRunId, workflowPipelineId } = ctx

  activeRuns.set(profileId, runId)

  try {
    // Загружаем профиль
    const profile = await prisma.trendwatcherProfile.findUnique({
      where: { id: profileId },
    })

    if (!profile) {
      const diag = classifyError("Профиль не найден", "init")
      await saveErrorDiagnostics(runId, "Профиль не найден", diag)
      await runLog(runId, "error", "Профиль не найден", "init")
      return
    }

    if (!profile.enabled) {
      const diag = classifyError("Профиль отключён", "init")
      await saveErrorDiagnostics(runId, "Профиль отключён", diag)
      await runLog(runId, "error", "Профиль отключён", "init")
      return
    }

    if (profile.keywords.length === 0) {
      const diag = classifyError("Нет ключевых слов", "init")
      await saveErrorDiagnostics(runId, "Нет ключевых слов", diag)
      await runLog(runId, "error", "Профиль не содержит ключевых слов", "init")
      return
    }

    // --- Этап: preflight validation ---
    await runLog(runId, "info", "Preflight-проверка конфигурации Apify", "preflight")
    const validation: ApifyValidationResult = await preflightValidateProfile({
      actorId: profile.actorId,
      keywords: profile.keywords,
      enabled: profile.enabled,
      maxItems: profile.maxItems,
    })

    if (!validation.valid) {
      const diag: ErrorDiagnostics = {
        errorCategory: "profile_validation_error",
        errorStep: "preflight",
        errorSummary: validation.errorSummary ?? "Профиль не прошёл preflight-валидацию",
        canRetry: validation.canRetry,
        needsProfileFix: validation.needsProfileFix,
      }
      await saveErrorDiagnostics(runId, diag.errorSummary, diag)
      await runLog(runId, "error", `Preflight failed: ${validation.errorSummary}`, "preflight", {
        errorCode: validation.errorCode,
        nextAction: validation.nextAction,
      })

      // Save validation status to profile
      await prisma.trendwatcherProfile.update({
        where: { id: profileId },
        data: {
          validationStatus: validation.errorCode ?? "profile_invalid",
          validationSummary: validation.errorSummary ?? null,
          validatedAt: new Date(),
        },
      }).catch(() => {})

      return
    }

    // Validation passed — update profile
    await prisma.trendwatcherProfile.update({
      where: { id: profileId },
      data: {
        validationStatus: "valid",
        validationSummary: null,
        validatedAt: new Date(),
      },
    }).catch(() => {})
    await runLog(runId, "info", "Preflight OK: актор доступен, токен валиден", "preflight")

    // --- Этап: starting ---
    await updateRunStatus(runId, "starting")
    await runLog(runId, "info", `Запуск Apify-актора ${profile.actorId}`, "starting", {
      keywords: profile.keywords,
      maxItems: profile.maxItems,
    })

    let externalRunId: string

    try {
      externalRunId = await runApifyActor(profile.actorId, {
        keywords: profile.keywords,
        maxItems: profile.maxItems,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Ошибка запуска актора"
      const diag = classifyError(msg, "starting")
      await saveErrorDiagnostics(runId, msg, diag)
      await runLog(runId, "error", `Apify actor не запустился: ${msg}`, "starting")
      return
    }

    await prisma.trendwatcherRun.update({
      where: { id: runId },
      data: { externalRunId, status: "running", sourceType: profile.actorId },
    })
    await runLog(runId, "info", `Apify run создан: ${externalRunId}`, "running")

    // --- Этап: running (ожидание Apify) ---
    try {
      // Проверяем, не отменён ли запуск, каждый цикл поллинга
      await waitForApifyRunWithCancelCheck(externalRunId, runId)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Ошибка Apify run"

      // Проверяем — может запуск отменён
      const currentRun = await prisma.trendwatcherRun.findUnique({
        where: { id: runId },
        select: { status: true },
      })
      if (currentRun?.status === "canceled") {
        await runLog(runId, "info", "Запуск отменён оператором", "canceled")
        return
      }

      // Подтягиваем диагностику из Apify
      let apifyInfo: ApifyRunInfo | null = null
      try {
        apifyInfo = await getApifyRunInfo(externalRunId)
      } catch { /* не критично */ }

      const diag = classifyError(msg, "running", apifyInfo)
      await saveErrorDiagnostics(runId, msg, diag)
      await runLog(runId, "error", `Apify run завершился с ошибкой: ${msg}`, "running", {
        apifyStatus: apifyInfo?.status,
        apifyStatusMessage: apifyInfo?.statusMessage,
      })
      return
    }

    // --- Этап: importing ---
    await updateRunStatus(runId, "importing")
    await runLog(runId, "info", "Загрузка результатов из Apify dataset", "importing")

    let items: unknown[]
    try {
      items = await getApifyResults(externalRunId)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Ошибка загрузки dataset"
      const diag = classifyError(msg, "importing")
      await saveErrorDiagnostics(runId, msg, diag)
      await runLog(runId, "error", `Dataset недоступен: ${msg}`, "importing")
      return
    }

    await prisma.trendwatcherRun.update({
      where: { id: runId },
      data: { foundCount: items.length, datasetId: externalRunId },
    })
    await runLog(runId, "info", `Найдено ${items.length} элементов`, "importing")

    if (items.length === 0) {
      await updateRunStatus(runId, "completed", { completedAt: new Date() })
      await runLog(runId, "warn", "Dataset пустой — 0 результатов", "importing")
      await updateProfileAfterRun(profileId, runId, true)
      return
    }

    // Импорт трендов
    const profileData = {
      appId: profile.appId,
      keywords: profile.keywords,
      platforms: profile.platforms,
      language: profile.language,
      geo: profile.geo,
    }

    let imported = 0
    let dedupSkipped = 0
    let viewCountSkipped = 0
    let warnings = 0
    let firstItemError: string | null = null

    for (const item of items) {
      try {
        const data = mapApifyToTrend(item as Record<string, unknown>, profileData)

        // Фильтрация по viewCount, если настроено
        if (profile.viewCountMin && data.viewCount !== undefined) {
          if ((data.viewCount as number) < profile.viewCountMin) {
            viewCountSkipped++
            continue
          }
        }
        if (profile.viewCountMax && data.viewCount !== undefined) {
          if ((data.viewCount as number) > profile.viewCountMax) {
            viewCountSkipped++
            continue
          }
        }

        // Дедупликация по sourceUrl
        if (data.sourceUrl) {
          const existing = await prisma.trend.findFirst({
            where: { sourceUrl: data.sourceUrl as string },
          })
          if (existing) {
            dedupSkipped++
            continue
          }
        }

        const rawItem = item as Record<string, unknown>
        const keyword = typeof rawItem.searchQuery === "string"
          ? rawItem.searchQuery
          : profile.keywords[0] || null

        await prisma.trend.create({
          data: {
            ...data,
            keyword,
            // Если trendwatcher запущен из pipeline-экзекутора — привязываем
            // тренд к WorkflowRun и Pipeline через relation connect, чтобы
            // фильтр «К юниту» видел тренды именно этого запуска.
            ...(workflowRunId ? { run: { connect: { id: workflowRunId } } } : {}),
            ...(workflowPipelineId ? { pipeline: { connect: { id: workflowPipelineId } } } : {}),
          },
        })
        imported++
      } catch (err: unknown) {
        warnings++
        const msg = err instanceof Error ? err.message : String(err)
        if (!firstItemError) firstItemError = msg
        await runLog(runId, "warn", `Ошибка импорта элемента: ${msg}`, "importing", {
          error: msg,
          itemPreview: typeof (item as Record<string, unknown>)?.webVideoUrl === "string"
            ? (item as Record<string, unknown>).webVideoUrl
            : undefined,
        }).catch(() => {})
      }
    }

    const skipped = dedupSkipped + viewCountSkipped + warnings
    await prisma.trendwatcherRun.update({
      where: { id: runId },
      data: {
        importedCount: imported,
        skippedCount: skipped,
        dedupSkipCount: dedupSkipped,
        viewCountSkipCount: viewCountSkipped,
        warningCount: warnings,
      },
    })
    await runLog(
      runId,
      "info",
      `Импортировано: ${imported}, дубликаты: ${dedupSkipped}, по viewCount: ${viewCountSkipped}, ошибки: ${warnings}`,
      "importing",
      { firstItemError: firstItemError ?? undefined },
    )

    // --- Этап: completed ---
    const finalStatus = warnings > 0 && imported > 0 ? "partially_completed" as const : "completed" as const
    const completionData: Record<string, unknown> = {
      completedAt: new Date(),
      apifyStatus: "SUCCEEDED",
    }
    if (finalStatus === "partially_completed") {
      completionData.errorCategory = "import_partial_failure"
      completionData.errorStep = "importing"
      completionData.errorSummary = `Импорт частично завершён: ${imported} из ${items.length} (${warnings} ошибок маппинга)`
      completionData.canRetry = true
    }
    await updateRunStatus(runId, finalStatus, completionData)
    await runLog(runId, "info", `Запуск завершён: ${finalStatus}`, "completed", {
      foundCount: items.length,
      importedCount: imported,
      skippedCount: skipped,
      dedupSkipCount: dedupSkipped,
      viewCountSkipCount: viewCountSkipped,
      warningCount: warnings,
    })

    await updateProfileAfterRun(profileId, runId, true)

    await logAgent("trendwatcher", "info", `Парсинг завершён: ${imported} трендов из ${items.length}`, {
      profileId,
      runId,
      externalRunId,
      total: items.length,
      imported,
      skipped,
      dedupSkipped,
      viewCountSkipped,
      warnings,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Неизвестная ошибка"
    const diag = classifyError(msg, "unknown")

    await saveErrorDiagnostics(runId, msg, diag).catch(() => {})
    await runLog(runId, "error", `Критическая ошибка: ${msg}`, "unknown").catch(() => {})
    await updateProfileAfterRun(profileId, runId, false).catch(() => {})

    await logAgent("trendwatcher", "error", `Запуск #${runId} упал: ${msg}`, {
      profileId,
      runId,
    }).catch(() => {})
  } finally {
    activeRuns.delete(profileId)
  }
}

/**
 * Ожидание Apify run с периодической проверкой отмены в БД.
 */
async function waitForApifyRunWithCancelCheck(
  externalRunId: string,
  runId: number,
  timeoutMs: number = 5 * 60 * 1000,
): Promise<void> {
  const token = getApifyTokenSafe()
  const startTime = Date.now()
  const pollInterval = 10_000

  while (Date.now() - startTime < timeoutMs) {
    // Проверяем отмену
    const currentRun = await prisma.trendwatcherRun.findUnique({
      where: { id: runId },
      select: { status: true },
    })
    if (currentRun?.status === "canceled") {
      throw new Error("Запуск отменён")
    }

    const response = await $fetch<{ data: { id: string; status: string; statusMessage?: string } }>(
      `https://api.apify.com/v2/actor-runs/${externalRunId}`,
      { query: { token } },
    )

    const status = response?.data?.status
    const statusMessage = response?.data?.statusMessage

    if (status === "SUCCEEDED") return
    if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
      const detail = statusMessage ? ` — ${statusMessage}` : ""
      throw new Error(`Apify run завершился: ${status}${detail}`)
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval))
  }

  throw new Error(`Таймаут ожидания Apify (${timeoutMs / 1000}с)`)
}

/**
 * Безопасное получение Apify token.
 */
function getApifyTokenSafe(): string {
  const apifyToken = process.env.APIFY_TOKEN || ""
  if (!apifyToken) {
    throw new Error("APIFY_TOKEN не настроен")
  }
  return apifyToken
}

/**
 * Обновляет профиль после завершения запуска.
 */
async function updateProfileAfterRun(
  profileId: number,
  runId: number,
  success: boolean,
): Promise<void> {
  const data: Record<string, unknown> = { lastRunId: runId }
  if (success) {
    data.lastSuccessfulRunAt = new Date()
  }
  await prisma.trendwatcherProfile.update({
    where: { id: profileId },
    data,
  }).catch(() => {})
}
