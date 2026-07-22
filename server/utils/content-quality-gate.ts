import type { Prisma } from '../../app/generated/prisma/client'

export interface FactoryQualityCheck {
  key: string
  passed: boolean
  blocking: boolean
  message: string
  value?: unknown
}

export interface FactoryQualityGateResult {
  verdict: 'pass' | 'warning' | 'fail'
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
  minDurationSec?: number
  maxDurationSec?: number
  wordsPerMinute?: number
  minCriticScore?: number
  requireFunnel?: boolean
  requireApprovedLeadMagnet?: boolean
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
  const add = (key: string, passed: boolean, message: string, value?: unknown, blocking = true) => {
    checks.push({ key, passed, blocking, message, value })
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
  add('hook', String(input.variant?.hook ?? '').trim().length >= 20, 'Hook is sufficiently detailed', String(input.variant?.hook ?? '').length)
  add('story_plan', Boolean(input.variant?.storyPlan), 'Editing story plan exists')
  add(
    'duration',
    estimatedDurationSec !== null && estimatedDurationSec >= minDuration && estimatedDurationSec <= maxDuration,
    `Estimated duration is ${minDuration}-${maxDuration} seconds`,
    estimatedDurationSec,
  )
  add('critic_score', Number.isFinite(criticScore) && criticScore >= minCriticScore, `AI critic score is at least ${minCriticScore}/100`, Number.isFinite(criticScore) ? criticScore : null)
  add('keyword', Boolean(keyword), 'Funnel has a trigger keyword')
  add(
    'cta_keyword',
    Boolean(keyword) && cta.toLocaleLowerCase('ru-RU').includes(keyword.toLocaleLowerCase('ru-RU')),
    'CTA contains the funnel trigger keyword',
    keyword || null,
  )

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
  }

  const passed = checks.filter(check => check.passed).length
  const score = Math.round((passed / Math.max(1, checks.length)) * 100)
  const blockingFailed = checks.filter(check => check.blocking && !check.passed)
  const nonBlockingFailed = checks.filter(check => !check.blocking && !check.passed)
  const verdict = blockingFailed.length > 0 ? 'fail' : nonBlockingFailed.length > 0 ? 'warning' : 'pass'
  return {
    verdict,
    score,
    checks,
    issues: checks.filter(check => !check.passed).map(check => `${check.key}: ${check.message}`),
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
  const result = evaluateFactoryQuality({
    stage,
    hypothesis,
    funnel: hypothesis?.funnel,
    leadMagnet,
    scenario,
    variant,
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
