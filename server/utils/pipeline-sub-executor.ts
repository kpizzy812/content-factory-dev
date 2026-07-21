/**
 * Sub-Pipeline Executor.
 *
 * Allows calling another pipeline as a sub-workflow.
 * Supports two modes:
 * - wait: Creates a child run and waits for completion (synchronous within parent)
 * - fire_and_forget: Creates a child run and continues (asynchronous)
 *
 * Links parent and child runs via parentRunId.
 * Respects parent cancellation signal — cascades cancel to child run.
 */

import { throwIfAborted, cancellableDelay, CancellationError, abortRun } from './pipeline-cancel-registry'

const MAX_SUB_PIPELINE_WAIT_MS = 15 * 60 * 1000 // 15 minutes
const MAX_SUB_PIPELINE_DEPTH = 10

/**
 * Walk up the parentRunId chain in DB to detect:
 * - Depth overflow (> MAX_SUB_PIPELINE_DEPTH)
 * - Cycle: targetPipelineId already appears in the ancestry chain
 * Returns { depth, ancestorPipelineIds } or throws on violation.
 */
async function checkRecursionSafety(
  parentRunId: number | undefined,
  targetPipelineId: number,
): Promise<{ depth: number; ancestorPipelineIds: number[] }> {
  const ancestorPipelineIds: number[] = []
  let currentRunId = parentRunId
  let depth = 0

  while (currentRunId) {
    depth++
    if (depth > MAX_SUB_PIPELINE_DEPTH) {
      throw new Error(
        `Подконвейер: превышена максимальная глубина вложенности (${MAX_SUB_PIPELINE_DEPTH}). `
        + `Цепочка: ${ancestorPipelineIds.map(id => `#${id}`).join(' → ')}`,
      )
    }

    const run = await prisma.workflowRun.findUnique({
      where: { id: currentRunId },
      select: { pipelineId: true, parentRunId: true },
    })

    if (!run) break

    ancestorPipelineIds.push(run.pipelineId)

    if (run.pipelineId === targetPipelineId) {
      throw new Error(
        `Подконвейер: обнаружен цикл — конвейер #${targetPipelineId} уже присутствует в цепочке вызовов: `
        + `${ancestorPipelineIds.map(id => `#${id}`).join(' → ')} → #${targetPipelineId}`,
      )
    }

    currentRunId = run.parentRunId ?? undefined
  }

  return { depth, ancestorPipelineIds }
}

export async function executeSubPipelineNode(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const targetPipelineId = Number(config.pipelineId)
  const mode = String(config.mode || 'wait') as 'wait' | 'fire_and_forget'
  // _parentRunId injected by pipeline-engine processNode for sub_pipeline nodes
  const parentRunId = Number(config._parentRunId) || Number(input._runId) || undefined

  if (!targetPipelineId || Number.isNaN(targetPipelineId)) {
    throw new Error('Подконвейер: не указан ID целевого конвейера')
  }

  // Load target pipeline
  const targetPipeline = await prisma.pipeline.findUnique({
    where: { id: targetPipelineId },
    select: { id: true, status: true, graphData: true, name: true },
  })

  if (!targetPipeline) {
    throw new Error(`Подконвейер: конвейер #${targetPipelineId} не найден`)
  }

  if (targetPipeline.status !== 'active') {
    throw new Error(`Подконвейер "${targetPipeline.name}" не активен`)
  }

  const graph = targetPipeline.graphData as { nodes?: unknown[] }
  if (!Array.isArray(graph?.nodes) || graph.nodes.length === 0) {
    throw new Error(`Подконвейер "${targetPipeline.name}" не содержит блоков`)
  }

  // Recursion safety: depth limit + cycle detection via DB ancestry chain
  const { depth } = await checkRecursionSafety(parentRunId, targetPipelineId)

  // Create child run
  const childRun = await prisma.workflowRun.create({
    data: {
      pipelineId: targetPipelineId,
      triggerType: 'manual',
      status: 'pending',
      parentRunId: parentRunId,
      graphSnapshot: targetPipeline.graphData as never,
    },
  })

  // Start execution through runtime governor
  enqueueRun(childRun.id).catch(() => {})

  if (mode === 'fire_and_forget') {
    return {
      childRunId: childRun.id,
      pipelineId: targetPipelineId,
      pipelineName: targetPipeline.name,
      mode: 'fire_and_forget',
      status: 'started',
    }
  }

  // Wait mode — poll for completion with cancellation support
  const startWait = Date.now()
  const POLL_INTERVAL = 3000

  while (Date.now() - startWait < MAX_SUB_PIPELINE_WAIT_MS) {
    try {
      await cancellableDelay(POLL_INTERVAL, signal)
    } catch {
      // Parent cancelled — cascade cancel to child run
      abortRun(childRun.id)
      await prisma.workflowRun.update({
        where: { id: childRun.id },
        data: {
          cancelRequestedAt: new Date(),
          cancelRequestedBy: null,
        },
      }).catch(() => {})
      throw new CancellationError()
    }

    const updated = await prisma.workflowRun.findUnique({
      where: { id: childRun.id },
      select: { status: true, errorMessage: true, finishedAt: true },
    })

    if (!updated) {
      throw new Error(`Подконвейер: дочерний запуск #${childRun.id} не найден`)
    }

    if (updated.status === 'success') {
      const lastStep = await prisma.workflowStep.findFirst({
        where: { runId: childRun.id, status: 'success' },
        orderBy: { createdAt: 'desc' },
        select: { output: true },
      })

      return {
        childRunId: childRun.id,
        pipelineId: targetPipelineId,
        pipelineName: targetPipeline.name,
        mode: 'wait',
        status: 'success',
        output: lastStep?.output ?? {},
      }
    }

    if (['failed', 'cancelled'].includes(updated.status)) {
      throw new Error(
        `Подконвейер "${targetPipeline.name}" завершился с ошибкой: ${updated.errorMessage || updated.status}`,
      )
    }
  }

  throw new Error(`Подконвейер "${targetPipeline.name}": таймаут ожидания (${MAX_SUB_PIPELINE_WAIT_MS / 60000} мин)`)
}
