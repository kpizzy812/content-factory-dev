import type {
  PipelineMonitorItem,
  PipelineMonitorMeta,
  WorkflowRunSummary,
  WorkflowStepSummary,
  PipelineRunStats,
  RunStatus,
  StepStatus,
  TriggerType,
  ErrorCategory,
} from '../../../shared/types/workflow'

/**
 * Pipeline monitor — combined catalog + runs endpoint.
 *
 * Returns pipelines accessible to the user with a snapshot of their runtime state:
 * active runs, recent runs, current step for the freshest active run, run stats.
 *
 * Batching strategy:
 *   1. One findMany for pipelines
 *   2. One groupBy for runStats across all pipelineIds
 *   3. One findMany for runs (limited by per-pipeline cap, then trimmed in memory)
 *   4. One findMany for current steps of active runs
 *
 * No N+1.
 */
export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'pipeline',
  })

  const query = getQuery(event)

  const page = Math.max(1, Number(query.page) || 1)
  const perPage = Math.min(50, Math.max(1, Number(query.perPage) || 9))
  const skip = (page - 1) * perPage

  const search = typeof query.search === 'string' && query.search.trim()
    ? query.search.trim()
    : null

  const hasRuns = query.hasRuns === 'yes' || query.hasRuns === 'no'
    ? query.hasRuns as 'yes' | 'no'
    : null

  const sort = query.sort === 'active_last' ? 'active_last' : 'active_first'

  const runsPerPipeline = Math.min(20, Math.max(1, Number(query.runsPerPipeline) || 5))

  // Build where clause — owner / shared / admin
  const accessWhere = user.canAdmin
    ? {}
    : {
        OR: [
          { userId: user.id },
          { sharedWith: { has: user.id } },
        ],
      }

  const searchWhere = search
    ? { name: { contains: search, mode: 'insensitive' as const } }
    : {}

  const hasRunsWhere = hasRuns === 'yes'
    ? { runs: { some: {} } }
    : hasRuns === 'no'
      ? { runs: { none: {} } }
      : {}

  const where = { ...accessWhere, ...searchWhere, ...hasRunsWhere }

  const [pipelines, total] = await Promise.all([
    prisma.pipeline.findMany({
      where,
      orderBy: { updatedAt: 'desc' as const },
      skip,
      take: perPage,
      include: { tags: { select: { id: true, name: true } } },
    }),
    prisma.pipeline.count({ where }),
  ])

  const pipelineIds = pipelines.map(p => p.id)

  // --- Batch 1: runStats via groupBy ---
  const statsRaw = pipelineIds.length > 0
    ? await prisma.workflowRun.groupBy({
        by: ['pipelineId', 'status'],
        where: { pipelineId: { in: pipelineIds } },
        _count: { _all: true },
      })
    : []

  const statsByPipeline = new Map<number, PipelineRunStats>()
  for (const id of pipelineIds) {
    statsByPipeline.set(id, { total: 0, success: 0, failed: 0, running: 0 })
  }
  for (const row of statsRaw) {
    const s = statsByPipeline.get(row.pipelineId)!
    const count = row._count._all
    s.total += count
    if (row.status === 'success') s.success += count
    else if (row.status === 'failed') s.failed += count
    else if (row.status === 'running' || row.status === 'pending') s.running += count
  }

  // --- Batch 2: all relevant runs for these pipelines ---
  // We fetch: latest 2*runsPerPipeline per pipeline by createdAt DESC.
  // Simpler: fetch all runs that are active, plus the latest N completed per pipeline.
  // To keep it to a single query — fetch top (runsPerPipeline * 2 + active slack) per pipeline via window? Prisma lacks per-group limit.
  // Strategy: one findMany with pipelineId IN + all active statuses; plus one findMany per pipeline subset of completed.
  // For correctness with no N+1 per pipeline, we fetch last (runsPerPipeline + 5) per pipeline by createdAt DESC using take per group via app-side trim after fetching createdAt-sorted block.
  // Simpler & still bounded: fetch up to (runsPerPipeline + 10) * pipelineIds.length runs sorted by createdAt desc filtered by pipelineId IN,
  // and group them in-memory. Since per-page pipelines <= 50 and run cap per page <= 20+slack, max ~1500 rows — acceptable.
  const fetchCap = (runsPerPipeline + 10) * Math.max(pipelineIds.length, 1)
  const allRuns = pipelineIds.length > 0
    ? await prisma.workflowRun.findMany({
        where: { pipelineId: { in: pipelineIds } },
        orderBy: { createdAt: 'desc' },
        take: fetchCap,
        include: { _count: { select: { steps: true } } },
      })
    : []

  // Group by pipelineId preserving createdAt DESC
  const runsByPipeline = new Map<number, typeof allRuns>()
  for (const id of pipelineIds) runsByPipeline.set(id, [])
  for (const run of allRuns) {
    const arr = runsByPipeline.get(run.pipelineId)
    if (arr) arr.push(run)
  }

  // --- Batch 3: current steps for all active runs in one query ---
  const activeRunIds: number[] = []
  for (const arr of runsByPipeline.values()) {
    for (const r of arr) {
      if (r.status === 'running' || r.status === 'pending') activeRunIds.push(r.id)
    }
  }

  const activeSteps = activeRunIds.length > 0
    ? await prisma.workflowStep.findMany({
        where: { runId: { in: activeRunIds }, status: { in: ['running', 'pending'] } },
        orderBy: { startedAt: 'desc' },
      })
    : []

  // Pick the freshest running/pending step per runId
  const stepByRunId = new Map<number, typeof activeSteps[number]>()
  for (const step of activeSteps) {
    if (!stepByRunId.has(step.runId)) stepByRunId.set(step.runId, step)
  }

  // --- Compose items ---
  const items: PipelineMonitorItem[] = pipelines.map((p) => {
    const graph = p.graphData as { nodes?: unknown[] } | null
    const totalNodes = Array.isArray(graph?.nodes) ? graph.nodes.length : 0

    const isOwner = p.userId === user.id
    const isShared = p.sharedWith.includes(user.id)
    const canCancel = Boolean(user.canRunAgent || user.canAdmin)
    const canRun = (user.canRunAgent || user.canAdmin) && p.status === 'active'
    const canWrite = Boolean(isOwner || user.canAdmin)

    const runs = runsByPipeline.get(p.id) ?? []

    const active: WorkflowRunSummary[] = []
    const completed: WorkflowRunSummary[] = []
    for (const r of runs) {
      const summary: WorkflowRunSummary = {
        id: r.id,
        pipelineId: r.pipelineId,
        status: r.status as RunStatus,
        triggerType: r.triggerType as TriggerType,
        errorCategory: (r.errorCategory as ErrorCategory | null) ?? null,
        errorMessage: r.errorMessage,
        cancelRequestedAt: r.cancelRequestedAt ? r.cancelRequestedAt.toISOString() : null,
        replayOfRunId: r.replayOfRunId,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
        stepsCount: r._count?.steps ?? 0,
        costActual: r.costActual,
      }
      if (r.status === 'running' || r.status === 'pending') active.push(summary)
      else completed.push(summary)
    }

    // Take current step for the freshest active run
    let currentStep: WorkflowStepSummary | null = null
    if (active.length > 0) {
      const step = stepByRunId.get(active[0]!.id)
      if (step) {
        currentStep = {
          id: step.id,
          runId: step.runId,
          nodeId: step.nodeId,
          nodeName: step.nodeName,
          nodeType: step.nodeType,
          status: step.status as StepStatus,
          startedAt: step.startedAt ? step.startedAt.toISOString() : null,
          finishedAt: step.finishedAt ? step.finishedAt.toISOString() : null,
        }
      }
    }

    return {
      id: p.id,
      name: p.name,
      description: p.description,
      icon: p.icon,
      color: p.color,
      status: p.status,
      tags: p.tags,
      nodesCount: totalNodes,
      totalNodes,
      updatedAt: p.updatedAt.toISOString(),
      permissions: {
        isOwner,
        isShared,
        canCancel,
        canRun,
        canWrite,
      },
      runStats: statsByPipeline.get(p.id) ?? { total: 0, success: 0, failed: 0, running: 0 },
      activeRuns: active,
      recentRuns: completed.slice(0, runsPerPipeline),
      currentStep,
    }
  })

  // --- In-memory sort by active-first / active-last ---
  const sorted = [...items].sort((a, b) => {
    const aHas = a.activeRuns.length > 0 ? 1 : 0
    const bHas = b.activeRuns.length > 0 ? 1 : 0
    if (aHas !== bHas) {
      return sort === 'active_first' ? bHas - aHas : aHas - bHas
    }
    // Tie: newer updatedAt first
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })

  // --- Runtime stats ---
  const runtime = getRuntimeStats()
  const queuedRuns = await prisma.workflowRun.count({
    where: { status: 'pending', cancelRequestedAt: null },
  })

  const meta: PipelineMonitorMeta = {
    total,
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    runtime: {
      ...runtime,
      queuedRuns,
      capacityUsed: `${runtime.activeRuns}/${runtime.maxConcurrent}`,
    },
  }

  return { data: sorted, meta }
})
