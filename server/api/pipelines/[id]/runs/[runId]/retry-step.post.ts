/**
 * Перезапуск конкретного шага в существующем run.
 *
 * В отличие от /replay (который создаёт новый run), retry-step переиспользует
 * текущий run: удаляет WorkflowStep записи целевой ноды и всех downstream,
 * сбрасывает run в pending и переcпавнивает выполнение. Engine при resume
 * подхватит prior steps (success/partial/no_data/skipped) через
 * completedNodeIds и пропустит uplink, переиспользуя их output.
 */

import type { GraphNode, GraphEdge } from '~~/server/utils/pipeline-graph'

interface RetryStepBody {
  nodeId?: string
}

/** BFS вниз по edges — собираем все nodeIds, достижимые из target. */
function collectDownstream(targetNodeId: string, edges: GraphEdge[]): string[] {
  const adj = new Map<string, string[]>()
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, [])
    adj.get(e.source)!.push(e.target)
  }

  const visited = new Set<string>()
  const queue: string[] = [targetNodeId]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const next of adj.get(current) ?? []) {
      if (visited.has(next)) continue
      visited.add(next)
      queue.push(next)
    }
  }
  // target не включаем в downstream — он отдельная категория
  visited.delete(targetNodeId)
  return [...visited]
}

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canRunAgent'],
    moduleSlug: 'pipeline',
  })

  const id = Number(getRouterParam(event, 'id'))
  const runId = Number(getRouterParam(event, 'runId'))

  if (Number.isNaN(id) || Number.isNaN(runId)) {
    throw createError({ statusCode: 400, message: 'Некорректные параметры' })
  }

  const body = await readBody<RetryStepBody>(event).catch(() => ({} as RetryStepBody))
  const nodeId = typeof body?.nodeId === 'string' ? body.nodeId.trim() : ''
  if (!nodeId) {
    throw createError({ statusCode: 400, message: 'Не указан nodeId шага' })
  }

  const run = await prisma.workflowRun.findFirst({
    where: { id: runId, pipelineId: id },
    include: {
      pipeline: { select: { userId: true, sharedWith: true, status: true, graphData: true } },
    },
  })

  if (!run || !run.pipeline) {
    throw createError({ statusCode: 404, message: 'Запуск не найден' })
  }

  // Access check — единый паттерн с cancel/replay
  const isOwner = run.pipeline.userId === user.id
  const isShared = run.pipeline.sharedWith.includes(user.id)
  if (!isOwner && !isShared && !user.canAdmin) {
    throw createError({ statusCode: 403, message: 'Нет доступа' })
  }

  if (run.pipeline.status !== 'active') {
    throw createError({ statusCode: 400, message: 'Конвейер не активен' })
  }

  // Запрещаем retry для активных run — иначе двойной exec
  if (run.status === 'running' || run.status === 'pending') {
    throw createError({
      statusCode: 409,
      message: `Невозможно перезапустить шаг: запуск ещё в статусе "${run.status}"`,
    })
  }

  // success run перезапускать незачем — это уже не failure recovery
  if (run.status === 'success') {
    throw createError({
      statusCode: 409,
      message: 'Запуск завершён успешно — для повторного прогона используйте «Перезапустить»',
    })
  }

  // Берём snapshot если есть — он отражает граф на момент исходного запуска,
  // а не возможно изменённый текущий graphData. Это важно: completedNodeIds
  // привязаны к старым nodeIds.
  const graphSource = (run.graphSnapshot ?? run.pipeline.graphData) as
    | { nodes?: GraphNode[]; edges?: GraphEdge[] }
    | null

  const nodes = Array.isArray(graphSource?.nodes) ? graphSource!.nodes! : []
  const edges = Array.isArray(graphSource?.edges) ? graphSource!.edges! : []

  const targetNode = nodes.find(n => n.id === nodeId)
  if (!targetNode) {
    throw createError({ statusCode: 404, message: 'Шаг не найден в графе' })
  }

  // Шаг для целевой ноды в этом run
  const targetStep = await prisma.workflowStep.findFirst({
    where: { runId, nodeId },
    orderBy: { createdAt: 'desc' },
  })

  if (!targetStep) {
    throw createError({ statusCode: 404, message: 'Шаг не выполнялся в этом запуске' })
  }

  // Защита от лишнего ретрая успешного шага
  if (targetStep.status === 'success' || targetStep.status === 'partial' || targetStep.status === 'no_data') {
    throw createError({
      statusCode: 409,
      message: `Шаг уже завершён со статусом "${targetStep.status}" — retry не нужен`,
    })
  }

  if (targetStep.status === 'pending' || targetStep.status === 'running') {
    throw createError({
      statusCode: 409,
      message: `Шаг ещё выполняется (статус "${targetStep.status}")`,
    })
  }

  // Каскадный сброс: target + все downstream удаляем, чтобы engine
  // создал их заново с чистого листа. Upstream success-шаги engine
  // подхватит через completedNodeIds и пропустит без повторного exec.
  const downstreamIds = collectDownstream(nodeId, edges)
  const idsToReset = [nodeId, ...downstreamIds]

  // ── Phantom prevention (этап A1 из phantom_video_stuck_cancel_fix_plan) ──
  // Извлекаем videoIds/scenarioIds из output удаляемых video/scenario шагов
  // ДО deleteMany — иначе при resume engine создаст новые сущности параллельно
  // старым и в галерее повиснут «фантомные» Video (старые failed + новые в работе
  // для одного и того же scenarioId).
  //
  // Soft-cancel (не delete!): сохраняем legacy записи для аудита/cost-учёта.
  // VideoStatus enum использует значение `canceled` (одна L) — см. schema.prisma:493.
  // Scenario.isDeleted + deletedAt уже в схеме (584-585), миграции не нужны.
  const stepsToCleanup = await prisma.workflowStep.findMany({
    where: {
      runId,
      nodeId: { in: idsToReset },
      nodeType: { in: ['video', 'scenario'] },
    },
    select: { nodeType: true, output: true },
  })

  const videoIdsToCancel = new Set<number>()
  const scenarioIdsToDelete = new Set<number>()
  for (const step of stepsToCleanup) {
    const out = step.output as Record<string, unknown> | null
    if (!out) continue
    if (step.nodeType === 'video') {
      // executeVideoNode возвращает { videos: [{id, ...}] } — см. pipeline-executors.ts:967
      const videos = Array.isArray(out.videos) ? (out.videos as Array<{ id?: unknown }>) : []
      for (const v of videos) {
        if (typeof v?.id === 'number') videoIdsToCancel.add(v.id)
      }
    } else if (step.nodeType === 'scenario') {
      // executeScenarioNode возвращает { scenarios: [{id, ...}] } — см. pipeline-executors.ts:653
      const scenarios = Array.isArray(out.scenarios) ? (out.scenarios as Array<{ id?: unknown }>) : []
      for (const s of scenarios) {
        if (typeof s?.id === 'number') scenarioIdsToDelete.add(s.id)
      }
    }
  }

  // Fallback: output может быть потерян (старый run без артефактов или legacy формат).
  // Подбираем все НЕ-терминальные Video с runId — они однозначно были созданы этим run.
  const fallbackVideos = await prisma.video.findMany({
    where: {
      runId,
      status: { notIn: ['completed', 'canceled'] },
    },
    select: { id: true },
  })
  for (const v of fallbackVideos) videoIdsToCancel.add(v.id)

  // Soft-cancel Video — только не-terminal (completed/canceled не трогаем).
  // isLocked=false снимает lock-флаг на случай, если worker оборвался в середине.
  let cancelledVideoCount = 0
  if (videoIdsToCancel.size > 0) {
    const res = await prisma.video.updateMany({
      where: {
        id: { in: [...videoIdsToCancel] },
        status: { notIn: ['completed', 'canceled'] },
      },
      data: {
        status: 'canceled',
        finishedAt: new Date(),
        errorMessage: 'Шаг был перезапущен — это видео заменено новым прогоном',
        isLocked: false,
      },
    })
    cancelledVideoCount = res.count
  }

  // Soft-delete Scenario — помечаем isDeleted=true, чтобы executor (A3) не
  // вернул их по idempotency-поиску.
  let deletedScenarioCount = 0
  if (scenarioIdsToDelete.size > 0) {
    const res = await prisma.scenario.updateMany({
      where: {
        id: { in: [...scenarioIdsToDelete] },
        isDeleted: false,
      },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    })
    deletedScenarioCount = res.count
  }

  console.log(
    `[retry-step] runId=${runId} nodeId=${nodeId}: cancelled ${cancelledVideoCount} Video(s), soft-deleted ${deletedScenarioCount} Scenario(s)`,
  )

  await prisma.workflowStep.deleteMany({
    where: {
      runId,
      nodeId: { in: idsToReset },
    },
  })

  // Сброс самого run в pending — engine стартанёт заново с resume семантикой
  await prisma.workflowRun.update({
    where: { id: runId },
    data: {
      status: 'pending',
      errorMessage: null,
      errorCategory: null,
      finishedAt: null,
      cancelRequestedAt: null,
      cancelRequestedBy: null,
    },
  })

  enqueueRun(runId).catch(() => {})

  await logAgent('pipeline-retry-step', 'info',
    `Retry шага "${targetNode.data?.label ?? nodeId}" в run #${runId} конвейера #${id} (downstream: ${downstreamIds.length}, cancelled videos: ${cancelledVideoCount}, deleted scenarios: ${deletedScenarioCount})`,
    {
      runId,
      pipelineId: id,
      userId: user.id,
      nodeId,
      downstreamReset: downstreamIds,
      cancelledVideoIds: [...videoIdsToCancel],
      softDeletedScenarioIds: [...scenarioIdsToDelete],
    },
  )

  return {
    data: {
      runId,
      retriedNodeId: nodeId,
      downstreamReset: downstreamIds,
    },
  }
})
