/**
 * Оркестратор производственного цикла.
 * 4 шага: тренды -> сценарии -> видео -> загрузки.
 * Вызывает реальные пайплайны с try/catch на каждом шаге.
 */

import { sendTelegramAlert } from "./telegram/alerts"

const VIDEO_TIMEOUT_MS = 10 * 60 * 1000

/**
 * Запускает полный цикл производства.
 * Fire-and-forget: обновляет статусы и логирует каждый шаг.
 */
export async function startCycle(cycleId: number): Promise<void> {
  let trendsFound = 0
  let scenariosGen = 0
  let videosGen = 0
  let uploadsCount = 0

  try {
    const cycle = await prisma.productionCycle.findUnique({
      where: { id: cycleId },
      include: { app: true, accountGroup: { include: { members: true } } },
    })

    if (!cycle) {
      await logAgent("orchestrator", "error", `Цикл #${cycleId} не найден`)
      return
    }

    await prisma.productionCycle.update({
      where: { id: cycleId },
      data: { status: "running" },
    })
    await logAgent("orchestrator", "info", "Цикл запущен", { cycleId, appId: cycle.appId }, cycleId)
    await sendTelegramAlert("cycle_started", `Цикл #${cycleId} запущен для "${cycle.app.name}"`)

    // Шаг 1: Тренды
    trendsFound = await stepTrends(cycleId, cycle.appId)

    // Шаг 2: Сценарии
    scenariosGen = await stepScenarios(cycleId, cycle.appId, cycle.app)

    // Шаг 3: Видео
    videosGen = await stepVideos(cycleId, cycle.appId)

    // Шаг 4: Загрузки
    uploadsCount = await stepUploads(cycleId, cycle.appId, cycle.groupId, cycle.accountGroup)

    await prisma.productionCycle.update({
      where: { id: cycleId },
      data: {
        status: "completed",
        completedAt: new Date(),
        trendsFound,
        scenariosGen,
        videosGen,
        uploadsCount,
      },
    })
    await logAgent(
      "orchestrator", "info", "Цикл завершен успешно",
      { trendsFound, scenariosGen, videosGen, uploadsCount }, cycleId,
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Неизвестная ошибка"
    await prisma.productionCycle.update({
      where: { id: cycleId },
      data: {
        status: "failed",
        errorMessage: message,
        completedAt: new Date(),
        trendsFound,
        scenariosGen,
        videosGen,
        uploadsCount,
      },
    }).catch(() => {})

    await logAgent("orchestrator", "error", `Цикл #${cycleId} упал: ${message}`, { error: message }, cycleId)
    await sendTelegramAlert("critical_error", `Цикл #${cycleId} завершился с ошибкой`, message)
  }
}

/**
 * Шаг 1: Получение трендов. Если нет новых -- пробует Apify.
 */
async function stepTrends(cycleId: number, appId: number): Promise<number> {
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
          const externalRunId = await runApifyActor(profile.actorId, { keywords: profile.keywords, maxItems: profile.maxItems, contentFormat: profile.contentFormat as "reels" | "posts" | null })
          await prisma.trendwatcherRun.update({
            where: { id: twRun.id },
            data: { externalRunId, status: "running" },
          })
          await waitForApifyRun(externalRunId)
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
          const msg = apifyErr instanceof Error ? apifyErr.message : "Ошибка Apify"
          await prisma.trendwatcherRun.update({
            where: { id: twRun.id },
            data: { status: "failed", failureReason: msg, completedAt: new Date() },
          }).catch(() => {})
          await logAgent("orchestrator", "warn", `Apify не удалось: ${msg}`, undefined, cycleId)
        }
      }
    }

    await prisma.productionCycle.update({
      where: { id: cycleId },
      data: { trendsFound: trends.length },
    })
    await logAgent("orchestrator", "info", `Шаг 1: ${trends.length} трендов`, { count: trends.length }, cycleId)
    return trends.length
  } catch (err: unknown) {
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
  app: { name: string; description: string | null; keywords: string[] },
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

    let count = 0

    for (const trend of trendsWithInsights) {
      try {
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
          { name: app.name, description: app.description, keywords: app.keywords, language: app.language },
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
      } catch (genErr: unknown) {
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
    const msg = err instanceof Error ? err.message : "Ошибка"
    await logAgent("orchestrator", "error", `Шаг 2 (сценарии): ${msg}`, undefined, cycleId)
    return 0
  }
}

/**
 * Шаг 3: Генерация видео для selected-сценариев.
 */
async function stepVideos(cycleId: number, appId: number): Promise<number> {
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

    for (const scenario of scenarios) {
      const video = await prisma.video.create({
        data: { scenarioId: scenario.id },
      })
      videoPromises.push(runVideoPipeline(video.id))
    }

    // Ждем все с таймаутом
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Video pipeline timeout")), VIDEO_TIMEOUT_MS),
    )

    await Promise.race([
      Promise.allSettled(videoPromises),
      timeout,
    ]).catch(() => {})

    const completedVideos = await prisma.video.count({
      where: {
        status: "completed",
        scenario: { trend: { appId } },
      },
    })

    await prisma.productionCycle.update({
      where: { id: cycleId },
      data: { videosGen: completedVideos },
    })
    await logAgent("orchestrator", "info", `Шаг 3: ${completedVideos} видео`, { count: completedVideos }, cycleId)
    return completedVideos
  } catch (err: unknown) {
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
            variants: {
              where: { status: 'accepted' },
              take: 1,
            },
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
      const acceptedVariant = video.scenario.variants[0]
      if (!acceptedVariant) continue

      for (const member of accountGroup.members) {
        const idempotencyKey = `cycle-${cycleId}-v${video.id}-a${member.socialAccountId}`

        const existing = await prisma.upload.findUnique({
          where: { idempotencyKey },
        })
        if (existing) continue

        const upload = await prisma.upload.create({
          data: {
            videoId: video.id,
            socialAccountId: member.socialAccountId,
            title: acceptedVariant.title,
            description: acceptedVariant.hook,
            // Scene-driven Scenario может иметь trend=null (shadow), тогда хэштеги пусты.
            hashtags: video.scenario.trend?.hashtags?.slice(0, 10) ?? [],
            idempotencyKey,
            status: "pending",
          },
        })

        runUploadPipeline(upload.id).catch(() => {})
        count++
      }
    }

    await prisma.productionCycle.update({
      where: { id: cycleId },
      data: { uploadsCount: count },
    })
    await logAgent("orchestrator", "info", `Шаг 4: ${count} загрузок`, { count }, cycleId)
    return count
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Ошибка"
    await logAgent("orchestrator", "error", `Шаг 4 (загрузки): ${msg}`, undefined, cycleId)
    return 0
  }
}
