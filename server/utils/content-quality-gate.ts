import type { Prisma } from '../../app/generated/prisma/client'
import type { QualityCheck, QualityCheckSeverity, QualityVerdict } from './quality/severity'
import { aggregateQualityVerdict, makeQualityCheck } from './quality/severity'
import { buildPolicyChecks, collectPolicyTexts, evaluateContentPolicy } from './quality/policy-check'
import type { PolicyJudgeOutcome } from './quality/policy-judge'
import { runPolicyJudge } from './quality/policy-judge'
import type { VideoUniquenessOutcome } from './quality/video-fingerprint'
import { buildUniquenessChecks } from './quality/video-fingerprint'
import { runVideoUniquenessCheck } from './quality/video-uniqueness'

export type { QualityCheckSeverity } from './quality/severity'

/** Историческое имя типа. Уровень чека живёт в поле `severity`. */
export type FactoryQualityCheck = QualityCheck

export interface FactoryQualityGateResult {
  verdict: QualityVerdict
  score: number
  checks: FactoryQualityCheck[]
  issues: string[]
  estimatedDurationSec: number | null
}

export interface FactoryQualityInput {
  stage: 'script' | 'final'
  hypothesis?: Record<string, any> | null
  funnel?: Record<string, any> | null
  leadMagnet?: Record<string, any> | null
  scenario?: Record<string, any> | null
  variant?: Record<string, any> | null
  video?: Record<string, any> | null
  /**
   * Конфигурация ограничений продукта. Списки берутся из App.forbiddenClaims /
   * App.riskyClaims — поля уже есть в схеме и заполняются app-enrichment-агентом,
   * новых миграций policy-чек не требует.
   */
  app?: { name?: string | null; forbiddenClaims?: string[] | null; riskyClaims?: string[] | null } | null
  /** Результат LLM-судьи. Приезжает готовым, чтобы функция осталась чистой. */
  policyJudge?: PolicyJudgeOutcome | null
  /**
   * Результат контура похожести (docs/PROJECT_CONTEXT.md п.7). Приезжает готовым
   * по той же причине, что и судья: ffmpeg и выборка истории не должны попадать
   * в чистую функцию.
   *
   * ПОЧЕМУ `undefined` не превращается в блокирующий чек: на стадии сценария
   * готового файла ещё нет, сравнивать физически нечего. Финальный узел
   * (`executeQualityGateNode`) передаёт поле ВСЕГДА — включая статус `failed`,
   * когда отпечаток посчитать не удалось, — поэтому в бою «не проверили» видно
   * как отдельный красный чек, а не как тишина.
   */
  uniqueness?: VideoUniquenessOutcome | null
  minDurationSec?: number
  maxDurationSec?: number
  wordsPerMinute?: number
  minCriticScore?: number
  requireFunnel?: boolean
  requireApprovedLeadMagnet?: boolean
  /** false — AI-критик выключен конфигом узла. */
  criticEnabled?: boolean
}

function wordsCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/u).length : 0
}

function plannedDurationSec(storyPlan: unknown): number | null {
  if (!storyPlan || typeof storyPlan !== 'object' || Array.isArray(storyPlan)) return null
  const scenes = (storyPlan as { scenes?: unknown }).scenes
  if (!Array.isArray(scenes) || scenes.length === 0) return null
  const durations = scenes.map((scene) => {
    if (!scene || typeof scene !== 'object' || Array.isArray(scene)) return NaN
    const raw = (scene as { duration?: unknown }).duration
    const match = String(raw ?? '').trim().match(/^(\d+(?:\.\d+)?)s?$/i)
    return match ? Number(match[1]) : NaN
  })
  if (durations.some(value => !Number.isFinite(value) || value <= 0)) return null
  return Math.round(durations.reduce((sum, value) => sum + value, 0))
}

export function evaluateFactoryQuality(input: FactoryQualityInput): FactoryQualityGateResult {
  const checks: FactoryQualityCheck[] = []
  // Пятый аргумент — уровень чека. По умолчанию blocking: новый чек безопаснее
  // считать блокирующим, пока автор явно не решил иначе.
  const add = (
    key: string,
    passed: boolean,
    message: string,
    value?: unknown,
    severity: QualityCheckSeverity = 'blocking',
  ) => {
    checks.push(makeQualityCheck(key, passed, message, { severity, value }))
  }
  const minDuration = Math.max(10, Number(input.minDurationSec) || 70)
  const maxDuration = Math.max(minDuration, Number(input.maxDurationSec) || 90)
  const wordsPerMinute = Math.max(60, Number(input.wordsPerMinute) || 135)
  const minCriticScore = Math.max(0, Math.min(100, Number(input.minCriticScore) || 70))
  const script = String(input.variant?.fullScript ?? '')
  const plannedDuration = plannedDurationSec(input.variant?.storyPlan)
  const estimatedDurationSec = plannedDuration
    ?? (script ? Math.round((wordsCount(script) / wordsPerMinute) * 60) : null)
  const keyword = String(input.funnel?.keyword ?? input.hypothesis?.keyword ?? '').trim()
  const cta = String(input.variant?.cta ?? input.hypothesis?.cta ?? '')
  const criticScore = Number(input.variant?.qualityScore)

  add('hypothesis', Boolean(input.hypothesis?.id), 'Content hypothesis is linked')
  if (input.requireFunnel !== false) {
    add('funnel', input.funnel?.status === 'active', 'Active funnel is linked to the run')
  }
  if (input.requireApprovedLeadMagnet !== false) {
    add('lead_magnet', input.leadMagnet?.status === 'approved', 'Lead magnet is approved')
  }
  add('scenario', Boolean(input.scenario?.id && input.variant?.id), 'Scenario and selected variant exist')
  // Длина хука — эвристика читаемости, а не дефект ролика. Короткий хук не
  // должен валить всю партию наравне с медицинским обещанием.
  add(
    'hook',
    String(input.variant?.hook ?? '').trim().length >= 20,
    'Hook is sufficiently detailed',
    String(input.variant?.hook ?? '').length,
    'warning',
  )
  add('story_plan', Boolean(input.variant?.storyPlan), 'Editing story plan exists')
  add(
    'duration',
    estimatedDurationSec !== null && estimatedDurationSec >= minDuration && estimatedDurationSec <= maxDuration,
    `Estimated duration is ${minDuration}-${maxDuration} seconds`,
    estimatedDurationSec,
  )
  // Критик. Три разных состояния, которые раньше сливались в один чек:
  //   отработал и дал оценку → сравниваем с порогом;
  //   не отработал (упал, не запускался) → блокирующий чек «качество не проверено»;
  //   выключен конфигом → предупреждение, но НЕ зелёный свет.
  const hasCriticScore = Number.isFinite(criticScore)
  if (input.criticEnabled === false) {
    add(
      'critic_score',
      false,
      'AI critic is disabled in the node config — scenario quality is not verified',
      hasCriticScore ? criticScore : null,
      'warning',
    )
  }
  else {
    add('critic_available', hasCriticScore, 'AI critic returned a score for the selected variant', hasCriticScore ? criticScore : null)
    add('critic_score', hasCriticScore && criticScore >= minCriticScore, `AI critic score is at least ${minCriticScore}/100`, hasCriticScore ? criticScore : null)
  }
  add('keyword', Boolean(keyword), 'Funnel has a trigger keyword')
  add(
    'cta_keyword',
    Boolean(keyword) && cta.toLocaleLowerCase('ru-RU').includes(keyword.toLocaleLowerCase('ru-RU')),
    'CTA contains the funnel trigger keyword',
    keyword || null,
  )

  // Policy-чек (docs/PROJECT_CONTEXT.md, п.10). Проверяем ровно тот текст, который
  // увидит и услышит зритель: сценарий, хук, CTA и финальные субтитры из storyPlan.
  const policy = evaluateContentPolicy({
    parts: collectPolicyTexts({
      fullScript: input.variant?.fullScript,
      hook: input.variant?.hook,
      cta,
      storyPlan: input.variant?.storyPlan,
    }),
    forbiddenClaims: input.app?.forbiddenClaims,
    riskyClaims: input.app?.riskyClaims,
    judge: input.policyJudge ?? null,
  })
  checks.push(...buildPolicyChecks(policy))

  if (input.stage === 'final') {
    add('video_ready', input.video?.status === 'completed', 'Video render completed successfully', input.video?.status ?? null)
    add('vertical_format', input.video?.format === 'portrait', 'Video uses vertical 9:16 format', input.video?.format ?? null)
    const actualDuration = Number(input.video?.duration)
    add(
      'actual_duration',
      Number.isFinite(actualDuration) && actualDuration >= minDuration && actualDuration <= maxDuration,
      `Actual duration is ${minDuration}-${maxDuration} seconds`,
      Number.isFinite(actualDuration) ? actualDuration : null,
    )
    // Проверка похожести перед публикацией. Последний рубеж: до этого готовый
    // ролик не сравнивался ни с чем, и серия визуально однотипных видео уходила
    // в аккаунт (docs/PROJECT_CONTEXT.md п.7).
    if (input.uniqueness !== undefined) {
      checks.push(...buildUniquenessChecks(input.uniqueness))
    }
  }

  const aggregate = aggregateQualityVerdict(checks)
  return {
    verdict: aggregate.verdict,
    score: aggregate.score,
    checks,
    issues: aggregate.issues,
    estimatedDurationSec,
  }
}

function extractIds(input: Record<string, unknown>, key: string): Array<number> {
  const raw = input[key]
  if (!Array.isArray(raw)) return []
  return raw.map((item: any) => Number(item?.id)).filter(id => Number.isInteger(id) && id > 0)
}

export async function executeQualityGateNode(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const runId = Number(input._runId)
  if (!Number.isInteger(runId) || runId <= 0) throw new Error('Quality Gate: runId is required')
  const stage = config.stage === 'final' ? 'final' : 'script'
  const run = await prisma.workflowRun.findUnique({
    where: { id: runId },
    select: { cycleId: true, trackingToken: true, cycle: { select: { appId: true } } },
  })
  if (!run?.cycle?.appId) throw new Error('Quality Gate: factory cycle and app are required')

  const hypothesis = await prisma.contentHypothesis.findFirst({
    where: { OR: [{ runId }, ...(run.trackingToken ? [{ trackingToken: run.trackingToken }] : [])] },
    include: { funnel: { include: { leadMagnet: true } }, leadMagnet: true },
  })
  const scenarioIds = extractIds(input, 'scenarios')
  const scenario = await prisma.scenario.findFirst({
    where: {
      isDeleted: false,
      ...(scenarioIds.length > 0 ? { id: { in: scenarioIds } } : { runId }),
    },
    include: { variants: { where: { isDeleted: false } } },
    orderBy: { createdAt: 'desc' },
  })
  const variant = scenario
    ? scenario.variants.find(item => item.id === scenario.selectedVariantId)
      ?? [...scenario.variants].sort((a, b) => Number(b.qualityScore ?? -1) - Number(a.qualityScore ?? -1))[0]
      ?? null
    : null

  const videoIds = extractIds(input, 'videos')
  const video = stage === 'final'
    ? await prisma.video.findFirst({
        where: videoIds.length > 0 ? { id: { in: videoIds } } : { runId },
        orderBy: { createdAt: 'desc' },
      })
    : null
  const leadMagnet = hypothesis?.funnel?.leadMagnet ?? hypothesis?.leadMagnet ?? null

  // Обложка ролика — отдельный ассет, и п.7 требует, чтобы она тоже отличалась.
  const cover = video
    ? await prisma.videoAsset.findFirst({
        where: { videoId: video.id, type: 'thumbnail' },
        orderBy: { createdAt: 'desc' },
        select: { storageKey: true, filePath: true },
      })
    : null

  // Контур похожести не бросает: любая его неудача приезжает статусом и
  // превращается в блокирующий чек внутри evaluateFactoryQuality.
  const uniqueness = stage === 'final'
    ? await runVideoUniquenessCheck({
        appId: run.cycle.appId,
        video,
        cover,
        enabled: config.uniquenessCheck !== false,
        historyLimit: Number(config.uniquenessHistoryLimit) || undefined,
      })
    : undefined

  // Ограничения продукта для policy-чека. Поля уже есть в схеме App и
  // заполняются app-enrichment-агентом — миграция policy-чеку не нужна.
  const app = await prisma.app.findUnique({
    where: { id: run.cycle.appId },
    select: { name: true, forbiddenClaims: true, riskyClaims: true },
  })

  const policyParts = collectPolicyTexts({
    fullScript: variant?.fullScript,
    hook: variant?.hook,
    cta: variant?.cta ?? hypothesis?.cta,
    storyPlan: variant?.storyPlan,
  })
  // Судья не бросает: любая его неудача приезжает статусом и превращается
  // в блокирующий чек внутри evaluateFactoryQuality.
  const policyJudge = await runPolicyJudge({
    parts: policyParts,
    appName: app?.name ?? null,
    forbiddenClaims: app?.forbiddenClaims ?? [],
    riskyClaims: app?.riskyClaims ?? [],
    enabled: config.policyJudge !== false,
  })

  const result = evaluateFactoryQuality({
    stage,
    hypothesis,
    funnel: hypothesis?.funnel,
    leadMagnet,
    scenario,
    variant,
    app,
    policyJudge,
    uniqueness,
    criticEnabled: config.criticEnabled !== false,
    video,
    minDurationSec: Number(config.minDurationSec) || 70,
    maxDurationSec: Number(config.maxDurationSec) || 90,
    wordsPerMinute: Number(config.wordsPerMinute) || 135,
    minCriticScore: Number(config.minCriticScore) || 70,
    requireFunnel: config.requireFunnel !== false,
    requireApprovedLeadMagnet: config.requireApprovedLeadMagnet !== false,
  })

  const review = await prisma.factoryQualityReview.upsert({
    where: { runId_stage: { runId, stage } },
    create: {
      appId: run.cycle.appId,
      cycleId: run.cycleId,
      runId,
      hypothesisId: hypothesis?.id ?? null,
      scenarioId: scenario?.id ?? null,
      videoId: video?.id ?? null,
      stage,
      verdict: result.verdict,
      score: result.score,
      checks: result.checks as unknown as Prisma.InputJsonValue,
      issues: result.issues as unknown as Prisma.InputJsonValue,
    },
    update: {
      hypothesisId: hypothesis?.id ?? null,
      scenarioId: scenario?.id ?? null,
      videoId: video?.id ?? null,
      verdict: result.verdict,
      score: result.score,
      checks: result.checks as unknown as Prisma.InputJsonValue,
      issues: result.issues as unknown as Prisma.InputJsonValue,
    },
  })

  if (result.verdict === 'fail' && config.blockOnFailure !== false) {
    throw new Error(`Quality Gate blocked publication: ${result.issues.join('; ')}`)
  }
  return { ...input, qualityReview: review, qualityGate: result }
}
