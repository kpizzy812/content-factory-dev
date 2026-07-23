/**
 * Исполнители нод конвейера.
 * Каждая функция вызывает реальные утилиты проекта.
 *
 * No-data контракт (единый для всех domain нод):
 *   - В output возвращается `{ _noData: true, _domainStatus: 'no_data', _noDataReason: string }`,
 *     когда executor технически отработал, но не произвёл полезных данных.
 *   - Downstream нода наследует _noData через `propagateNoData(input, overrideReason?)`.
 *   - Engine использует это чтобы поставить step status = 'no_data' и run.status = 'no_data'.
 *   - Notification executor по умолчанию блокирует отправку при _noData (skipOnNoData).
 */

import { throwIfAborted, cancellableDelay, CancellationError } from './pipeline-cancel-registry'
import { detectUpstreamNoData, getUpstreamNoDataReason } from './pipeline-passthrough'
// PR5: статические импорты постинг-утилит. Реального цикла импортов нет
// (job-service/one-to-one-guard/instagram-snapshot-validator не импортируют
// pipeline-executors), поэтому lazy `await import` не требуется. vi.mock в
// юнит-тестах хойстится и перехватывает статические импорты так же, как lazy.
import { createPostingJob, defaultMaxAttemptsForMethod } from './posting/job-service'
import { assertOneToOneForBrowserAutomation } from './accounts/one-to-one-guard'
import {
  validateInstagramSnapshot,
  InstagramSnapshotValidationError,
} from './posting/instagram-snapshot-validator'
import { readFactoryContext } from './content-factory-batch'
import { linkFactoryPublication } from './factory-publication'

// Re-export для backward compatibility (call-sites вне этого файла могут
// импортировать detectUpstreamNoData/getUpstreamNoDataReason из './pipeline-executors').
export { detectUpstreamNoData, getUpstreamNoDataReason }

/**
 * Собирает no-data payload для downstream ноды.
 * Если upstream ничего не дал — возвращает объект с _noData=true + overrideReason;
 * иначе — пустой объект (spread в return ничего не добавит).
 */
export function propagateNoData(
  input: Record<string, unknown>,
  overrideReason?: string,
): Record<string, unknown> {
  if (!detectUpstreamNoData(input)) return {}
  const reason = overrideReason ?? getUpstreamNoDataReason(input) ?? 'Нет данных от предыдущего блока'
  return { _noData: true, _noDataReason: reason, _domainStatus: 'no_data' }
}

/**
 * Вытягивает список предшествующих шагов, output которых имеет `_noData: true`,
 * для заданного runId. Используется notification executor-ом, чтобы перечислить
 * источники «нет данных» в теле сообщения.
 */
export async function collectNoDataSourcesFromRun(runId: number): Promise<Array<{ nodeName: string; nodeType: string; reason: string }>> {
  const steps = await prisma.workflowStep.findMany({
    where: { runId },
    select: { nodeName: true, nodeType: true, output: true, finishedAt: true, startedAt: true },
    orderBy: { startedAt: 'asc' },
  })
  const result: Array<{ nodeName: string; nodeType: string; reason: string }> = []
  for (const s of steps) {
    const out = s.output as Record<string, unknown> | null
    if (out?._noData === true) {
      const reason = typeof out._noDataReason === 'string' ? out._noDataReason : 'нет данных'
      result.push({ nodeName: s.nodeName, nodeType: s.nodeType, reason })
    }
  }
  return result
}

const VALID_PLATFORMS_SET = new Set(['tiktok', 'instagram', 'youtube'])
const DEFAULT_ACTOR_ID = 'clockworks/tiktok-scraper'

// Маппинг устаревших / никогда не публиковавшихся в Apify Store actor-id на рабочие.
// Inline-конфиги пайплайнов живут в graphData (JSON) и миграцией БД не обновляются,
// поэтому санитизируем на входе в executor.
const DEPRECATED_ACTOR_MAP: Record<string, string> = {
  'apify/tiktok-scraper': 'clockworks/tiktok-scraper',
  'apify/youtube-scraper': 'streamers/youtube-scraper',
}

function sanitizeActorId(raw: string): string {
  return DEPRECATED_ACTOR_MAP[raw] ?? raw
}

/**
 * Разрешение TrendwatcherProfile для pipeline executor.
 *
 * Режимы:
 *  - linked: взять сохранённый профиль по config.profileId, проверить enabled и appId
 *  - inline: создать / переиспользовать inline-профиль (isInline=true) привязанный к ноде.
 *    При saveAsProfile=true ищем профиль по sourceNodeId и обновляем его;
 *    если saveAsProfile становится true — помечаем isInline=false (превращение в переиспользуемый).
 *  - legacy: поведение старой ноды — первый enabled профиль для appId.
 */
async function resolveTrendwatcherProfile(opts: {
  profileMode: string
  explicitProfileId?: number
  appId?: number
  config: Record<string, unknown>
  pipelineId?: number
  nodeCanvasId?: string
}): Promise<{
  id: number
  appId: number
  keywords: string[]
  platforms: string[]
  enabled: boolean
  actorId: string
  maxItems: number
} | null> {
  const { profileMode, explicitProfileId, appId, config, pipelineId, nodeCanvasId } = opts

  if (profileMode === 'linked' && explicitProfileId) {
    const found = await prisma.trendwatcherProfile.findUnique({ where: { id: explicitProfileId } })
    if (!found || !found.enabled) return null
    if (appId && found.appId !== appId) return null
    return { ...found, actorId: sanitizeActorId(found.actorId) }
  }

  if (profileMode === 'inline') {
    const inlineAppId = appId ?? (Number(config.appId) || 0)
    if (!inlineAppId) return null

    const platforms = Array.isArray(config.platforms)
      ? (config.platforms as string[]).filter(p => VALID_PLATFORMS_SET.has(p))
      : []
    if (platforms.length === 0) return null

    const keywords = Array.isArray(config.keywords)
      ? (config.keywords as unknown[])
        .filter((k): k is string => typeof k === 'string')
        .map(k => k.trim())
        .filter(k => k.length > 0)
      : []
    if (keywords.length === 0) return null

    const actorIdRaw = typeof config.actorId === 'string' && config.actorId.trim().length > 0
      ? config.actorId.trim()
      : DEFAULT_ACTOR_ID
    const actorId = sanitizeActorId(actorIdRaw)
    const language = typeof config.language === 'string' ? config.language.trim() || null : null
    const geo = typeof config.geo === 'string' ? config.geo.trim() || null : null
    const viewCountMin = typeof config.viewCountMin === 'number' ? config.viewCountMin : null
    const viewCountMax = typeof config.viewCountMax === 'number' ? config.viewCountMax : null
    const maxItems = typeof config.maxItems === 'number' && config.maxItems > 0
      ? Math.min(100, Math.max(1, Math.round(config.maxItems)))
      : 20
    const saveAsProfile = config.saveAsProfile === true
    const rawName = typeof config.inlineName === 'string' ? config.inlineName.trim() : ''
    const profileName = rawName.length > 0
      ? rawName
      : `[pipeline-inline] ${nodeCanvasId ?? 'node'}`

    // Ищем существующий inline профиль ноды
    const existing = nodeCanvasId
      ? await prisma.trendwatcherProfile.findFirst({
        where: {
          sourceNodeId: nodeCanvasId,
          ...(pipelineId ? { sourcePipelineId: pipelineId } : {}),
          appId: inlineAppId,
        },
      })
      : null

    const dataCommon = {
      appId: inlineAppId,
      actorId,
      keywords,
      platforms: platforms as Array<'tiktok' | 'instagram' | 'youtube'>,
      language,
      geo,
      viewCountMin,
      viewCountMax,
      maxItems,
      enabled: true,
      isInline: !saveAsProfile,
      sourceNodeId: nodeCanvasId ?? null,
      sourcePipelineId: pipelineId ?? null,
    }

    if (existing) {
      return prisma.trendwatcherProfile.update({
        where: { id: existing.id },
        data: {
          ...dataCommon,
          name: saveAsProfile ? profileName : existing.name,
        },
      })
    }

    return prisma.trendwatcherProfile.create({
      data: { ...dataCommon, name: profileName },
    })
  }

  // legacy fallback — первый enabled профиль для appId
  const where: Record<string, unknown> = { enabled: true, isInline: false }
  if (appId) where.appId = appId
  return prisma.trendwatcherProfile.findFirst({
    where,
    orderBy: { updatedAt: 'desc' },
  })
}

export async function executeTrendwatcherNode(
  config: Record<string, unknown>,
  _input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const appId = Number(config.appId) || undefined
  const triggerType = String(_input._triggerType ?? 'manual')
  const profileMode = String(config.profileMode ?? 'linked')
  const explicitProfileId = Number(config.profileId) || undefined
  const pipelineId = Number(_input._pipelineId) || undefined
  const nodeCanvasId = typeof _input._nodeCanvasId === 'string' ? _input._nodeCanvasId : undefined

  // Retry policy для пустых результатов (актуально для scheduled runs)
  const configuredRetryCount = Math.max(0, Math.min(Number(config.emptyRetryCount) || 2, 3))
  const emptyRetryCount = triggerType === 'schedule' ? configuredRetryCount : 0
  const emptyRetryDelaySec = Math.max(5, Math.min(Number(config.emptyRetryDelay) || 30, 300))

  // ─── Разрешаем профиль: linked / inline / legacy fallback ───
  let profile = await resolveTrendwatcherProfile({
    profileMode,
    explicitProfileId,
    appId,
    config,
    pipelineId,
    nodeCanvasId,
  })

  if (!profile) {
    const reason = profileMode === 'linked'
      ? 'Выбран режим "Профиль", но профиль не найден или отключён'
      : profileMode === 'inline'
        ? 'Не удалось собрать inline-конфиг: проверьте приложение, keywords и платформы'
        : 'Нет активного профиля Трендвотчера для этого приложения'
    return {
      trends: [],
      _noData: true,
      _noDataReason: reason,
      _domainStatus: 'no_data',
      warning: reason,
      importedCount: 0,
      skippedCount: 0,
    }
  }

  let lastRunId: number | null = null
  let lastImportedCount = 0
  let lastSkippedCount = 0
  let lastDedupSkipCount = 0
  let lastViewCountSkipCount = 0
  let lastWarningCount = 0
  let lastFoundCount = 0
  let trends: unknown[] = []
  let attemptsMade = 0

  for (let attempt = 0; attempt <= emptyRetryCount; attempt++) {
    throwIfAborted(signal)
    attemptsMade = attempt + 1

    if (attempt > 0) {
      // Ждём перед retry — прерываемый delay
      await cancellableDelay(emptyRetryDelaySec * 1000, signal)
    }

    // Фиксируем время ДО запуска — потом заберём только новые тренды
    const beforeRun = new Date()

    // Создаём запись запуска
    const run = await prisma.trendwatcherRun.create({
      data: {
        profileId: profile.id,
        triggerType: 'pipeline',
        status: 'pending',
        initiatedBy: attempt > 0 ? `pipeline_retry_${attempt}` : 'pipeline',
      },
    })
    lastRunId = run.id

    // Запускаем реальный поиск через Apify и ЖДЁМ завершения.
    // Пробрасываем workflow runId/pipelineId — trendwatcher-runner проставит их
    // на созданных Trend, чтобы фильтр «К юниту» работал сквозь trendwatcher-run.
    const workflowRunId = Number(_input._runId) || undefined
    await executeTrendwatcherRun({
      runId: run.id,
      profileId: profile.id,
      workflowRunId,
      workflowPipelineId: pipelineId,
    })

    // Проверяем статус запуска
    const completedRun = await prisma.trendwatcherRun.findUnique({
      where: { id: run.id },
    })

    if (completedRun?.status === 'failed') {
      throw new Error(`Поиск трендов не удался: ${completedRun.errorSummary || completedRun.failureReason || 'неизвестная ошибка'}`)
    }

    lastImportedCount = completedRun?.importedCount ?? 0
    lastSkippedCount = completedRun?.skippedCount ?? 0
    lastDedupSkipCount = completedRun?.dedupSkipCount ?? 0
    lastViewCountSkipCount = completedRun?.viewCountSkipCount ?? 0
    lastWarningCount = completedRun?.warningCount ?? 0
    lastFoundCount = completedRun?.foundCount ?? 0

    // Забираем только тренды, импортированные ЭТИМ запуском (по времени)
    const trendWhere: Record<string, unknown> = {
      importedAt: { gte: beforeRun },
      isDeleted: false,
    }
    if (appId) trendWhere.appId = appId

    trends = await prisma.trend.findMany({
      where: trendWhere,
      orderBy: { importedAt: 'desc' },
      include: { insights: true, brief: true },
    })

    // Если нашли тренды — выходим из цикла retry
    if (trends.length > 0) break

    // Если retry исчерпаны — логируем
    if (attempt < emptyRetryCount) {
      await logAgent('trendwatcher-node', 'info', `Попытка ${attempt + 1}: trends=[] (imported=${lastImportedCount}, skipped=${lastSkippedCount}). Retry через ${emptyRetryDelaySec}с...`).catch(() => {})
    }
  }

  // Помечаем как in_work
  if (trends.length > 0) {
    const trendIds = trends.map((t: any) => t.id)
    await prisma.trend.updateMany({
      where: { id: { in: trendIds } },
      data: { status: 'in_work' },
    })
  }

  // No-data сигнализация — честная разбивка по причинам, без ложного «дубликаты».
  const isNoData = trends.length === 0 && lastImportedCount === 0
  let noDataReason: string | undefined
  if (isNoData) {
    if (lastFoundCount === 0) {
      noDataReason = `Источник не вернул элементов за ${attemptsMade} попытк${attemptsMade === 1 ? 'у' : 'и'}.`
    } else {
      const parts: string[] = []
      if (lastDedupSkipCount > 0) parts.push(`${lastDedupSkipCount} дубликат(ов)`)
      if (lastViewCountSkipCount > 0) parts.push(`${lastViewCountSkipCount} отфильтровано по viewCount`)
      if (lastWarningCount > 0) parts.push(`${lastWarningCount} ошибок импорта (см. логи запуска)`)
      const breakdown = parts.length > 0 ? parts.join(', ') : `${lastSkippedCount} пропущено`
      noDataReason = `Найдено ${lastFoundCount}, импортировано 0: ${breakdown}.`
    }
  }

  return {
    trends,
    runId: lastRunId,
    importedCount: lastImportedCount,
    skippedCount: lastSkippedCount,
    // No-data signals для engine и notification
    ...(isNoData ? {
      _noData: true,
      _noDataReason: noDataReason,
      _domainStatus: 'no_data',
    } : {}),
    // Retry info для audit
    _retryAttempts: attemptsMade,
    _retryPolicy: emptyRetryCount > 0 ? { maxRetries: emptyRetryCount, delaySec: emptyRetryDelaySec } : undefined,
  }
}

export async function executeScenarioNode(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const trendInputs = (input.trends ?? []) as Array<{
    id: number
    hypothesisId?: string
    title: string
    description?: string | null
    platform: string
    hashtags: string[]
    viewCount: number
    isDeleted?: boolean
    insights: Array<{
      whyViral: string
      patterns: string[]
      hooks: string[]
      audience?: string | null
    }>
    brief?: {
      hookAnalysis: unknown
      sceneStructure: unknown
      visualStyle: unknown
      viralityReasons: unknown
      summary: string
    } | null
  }>
  const hypotheses = (Array.isArray(input.hypotheses) ? input.hypotheses : []) as Array<{
    id: string
    title: string
    angle: string
    audience: string
    problem: string
    promise: string
    hook: string
    cta: string
    evidence?: { rationale?: string } | null
  }>
  const factoryPlatform = readFactoryContext(input)?.assignments[0]?.platform ?? 'instagram'
  const trends = trendInputs.length > 0
    ? trendInputs
    : hypotheses.map(hypothesis => ({
        id: 0,
        hypothesisId: hypothesis.id,
        title: hypothesis.title,
        description: `${hypothesis.angle}\nAudience: ${hypothesis.audience}\nProblem: ${hypothesis.problem}\nPromise: ${hypothesis.promise}\nCTA: ${hypothesis.cta}`,
        platform: factoryPlatform,
        hashtags: [] as string[],
        viewCount: 0,
        insights: [{
          whyViral: hypothesis.evidence?.rationale ?? hypothesis.angle,
          patterns: [hypothesis.angle],
          hooks: [hypothesis.hook],
          audience: hypothesis.audience,
        }],
        brief: null,
      }))
  // ── Scene-driven ветка ──
  // Если upstream — character / scene_composer (без trends), вызываем
  // runScenarioGenerationForScene вместо trend-pipeline. Этот путь не зависит
  // от trends/insights/brief и собирает shadow Scenario с осмысленным текстовым
  // hook (через scene-scripter agent), а не compiled visual prompt в hook.
  const upstreamCharacterRaw = input.character as
    | { id?: string; name?: string; description?: string | null; visualPrompt?: string | null; role?: string | null; referenceImages?: Array<{ fileUrl?: string; aiVisualDescription?: string | null }> }
    | null
    | undefined
  const upstreamSceneIdRaw = typeof input.sceneId === 'string' && input.sceneId ? input.sceneId : null
  const upstreamCompiledPromptRaw = typeof input.compiledPrompt === 'string' && input.compiledPrompt
    ? input.compiledPrompt
    : null
  const upstreamReferenceImagesRaw = Array.isArray(input.referenceImages)
    ? (input.referenceImages as unknown[]).filter(r => r && typeof r === 'object') as Array<Record<string, unknown>>
    : []
  const hasSceneInput = Boolean(
    upstreamCompiledPromptRaw && (upstreamSceneIdRaw || upstreamCharacterRaw?.id),
  )

  if (trends.length === 0 && hasSceneInput) {
    // Делегируем в scene-driven модуль. Trend-driven приоритетнее, поэтому эта
    // ветка работает только когда trends реально пусты.
    const { runScenarioGenerationForScene } = await import('~~/server/utils/scene-driven-scenario')

    // Resolve appId: либо из config, либо fallback на first app (как в trend-ветке).
    const appConfigForScene = config.app as Record<string, unknown> | undefined
    const appIdForSceneRaw = Number(appConfigForScene?.appId) || Number(config.appId)
    const appForScene = appIdForSceneRaw
      ? await prisma.app.findUnique({ where: { id: appIdForSceneRaw } })
      : await prisma.app.findFirst()
    if (!appForScene) {
      throw new Error('Приложение не найдено для scene-driven сценария')
    }

    const runIdForScene = Number(input._runId) || undefined
    const pipelineIdForScene = Number(input._pipelineId) || undefined

    // Идемпотентность для retry: ищем существующее Scenario с runId + sceneId.
    if (runIdForScene && upstreamSceneIdRaw) {
      const existing = await prisma.scenario.findFirst({
        where: {
          sceneId: upstreamSceneIdRaw,
          appId: appForScene.id,
          runId: runIdForScene,
          isDeleted: false,
        },
      })
      if (existing) {
        return {
          scenarios: [existing],
          trendsReceived: 0,
          trendsProcessed: 0,
          scenariosCreated: 0,
          variantsCreated: 0,
          skippedDuplicates: 1,
          _domainStatus: 'idempotent_reuse',
        }
      }
    }

    // Сборка referenceImages для AI vision контекста: scripter inject'ит
    // visualDescription'ы реф-фото в свой prompt.
    const refImages = upstreamReferenceImagesRaw
      .map((r) => ({
        source: typeof r.source === 'string' ? r.source : 'unknown',
        sourceId: typeof r.sourceId === 'string' ? r.sourceId : '',
        url: typeof r.url === 'string' ? r.url : '',
        kind: typeof r.kind === 'string' ? r.kind : undefined,
        aiVisualDescription: typeof r.aiVisualDescription === 'string' ? r.aiVisualDescription : null,
      }))
      .filter(r => r.url)

    const refUrls: string[] = Array.isArray(input.referenceImageUrls)
      ? (input.referenceImageUrls as unknown[]).filter(u => typeof u === 'string') as string[]
      : refImages.map(r => r.url)

    const characterContext = upstreamCharacterRaw?.id && upstreamCharacterRaw.name
      ? {
          id: upstreamCharacterRaw.id,
          name: upstreamCharacterRaw.name,
          description: upstreamCharacterRaw.description ?? null,
          visualPrompt: upstreamCharacterRaw.visualPrompt ?? null,
          role: upstreamCharacterRaw.role ?? null,
          referenceImages: (upstreamCharacterRaw.referenceImages ?? [])
            .filter(r => r && typeof r.fileUrl === 'string')
            .map(r => ({
              fileUrl: r.fileUrl as string,
              aiVisualDescription: r.aiVisualDescription ?? null,
            })),
        }
      : null

    const sceneNameRaw = typeof input.sceneName === 'string' && input.sceneName ? input.sceneName : null

    const sceneResult = await runScenarioGenerationForScene({
      appId: appForScene.id,
      sceneId: upstreamSceneIdRaw,
      sceneName: sceneNameRaw,
      character: characterContext,
      compiledPrompt: upstreamCompiledPromptRaw!,
      negativePrompt: typeof input.negativePrompt === 'string' ? input.negativePrompt : null,
      referenceImageUrls: refUrls,
      referenceImages: refImages,
      runId: runIdForScene,
      pipelineId: pipelineIdForScene,
      operatorNotes: `[pipeline scene-driven] Сцена: ${sceneNameRaw ?? upstreamSceneIdRaw ?? '(без id)'}, персонаж: ${characterContext?.name ?? '—'}`,
    })

    const scenarioRecord = await prisma.scenario.findUnique({ where: { id: sceneResult.scenarioId } })

    return {
      scenarios: scenarioRecord ? [scenarioRecord] : [],
      trendsReceived: 0,
      trendsProcessed: 0,
      scenariosCreated: 1,
      variantsCreated: sceneResult.variantsCreated,
      skippedDuplicates: 0,
      _domainStatus: 'scene_driven',
    }
  }

  if (trends.length === 0) {
    const upstreamNoData = detectUpstreamNoData(input)
    const reason = upstreamNoData
      ? `Нет трендов (upstream: ${getUpstreamNoDataReason(input) ?? 'нет данных от Trendwatcher'})`
      : 'Нет трендов на входе'
    return {
      scenarios: [],
      skipped: true,
      reason,
      trendsReceived: 0,
      trendsProcessed: 0,
      scenariosCreated: 0,
      variantsCreated: 0,
      skippedDuplicates: 0,
      _noData: true,
      _noDataReason: reason,
      _domainStatus: 'no_data',
    }
  }

  // Resolve app from nested config or legacy flat field
  const appConfig = config.app as Record<string, unknown> | undefined
  const appId = Number(appConfig?.appId) || Number(config.appId) || Number(input.appId) || undefined
  const variantsCount = Number(config.variantsCount) || 3

  // Pipeline-level subtitle style: один стиль на весь контейнер. При первой генерации
  // забираем из storyPlan.subtitleStyle и сохраняем в Pipeline. Все последующие сценарии
  // (любых трендов в этом pipeline) получают этот же стиль — единый visual brand.
  const pipelineIdForStyle = typeof input._pipelineId === 'number' ? input._pipelineId : undefined
  let pipelineSubtitleStyle: Record<string, unknown> | null = null
  if (pipelineIdForStyle) {
    const p = await prisma.pipeline.findUnique({
      where: { id: pipelineIdForStyle },
      select: { subtitleStyle: true },
    })
    pipelineSubtitleStyle = (p?.subtitleStyle as Record<string, unknown> | null) ?? null
  }
  // Жёсткий минимум 1 тренд. Unlimited режим (старое значение 0) убран — каждый
  // тренд = +N вариантов сценария = серьёзный расход AI-токенов. Если нужно больше
  // одного — пользователь явно выставляет число; legacy конфиги с 0 трактуем как 1.
  const maxTrendsRaw = Number(config.maxTrends)
  const maxTrends = Number.isFinite(maxTrendsRaw) && maxTrendsRaw >= 1
    ? Math.min(50, Math.floor(maxTrendsRaw))
    : 1
  const app = appId
    ? await prisma.app.findUnique({ where: { id: appId } })
    : await prisma.app.findFirst()

  if (!app) {
    throw new Error('Приложение не найдено для генерации сценариев')
  }

  // Build profileSettings from nested storytelling/subtitles/voiceover config
  const storytelling = config.storytelling as Record<string, unknown> | undefined
  const subtitles = config.subtitles as Record<string, unknown> | undefined
  const voiceover = config.voiceover as Record<string, unknown> | undefined

  const profileSettings = storytelling?.enabled ? {
    storytellingMode: (storytelling.protagonistMode === 'auto' ? 'auto' : storytelling.sceneCountStrategy) as any,
    sceneCountStrategy: (storytelling.sceneCountStrategy ?? 'auto') as 'auto' | 'minimal' | 'detailed' | 'cinematic' | 'longform',
    protagonistMode: (storytelling.protagonistMode ?? 'auto') as any,
    continuityStrictness: (storytelling.continuityStrictness ?? 'moderate') as any,
    sceneDiversity: storytelling.variationIntensity === 'high' ? 'high' as const
      : storytelling.variationIntensity === 'low' ? 'low' as const : 'medium' as const,
    transformationArcTemplate: storytelling.transformationArcTemplate as string | null ?? null,
    appIntegrationStyle: (storytelling.appIntegrationStyle ?? 'native') as any,
    pacing: (voiceover?.enabled ? (voiceover.pacing as any) : 'moderate') as any,
    visualPaletteCues: storytelling.paletteMood ? [storytelling.paletteMood as string] : [],
    subtitleStrategy: subtitles?.enabled
      ? (subtitles.placementStrategy === 'auto' ? 'dynamic' as const : 'static' as const)
      : 'none' as const,
    voiceoverStrategy: voiceover?.enabled ? 'full' as const : 'none' as const,
    variationRules: (storytelling.antiLoopRules ?? []) as string[],
    negativeRules: (storytelling.negativeRules ?? []) as string[],
  } : undefined

  // Build extended app data
  const appData = {
    name: app.name,
    description: app.description,
    keywords: app.keywords as string[],
    language: app.language,
    transformationPromise: (app as any).transformationPromise ?? null,
    corePain: (app as any).corePain ?? null,
    coreOutcome: (app as any).coreOutcome ?? null,
    creativeAngles: (app as any).creativeAngles ?? null,
    scenarioContext: (app as any).scenarioContext ?? null,
    referenceImageUrls: ((app as any).referenceImageUrls ?? []) as string[],
  }

  // Apply manual override if provided
  if (appConfig?.contextMode === 'manual_only' && appConfig.manualOverrideSummary) {
    appData.description = String(appConfig.manualOverrideSummary)
  } else if (appConfig?.contextMode === 'light') {
    // Strip rich context in light mode
    appData.creativeAngles = null
    appData.scenarioContext = null
  } else if (appConfig?.contextMode === 'off') {
    appData.description = null
    appData.creativeAngles = null
    appData.scenarioContext = null
    appData.referenceImageUrls = []
  }

  const allScenarios: unknown[] = []
  let skippedDuplicates = 0
  let variantsCreated = 0

  // Apply maxTrends limiter — user-controlled cardinality cap. maxTrends всегда >= 1.
  const activeTrends = trends.filter(t => !t.isDeleted)
  const trendsToProcess = activeTrends.slice(0, maxTrends)

  // Resolve run start time for idempotency scope (prevents duplicates on retry)
  const runId = Number(input._runId) || 0
  const pipelineIdForTracking = Number(input._pipelineId) || undefined
  let runStartedAt: Date | null = null
  if (runId) {
    const run = await prisma.workflowRun.findUnique({
      where: { id: runId },
      select: { startedAt: true },
    })
    runStartedAt = run?.startedAt ?? null
  }

  for (const trend of trendsToProcess) {
    throwIfAborted(signal)

    // ── Retry idempotency ──
    // runId-первичный поиск: точная идентификация по (trendId, appId, runId).
    // Исключаем isDeleted=true — это soft-cancel из A1 retry-step, надо генерить заново.
    // Legacy fallback (без runId) сохранён — используется cycles/standalone путями.
    let existingScenario: Awaited<ReturnType<typeof prisma.scenario.findFirst>> | null = null
    if (runId) {
      existingScenario = await prisma.scenario.findFirst({
        where: {
          ...(trend.hypothesisId ? { hypothesisId: trend.hypothesisId } : { trendId: trend.id }),
          appId: app.id,
          runId,
          isDeleted: false,
        },
        include: { variants: true },
      })
    } else if (runStartedAt) {
      // Legacy без runId: оставляем старый поиск по createdAt window
      existingScenario = await prisma.scenario.findFirst({
        where: {
          ...(trend.hypothesisId ? { hypothesisId: trend.hypothesisId } : { trendId: trend.id }),
          appId: app.id,
          createdAt: { gte: runStartedAt },
          isDeleted: false,
        },
        include: { variants: true },
      })
    }
    if (existingScenario) {
      allScenarios.push(existingScenario)
      skippedDuplicates++
      continue
    }

    // Favorite prompts selection из config.favoritePrompts — прокидываем в сценарный пайплайн
    const favoritePromptsConfig = config.favoritePrompts as
      | { manualIds?: unknown, autoSelect?: unknown }
      | undefined
    const manualIds = Array.isArray(favoritePromptsConfig?.manualIds)
      ? (favoritePromptsConfig!.manualIds as unknown[]).map(v => Number(v)).filter(v => Number.isFinite(v) && v > 0)
      : []
    const autoSelect = favoritePromptsConfig?.autoSelect === true
    const favoritePromptsSelection = (manualIds.length > 0 || autoSelect)
      ? { manualIds: manualIds.length > 0 ? manualIds : undefined, autoSelect }
      : undefined

    const generated = await generateScenarios(
      {
        title: trend.title,
        description: trend.description,
        platform: trend.platform,
        hashtags: trend.hashtags,
        viewCount: trend.viewCount,
        insights: trend.insights,
        brief: trend.brief ?? null,
      },
      appData,
      variantsCount,
      app.id,
      profileSettings,
      favoritePromptsSelection,
    )

    // Upstream context: если перед сценарием стояла нода character или scene_composer,
    // их данные приходят в input и пробрасываются в Scenario.operatorNotes как
    // structured hint для оператора + (если sceneId) в FK Scenario.sceneId.
    const upstreamCharacter = input.character as
      | { id: string; name: string; visualPrompt?: string | null; referenceImages?: Array<{ fileUrl: string }> }
      | undefined
    const upstreamSceneId = typeof input.sceneId === 'string' ? input.sceneId : null
    const upstreamCompiledPrompt = typeof input.compiledPrompt === 'string' ? input.compiledPrompt : null

    const operatorNotesParts: string[] = []
    if (upstreamCharacter?.id) {
      const refsCount = upstreamCharacter.referenceImages?.length ?? 0
      operatorNotesParts.push(
        `[pipeline] Персонаж: ${upstreamCharacter.name} (id=${upstreamCharacter.id}, реф-фото=${refsCount})${
          upstreamCharacter.visualPrompt ? `; visualPrompt: ${upstreamCharacter.visualPrompt}` : ''
        }`,
      )
    }
    if (upstreamSceneId && upstreamCompiledPrompt) {
      operatorNotesParts.push(
        `[pipeline] Сцена из композитора: id=${upstreamSceneId}; prompt: ${upstreamCompiledPrompt.slice(0, 280)}${
          upstreamCompiledPrompt.length > 280 ? '…' : ''
        }`,
      )
    }

    const scenario = await prisma.scenario.create({
      data: {
        trendId: trend.hypothesisId ? null : trend.id,
        hypothesisId: trend.hypothesisId ?? null,
        appId: app.id,
        status: 'generated',
        generationStatus: 'completed',
        ...(upstreamSceneId ? { sceneId: upstreamSceneId } : {}),
        ...(operatorNotesParts.length > 0 ? { operatorNotes: operatorNotesParts.join('\n') } : {}),
        // --- Pipeline tracking: runId/pipelineId помогают фильтру «К юниту» ---
        ...(runId ? { runId } : {}),
        ...(pipelineIdForTracking ? { pipelineId: pipelineIdForTracking } : {}),
      },
    })

    // Применяем pipeline-level стиль (если есть) или забираем из первого storyPlan
    // и сохраняем в Pipeline для всех будущих сценариев.
    if (!pipelineSubtitleStyle && pipelineIdForStyle && generated[0]?.storyPlan?.subtitleStyle) {
      pipelineSubtitleStyle = generated[0].storyPlan.subtitleStyle as unknown as Record<string, unknown>
      await prisma.pipeline.update({
        where: { id: pipelineIdForStyle },
        data: { subtitleStyle: pipelineSubtitleStyle as never },
      })
    }

    for (let i = 0; i < generated.length; i++) {
      const v = generated[i]!
      // Если в pipeline уже есть единый стиль — переписываем storyPlan.subtitleStyle
      // на него (variants одного и разных сценариев живут с одним стилем).
      const storyPlanWithStyle = v.storyPlan && pipelineSubtitleStyle
        ? { ...v.storyPlan, subtitleStyle: pipelineSubtitleStyle }
        : v.storyPlan

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
          // storyPlan критичен для video pipeline: без него detectRuntimeMode уходит
          // в legacy_simple и игнорирует структуру сцен — 1 image + 3 одинаковых клипа
          // hook/body/cta по clipDuration вместо настоящих per-scene durations.
          storyPlan: storyPlanWithStyle as any,
          toneProfile: v.toneProfile,
          rationale: v.rationale,
          promptVersion: '3.0.0',
        },
      })
      variantsCreated++
    }

    // Quality Critic — только 1 проход без rework (pipeline timeout protection).
    try {
      const { runQualityCriticForScenario } = await import('~~/server/utils/scenario-critic-orchestrator')
      await runQualityCriticForScenario(scenario.id, { maxIterations: 1 })
    } catch (criticErr) {
      console.error('[scenario-critic] failed in pipeline-executors:', criticErr)
    }

    allScenarios.push(scenario)
  }

  return {
    scenarios: allScenarios,
    // ── Fan-out cardinality metadata ──
    trendsReceived: trends.length,
    trendsProcessed: trendsToProcess.length,
    scenariosCreated: allScenarios.length - skippedDuplicates,
    variantsCreated,
    skippedDuplicates,
    skippedDeleted: trends.length - activeTrends.length,
    ...(activeTrends.length > maxTrends
      ? { _cardinalityLimited: true, _limitApplied: maxTrends, _totalAvailable: activeTrends.length }
      : {}),
  }
}

async function resolvePipelineLipSyncCharacterId(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
  appId: number | null,
): Promise<string | null> {
  if (config.lipSyncEnabled !== true) return null

  const requestedId = typeof config.lipSyncCharacterId === 'string' && config.lipSyncCharacterId
    ? config.lipSyncCharacterId
    : typeof input.characterId === 'string' && input.characterId
      ? input.characterId
      : null

  if (requestedId) {
    const character = await prisma.character.findUnique({
      where: { id: requestedId },
      select: {
        id: true,
        appId: true,
        archived: true,
        _count: { select: { sourceClips: { where: { isActive: true } } } },
      },
    })
    if (!character || character.archived || (appId && character.appId !== appId)) {
      throw new Error('Lip-sync presenter was not found in the scenario application')
    }
    if (character._count.sourceClips === 0) {
      throw new Error('Selected presenter has no active source clips for lip-sync')
    }
    return character.id
  }

  if (appId) {
    const protagonist = await prisma.character.findFirst({
      where: {
        appId,
        archived: false,
        role: 'protagonist',
        sourceClips: { some: { isActive: true } },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    const fallback = protagonist ? null : await prisma.character.findFirst({
      where: { appId, archived: false, sourceClips: { some: { isActive: true } } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    const resolved = protagonist?.id ?? fallback?.id ?? null
    if (resolved) return resolved
  }

  if (config.requireLipSyncCharacter === true) {
    throw new Error('Lip-sync requires a presenter with active source clips')
  }
  return null
}
export async function executeVideoNode(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const scenarios = (input.scenarios ?? []) as Array<{ id: number }>
  const maxVideos = Math.max(0, Number(config.maxVideos) || 0) // 0 = unlimited

  if (scenarios.length === 0) {
    const upstreamNoData = detectUpstreamNoData(input)
    const reason = upstreamNoData
      ? `Нет сценариев (upstream: ${getUpstreamNoDataReason(input) ?? 'нет данных'})`
      : 'Нет сценариев на входе'
    return {
      videos: [],
      skipped: true,
      reason,
      generatedCount: 0,
      failedCount: 0,
      timeoutCount: 0,
      scenariosReceived: 0,
      scenariosProcessed: 0,
      skippedDuplicates: 0,
      _noData: true,
      _domainStatus: 'no_data',
      _noDataReason: reason,
    }
  }

  // Apply maxVideos limiter — user-controlled cardinality cap
  const scenariosToProcess = maxVideos > 0 ? scenarios.slice(0, maxVideos) : scenarios

  // Resolve run start time for idempotency scope (prevents duplicates on retry)
  const runId = Number(input._runId) || 0
  const pipelineIdForTracking = Number(input._pipelineId) || undefined
  let runStartedAt: Date | null = null
  if (runId) {
    const run = await prisma.workflowRun.findUnique({
      where: { id: runId },
      select: { startedAt: true },
    })
    runStartedAt = run?.startedAt ?? null
  }

  const videos: unknown[] = []
  const launchErrors: string[] = []
  let skippedDuplicates = 0

  for (const sc of scenariosToProcess) {
    throwIfAborted(signal)

    // ── Retry idempotency ──
    // runId-первичный поиск: точная идентификация по (scenarioId, runId).
    // НЕ ищем canceled/failed видео (после A1 retry-step ставит canceled,
    // а failed мог быть от прошлого прогона). Это сигнал что прошлый прогон
    // надо переcоздать заново.
    // Legacy fallback (без runId) сохранён — используется cycles/standalone путями.
    let existingVideo: { id: number; status: string; startedAt: Date | null; finishedAt: Date | null } | null = null
    if (runId) {
      existingVideo = await prisma.video.findFirst({
        where: {
          scenarioId: sc.id,
          runId,
          status: { notIn: ['canceled', 'failed'] as never[] },
        },
        select: { id: true, status: true, startedAt: true, finishedAt: true },
      })
    } else if (runStartedAt) {
      // Legacy без runId: оставляем старый поиск по createdAt window
      existingVideo = await prisma.video.findFirst({
        where: {
          scenarioId: sc.id,
          createdAt: { gte: runStartedAt },
        },
        select: { id: true, status: true, startedAt: true, finishedAt: true },
      })
    }
    if (existingVideo) {
      // ── Phantom video defense ──
      // Если найденное видео висит в in-progress статусе дольше 30 минут без
      // finishedAt — оно фантомное (worker умер / Saturn redeploy прервал /
      // pipeline получил unrecoverable ошибку до записи failed). Soft-cancel
      // его и создаём новое, чтобы запуск не зависал на reuse мёртвой записи.
      const STUCK_THRESHOLD_MS = 30 * 60 * 1000
      const inProgress = !['completed', 'canceled', 'failed'].includes(existingVideo.status)
      const startedAt = existingVideo.startedAt ? new Date(existingVideo.startedAt) : null
      const ageMs = startedAt ? Date.now() - startedAt.getTime() : 0
      const isStuck = inProgress && !existingVideo.finishedAt && startedAt !== null && ageMs > STUCK_THRESHOLD_MS
      if (isStuck) {
        await prisma.video.update({
          where: { id: existingVideo.id },
          data: {
            status: 'canceled' as never,
            finishedAt: new Date(),
            errorMessage: `Phantom auto-cancel: видео висело в ${existingVideo.status} > 30 мин без прогресса`,
            isLocked: false,
          },
        }).catch(() => {})
        await logAgent('video-node', 'warn',
          `Phantom video ${existingVideo.id} auto-canceled (was ${existingVideo.status} for ${Math.round(ageMs / 60000)} min, scenarioId=${sc.id}, runId=${runId})`,
          { videoId: existingVideo.id }).catch(() => {})
        // Не reuse — упадём ниже и создадим новое
      } else {
        // Re-read with latest status
        const fresh = await prisma.video.findUnique({ where: { id: existingVideo.id } })
        videos.push(fresh ?? existingVideo)
        skippedDuplicates++
        continue
      }
    }

    // Pre-flight: ensure scenario has at least one variant
    // Pipeline-generated scenarios have status "generated" but no "accepted" variant.
    // Auto-accept the first variant so video pipeline can proceed.
    const scenario = await prisma.scenario.findUnique({
      where: { id: sc.id },
      include: {
        variants: { orderBy: { variantIndex: 'asc' as const } },
      },
    })

    if (!scenario) {
      launchErrors.push(`Сценарий ${sc.id} не найден`)
      continue
    }
    const scenarioLanguage = scenario.appId
      ? (await prisma.app.findUnique({ where: { id: scenario.appId }, select: { language: true } }))?.language
      : null

    if (scenario.variants.length === 0) {
      launchErrors.push(`У сценария ${sc.id} нет вариантов для генерации видео`)
      continue
    }

    // Auto-accept first variant if none is accepted (pipeline automation)
    const hasAccepted = scenario.variants.some(v => v.status === 'accepted')
    if (!hasAccepted) {
      const firstVariant = scenario.variants[0]!
      await prisma.scenarioVariant.update({
        where: { id: firstVariant.id },
        data: { status: 'accepted' as never },
      })
      await prisma.scenario.update({
        where: { id: sc.id },
        data: { selectedVariantId: firstVariant.id },
      })
    }

    // Map UI field names to Prisma field names
    const uiFormat = String(config.format || 'vertical')
    const prismaFormat = uiFormat === 'horizontal' ? 'landscape' : 'portrait'
    const uiQuality = String(config.quality || '1080p')
    const prismaQuality = uiQuality === '720p' ? 'low' : uiQuality === '1080p' ? 'high' : 'medium'

    // ── Sync с upstream scenario storyPlan ──
    // Scenario block (через sceneCountStrategy) уже зафиксировал точное количество
    // сцен и их длительности в storyPlan. video-pipeline в runtime всё равно берёт
    // их оттуда, так что если не синхронизировать - UI показывает одно, а фактически
    // создаётся видео с другой структурой. Синхронизируем при записи Video.
    const acceptedVariant = scenario.variants.find(v => v.status === 'accepted') ?? scenario.variants[0]!
    const storyPlan = acceptedVariant.storyPlan as {
      scenes?: Array<{ duration?: string }>
      voiceoverPlan?: { enabled?: boolean; lines?: unknown[] }
    } | null
    let syncedSceneCount = Math.min(10, Math.max(1, Number(config.sceneCount) || 3))
    let syncedClipDuration = Math.min(15, Math.max(3, Number(config.clipDuration) || 5))
    if (storyPlan?.scenes && storyPlan.scenes.length > 0) {
      const perSceneDurations = storyPlan.scenes.map((s) => {
        const parsed = parseInt(String(s.duration ?? '5'), 10)
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 5
      })
      syncedSceneCount = Math.min(10, Math.max(1, perSceneDurations.length))
      const avg = perSceneDurations.reduce((a, b) => a + b, 0) / perSceneDurations.length
      syncedClipDuration = Math.min(15, Math.max(3, Math.round(avg)))
    }

    // Voiceover sync: если node-config явно не указал voiceoverEnabled,
    // подхватываем из storyPlan.voiceoverPlan. Иначе video.voiceoverEnabled
    // остаётся false (default БД) и шаг voiceover_generation скипается даже
    // когда сценарий запланировал реплики - у пользователя пропадает звук.
    const storyHasVoiceoverLines = !!storyPlan?.voiceoverPlan?.enabled
      && Array.isArray(storyPlan.voiceoverPlan.lines)
      && (storyPlan.voiceoverPlan.lines?.length ?? 0) > 0
    const resolvedVoiceoverEnabled = config.voiceoverEnabled === true
      ? true
      : config.voiceoverEnabled === false
        ? false
        : storyHasVoiceoverLines
    const resolvedLipSyncCharacterId = await resolvePipelineLipSyncCharacterId(config, input, scenario.appId)
    const resolvedLipSyncModel = config.lipSyncEnabled === true
      ? (typeof config.lipSyncModelId === 'string' ? getModel(config.lipSyncModelId) : getDefaultLipSyncModel())
      : null
    if (config.lipSyncEnabled === true && (
      !resolvedLipSyncModel
      || resolvedLipSyncModel.task !== 'lip_sync'
      || !resolvedLipSyncModel.integrated
    )) {
      throw new Error(`Unknown or unavailable lip-sync model: ${String(config.lipSyncModelId || 'default')}`)
    }

    // Validate models are integrated (defense in depth — pipeline also validates)
    const resolvedImageModelId = String(config.imageModelId || getDefaultImageModel().id)
    const resolvedVideoModelId = String(config.videoModelId || getDefaultVideoModel().id)
    const imgModelCheck = getModel(resolvedImageModelId)
    if (!imgModelCheck || imgModelCheck.task !== 'image' || !imgModelCheck.integrated) {
      throw new Error(`Неизвестная или неподключённая модель изображений: ${resolvedImageModelId}`)
    }
    const vidModelCheck = getModel(resolvedVideoModelId)
    if (!vidModelCheck || vidModelCheck.task !== 'video' || !vidModelCheck.integrated) {
      throw new Error(`Неизвестная или неподключённая модель видео: ${resolvedVideoModelId}`)
    }

    // Preflight: проверяем реальную доступность моделей для текущего FAL_KEY
    const { falProbeAccessBatch } = await import('./fal')
    const accessResults = await falProbeAccessBatch([resolvedImageModelId, resolvedVideoModelId])
    const imgAccess = accessResults.get(resolvedImageModelId)
    const vidAccess = accessResults.get(resolvedVideoModelId)

    if (imgAccess && imgAccess.status !== 'available') {
      throw new Error(
        `Модель изображений "${imgModelCheck.name}" (${resolvedImageModelId}) недоступна: ${imgAccess.reason}. `
        + `Статус: ${imgAccess.status}. Проверьте план/workspace вашего аккаунта fal.ai.`,
      )
    }
    if (vidAccess && vidAccess.status !== 'available') {
      throw new Error(
        `Модель видео "${vidModelCheck.name}" (${resolvedVideoModelId}) недоступна: ${vidAccess.reason}. `
        + `Статус: ${vidAccess.status}. Проверьте план/workspace вашего аккаунта fal.ai.`,
      )
    }

    const video = await prisma.video.create({
      data: {
        scenarioId: sc.id,
        variantId: acceptedVariant.id,
        applicationId: scenario.appId,
        format: prismaFormat as never,
        imageModelId: resolvedImageModelId,
        videoModelId: resolvedVideoModelId,
        modelStrategy: typeof config.modelStrategy === 'string' ? config.modelStrategy : 'auto',
        generateAudio: config.generateAudio !== false,
        clipDuration: syncedClipDuration,
        imageCount: syncedSceneCount,
        renderQuality: prismaQuality,
        musicEnabled: config.enableMusic !== false,
        musicMood: config.musicMood ? String(config.musicMood) : null,
        musicVolume: typeof config.musicVolume === 'number' ? Math.max(0, Math.min(1, config.musicVolume)) : undefined,
        musicVolumeWithVoiceover: typeof config.musicVolumeWithVoiceover === 'number' ? Math.max(0, Math.min(1, config.musicVolumeWithVoiceover)) : undefined,
        subtitlesEnabled: config.subtitlesEnabled !== false,
        subtitlePreset: typeof config.subtitlePreset === 'string' ? config.subtitlePreset : null,
        targetPlatform: config.targetPlatform ? String(config.targetPlatform) : null,
        voiceoverEnabled: resolvedVoiceoverEnabled,
        voiceoverModelId: typeof config.voiceoverModelId === 'string' ? config.voiceoverModelId : null,
        voiceoverVoiceId: typeof config.voiceoverVoiceId === 'string' ? config.voiceoverVoiceId : null,
        voiceoverLanguage: typeof config.voiceoverLanguage === 'string' ? config.voiceoverLanguage : scenarioLanguage || 'en',
        voiceoverPacing: typeof config.voiceoverPacing === 'string' ? config.voiceoverPacing as never : 'moderate' as never,
        voiceoverReconciliation: typeof config.voiceoverReconciliation === 'string' ? config.voiceoverReconciliation as never : 'compress_audio' as never,
        lipSyncEnabled: config.lipSyncEnabled === true,
        lipSyncModelId: resolvedLipSyncModel?.id ?? null,
        lipSyncCharacterId: resolvedLipSyncCharacterId,
        // --- Pipeline tracking: runId/pipelineId помогают фильтру «К юниту» ---
        ...(runId ? { runId } : {}),
        ...(pipelineIdForTracking ? { pipelineId: pipelineIdForTracking } : {}),
      },
    })

    if (storyHasVoiceoverLines && !resolvedVoiceoverEnabled) {
      await logAgent('video-node', 'warn',
        `StoryPlan содержит ${(storyPlan?.voiceoverPlan?.lines?.length ?? 0)} voiceover-реплик, но node-config выключил voiceover. Видео будет без озвучки.`,
        { videoId: video.id }).catch(() => {})
    }

    // Pre-flight env warnings: пользователь увидит предупреждение в BotEvent
    // ещё до генерации, если включил музыку, но среда не способна её сделать.
    // Раньше Mubert тихо возвращал null → видео без звука без объяснения.
    if (video.musicEnabled) {
      if (process.env.ENABLE_PAID_APIS !== 'true') {
        await logAgent('video-node', 'warn',
          `Музыка включена в конфиге блока, но ENABLE_PAID_APIS != "true" — Mubert не вызовется, видео будет без фоновой музыки.`,
          { videoId: video.id }).catch(() => {})
      }
      else if (!process.env.MUBERT_KEY) {
        await logAgent('video-node', 'warn',
          `Музыка включена в конфиге блока, но MUBERT_KEY не задан — Mubert не вызовется, видео будет без фоновой музыки.`,
          { videoId: video.id }).catch(() => {})
      }
    }

    if (resolvedVoiceoverEnabled && !storyHasVoiceoverLines) {
      await logAgent('video-node', 'warn',
        `Voiceover включён, но в storyPlan.voiceoverPlan.lines нет реплик — озвучка будет пропущена. Перегенерируйте сценарий, чтобы получить план озвучки.`,
        { videoId: video.id }).catch(() => {})
    }

    // Await real video generation — step completes only when video is done
    // Set up cancellation cascade: if pipeline is cancelled, cancel video generation too
    let cancelCleanup: (() => void) | undefined
    if (signal) {
      const videoId = video.id
      const onAbort = () => {
        cancelVideoPipeline(videoId).catch(() => {})
      }
      signal.addEventListener('abort', onAbort, { once: true })
      cancelCleanup = () => signal.removeEventListener('abort', onAbort)
    }

    try {
      // Передаём signal в pipeline — между шагами выбрасывает CancellationError
      // если signal aborted, не дожидаясь конца fal polling.
      await runVideoPipeline(video.id, { signal })

      // Re-read the completed video for accurate output
      const completed = await prisma.video.findUnique({ where: { id: video.id } })
      videos.push(completed ?? video)
    } catch (err) {
      // CancellationError из runVideoPipeline (signal aborted между шагами) ИЛИ
      // signal.aborted=true (cascade cancel уже триггернул cancelVideoPipeline) —
      // выходим из executor'а как cancellation, не как failure.
      const isCancellation =
        signal?.aborted ||
        err instanceof CancellationError ||
        (err instanceof Error && err.name === 'CancellationError')
      if (isCancellation) {
        cancelCleanup?.()
        throw err instanceof CancellationError ? err : new CancellationError()
      }
      const msg = err instanceof Error ? err.message : 'Неизвестная ошибка'
      await logAgent('video-node', 'error', `Ошибка генерации видео ${video.id}: ${msg}`, { videoId: video.id }).catch(() => {})
      launchErrors.push(`Видео ${video.id}: ${msg}`)

      // ── Phantom video defense ──
      // runVideoPipeline должен сам помечать video.status='failed' в catch, но
      // если он крашнулся раньше (worker died, OOM, unhandled exception) —
      // video остаётся в in-progress статусе с isLocked=true навсегда. Defense
      // in depth: явно помечаем failed здесь, чтобы next retry/run не reuse'ил
      // phantom через idempotency.
      const stuck = await prisma.video.findUnique({ where: { id: video.id } })
      if (stuck && !['completed', 'canceled', 'failed'].includes(stuck.status)) {
        await prisma.video.update({
          where: { id: video.id },
          data: {
            status: 'failed' as never,
            finishedAt: new Date(),
            errorMessage: msg.slice(0, 500),
            isLocked: false,
          },
        }).catch(() => {})
      }

      // Re-read to get actual failed status
      const failed = await prisma.video.findUnique({ where: { id: video.id } })
      videos.push(failed ?? video)
    } finally {
      cancelCleanup?.()
    }
  }

  const generatedCount = videos.filter((v: any) => v.status === 'completed').length
  const failedCount = videos.filter((v: any) => v.status === 'failed').length
  const timeoutCount = videos.filter((v: any) => v.status === 'timeout').length
  const totalFailed = failedCount + timeoutCount

  // Все domain outcomes failed/timeout — честный throw, step станет failed
  if (generatedCount === 0 && (totalFailed > 0 || launchErrors.length > 0)) {
    const allErrors = [...launchErrors]
    for (const v of videos as Array<{ id?: number; status?: string; errorMessage?: string }>) {
      if ((v.status === 'failed' || v.status === 'timeout') && v.errorMessage && !allErrors.some(e => e.includes(v.errorMessage!))) {
        allErrors.push(`Видео ${v.id}: ${v.errorMessage}`)
      }
    }
    const verb = timeoutCount > 0 && failedCount === 0
      ? 'Таймаут генерации видео (remote job может ещё выполняться)'
      : 'Генерация видео не удалась'
    throw new Error(`${verb}: ${allErrors.join('; ') || 'неизвестная ошибка'}`)
  }

  // Determine domain status for canonical summary
  const hasDegraded = totalFailed > 0 && generatedCount > 0
  const domainStatus = totalFailed === 0 ? 'success' : (generatedCount > 0 ? 'partial' : 'failed')

  return {
    videos,
    generatedCount,
    failedCount,
    timeoutCount,
    // ── Fan-out cardinality metadata ──
    scenariosReceived: scenarios.length,
    scenariosProcessed: scenariosToProcess.length,
    skippedDuplicates,
    _domainStatus: domainStatus,
    errors: launchErrors.length > 0 ? launchErrors : undefined,
    // Partial failure: есть успешные, но есть и failed/timeout — domain degraded
    ...(hasDegraded ? { _domainDegraded: true } : {}),
    ...(maxVideos > 0 && scenarios.length > maxVideos
      ? { _cardinalityLimited: true, _limitApplied: maxVideos, _totalAvailable: scenarios.length }
      : {}),
  }
}

type UploadDispatchMode = 'round_robin' | 'all' | 'first_active'

interface ResolvedTarget {
  accountIds: number[]
  groupId?: number
  dispatchMode?: UploadDispatchMode
  source: 'account' | 'group' | 'factory'
}

/**
 * Резолвит итоговый список socialAccountId для публикации,
 * исходя из конфига Upload-ноды (single account vs group + dispatchMode).
 *
 * - mode='account' → один аккаунт (если он active).
 * - mode='group' → набор active members группы по выбранной стратегии:
 *   • round_robin → один member, наименее давно публиковавший;
 *   • first_active → один member, отсортированный по id;
 *   • all → все active members одновременно.
 */
async function resolveUploadTarget(
  config: Record<string, unknown>,
): Promise<{ target?: ResolvedTarget; reason?: string }> {
  const accountMode = String(config.accountMode || '').trim()
  const socialAccountId = Number(config.socialAccountId || config.accountId) || undefined
  const accountGroupId = Number(config.accountGroupId || config.accountGroup) || undefined

  // Определяем режим: явный accountMode > наличие socialAccountId/accountGroupId
  const effectiveMode: 'account' | 'group' = accountMode === 'group'
    ? 'group'
    : accountMode === 'account'
      ? 'account'
      : accountGroupId
        ? 'group'
        : 'account'

  if (effectiveMode === 'account') {
    if (!socialAccountId) return { reason: 'Не настроен socialAccountId для Upload-ноды' }
    const account = await prisma.socialAccount.findUnique({
      where: { id: socialAccountId },
      select: { id: true, status: true, displayName: true },
    })
    if (!account) return { reason: `Аккаунт #${socialAccountId} не найден` }
    if (account.status !== 'active') {
      return { reason: `Аккаунт «${account.displayName}» в статусе ${account.status} — публикация отклонена` }
    }
    return { target: { accountIds: [account.id], source: 'account' } }
  }

  // mode === 'group'
  if (!accountGroupId) return { reason: 'Не настроена группа аккаунтов для Upload-ноды' }
  const group = await prisma.accountGroup.findUnique({
    where: { id: accountGroupId },
    select: {
      id: true,
      name: true,
      dispatchMode: true,
      members: {
        select: {
          socialAccount: {
            select: { id: true, status: true, lastPostedAt: true },
          },
        },
      },
    },
  })
  if (!group) return { reason: `Группа #${accountGroupId} не найдена` }

  const activeMembers = group.members
    .map(m => m.socialAccount)
    .filter(a => a.status === 'active')

  if (activeMembers.length === 0) {
    return { reason: `В группе «${group.name}» нет активных аккаунтов` }
  }

  // Override через config.groupDispatchMode имеет приоритет над group.dispatchMode
  const VALID_MODES: UploadDispatchMode[] = ['round_robin', 'all', 'first_active']
  const cfgDispatchRaw = String(config.groupDispatchMode || '').trim()
  const cfgDispatch = VALID_MODES.includes(cfgDispatchRaw as UploadDispatchMode)
    ? (cfgDispatchRaw as UploadDispatchMode)
    : null
  const grpDispatchRaw = String(group.dispatchMode || '').trim()
  const grpDispatch = VALID_MODES.includes(grpDispatchRaw as UploadDispatchMode)
    ? (grpDispatchRaw as UploadDispatchMode)
    : 'round_robin'
  const dispatchMode: UploadDispatchMode = cfgDispatch ?? grpDispatch

  if (dispatchMode === 'all') {
    return {
      target: {
        accountIds: activeMembers.map(a => a.id),
        groupId: group.id,
        dispatchMode,
        source: 'group',
      },
    }
  }

  if (dispatchMode === 'first_active') {
    const sorted = [...activeMembers].sort((a, b) => a.id - b.id)
    return {
      target: {
        accountIds: [sorted[0]!.id],
        groupId: group.id,
        dispatchMode,
        source: 'group',
      },
    }
  }

  // round_robin: меньше всего «свежих» публикаций → null/oldest first
  const sorted = [...activeMembers].sort((a, b) => {
    const ta = a.lastPostedAt ? a.lastPostedAt.getTime() : 0
    const tb = b.lastPostedAt ? b.lastPostedAt.getTime() : 0
    if (ta !== tb) return ta - tb
    return a.id - b.id
  })
  return {
    target: {
      accountIds: [sorted[0]!.id],
      groupId: group.id,
      dispatchMode,
      source: 'group',
    },
  }
}

async function resolveFactoryUploadTarget(
  input: Record<string, unknown>,
  config: Record<string, unknown>,
): Promise<{ target?: ResolvedTarget; reason?: string } | null> {
  const factory = readFactoryContext(input)
  if (!factory) return null

  const configuredPlatforms = Array.isArray(config.uploadPlatforms)
    ? new Set(config.uploadPlatforms.map(String))
    : new Set<string>()
  const assignments = factory.assignments.filter(assignment =>
    configuredPlatforms.size === 0 || configuredPlatforms.has(assignment.platform),
  )
  if (assignments.length === 0) {
    return { reason: 'Нет назначенных аккаунтов для выбранных площадок' }
  }

  const requestedIds = [...new Set(assignments.map(assignment => assignment.socialAccountId))]
  const activeAccounts = await prisma.socialAccount.findMany({
    where: {
      id: { in: requestedIds },
      status: 'active',
      postingMethod: 'api',
    },
    select: { id: true, platform: true },
  })
  const activeById = new Map(activeAccounts.map(account => [account.id, account.platform]))
  const validIds = assignments
    .filter(assignment => activeById.get(assignment.socialAccountId) === assignment.platform)
    .map(assignment => assignment.socialAccountId)
  const uniqueValidIds = [...new Set(validIds)]

  if (uniqueValidIds.length !== requestedIds.length) {
    const missingIds = requestedIds.filter(id => !uniqueValidIds.includes(id))
    return {
      reason: 'Accounts #' + missingIds.join(', #') + ' are unavailable for official API publishing',
    }
  }

  return {
    target: {
      accountIds: uniqueValidIds,
      source: 'factory',
    },
  }
}

export async function executeUploadNode(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const videos = (input.videos ?? []) as Array<{ id: number }>

  const factoryContext = readFactoryContext(input)
  const factoryTarget = await resolveFactoryUploadTarget(input, config)
  const { target, reason: resolveReason } = factoryTarget ?? await resolveUploadTarget(config)

  if (videos.length === 0 || !target) {
    const upstreamNoData = detectUpstreamNoData(input)
    const reason = !target
      ? resolveReason ?? 'Не настроен адресат публикации (аккаунт или группа)'
      : upstreamNoData
        ? `Нет видео (upstream: ${getUpstreamNoDataReason(input) ?? 'нет данных'})`
        : 'Нет видео на входе'
    return {
      uploads: [],
      skipped: true,
      reason,
      uploadsInitiated: 0,
      videosReceived: videos.length,
      _noData: true,
      _noDataReason: reason,
      _domainStatus: 'no_data',
    }
  }

  const completedVideos = await prisma.video.findMany({
    where: {
      id: { in: videos.map(v => v.id) },
      status: 'completed',
      filePath: { not: null },
    },
    include: {
      scenario: {
        include: {
          variants: { where: { status: 'accepted' }, take: 1 },
        },
      },
    },
  })

  const uploads: unknown[] = []
  let postingJobsCreated = 0
  const uploadRunId = Number(input._runId) || 0
  const uploadPipelineId = Number(input._pipelineId) || undefined

  // PR2.1: наблюдаемость — аккумулятор пропущенных аккаунтов (1:1:1 нарушение,
  // провал IG-валидации snapshot). Возвращается в output (аддитивно), чтобы один
  // невалидный аккаунт не маскировал успех остальных и был виден оператору.
  const skippedAccounts: Array<{ accountId: number; reason: string }> = []

  // ── Pre-fetch platforms + posting-метод для всех целевых аккаунтов (одним запросом) ──
  const accountsMeta = await prisma.socialAccount.findMany({
    where: { id: { in: target.accountIds } },
    select: {
      id: true,
      platform: true,
      postingMethod: true,
      proxyId: true,
      deviceProfileId: true,
    },
  })
  const platformByAccountId = new Map<number, string>()
  const metaByAccountId = new Map<number, typeof accountsMeta[number]>()
  for (const a of accountsMeta) {
    platformByAccountId.set(a.id, a.platform)
    metaByAccountId.set(a.id, a)
  }

  // ── Pre-fetch all approved captions for these videos at once ──
  const videoIds = completedVideos.map((v) => v.id)
  const captionsList = videoIds.length > 0
    ? await prisma.caption.findMany({
      where: {
        videoId: { in: videoIds },
        approvedAt: { not: null },
        fitsLimits: true,
      },
    })
    : []
  // Map: `${videoId}:${platform}` → Caption
  const captionByKey = new Map<string, typeof captionsList[number]>()
  for (const c of captionsList) {
    captionByKey.set(`${c.videoId}:${c.platform}`, c)
  }

  for (const video of completedVideos) {
    for (const accountId of target.accountIds) {
      throwIfAborted(signal)
      const variant = video.scenario?.variants?.[0]

      // Caption substitution: если есть approved+fitsLimits Caption для (videoId, accountPlatform) —
      // подменяем placeholder title/description/hashtags на её значения. Иначе fallback
      // на старое поведение (variant.title/hook + пустые hashtags), чтобы не ломать
      // существующие pipelines без CaptionGenerator-ноды.
      const accountPlatform = platformByAccountId.get(accountId)
      const caption = accountPlatform
        ? captionByKey.get(`${video.id}:${accountPlatform}`) ?? null
        : null

      // ── PR5: развилка по postingMethod ────────────────────────────────────
      // browser_automation → создаём PostingJob (FSM-постер), БЕЗ Upload.
      // api → старый Upload + runUploadPipeline (байт-в-байт ниже).
      const accMeta = metaByAccountId.get(accountId)
      if (accMeta?.postingMethod === 'browser_automation') {
        const platform = accMeta.platform as 'instagram' | 'youtube' | 'tiktok'

        // contentSnapshot под платформу. Для IG caption = ПОЛНЫЙ текст (Caption.title, W6),
        // БЕЗ поля title. Для YouTube — title/description/hashtags + youtube-блок.
        let contentSnapshot: Record<string, unknown>
        if (platform === 'instagram') {
          contentSnapshot = {
            instagram: { shareAsReel: true },
          }
          const igCaption = (caption?.title ?? variant?.hook ?? '').trim()
          if (igCaption.length > 0) contentSnapshot.caption = igCaption
          contentSnapshot.hashtags = caption?.hashtags ?? []
        } else {
          // youtube (и прочие browser-платформы): FSM-постер ждёт title/description/hashtags.
          // P2.2: visibility читаем из config (явное поле появится в UI ноды в PR6).
          const visibilityConfigured = config.youtubeVisibility || config.visibility
          const visibility = String(visibilityConfigured || 'private')
          const madeForKids = config.madeForKids === true
          // Если visibility не задан явно в конфиге — уходим в private по дефолту.
          // Логируем для наблюдаемости, чтобы оператор не удивлялся «приватной» публикации.
          if (!visibilityConfigured) {
            await logAgent('upload-node', 'warn',
              'YouTube автопост уходит в private, visibility не задан в конфиге ноды',
              { accountId, videoId: video.id }).catch(() => {})
          }
          contentSnapshot = {
            title: caption?.title ?? variant?.title ?? 'Видео',
            description: caption?.description ?? variant?.hook ?? '',
            hashtags: caption?.hashtags ?? [],
            youtube: { visibility, madeForKids },
          }
        }

        // P1.2: валидация IG-snapshot в pipeline-пути (паритет с API-эндпоинтами,
        // которые зовут validateInstagramSnapshot перед createPostingJob). caption с
        // fallback на variant.hook + хэштеги может превысить 2200 — отсеиваем здесь,
        // чтобы невалидный пост не ушёл в постер. Провал → skip аккаунта, не роняем ноду.
        if (platform === 'instagram') {
          try {
            validateInstagramSnapshot(contentSnapshot)
          } catch (err) {
            const msg = err instanceof InstagramSnapshotValidationError
              ? err.message
              : (err instanceof Error ? err.message : 'Неизвестная ошибка')
            await logAgent('upload-node', 'warn',
              `Аккаунт #${accountId} пропущен (невалидный IG-snapshot): ${msg}`,
              { accountId, videoId: video.id }).catch(() => {})
            skippedAccounts.push({ accountId, reason: `invalid_instagram_snapshot: ${msg}` })
            continue
          }
        }

        // 1:1:1 guard ПЕРЕД созданием job. Нарушение (409) → skip аккаунта, не роняем ноду.
        try {
          await assertOneToOneForBrowserAutomation(accountId, {
            proxyId: accMeta.proxyId,
            deviceProfileId: accMeta.deviceProfileId,
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Неизвестная ошибка'
          await logAgent('upload-node', 'warn',
            `Аккаунт #${accountId} пропущен (нарушение 1:1:1): ${msg}`,
            { accountId, videoId: video.id }).catch(() => {})
          skippedAccounts.push({ accountId, reason: `one_to_one_violation: ${msg}` })
          continue
        }

        await createPostingJob({
          videoId: video.id,
          socialAccountId: accountId,
          platform: platform as never,
          contentSnapshot: contentSnapshot as never,
          scheduledAt: null,
          runId: input._runId as number | null | undefined,
          pipelineId: input._pipelineId as number | null | undefined,
          maxAttempts: defaultMaxAttemptsForMethod(accMeta.postingMethod),
        })

        // Round-robin tick — как для Upload-пути.
        // P2.3: Намеренно: tick при создании job, паритет с api-путём (Upload.create);
        // точный tick при published — отдельный PR.
        prisma.socialAccount.update({
          where: { id: accountId },
          data: { lastPostedAt: new Date() },
        }).catch(() => {})

        postingJobsCreated++
        continue
      }

      const instagramPublishMode = ["reel", "trial_manual", "trial_auto"].includes(
        String(config.instagramPublishMode),
      )
        ? String(config.instagramPublishMode)
        : "reel"

      const upload = await prisma.upload.create({
        data: {
          videoId: video.id,
          socialAccountId: accountId,
          accountGroupId: target.groupId,
          dispatchMode: target.dispatchMode,
          title: caption?.title ?? variant?.title ?? 'Видео',
          description: caption?.description ?? variant?.hook ?? '',
          hashtags: caption?.hashtags ?? [],
          idempotencyKey: `pipeline-run${input._runId || 0}-v${video.id}-a${accountId}`,
          platformOptions: accountPlatform === 'instagram'
            ? { instagram: { publishMode: instagramPublishMode } }
            : undefined,
          ...(uploadRunId ? { runId: uploadRunId } : {}),
          ...(uploadPipelineId ? { pipelineId: uploadPipelineId } : {}),
        },
      })

      if (factoryContext?.trackingToken && uploadRunId) {
        await linkFactoryPublication({
          runId: uploadRunId,
          socialAccountId: accountId,
          videoId: video.id,
          uploadId: upload.id,
        })
      }

      // Round-robin tick: помечаем lastPostedAt сразу при создании Upload,
      // чтобы следующий запуск раунд-робина пошёл к другому аккаунту.
      // (Фактический результат публикации — асинхронный.)
      prisma.socialAccount.update({
        where: { id: accountId },
        data: { lastPostedAt: new Date() },
      }).catch(() => {})

      runUploadPipeline(upload.id).catch((err) => {
        const msg = err instanceof Error ? err.message : 'Неизвестная ошибка'
        logAgent('upload-node', 'error', `Ошибка запуска загрузки ${upload.id}: ${msg}`, { uploadId: upload.id }).catch(() => {})
      })
      uploads.push(upload)
    }
  }

  return {
    uploads,
    uploadsInitiated: uploads.length,
    postingJobsCreated,
    skippedAccounts,
    target: {
      source: target.source,
      groupId: target.groupId,
      dispatchMode: target.dispatchMode,
      accountIds: target.accountIds,
    },
  }
}

export async function executeAnalyticsNode(
  _config: Record<string, unknown>,
  _input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await collectMetrics()
  return { collected: result.collected, errors: result.errors }
}

export async function executeFilterNode(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const { withPassthrough } = await import('./pipeline-passthrough')
  const metric = config.metric as string | undefined
  const threshold = Number(config.threshold)

  if (!metric || Number.isNaN(threshold)) {
    return withPassthrough(input, {})
  }

  const value = Number(input[metric] ?? 0)
  if (value < threshold) {
    return null // skip downstream
  }

  return withPassthrough(input, {})
}

export async function executeNotificationNode(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const {
    extractVariablesFromTemplate,
    resolveVariablesFromInput,
    renderTemplate,
  } = await import('./telegram/variable-registry')

  const mode = String(config.mode || 'message')
  const defaultAlertType = (String(config.alertType || 'custom')) as import('./telegram/alerts').AlertType
  // Pipeline notifications: strict по умолчанию — не отправлять с [н/д] и ложными данными
  const strict = config.strict !== false

  // ── No-data handling policy ──
  // skipOnNoData (default true) — если upstream отдал _noData, не отправлять ложно-успешное уведомление.
  // treatNoDataAsWarning (default true) — при отправке в no_data режиме использовать alertType='critical_error'
  //   чтобы попасть в warning routing tags и визуально отличаться от обычного "успешно".
  const skipOnNoData = config.skipOnNoData !== false
  const treatNoDataAsWarning = config.treatNoDataAsWarning !== false

  // Находим все upstream-ноды с _noData (помимо прямого флага в merged input).
  // Это позволяет честно показать пользователю цепочку источников.
  const runId = Number(input._runId) || 0
  const noDataSources = runId > 0 ? await collectNoDataSourcesFromRun(runId) : []
  const noDataDetected = detectUpstreamNoData(input) || noDataSources.length > 0
  const noDataReason = noDataDetected
    ? (getUpstreamNoDataReason(input)
      ?? (noDataSources.length > 0
        ? `Upstream-ноды без данных: ${noDataSources.map(s => s.nodeName).join(', ')}`
        : 'Нет полезных данных от предыдущих блоков'))
    : undefined

  // Early-exit: блокируем отправку если skipOnNoData включён и есть no-data признак
  if (noDataDetected && skipOnNoData) {
    await logAgent('notification-node', 'warn',
      `Уведомление пропущено из-за no-data контекста: ${noDataReason}`,
      { noDataSources, noDataReason, mode, templateKey: config.templateKey }).catch(() => {})
    return {
      sent: false,
      skipped: true,
      mode,
      renderStatus: 'blocked_no_data',
      skipReason: 'no_data',
      noDataDetected: true,
      noDataReason,
      noDataSources,
      _noData: true,
      _domainStatus: 'no_data',
      _noDataReason: noDataReason ?? 'Нет данных для уведомления',
    }
  }

  // Если no-data, но пользователь хочет уведомление — отправляем с warning-типом
  const alertType: import('./telegram/alerts').AlertType = (noDataDetected && treatNoDataAsWarning)
    ? 'critical_error'
    : defaultAlertType

  // Обогащаем input no-data метаданными, чтобы они были доступны для {{noDataReason}}, {{noDataSources}}
  // в шаблоне и raw message.
  const enrichedInput: Record<string, unknown> = {
    ...input,
    noDataDetected: noDataDetected ? 'да' : 'нет',
    noDataReason: noDataReason ?? '',
    noDataSources: noDataSources.map(s => s.nodeName).join(', '),
  }

  // Template mode: use a saved template with variable substitution via registry
  if (mode === 'template' && config.templateKey) {
    const schema = config.templateVariables as Record<string, string> | undefined
    let variables: Record<string, string> = {}

    if (schema && Object.keys(schema).length > 0) {
      // Explicit mapping: varName → inputPath (пользователь задал маппинг вручную)
      for (const [varName, inputPath] of Object.entries(schema)) {
        const resolved = resolveInputPath(enrichedInput, String(inputPath))
        if (resolved !== undefined) {
          variables[varName] = String(resolved)
        }
      }
    } else {
      // Registry-based auto-resolution: используем canonical registry вместо эвристики
      const template = await prisma.telegramMessageTemplate.findUnique({
        where: { key: String(config.templateKey) },
        select: { messageBody: true },
      })
      if (template) {
        const varNames = extractVariablesFromTemplate(template.messageBody)
        const { resolved } = resolveVariablesFromInput(enrichedInput, varNames)
        variables = resolved
      }
    }

    const result = await sendTemplateAlert(
      String(config.templateKey),
      variables,
      {
        relatedEntityType: 'pipeline',
        relatedEntityId: input._runId ? Number(input._runId) : undefined,
        strict,
      },
    )

    // Render status для audit и UI
    const renderStatus = !result.sent
      ? (result.unresolvedVariables?.length ? 'blocked_unresolved_variables' : 'blocked_template_error')
      : (result.unresolvedVariables?.length ? 'sent_degraded' : 'rendered_ok')

    return {
      sent: result.sent,
      error: result.error,
      mode: 'template',
      renderStatus,
      alertType,
      resolvedVariables: Object.keys(variables),
      resolvedSnapshot: variables,
      unresolvedVariables: result.unresolvedVariables ?? [],
      strippedExpressions: result.strippedExpressions ?? [],
      noDataDetected,
      noDataReason,
      noDataSources,
      ...(noDataDetected ? { _domainStatus: 'no_data', _noDataReason: noDataReason ?? '' } : {}),
    }
  }

  // Raw message mode: send a direct message с registry-based resolution
  const rawMessage = String(config.message || 'Конвейер завершил шаг')
  // Если no-data и пользователь не переопределил сообщение — префиксируем честным предупреждением
  const finalRawMessage = noDataDetected
    ? `⚠️ Запуск без данных — ${noDataReason ?? 'нет полезных результатов'}\n\n${rawMessage}`
    : rawMessage
  const varNames = extractVariablesFromTemplate(finalRawMessage)
  const { resolved, unresolved } = resolveVariablesFromInput(enrichedInput, varNames)

  // Для переменных не из registry — пробуем прямой path resolve из enriched input
  for (const key of unresolved) {
    const val = resolveInputPath(enrichedInput, key)
    if (val !== undefined) {
      resolved[key] = String(val)
    }
  }

  const { text, unresolvedVariables, strippedExpressions } = renderTemplate(finalRawMessage, resolved, { strict })

  if (strict && unresolvedVariables.length > 0) {
    return {
      sent: false,
      mode: 'message',
      renderStatus: 'blocked_unresolved_variables',
      error: `Неразрешённые переменные: ${unresolvedVariables.join(', ')}`,
      unresolvedVariables,
      resolvedSnapshot: resolved,
      noDataDetected,
      noDataReason,
      noDataSources,
      ...(noDataDetected ? { _domainStatus: 'no_data', _noDataReason: noDataReason ?? '' } : {}),
    }
  }

  if (unresolvedVariables.length > 0) {
    await logAgent('notification-node', 'warn', `Неразрешённые переменные в сообщении: ${unresolvedVariables.join(', ')}`, { unresolvedVariables }).catch(() => {})
  }

  await sendStructuredAlert({
    type: alertType,
    message: text,
    relatedEntityType: 'pipeline',
    relatedEntityId: input._runId ? Number(input._runId) : undefined,
  })

  return {
    sent: true,
    mode: 'message',
    renderStatus: unresolvedVariables.length > 0 ? 'sent_degraded' : 'rendered_ok',
    alertType,
    unresolvedVariables,
    strippedExpressions,
    resolvedSnapshot: resolved,
    noDataDetected,
    noDataReason,
    noDataSources,
    ...(noDataDetected ? { _domainStatus: 'no_data', _noDataReason: noDataReason ?? '' } : {}),
  }
}

/** Resolve a value from input by dot-separated path or flat key. */
function resolveInputPath(input: Record<string, unknown>, path: string): unknown {
  if (input[path] !== undefined) return input[path]
  const parts = path.split('.')
  let current: unknown = input
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export async function executeIdeaNode(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const mode = String(config.mode || 'input')
  const language = String(config.language || 'EN')
  const ideaRunId = Number(input._runId) || undefined
  const ideaPipelineId = Number(input._pipelineId) || undefined

  // --- Режим «input» — анализ URL из входных данных предыдущего блока ---
  // Типичная цепочка: Trendwatcher → Idea (берёт URL из trends)
  if (mode === 'input') {
    const urls = extractUrlsFromInput(input, config)

    if (urls.length === 0) {
      const upstreamNoData = detectUpstreamNoData(input)
      const reason = upstreamNoData
        ? `Нет URL для анализа (upstream: ${getUpstreamNoDataReason(input) ?? 'нет данных'})`
        : 'Не найдены URL для анализа во входных данных'
      return {
        ideas: [],
        count: 0,
        warning: reason,
        _noData: true,
        _noDataReason: reason,
        _domainStatus: 'no_data',
      }
    }

    const limit = Math.min(Number(config.limit) || 5, 20)
    const toProcess = urls.slice(0, limit)
    const ideas: unknown[] = []

    for (const url of toProcess) {
      throwIfAborted(signal)
      const idea = await processOneUrl(url, language, ideaRunId, ideaPipelineId)
      if (idea) ideas.push(idea)
    }

    if (ideas.length === 0) {
      const reason = `Не удалось проанализировать ни одного URL из ${toProcess.length}`
      return {
        ideas: [],
        count: 0,
        warning: reason,
        _noData: true,
        _noDataReason: reason,
        _domainStatus: 'no_data',
      }
    }

    return { ideas, count: ideas.length }
  }

  // --- Режим «url» — анализ одного конкретного URL из настроек ---
  if (mode === 'url') {
    const sourceUrl = String(config.sourceUrl || '')
    if (!sourceUrl) {
      throw new Error('URL видео не указан в настройках блока')
    }

    const idea = await processOneUrl(sourceUrl, language, ideaRunId, ideaPipelineId)
    if (!idea) {
      const reason = `Анализ URL ${sourceUrl} не удался`
      return {
        ideas: [],
        count: 0,
        warning: reason,
        _noData: true,
        _noDataReason: reason,
        _domainStatus: 'no_data',
      }
    }
    return { ideas: [idea], count: 1 }
  }

  // --- Режим «fetch» — получение готовых идей из БД ---
  const status = String(config.ideaStatus || 'ready')
  const limit = Math.min(Number(config.limit) || 5, 20)

  const ideas = await prisma.idea.findMany({
    where: { status: status as any },
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: { analysis: true },
  })

  if (ideas.length === 0) {
    const reason = `В БД нет идей со статусом "${status}"`
    return {
      ideas: [],
      count: 0,
      warning: reason,
      _noData: true,
      _noDataReason: reason,
      _domainStatus: 'no_data',
    }
  }

  return { ideas, count: ideas.length }
}

/** Обработать один URL: создать Idea, запустить анализ, вернуть результат. */
async function processOneUrl(
  sourceUrl: string,
  language: string,
  runId?: number,
  pipelineId?: number,
) {
  const idea = await prisma.idea.create({
    data: {
      sourceUrl,
      language,
      source: 'pipeline',
      status: 'pending',
      // --- Pipeline tracking: runId/pipelineId помогают фильтру «К юниту» ---
      ...(runId ? { runId } : {}),
      ...(pipelineId ? { pipelineId } : {}),
    },
  })

  await processIdea(idea.id)

  const updated = await prisma.idea.findUnique({
    where: { id: idea.id },
    include: { analysis: true },
  })

  if (updated?.status === 'failed') {
    await logAgent('idea-node', 'warn', `Анализ URL ${sourceUrl} не удался: ${updated.errorMessage}`).catch(() => {})
    return null
  }

  return updated
}

/**
 * Извлечь URL из входных данных предыдущего блока.
 * Поддерживает: trends[].sourceUrl, trends[].videoUrl, прямые поля input.url/sourceUrl/videoUrl,
 * и массив ideas[].sourceUrl.
 */
function extractUrlsFromInput(input: Record<string, unknown>, config: Record<string, unknown>): string[] {
  const urls: string[] = []
  const urlField = String(config.urlField || '')

  // 1. Явно указанное поле
  if (urlField) {
    const val = input[urlField]
    if (typeof val === 'string' && val.startsWith('http')) urls.push(val)
    if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string' && item.startsWith('http')) urls.push(item)
      }
    }
  }

  // 2. Из массива trends (после Trendwatcher)
  const trends = input.trends as Array<Record<string, unknown>> | undefined
  if (Array.isArray(trends)) {
    for (const t of trends) {
      const url = String(t.sourceUrl || t.videoUrl || '')
      if (url.startsWith('http')) urls.push(url)
    }
  }

  // 3. Прямые поля
  for (const key of ['sourceUrl', 'videoUrl', 'url']) {
    const val = input[key]
    if (typeof val === 'string' && val.startsWith('http') && !urls.includes(val)) {
      urls.push(val)
    }
  }

  return [...new Set(urls)]
}

// Реэкспорт дополнительных executor-ов
export {
  executeHttpRequestNode,
  executeCodeNode,
  executeSetNode,
  executeIfNode,
  executeLoopNode,
  executeWaitNode,
  executeCaptionGeneratorNode,
} from './pipeline-executors-extra'
