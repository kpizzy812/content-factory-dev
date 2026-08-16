/**
 * Оркестратор производственного цикла.
 * 4 шага: тренды -> сценарии -> видео -> загрузки.
 * Вызывает реальные пайплайны с try/catch на каждом шаге.
 */

import { sendTelegramAlert } from "./telegram/alerts"
import { CancellationError, throwIfAborted } from "./pipeline-cancel-registry"
import { resolveScenarioFunnel } from "./scenario-funnel"
import type { ScenarioFunnelPayload } from "./scenario-funnel"
import { selectScenarioVariantForVideo } from "./scenario-variant-selection"
import { resolveEditPipelineFlag } from "./video-pipeline-run-policy"

const VIDEO_TIMEOUT_MS = 10 * 60 * 1000

/** Как часто оркестратор перечитывает статус цикла во время длинного шага. */
const STOP_POLL_INTERVAL_MS = 10_000

/**
 * Реестр остановки циклов: AbortController на каждый живой ProductionCycle.
 *
 * Механизм тот же, что у прогонов конвейера (pipeline-cancel-registry:
 * AbortController + throwIfAborted + CancellationError), но карта отдельная —
 * там ключ это id PipelineRun, и подмешать в неё id цикла нельзя: нумерация
 * независимая, abortRun(5) снёс бы чужой прогон конвейера.
 */
const cycleControllers = new Map<number, AbortController>()

/**
 * Просит оркестратор немедленно прекратить цикл.
 * Вызывается теми, кто выставил статус stopped в БД (Telegram /stop, админка).
 * Идемпотентна: повторный вызов ничего не ломает.
 * @returns true, если цикл выполняется в этом процессе и сигнал доставлен.
 */
export function requestCycleStop(cycleId: number): boolean {
  const controller = cycleControllers.get(cycleId)
  if (!controller) return false
  if (!controller.signal.aborted) controller.abort()
  return true
}

/** Запрошена ли остановка цикла (без похода в БД). */
export function isCycleStopRequested(cycleId: number): boolean {
  return cycleControllers.get(cycleId)?.signal.aborted ?? false
}

/** Отмена — это не падение: отличаем её от настоящей ошибки шага. */
function isCancellation(err: unknown): boolean {
  return err instanceof CancellationError
    || (err instanceof Error && err.name === "CancellationError")
}

/**
 * Читает актуальный статус цикла.
 * "unknown" — БД моргнула; из-за проблем с чтением цикл не останавливаем,
 * иначе любой сетевой сбой выглядел бы как остановка оператором.
 */
async function readCycleLiveness(cycleId: number): Promise<"alive" | "stopped" | "unknown"> {
  try {
    const row = await prisma.productionCycle.findUnique({
      where: { id: cycleId },
      select: { status: true },
    })
    if (!row) return "stopped"
    return row.status === "running" || row.status === "pending" ? "alive" : "stopped"
  } catch {
    return "unknown"
  }
}

/**
 * Барьер между шагами: дальше идём, только если цикл всё ещё живой.
 * Проверяем и сигнал (остановка в этом процессе), и БД — команду /stop мог
 * выполнить другой инстанс, у которого нашего AbortController нет.
 */
async function assertCycleRunning(cycleId: number, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal)

  if (await readCycleLiveness(cycleId) === "stopped") {
    // Внешнюю остановку подхватываем в сигнал: он погасит уже запущенные
    // внешние операции (генерации видео) через каскад в шаге 3.
    requestCycleStop(cycleId)
    throw new CancellationError(`Цикл #${cycleId} остановлен`)
  }
}

/**
 * Фоновый наблюдатель: пока идёт длинный шаг, перечитывает статус цикла и
 * абортит сигнал, если цикл остановили. Без него остановка во время шага
 * «видео» ждала бы до десяти минут, продолжая тратить деньги.
 */
function watchCycleStop(cycleId: number): () => void {
  const timer = setInterval(() => {
    void readCycleLiveness(cycleId).then((liveness) => {
      if (liveness === "stopped") requestCycleStop(cycleId)
    })
  }, STOP_POLL_INTERVAL_MS)

  // Таймер не должен держать процесс живым.
  ;(timer as unknown as { unref?: () => void }).unref?.()

  return () => clearInterval(timer)
}

/**
 * Ждёт внешнюю операцию, но бросает CancellationError, как только пришла
 * остановка. `onAbort` должен погасить внешнюю операцию — просто перестать
 * её ждать мало, иначе она продолжит тратить деньги и никем не учтётся.
 */
async function raceWithAbort<T>(
  work: Promise<T>,
  signal: AbortSignal,
  onAbort: () => Promise<void>,
): Promise<T> {
  // Хвост брошенной операции гасим сами, чтобы не ловить unhandled rejection.
  work.catch(() => {})

  let onAbortEvent: (() => void) | null = null
  const aborted = new Promise<never>((_, reject) => {
    if (signal.aborted) return reject(new CancellationError())
    onAbortEvent = () => reject(new CancellationError())
    signal.addEventListener("abort", onAbortEvent, { once: true })
  })

  try {
    return await Promise.race([work, aborted])
  } catch (err) {
    if (isCancellation(err)) await onAbort().catch(() => {})
    throw err
  } finally {
    if (onAbortEvent) signal.removeEventListener("abort", onAbortEvent)
  }
}

/** Счётчики цикла — пишем их при любом финале, включая остановку. */
interface CycleCounters {
  trendsFound: number
  scenariosGen: number
  videosGen: number
  uploadsCount: number
}

/**
 * Финализирует цикл в терминальном статусе, НЕ затирая уже выставленный
 * stopped. Ровно тут был баг: успешный финал безусловно писал completed,
 * и остановка оператором пропадала.
 */
async function finalizeCycle(
  cycleId: number,
  status: "completed" | "failed",
  counters: CycleCounters,
  errorMessage?: string,
): Promise<boolean> {
  const claimed = await prisma.productionCycle.updateMany({
    where: { id: cycleId, status: { in: ["running", "pending"] } },
    data: {
      status,
      completedAt: new Date(),
      ...(errorMessage ? { errorMessage } : {}),
      ...counters,
    },
  })

  if (claimed.count > 0) return true

  // Кто-то уже закрыл цикл (обычно /stop). Сохраняем только счётчики —
  // сколько успели сделать до остановки.
  await prisma.productionCycle.update({
    where: { id: cycleId },
    data: counters,
  }).catch(() => {})
  return false
}

/** Закрывает цикл как остановленный, сохраняя момент остановки. */
async function finalizeStoppedCycle(cycleId: number, counters: CycleCounters): Promise<void> {
  const current = await prisma.productionCycle.findUnique({
    where: { id: cycleId },
    select: { completedAt: true },
  }).catch(() => null)

  await prisma.productionCycle.update({
    where: { id: cycleId },
    data: {
      status: "stopped",
      // completedAt ставит тот, кто нажал стоп; повторная запись не должна
      // сдвигать момент остановки — иначе /stop не идемпотентен.
      completedAt: current?.completedAt ?? new Date(),
      ...counters,
    },
  }).catch(() => {})
}

/**
 * Запускает полный цикл производства.
 * Fire-and-forget: обновляет статусы и логирует каждый шаг.
 * Между шагами проверяет, не остановили ли цикл.
 */
export async function startCycle(cycleId: number): Promise<void> {
  // Счётчики держим одним изменяемым объектом: шаги дописывают в него прогресс
  // по ходу дела, чтобы при остановке посреди шага сделанное не потерялось.
  const counters: CycleCounters = { trendsFound: 0, scenariosGen: 0, videosGen: 0, uploadsCount: 0 }

  // Если по этому id уже крутится прогон — его сигнал больше не наш.
  const controller = new AbortController()
  cycleControllers.set(cycleId, controller)
  const signal = controller.signal
  const stopWatching = watchCycleStop(cycleId)

  try {
    const cycle = await prisma.productionCycle.findUnique({
      where: { id: cycleId },
      include: { app: true, accountGroup: { include: { members: true } } },
    })

    if (!cycle) {
      await logAgent("orchestrator", "error", `Цикл #${cycleId} не найден`)
      return
    }

    // Цикл могли остановить ещё до старта — тогда ничего не запускаем.
    if (cycle.status !== "running" && cycle.status !== "pending") {
      await logAgent(
        "orchestrator", "warn",
        `Цикл #${cycleId} не запущен: статус ${cycle.status}`, { status: cycle.status }, cycleId,
      )
      return
    }

    await prisma.productionCycle.update({
      where: { id: cycleId },
      data: { status: "running" },
    })
    await logAgent("orchestrator", "info", "Цикл запущен", { cycleId, appId: cycle.appId }, cycleId)
    await sendTelegramAlert("cycle_started", `Цикл #${cycleId} запущен для "${cycle.app.name}"`)

    // Шаг 1: Тренды
    await assertCycleRunning(cycleId, signal)
    await stepTrends(cycleId, cycle.appId, signal, counters)

    // Шаг 2: Сценарии
    await assertCycleRunning(cycleId, signal)
    await stepScenarios(cycleId, cycle.appId, cycle.app, signal, counters)

    // Шаг 3: Видео
    await assertCycleRunning(cycleId, signal)
    await stepVideos(cycleId, cycle.appId, signal, counters)

    // Шаг 4: Загрузки
    await assertCycleRunning(cycleId, signal)
    await stepUploads(cycleId, cycle.appId, cycle.groupId, cycle.accountGroup, signal, counters)

    // Последняя проверка: стоп мог прийти уже во время четвёртого шага.
    await assertCycleRunning(cycleId, signal)

    const finished = await finalizeCycle(cycleId, "completed", counters)

    await logAgent(
      "orchestrator", "info",
      finished ? "Цикл завершен успешно" : "Цикл остановлен на финише, статус completed не выставлен",
      { ...counters }, cycleId,
    )
  } catch (err: unknown) {
    if (isCancellation(err)) {
      await finalizeStoppedCycle(cycleId, counters)
      await logAgent(
        "orchestrator", "warn", `Цикл #${cycleId} остановлен`,
        { ...counters }, cycleId,
      )
      return
    }

    const message = err instanceof Error ? err.message : "Неизвестная ошибка"
    await finalizeCycle(cycleId, "failed", counters, message).catch(() => {})

    await logAgent("orchestrator", "error", `Цикл #${cycleId} упал: ${message}`, { error: message }, cycleId)
    await sendTelegramAlert("critical_error", `Цикл #${cycleId} завершился с ошибкой`, message)
  } finally {
    stopWatching()
    // Снимаем только свой controller: у перезапуска цикла он уже другой.
    if (cycleControllers.get(cycleId) === controller) cycleControllers.delete(cycleId)
  }
}

/**
 * Шаг 1: Получение трендов. Если нет новых -- пробует Apify.
 */
async function stepTrends(
  cycleId: number,
  appId: number,
  signal: AbortSignal,
  counters: CycleCounters,
): Promise<number> {
  try {
    // Atomic claiming: select new trends and immediately mark as in_work
    // to prevent race conditions with pipeline executors
    let trends = await prisma.trend.findMany({
      where: { appId, status: "new" },
      take: 5,
    })

    if (trends.length > 0) {
      const claimedIds = trends.map(t => t.id)
      await prisma.trend.updateMany({
        where: { id: { in: claimedIds }, status: "new" },
        data: { status: "in_work" },
      })
      // Re-read only successfully claimed trends (atomic: only those still "new" → "in_work")
      trends = await prisma.trend.findMany({
        where: { id: { in: claimedIds }, status: "in_work" },
      })
    }

    if (trends.length === 0) {
      const profile = await prisma.trendwatcherProfile.findFirst({
        where: { appId, enabled: true },
      })

      if (profile) {
        await logAgent("orchestrator", "info", "Нет новых трендов, запускаем Apify", { profileId: profile.id }, cycleId)

        // Создаём запись запуска для observability
        const twRun = await prisma.trendwatcherRun.create({
          data: {
            profileId: profile.id,
            status: "running",
            triggerType: "pipeline",
            initiatedBy: `cycle-${cycleId}`,
            sourceType: profile.actorId,
          },
        })

        try {
          throwIfAborted(signal)
          const externalRunId = await runApifyActor(profile.actorId, { keywords: profile.keywords, maxItems: profile.maxItems, contentFormat: profile.contentFormat as "reels" | "posts" | null })
          await prisma.trendwatcherRun.update({
            where: { id: twRun.id },
            data: { externalRunId, status: "running" },
          })
          // Ждём Apify, но не дольше, чем живёт цикл: при остановке гасим
          // актор на стороне Apify и закрываем запись прогона, иначе внешняя
          // операция осталась бы висеть без учёта.
          await raceWithAbort(
            waitForApifyRun(externalRunId),
            signal,
            async () => {
              await abortApifyRun(externalRunId).catch(() => false)
              await prisma.trendwatcherRun.update({
                where: { id: twRun.id },
                data: { status: "canceled", failureReason: "Цикл остановлен", completedAt: new Date() },
              }).catch(() => {})
            },
          )
          const items = await getApifyResults(externalRunId)

          let imported = 0
          for (const item of items.slice(0, profile.maxItems)) {
            if (!isImportableApifyItem(item as Record<string, unknown>)) continue

            const data = mapApifyToTrend(item as Record<string, unknown>, {
              appId: profile.appId,
              keywords: profile.keywords,
              platforms: profile.platforms,
              language: profile.language,
              geo: profile.geo,
            })
            try {
              await prisma.trend.create({ data })
              imported++
            } catch { /* duplicate */ }
          }

          await prisma.trendwatcherRun.update({
            where: { id: twRun.id },
            data: {
              status: "completed",
              completedAt: new Date(),
              foundCount: items.length,
              importedCount: imported,
              skippedCount: items.length - imported,
            },
          })
          await prisma.trendwatcherProfile.update({
            where: { id: profile.id },
            data: { lastRunId: twRun.id, lastSuccessfulRunAt: new Date() },
          }).catch(() => {})

          trends = await prisma.trend.findMany({
            where: { appId, status: "new" },
            take: 5,
          })
        } catch (apifyErr: unknown) {
          // Остановка цикла — не «Apify не удалось»: пробрасываем наверх.
          if (isCancellation(apifyErr)) throw apifyErr
          const msg = apifyErr instanceof Error ? apifyErr.message : "Ошибка Apify"
          await prisma.trendwatcherRun.update({
            where: { id: twRun.id },
            data: { status: "failed", failureReason: msg, completedAt: new Date() },
          }).catch(() => {})
          await logAgent("orchestrator", "warn", `Apify не удалось: ${msg}`, undefined, cycleId)
        }
      }
    }

    counters.trendsFound = trends.length
    await prisma.productionCycle.update({
      where: { id: cycleId },
      data: { trendsFound: trends.length },
    })
    await logAgent("orchestrator", "info", `Шаг 1: ${trends.length} трендов`, { count: trends.length }, cycleId)
    return trends.length
  } catch (err: unknown) {
    if (isCancellation(err)) throw err
    const msg = err instanceof Error ? err.message : "Ошибка"
    await logAgent("orchestrator", "error", `Шаг 1 (тренды): ${msg}`, undefined, cycleId)
    return 0
  }
}

/**
 * Шаг 2: Генерация сценариев для трендов с insights.
 */
async function stepScenarios(
  cycleId: number,
  appId: number,
  // language читается ниже и обязан быть в типе: без него агенты пишут сценарий
  // по-английски даже у русскоязычного юнита.
  app: { name: string; description: string | null; keywords: string[]; language: string | null },
  signal: AbortSignal,
  counters: CycleCounters,
): Promise<number> {
  try {
    if (process.env.ENABLE_PAID_APIS !== "true") {
      await logAgent("orchestrator", "info", "Шаг 2: платные API отключены, пропуск генерации сценариев", undefined, cycleId)
      return 0
    }

    // Select trends that are in_work (claimed by this cycle) OR new (not yet claimed).
    // Guard: scenarios: { none: {} } prevents re-processing trends already handled by pipeline executor.
    const trendsWithInsights = await prisma.trend.findMany({
      where: {
        appId,
        status: { in: ["new", "in_work"] },
        isDeleted: false,
        OR: [
          { brief: { isNot: null } },
          { insights: { some: {} } },
        ],
        scenarios: { none: { isDeleted: false } },
      },
      include: { insights: true, brief: true },
      take: 5,
    })

    // Активная воронка юнита. Без неё генератор уходит в ветку «назови
    // приложение и скачай», хотя по ТЗ конверсия идёт через кодовое слово в
    // директ (docs/PROJECT_CONTEXT.md §9). Резолвер и формат те же, что у
    // сценарной ноды конвейера, ручной генерации и пути из идеи — иначе цикл
    // из админки был бы четвёртым входом со своим поведением.
    // Юнит на весь шаг один, поэтому резолвим до цикла по трендам; при пустом
    // списке трендов лишний запрос в БД не делаем.
    let funnel: ScenarioFunnelPayload | null = null
    if (trendsWithInsights.length > 0) {
      const funnelResolution = await resolveScenarioFunnel(appId)
      funnel = funnelResolution.funnel
      if (funnelResolution.warning) {
        await logAgent("orchestrator", "warn", funnelResolution.warning, undefined, cycleId).catch(() => {})
      }
      if (!funnel) {
        await logAgent(
          "orchestrator", "warn",
          `У юнита ${appId} нет активной воронки — CTA будет про приложение, а не про кодовое слово в директ.`,
          undefined, cycleId,
        ).catch(() => {})
      }
    }

    let count = 0

    for (const trend of trendsWithInsights) {
      try {
        // Каждая итерация — платный вызов агентов, поэтому проверяем стоп
        // перед ней, а не раз на весь шаг.
        throwIfAborted(signal)

        const generated = await generateScenarios(
          {
            title: trend.title,
            description: trend.description,
            platform: trend.platform,
            hashtags: trend.hashtags,
            viewCount: trend.viewCount,
            insights: trend.insights.map((i) => ({
              whyViral: i.whyViral,
              patterns: i.patterns,
              hooks: i.hooks,
              audience: i.audience,
            })),
            brief: trend.brief
              ? {
                  hookAnalysis: trend.brief.hookAnalysis as any,
                  sceneStructure: trend.brief.sceneStructure as any,
                  visualStyle: trend.brief.visualStyle as any,
                  viralityReasons: trend.brief.viralityReasons as any,
                  summary: trend.brief.summary,
                }
              : null,
          },
          // language обязателен: иначе агенты пишут сценарий по-английски.
          // funnel передаём всегда, даже null: генератор различает «воронки
          // нет» и «поле забыли» — во втором случае он уходит в CTA про
          // установку приложения.
          {
            name: app.name,
            description: app.description,
            keywords: app.keywords,
            language: app.language,
            funnel,
          },
        )

        // Создаём сценарий с вариантами
        const scenario = await prisma.scenario.create({
          data: {
            trendId: trend.id,
            briefId: trend.brief?.id ?? null,
            appId,
            status: 'generated',
            generationStatus: 'completed',
          },
        })

        for (let i = 0; i < generated.length; i++) {
          const v = generated[i]!
          await prisma.scenarioVariant.create({
            data: {
              scenarioId: scenario.id,
              variantIndex: i,
              title: v.title,
              hook: v.hook,
              body: v.body,
              cta: v.cta,
              fullScript: v.fullScript,
              visualStyleText: v.visualStyleText,
              visualStyleStructured: v.visualStyleStructured as any,
              storyPlan: v.storyPlan as any,
              toneProfile: v.toneProfile,
              rationale: v.rationale,
              promptVersion: '2.0.0',
            },
          })
        }

        // Получаем первый вариант — но НЕ ставим selectedVariantId сразу,
        // иначе critic'у нечего auto-select'ить (он проверяет null).
        const firstVariant = await prisma.scenarioVariant.findFirst({
          where: { scenarioId: scenario.id, status: 'draft' },
          orderBy: { variantIndex: 'asc' },
        })

        // Quality Critic loop (gated by SCENARIO_CRITIC_ENABLED).
        // Critic сам выставит selectedVariantId=bestVariantId если он null.
        try {
          const { runQualityCriticForScenario } = await import('~~/server/utils/scenario-critic-orchestrator')
          await runQualityCriticForScenario(scenario.id)
        } catch (criticErr) {
          if (isCancellation(criticErr)) throw criticErr
          await logAgent('orchestrator', 'warn', `Critic для сценария #${scenario.id}: ${criticErr instanceof Error ? criticErr.message : 'ошибка'}`, undefined, cycleId)
        }

        // Fallback: если critic skipped/failed/AI-down — ставим первый variant.
        // Statuses + scenario.status='selected' выставляем после critic'а независимо от того,
        // выбрал ли critic свой best (мы помечаем выбранный variant как accepted и scenario как selected).
        if (firstVariant) {
          const updated = await prisma.scenario.findUnique({
            where: { id: scenario.id },
            select: { selectedVariantId: true },
          })
          const finalVariantId = updated?.selectedVariantId ?? firstVariant.id
          await prisma.scenarioVariant.update({
            where: { id: finalVariantId },
            data: { status: 'accepted' },
          })
          await prisma.scenario.update({
            where: { id: scenario.id },
            data: { status: 'selected', selectedVariantId: finalVariantId },
          })
        }

        count += generated.length
        counters.scenariosGen = count
      } catch (genErr: unknown) {
        // Остановка не должна выглядеть как неудачная генерация одного тренда:
        // иначе цикл спокойно пошёл бы к следующему платному вызову.
        if (isCancellation(genErr)) throw genErr
        const msg = genErr instanceof Error ? genErr.message : "Ошибка генерации"
        await logAgent("orchestrator", "warn", `Сценарии для тренда #${trend.id}: ${msg}`, undefined, cycleId)
      }
    }

    await prisma.productionCycle.update({
      where: { id: cycleId },
      data: { scenariosGen: count },
    })
    await logAgent("orchestrator", "info", `Шаг 2: ${count} сценариев`, { count }, cycleId)
    return count
  } catch (err: unknown) {
    if (isCancellation(err)) throw err
    const msg = err instanceof Error ? err.message : "Ошибка"
    await logAgent("orchestrator", "error", `Шаг 2 (сценарии): ${msg}`, undefined, cycleId)
    return 0
  }
}

/**
 * Шаг 3: Генерация видео для selected-сценариев.
 */
async function stepVideos(
  cycleId: number,
  appId: number,
  signal: AbortSignal,
  counters: CycleCounters,
): Promise<number> {
  try {
    // Guard: skip scenarios that already have ANY video (prevents duplicates on retry/overlap)
    const scenarios = await prisma.scenario.findMany({
      where: {
        status: "selected",
        isDeleted: false,
        trend: { appId, isDeleted: false },
        videos: { none: {} },
      },
      take: 5,
    })

    if (scenarios.length === 0) {
      await logAgent("orchestrator", "info", "Шаг 3: нет сценариев для видео", undefined, cycleId)
      return 0
    }

    const videoPromises: Promise<void>[] = []
    const startedVideoIds: number[] = []

    // Каскад отмены: при остановке цикла гасим уже запущенные генерации.
    // Без этого fal/Replicate дорабатывали заказ до конца (деньги), а ролики
    // навсегда оставались в generating_* — «внешняя операция без учёта».
    const onAbort = () => {
      for (const videoId of startedVideoIds) {
        void Promise.resolve()
          .then(() => cancelVideoPipeline(videoId))
          .catch(() => {})
      }
    }
    signal.addEventListener("abort", onAbort, { once: true })

    try {
      for (const scenario of scenarios) {
        throwIfAborted(signal)
        const video = await prisma.video.create({
          // Маршрут фиксируется на ролике при создании, а не глобальным флагом
          // на каждом шаге (см. resolveEditPipelineFlag).
          data: { scenarioId: scenario.id, editPipeline: resolveEditPipelineFlag(process.env) },
        })
        startedVideoIds.push(video.id)
        // Пайплайн сам проверяет signal между шагами и не тратит деньги дальше.
        videoPromises.push(runVideoPipeline(video.id, { signal }))
      }

      // Ждем все с таймаутом
      const timeoutTimer: { id?: ReturnType<typeof setTimeout> } = {}
      const timeout = new Promise<never>((_, reject) => {
        timeoutTimer.id = setTimeout(() => reject(new Error("Video pipeline timeout")), VIDEO_TIMEOUT_MS)
      })
      timeout.catch(() => {})

      try {
        await raceWithAbort(
          Promise.race([Promise.allSettled(videoPromises), timeout]),
          signal,
          // onAbort уже повешен на сигнал — здесь только ждём, пока отмены
          // долетят до провайдеров, и не блокируем финализацию цикла.
          async () => {},
        )
      } catch (waitErr) {
        if (isCancellation(waitErr)) throw waitErr
        // Таймаут шага — не повод валить цикл, поведение как было.
      } finally {
        if (timeoutTimer.id) clearTimeout(timeoutTimer.id)
      }
    } finally {
      signal.removeEventListener("abort", onAbort)
    }

    const completedVideos = await prisma.video.count({
      where: {
        status: "completed",
        scenario: { trend: { appId } },
      },
    })

    counters.videosGen = completedVideos
    await prisma.productionCycle.update({
      where: { id: cycleId },
      data: { videosGen: completedVideos },
    })
    await logAgent("orchestrator", "info", `Шаг 3: ${completedVideos} видео`, { count: completedVideos }, cycleId)
    return completedVideos
  } catch (err: unknown) {
    if (isCancellation(err)) throw err
    const msg = err instanceof Error ? err.message : "Ошибка"
    await logAgent("orchestrator", "error", `Шаг 3 (видео): ${msg}`, undefined, cycleId)
    return 0
  }
}

/**
 * Шаг 4: Создание загрузок для completed видео.
 */
async function stepUploads(
  cycleId: number,
  appId: number,
  groupId: number | null,
  accountGroup: { members: Array<{ socialAccountId: number }> } | null,
  signal: AbortSignal,
  counters: CycleCounters,
): Promise<number> {
  try {
    const videos = await prisma.video.findMany({
      where: {
        status: "completed",
        scenario: { trend: { appId }, isDeleted: false },
        uploads: { none: { status: "published" } },
      },
      include: {
        scenario: {
          include: {
            trend: true,
            // Грузим ВСЕ варианты: подпись к публикации должна браться из того
            // же варианта, из которого собран ролик, а не из «первого
            // accepted» — при выборе оператора это разные варианты.
            variants: { orderBy: { variantIndex: 'asc' as const } },
          },
        },
      },
    })

    if (videos.length === 0 || !accountGroup?.members.length) {
      await logAgent("orchestrator", "info", "Шаг 4: нет видео для загрузки или нет аккаунтов", undefined, cycleId)
      return 0
    }

    let count = 0

    for (const video of videos) {
      // Тот же порядок, что в ноде загрузки (pipeline-executors, executeUploadNode):
      // сначала жёсткая привязка Video.variantId — что реально сняли; затем общее
      // правило selectScenarioVariantForVideo, которое уважает выбор оператора
      // через Scenario.selectedVariantId. Второй шаг нужен для legacy-роликов
      // этого пути: у них variantId пуст, и привязываться не к чему.
      const variant = (video.variantId
        ? video.scenario.variants.find(v => v.id === video.variantId)
        : undefined)
        ?? selectScenarioVariantForVideo(
          video.scenario.variants,
          video.scenario.selectedVariantId,
        )?.variant
      if (!variant) continue

      for (const member of accountGroup.members) {
        // Публикация необратима, поэтому стоп проверяем перед каждой заливкой.
        throwIfAborted(signal)

        const idempotencyKey = `cycle-${cycleId}-v${video.id}-a${member.socialAccountId}`

        const existing = await prisma.upload.findUnique({
          where: { idempotencyKey },
        })
        if (existing) continue

        const upload = await prisma.upload.create({
          data: {
            videoId: video.id,
            socialAccountId: member.socialAccountId,
            title: variant.title,
            description: variant.hook,
            // Scene-driven Scenario может иметь trend=null (shadow), тогда хэштеги пусты.
            hashtags: video.scenario.trend?.hashtags?.slice(0, 10) ?? [],
            idempotencyKey,
            status: "pending",
          },
        })

        runUploadPipeline(upload.id).catch(() => {})
        count++
        counters.uploadsCount = count
      }
    }

    await prisma.productionCycle.update({
      where: { id: cycleId },
      data: { uploadsCount: count },
    })
    await logAgent("orchestrator", "info", `Шаг 4: ${count} загрузок`, { count }, cycleId)
    return count
  } catch (err: unknown) {
    if (isCancellation(err)) throw err
    const msg = err instanceof Error ? err.message : "Ошибка"
    await logAgent("orchestrator", "error", `Шаг 4 (загрузки): ${msg}`, undefined, cycleId)
    return 0
  }
}
