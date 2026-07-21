/**
 * Production-grade Pipeline Execution Engine.
 *
 * Features:
 * - Cancellation support (checks cancelRequestedAt between steps)
 * - Structured error classification
 * - Step-level logs with timestamps
 * - Graph snapshot on run start
 * - Parallel execution of independent branches
 * - Stuck run detection
 * - Retry with attempt tracking
 * - Error edge routing (actually executes error handler nodes)
 */

import type { GraphNode, GraphEdge } from './pipeline-graph'
import {
  topologicalSort,
  executeNode,
  collectInput,
  collectFullPipelineInput,
  findErrorEdgeTarget,
} from './pipeline-graph'
import type { ErrorCategory, StepLogEntry } from '~~/shared/types/workflow'
import {
  createRunSignal,
  cleanupRunSignal,
  cancellableDelay,
  CancellationError,
} from './pipeline-cancel-registry'
import { prisma } from './prisma'
import { logAgent } from './agent-logger'

const MAX_RUN_DURATION_MS = 30 * 60 * 1000 // 30 minutes
const MAX_STEP_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes per step (default)
/**
 * Cancel watchdog порог: после запроса отмены (cancelRequestedAt) ждём
 * 2 минуты graceful shutdown'а worker'а. Если за это время run всё ещё
 * в running — финализируем принудительно. Покрывает кейсы, когда worker
 * завис в глубоком fal polling без AbortSignal propagation (баг B, причина 3).
 *
 * Контракт с другими ветками:
 * - B1 sweeper (pipeline-runtime.ts:finalizeCancelledPending) — pending+cancel
 * - B2 (здесь) — running+cancel >2 мин
 * - Classic stuck (ниже) — running без cancel >60 мин
 */
const CANCEL_STUCK_THRESHOLD_MS = 2 * 60 * 1000 // 2 минуты

// Heavy nodes that involve external API calls and real generation
const HEAVY_NODE_TIMEOUT_MS = 25 * 60 * 1000 // 25 minutes for video/upload
const HEAVY_NODE_TYPES = new Set(['video', 'upload', 'trendwatcher', 'scenario', 'google_drive_uploader'])

/** Classify error into a structured category. */
function classifyError(err: Error): ErrorCategory {
  const msg = err.message.toLowerCase()
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('aborted')) return 'timeout'
  if (msg.includes('permission') || msg.includes('forbidden') || msg.includes('unauthorized') || msg.includes('403')) return 'permission'
  if (msg.includes('fetch') || msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('api') || msg.includes('502') || msg.includes('503')) return 'external_api'
  if (msg.includes('validation') || msg.includes('invalid') || msg.includes('required') || msg.includes('обязателен') || msg.includes('некорректн')) return 'validation'
  if (msg.includes('cancel') || msg.includes('отмен')) return 'cancellation'
  if (msg.includes('config') || msg.includes('не настроен') || msg.includes('не найден')) return 'configuration'
  return 'runtime'
}

/** Build expression context from node outputs. */
function buildExpressionContext(
  nodes: GraphNode[],
  outputs: Map<string, Record<string, unknown>>,
): Record<string, any> {
  const ctx: Record<string, any> = { $node: {} as Record<string, any> }
  for (const node of nodes) {
    const label = node.data?.label ?? node.id
    const output = outputs.get(node.id)
    if (output) {
      ctx.$node[label] = { output }
    }
  }
  return ctx
}

/** Check if run cancellation was requested. */
async function isCancelled(runId: number): Promise<boolean> {
  const run = await prisma.workflowRun.findUnique({
    where: { id: runId },
    select: { cancelRequestedAt: true },
  })
  return !!run?.cancelRequestedAt
}

/** Create a step log entry. */
function logEntry(level: StepLogEntry['level'], message: string, data?: unknown): StepLogEntry {
  return { ts: new Date().toISOString(), level, message, data }
}

/** Process a single node: create step, execute with retry, record results. */
interface SystemContext {
  pipelineName: string
  triggerType: string
  pipelineId?: number
}

async function processNode(
  runId: number,
  node: GraphNode,
  edges: GraphEdge[],
  outputs: Map<string, Record<string, unknown>>,
  allNodes: GraphNode[],
  systemContext?: SystemContext,
  signal?: AbortSignal,
  completedNodeIds?: Set<string>,
): Promise<{ failed: boolean; message: string; errorCategory?: ErrorCategory }> {
  const nodeId = node.id
  const nodeType = node.data?.type ?? 'unknown'
  const nodeName = node.data?.label ?? nodeType
  const nodeData = (node.data ?? {}) as Record<string, unknown>
  const config = (nodeData.config ?? {}) as Record<string, unknown>
  const pinnedOutput = nodeData.pinnedOutput as Record<string, unknown> | undefined

  // Resume: нода уже выполнена в этом run (после restart/reque). Output уже
  // загружен в outputs Map в executePipeline — просто пропускаем выполнение,
  // не создавая дубль WorkflowStep и не дёргая executor (двойной расход API).
  if (completedNodeIds?.has(nodeId)) {
    return { failed: false, message: '' }
  }

  // Тяжёлые AI-ноды иногда падают по timeout/rate-limit/empty response. Auto-retry
  // дешевле, чем ждать пока человек заметит и вручную нажмёт retry-step. Дефолт 1
  // (ровно одна повторная попытка) применяется только если пользователь не задал
  // retryCount явно — иначе уважаем его выбор (включая 0 = без retry).
  const HEAVY_AUTO_RETRY = new Set(['scenario', 'video', 'idea', 'trendwatcher'])
  const userRetry = config.retryCount
  const defaultRetry = HEAVY_AUTO_RETRY.has(nodeType) ? 1 : 0
  const retryCount = Math.min(
    userRetry == null ? defaultRetry : Math.max(0, Number(userRetry) || 0),
    3,
  )
  const retryDelay = Number(config.retryDelay) || 1000

  const logs: StepLogEntry[] = []
  const retryPolicy = { maxRetries: retryCount, delayMs: retryDelay }

  const step = await prisma.workflowStep.create({
    data: {
      runId,
      nodeId,
      nodeName,
      nodeType,
      status: 'pending',
      retryPolicy: retryPolicy as never,
    },
  })

  // Notification nodes получают accumulated context от ВСЕХ нод pipeline,
  // а не только от прямых предшественников — это гарантирует доступность
  // trendsCount, scenariosCount и других summary variables, вычисленных ранними нодами.
  const rawInput = nodeType === 'notification'
    ? collectFullPipelineInput(outputs)
    : collectInput(nodeId, edges, outputs)

  // Inject system variables so notification templates can always resolve pipelineName, runId, triggerType
  const input = {
    ...rawInput,
    _pipelineName: rawInput._pipelineName ?? (systemContext?.pipelineName ?? ''),
    _runId: rawInput._runId ?? runId,
    _triggerType: rawInput._triggerType ?? (systemContext?.triggerType ?? 'manual'),
    _pipelineId: rawInput._pipelineId ?? (systemContext?.pipelineId ?? undefined),
    _nodeCanvasId: rawInput._nodeCanvasId ?? nodeId,
  }

  logs.push(logEntry('info', `Начало выполнения ноды "${nodeName}" (${nodeType})`))

  // Pinned output — skip real execution
  if (pinnedOutput && typeof pinnedOutput === 'object') {
    outputs.set(nodeId, pinnedOutput)
    logs.push(logEntry('info', 'Использован закреплённый output (pinned)'))
    await prisma.workflowStep.update({
      where: { id: step.id },
      data: {
        status: 'success',
        duration: 0,
        output: pinnedOutput as never,
        input: input as never,
        logs: logs as never,
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    })
    return { failed: false, message: '' }
  }

  // Expression evaluation
  const exprContext = buildExpressionContext(allNodes, outputs)
  const resolvedConfig = resolveConfigExpressions(config, exprContext)

  const startTime = new Date()
  await prisma.workflowStep.update({
    where: { id: step.id },
    data: { status: 'running', input: input as never, startedAt: startTime },
  })

  // Credential resolution — resolve CredentialId references to actual secrets
  let finalConfig = resolvedConfig
  try {
    const run = await prisma.workflowRun.findUnique({
      where: { id: runId },
      select: { pipeline: { select: { userId: true } } },
    })
    if (run?.pipeline?.userId) {
      const credResult = await resolveNodeCredentials(resolvedConfig, run.pipeline.userId)
      finalConfig = credResult.config
      if (Object.keys(credResult.credentials).length > 0) {
        logs.push(logEntry('info', `Загружены учётные данные: ${Object.keys(credResult.credentials).join(', ')}`))
      }
    }
  } catch (credErr) {
    const credMsg = credErr instanceof Error ? credErr.message : 'Ошибка загрузки учётных данных'
    logs.push(logEntry('error', credMsg))
    const finishedAt = new Date()
    await prisma.workflowStep.update({
      where: { id: step.id },
      data: {
        status: 'failed',
        duration: finishedAt.getTime() - startTime.getTime(),
        error: credMsg.slice(0, 2000),
        errorCategory: 'configuration',
        logs: logs as never,
        finishedAt,
      },
    })
    return { failed: true, message: `Ошибка учётных данных в ноде "${nodeName}": ${credMsg}`, errorCategory: 'configuration' }
  }

  // Inject _parentRunId for sub_pipeline nodes — enables recursion safety checks
  if (nodeType === 'sub_pipeline') {
    finalConfig = { ...finalConfig, _parentRunId: runId }
  }

  const resolvedNodeData = { ...nodeData, config: finalConfig }

  let lastError: Error | null = null
  let lastCategory: ErrorCategory = 'unknown'

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    // Check cancellation between retries — signal (instant) + DB (fallback)
    if (signal?.aborted || await isCancelled(runId)) {
      logs.push(logEntry('warn', 'Выполнение отменено пользователем'))
      const finishedAt = new Date()
      await prisma.workflowStep.update({
        where: { id: step.id },
        data: {
          status: 'cancelled',
          duration: finishedAt.getTime() - startTime.getTime(),
          logs: logs as never,
          attemptCount: attempt,
          finishedAt,
        },
      })
      return { failed: true, message: 'Выполнение отменено', errorCategory: 'cancellation' }
    }

    if (attempt > 0) {
      const backoffMs = retryDelay * Math.pow(2, attempt - 1)
      logs.push(logEntry('info', `Повторная попытка ${attempt}/${retryCount} через ${backoffMs}мс`))
      try {
        await cancellableDelay(backoffMs, signal)
      } catch {
        // Signal aborted during retry delay — fall through to cancellation check at loop start
        continue
      }
    }

    try {
      // Timeout + cancellation wrapper — heavy nodes get extended timeout
      const stepTimeout = HEAVY_NODE_TYPES.has(nodeType) ? HEAVY_NODE_TIMEOUT_MS : MAX_STEP_TIMEOUT_MS
      const output = await Promise.race([
        executeNode(nodeType, resolvedNodeData, input, signal),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Таймаут выполнения ноды (${stepTimeout / 1000}с)`)), stepTimeout),
        ),
        // Abort race — resolve immediately when signal fires
        ...(signal ? [new Promise<never>((_, reject) => {
          if (signal.aborted) reject(new CancellationError())
          else signal.addEventListener('abort', () => reject(new CancellationError()), { once: true })
        })] : []),
      ])

      const finishedAt = new Date()
      const duration = finishedAt.getTime() - startTime.getTime()

      if (output === null) {
        logs.push(logEntry('info', 'Нода вернула null — пропуск downstream'))
        await prisma.workflowStep.update({
          where: { id: step.id },
          data: {
            status: 'skipped',
            duration,
            output: { skipped: true } as never,
            logs: logs as never,
            attemptCount: attempt + 1,
            finishedAt,
          },
        })
        return { failed: false, message: '' }
      }

      outputs.set(nodeId, output)

      // Edge snapshot: для каждого incoming edge — какие top-level ключи source
      // предоставил. Помогает UI монитора показать «loop отдал [items,_runId],
      // scenario ждала [trends]». Только диагностика — downstream логика
      // _edgeSnapshot не использует. Мутируем output (он же в outputs Map и пойдёт
      // в БД через тот же reference). Если output не object — пропускаем мутацию.
      if (output && typeof output === 'object' && !Array.isArray(output)) {
        const { buildEdgeSnapshot } = await import('./pipeline-edge-snapshot')
        const snap = buildEdgeSnapshot(nodeId, edges, outputs)
        if (snap) {
          ;(output as Record<string, unknown>)._edgeSnapshot = snap
        }
      }

      // Domain outcome awareness: executor сигнализирует о degraded/failed/no_data результате
      const outputRec = output as Record<string, unknown>
      const isDomainDegraded = !!outputRec._domainDegraded
      const isNoData = outputRec._noData === true || outputRec._domainStatus === 'no_data'
      let stepStatus: 'success' | 'partial' | 'no_data' = 'success'

      if (isNoData) {
        stepStatus = 'no_data'
        const reason = typeof outputRec._noDataReason === 'string' ? outputRec._noDataReason : 'нет данных'
        logs.push(logEntry('warn', `Нода завершилась без данных за ${duration}мс: ${reason}`, { outputKeys: Object.keys(output) }))
      } else if (isDomainDegraded) {
        stepStatus = 'partial'
        const failedCount = outputRec.failedCount ?? 0
        const generatedCount = outputRec.generatedCount ?? 0
        const timeoutCount = outputRec.timeoutCount ?? 0
        const details = [`${generatedCount} успешно`, `${failedCount} с ошибкой`]
        if (timeoutCount) details.push(`${timeoutCount} таймаут`)
        logs.push(logEntry('warn', `Частичный результат за ${duration}мс: ${details.join(', ')}`, { outputKeys: Object.keys(output) }))
      } else {
        logs.push(logEntry('info', `Успешно за ${duration}мс`, { outputKeys: Object.keys(output) }))
      }

      await prisma.workflowStep.update({
        where: { id: step.id },
        data: {
          status: stepStatus,
          duration,
          output: output as never,
          logs: logs as never,
          attemptCount: attempt + 1,
          finishedAt,
        },
      })

      return { failed: false, message: '' }
    } catch (err) {
      // CancellationError — немедленный выход, не считать как retry failure
      if (err instanceof CancellationError) {
        logs.push(logEntry('warn', 'Выполнение отменено пользователем (signal)'))
        const finishedAt = new Date()
        await prisma.workflowStep.update({
          where: { id: step.id },
          data: {
            status: 'cancelled',
            duration: finishedAt.getTime() - startTime.getTime(),
            logs: logs as never,
            attemptCount: attempt + 1,
            finishedAt,
          },
        })
        return { failed: true, message: 'Выполнение отменено', errorCategory: 'cancellation' }
      }

      lastError = err instanceof Error ? err : new Error('Неизвестная ошибка')
      lastCategory = classifyError(lastError)
      logs.push(logEntry('error', `Попытка ${attempt + 1}: ${lastError.message}`, { category: lastCategory }))
    }
  }

  // All attempts exhausted
  const finishedAt = new Date()
  const duration = finishedAt.getTime() - startTime.getTime()
  const errorMsg = lastError?.message ?? 'Неизвестная ошибка'

  logs.push(logEntry('error', `Все попытки исчерпаны (${retryCount + 1}). Финальная ошибка: ${errorMsg}`))

  await prisma.workflowStep.update({
    where: { id: step.id },
    data: {
      status: 'failed',
      duration,
      error: errorMsg.slice(0, 2000),
      errorCategory: lastCategory,
      logs: logs as never,
      attemptCount: retryCount + 1,
      finishedAt,
    },
  })

  // Error routing — find and queue error handler node
  const errorTarget = findErrorEdgeTarget(nodeId, edges)
  if (errorTarget) {
    // Include upstream input so error handler (e.g. notification) can resolve variables
    // from prior nodes (trendsCount, videosCount etc.), not just bare error info
    outputs.set(nodeId, { ...input, _error: true, errorMessage: errorMsg, errorCategory: lastCategory })
    logs.push(logEntry('info', `Маршрутизация ошибки к ноде: ${errorTarget}`))
    return { failed: false, message: '' }
  }

  return { failed: true, message: `Ошибка в ноде "${nodeName}": ${errorMsg}`, errorCategory: lastCategory }
}

/**
 * Build execution levels for controlled parallel execution.
 * Groups nodes by their topological depth — nodes at the same depth
 * with no mutual dependencies can run in parallel.
 */
function buildExecutionLevels(
  sortedIds: string[],
  edges: GraphEdge[],
  nodes?: GraphNode[],
): string[][] {
  const depth = new Map<string, number>()

  for (const id of sortedIds) {
    const incoming = edges.filter(e => e.target === id)
    if (incoming.length === 0) {
      depth.set(id, 0)
    } else {
      const maxParentDepth = Math.max(
        ...incoming.map(e => depth.get(e.source) ?? 0),
      )
      depth.set(id, maxParentDepth + 1)
    }
  }

  // Disconnected notification ноды без incoming edges должны выполняться последними,
  // иначе collectFullPipelineInput вернёт пустой outputs Map и все summary-переменные
  // (trendsCount, videosCount, errorsCount и т.д.) будут unresolved → blocked_unresolved_variables.
  if (nodes && nodes.length > 0) {
    const maxDepth = sortedIds.length > 0
      ? Math.max(...Array.from(depth.values()))
      : 0
    const nodeMap = new Map(nodes.map(n => [n.id, n]))
    for (const id of sortedIds) {
      if (depth.get(id) !== 0) continue
      const node = nodeMap.get(id)
      if (node?.data?.type === 'notification') {
        depth.set(id, maxDepth + 1)
      }
    }
  }

  const levels = new Map<number, string[]>()
  for (const id of sortedIds) {
    const d = depth.get(id) ?? 0
    if (!levels.has(d)) levels.set(d, [])
    levels.get(d)!.push(id)
  }

  return Array.from(levels.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, ids]) => ids)
}

/** Main function: load run + pipeline, execute graph with production-grade semantics. */
export async function executePipeline(runId: number): Promise<void> {
  const run = await prisma.workflowRun.findUnique({
    where: { id: runId },
    include: { pipeline: true },
  })

  if (!run || !run.pipeline) {
    await prisma.workflowRun.update({
      where: { id: runId },
      data: {
        status: 'failed',
        errorMessage: 'Запуск или конвейер не найден',
        errorCategory: 'configuration',
        finishedAt: new Date(),
      },
    }).catch(() => {})
    return
  }

  const graph = run.pipeline.graphData as { nodes?: GraphNode[]; edges?: GraphEdge[] }
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
  const edges = Array.isArray(graph?.edges) ? graph.edges : []

  // Snapshot graph on run (if not already set by caller)
  const graphSnapshot = run.graphSnapshot ?? { nodes, edges }

  // Create AbortController signal for this run — enables instant cancellation
  const signal = createRunSignal(runId)

  await prisma.workflowRun.update({
    where: { id: runId },
    data: {
      status: 'running',
      graphSnapshot: graphSnapshot as never,
      startedAt: new Date(),
    },
  })

  let hasFailed = false
  let failMessage = ''
  let failCategory: ErrorCategory = 'unknown'
  const runStartTime = Date.now()

  // System context: inject pipelineName/runId/triggerType into all node inputs
  const systemCtx: SystemContext = {
    pipelineName: run.pipeline.name ?? '',
    triggerType: run.triggerType as string,
    pipelineId: run.pipelineId,
  }

  // ─── Pre-flight: fal.ai model access check for video nodes ───
  try {
    const videoNodes = nodes.filter(n => n.data?.type === 'video')
    if (videoNodes.length > 0) {
      const { falProbeAccessBatch } = await import('./fal')
      const { getModel } = await import('./video-models')
      const modelsToCheck: string[] = []

      for (const vn of videoNodes) {
        const cfg = (vn.data?.config ?? {}) as Record<string, unknown>
        modelsToCheck.push(String(cfg.imageModelId || 'fal-ai/flux/dev'))
        modelsToCheck.push(String(cfg.videoModelId || 'fal-ai/kling-video/v3/standard/text-to-video'))
      }

      const uniqueModels = [...new Set(modelsToCheck)]
      const accessResults = await falProbeAccessBatch(uniqueModels)
      const blockedModels: string[] = []

      for (const [endpoint, result] of accessResults) {
        if (result.status !== 'available') {
          const meta = getModel(endpoint)
          blockedModels.push(`"${meta?.name ?? endpoint}": ${result.reason}`)
        }
      }

      if (blockedModels.length > 0) {
        hasFailed = true
        failMessage = `Запуск заблокирован: недоступные модели fal.ai — ${blockedModels.join('; ')}`
        failCategory = 'permission'

        await prisma.workflowRun.update({
          where: { id: runId },
          data: {
            status: 'failed',
            finishedAt: new Date(),
            errorMessage: failMessage.slice(0, 2000),
            errorCategory: failCategory,
          },
        })

        await logAgent(
          'pipeline-engine',
          'error',
          `Конвейер #${run.pipelineId} заблокирован: ${failMessage}`,
          { runId, pipelineId: run.pipelineId },
        )
        return
      }
    }
  } catch (preflightErr) {
    // Non-fatal: если probe не удался, продолжаем (executeVideoNode сам проверит)
    await logAgent('pipeline-engine', 'warn', `Pre-flight access check failed: ${preflightErr instanceof Error ? preflightErr.message : 'unknown'}`, { runId, pipelineId: run.pipelineId }).catch(() => {})
  }

  try {
    const sortedIds = topologicalSort(nodes, edges)
    const nodeMap = new Map(nodes.map(n => [n.id, n]))
    const outputs = new Map<string, Record<string, unknown>>()

    // Resume: подгружаем уже выполненные шаги этого run (могут остаться после
    // restart сервера / reque'а из recoverOrphanedRuns). Их output восстанавливаем
    // в outputs Map — downstream ноды получат корректный input. processNode
    // увидит nodeId в completedNodeIds и пропустит executor, не создавая дубль.
    const priorSteps = await prisma.workflowStep.findMany({
      where: {
        runId,
        status: { in: ['success', 'partial', 'no_data', 'skipped'] },
      },
      orderBy: { finishedAt: 'desc' },
      select: { nodeId: true, status: true, output: true },
    })
    const completedNodeIds = new Set<string>()
    for (const s of priorSteps) {
      if (completedNodeIds.has(s.nodeId)) continue
      completedNodeIds.add(s.nodeId)
      // skipped даёт пустой output — downstream получает пустой input как и при первом проходе
      if (s.status !== 'skipped' && s.output && typeof s.output === 'object') {
        outputs.set(s.nodeId, s.output as Record<string, unknown>)
      }
    }
    if (completedNodeIds.size > 0) {
      await logAgent(
        'pipeline-engine',
        'info',
        `Resume: пропускаем ${completedNodeIds.size} уже выполненных шагов в run #${runId}`,
        { runId, pipelineId: run.pipelineId, completedCount: completedNodeIds.size },
      ).catch(() => {})
    }

    // Build execution levels for parallel execution
    const levels = buildExecutionLevels(sortedIds, edges, nodes)

    for (const level of levels) {
      // Check run timeout
      if (Date.now() - runStartTime > MAX_RUN_DURATION_MS) {
        hasFailed = true
        failMessage = `Таймаут выполнения конвейера (${MAX_RUN_DURATION_MS / 1000 / 60} мин)`
        failCategory = 'timeout'
        break
      }

      // Check cancellation between levels — signal (instant) + DB (fallback)
      if (signal.aborted || await isCancelled(runId)) {
        hasFailed = true
        failMessage = 'Выполнение отменено пользователем'
        failCategory = 'cancellation'

        // Mark remaining steps as cancelled
        for (const nodeId of level) {
          const node = nodeMap.get(nodeId)
          if (!node) continue
          await prisma.workflowStep.create({
            data: {
              runId,
              nodeId,
              nodeName: node.data?.label ?? 'unknown',
              nodeType: node.data?.type ?? 'unknown',
              status: 'cancelled',
              startedAt: new Date(),
              finishedAt: new Date(),
            },
          })
        }
        break
      }

      // Execute nodes at this level
      // For single-node levels, execute directly
      // For multi-node levels, run in parallel with concurrency limit
      if (level.length === 1) {
        const node = nodeMap.get(level[0]!)
        if (!node) continue
        const result = await processNode(runId, node, edges, outputs, nodes, systemCtx, signal, completedNodeIds)
        if (result.failed) {
          hasFailed = true
          failMessage = result.message
          failCategory = result.errorCategory ?? 'runtime'
          break
        }
      } else {
        // Parallel execution with concurrency limit of 3
        const CONCURRENCY = 3
        const nodeIds = [...level]
        let levelFailed = false

        while (nodeIds.length > 0 && !levelFailed) {
          const batch = nodeIds.splice(0, CONCURRENCY)
          const results = await Promise.all(
            batch.map(async (nodeId) => {
              const node = nodeMap.get(nodeId)
              if (!node) return { failed: false, message: '' }
              return processNode(runId, node, edges, outputs, nodes, systemCtx, signal, completedNodeIds)
            }),
          )

          for (const result of results) {
            if (result.failed) {
              levelFailed = true
              hasFailed = true
              failMessage = result.message
              failCategory = result.errorCategory ?? 'runtime'
              break
            }
          }
        }

        if (hasFailed) break
      }
    }
  } catch (err) {
    hasFailed = true
    if (err instanceof CancellationError) {
      failMessage = 'Выполнение отменено пользователем'
      failCategory = 'cancellation'
    } else {
      const error = err instanceof Error ? err : new Error('Ошибка выполнения графа')
      failMessage = error.message
      failCategory = classifyError(error)
    }
  } finally {
    // Cleanup AbortController — run is done regardless of outcome
    cleanupRunSignal(runId)
  }

  // Determine final status with no_data awareness
  let finalStatus: string
  if (hasFailed) {
    finalStatus = failCategory === 'cancellation' ? 'cancelled' : 'failed'
  } else {
    // Check if any node signaled no_data — business outcome without useful data
    const allSteps = await prisma.workflowStep.findMany({
      where: { runId },
      select: { output: true, status: true, nodeType: true },
    })

    const hasNoData = allSteps.some(s => {
      const out = s.output as Record<string, unknown> | null
      return out?._noData === true
    })

    // All steps either succeeded/skipped but primary data source returned no data
    // AND no step produced meaningful business output
    const hasAnyMeaningfulOutput = allSteps.some(s => {
      if (s.status !== 'success' && s.status !== 'partial') return false
      const out = s.output as Record<string, unknown> | null
      if (!out) return false
      if (out.skipped) return false
      if (out._noData) return false
      // Check for actual content: trends, scenarios, videos, ideas
      const hasContent = Array.isArray(out.trends) && out.trends.length > 0
        || Array.isArray(out.scenarios) && out.scenarios.length > 0
        || Array.isArray(out.videos) && out.videos.length > 0
        || Array.isArray(out.ideas) && out.ideas.length > 0
        || (typeof out.generatedCount === 'number' && out.generatedCount > 0)
      return hasContent
    })

    if (hasNoData && !hasAnyMeaningfulOutput) {
      finalStatus = 'no_data'
    } else {
      finalStatus = 'success'
    }
  }

  // Build no_data explanation for errorMessage
  let noDataMessage: string | null = null
  if (finalStatus === 'no_data') {
    const noDataSteps = await prisma.workflowStep.findMany({
      where: { runId },
      select: { nodeName: true, output: true },
    })
    const reasons = noDataSteps
      .filter(s => (s.output as Record<string, unknown> | null)?._noData)
      .map(s => {
        const reason = (s.output as Record<string, unknown>)?._noDataReason
        return `${s.nodeName}: ${reason || 'нет данных'}`
      })
    noDataMessage = `Запуск завершён без данных. ${reasons.join('; ')}`
  }

  await prisma.workflowRun.update({
    where: { id: runId },
    data: {
      status: finalStatus as never,
      finishedAt: new Date(),
      errorMessage: hasFailed ? failMessage.slice(0, 2000) : (noDataMessage?.slice(0, 2000) ?? null),
      errorCategory: hasFailed ? failCategory : null,
    },
  })

  const logLevel = hasFailed ? 'error' : (finalStatus === 'no_data' ? 'warn' : 'info')
  const logMessage = hasFailed
    ? `Конвейер #${run.pipelineId} завершился с ошибкой: ${failMessage}`
    : finalStatus === 'no_data'
      ? `Конвейер #${run.pipelineId} завершён без данных (no_data)`
      : `Конвейер #${run.pipelineId} выполнен успешно`

  await logAgent(
    'pipeline-engine',
    logLevel,
    logMessage,
    { runId, pipelineId: run.pipelineId, status: finalStatus, category: failCategory },
  )

  // Update PipelineSchedule.lastRunStatus for scheduled runs — so scheduler UI shows real outcome
  if (run.triggerType === 'schedule') {
    await prisma.pipelineSchedule.updateMany({
      where: { pipelineId: run.pipelineId },
      data: { lastRunStatus: finalStatus },
    }).catch(() => {})
  }
}

/**
 * Detect and mark stuck runs — runs that have been 'running' for too long.
 * Called periodically by the scheduler plugin.
 */
export async function detectStuckRuns(): Promise<number> {
  const stuckThreshold = new Date(Date.now() - MAX_RUN_DURATION_MS * 2)
  const cancelStuckThreshold = new Date(Date.now() - CANCEL_STUCK_THRESHOLD_MS)

  // ── Ветка 1 (cancel watchdog): running + cancelRequestedAt > 2 мин ──
  // Worker должен был сам выйти через CancellationError, но если signal
  // не пробросился глубоко (fal polling без AbortSignal) — финализируем
  // принудительно, чтобы UI спиннер «Останавливается» не висел до 60 мин
  // (старого classic-stuck порога). После этапа B3 эта ветка станет
  // редкой safety-net, а не основным механизмом отмены.
  const cancelStuck = await prisma.workflowRun.findMany({
    where: {
      status: 'running',
      cancelRequestedAt: { not: null, lte: cancelStuckThreshold },
    },
    take: 20,
  })

  for (const run of cancelStuck) {
    cleanupRunSignal(run.id)

    // Atomic: переводим только если всё ещё running — не отнимаем у параллельного
    // worker'а, который может в последнюю секунду сам выставить terminal статус.
    const updated = await prisma.workflowRun.updateMany({
      where: { id: run.id, status: 'running' },
      data: {
        status: 'cancelled',
        finishedAt: new Date(),
        errorMessage: 'Отмена не была подтверждена worker\'ом за 2 минуты — принудительный финал (cancel watchdog)',
        errorCategory: 'cancellation',
      },
    })

    if (updated.count > 0) {
      // Финализируем зомби-шаги (running/pending) — иначе UI показывает
      // «висящие» шаги под cancelled run.
      await prisma.workflowStep.updateMany({
        where: {
          runId: run.id,
          status: { in: ['pending', 'running'] },
        },
        data: {
          status: 'cancelled',
          finishedAt: new Date(),
          error: 'Шаг прерван cancel watchdog\'ом (run отмечен cancelled)',
          errorCategory: 'cancellation',
        },
      }).catch(() => {})

      await logAgent('pipeline-engine', 'warn',
        `Зависший cancel запуска #${run.id} конвейера #${run.pipelineId} принудительно завершён (cancel watchdog, 2мин)`,
        { runId: run.id, pipelineId: run.pipelineId, wasCancelled: true },
      ).catch(() => {})
    }
  }

  // ── Ветка 2 (classic stuck): running без cancel > 60 мин ──
  // Исключаем cancelRequestedAt != null — этих обрабатывает ветка 1 со своим
  // более коротким порогом 2 мин.
  const stuckRuns = await prisma.workflowRun.findMany({
    where: {
      status: 'running',
      startedAt: { lte: stuckThreshold },
      cancelRequestedAt: null,
    },
    take: 20,
  })

  for (const run of stuckRuns) {
    // cancelRequestedAt здесь null по фильтру — это «честный» stuck без отмены.
    cleanupRunSignal(run.id)

    await prisma.workflowRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        errorMessage: 'Запуск завис и был автоматически отмечен как неудачный (watchdog)',
        errorCategory: 'timeout',
      },
    })

    await logAgent('pipeline-engine', 'error',
      `Зависший запуск #${run.id} конвейера #${run.pipelineId} отмечен как failed (watchdog)`, {
        runId: run.id,
        pipelineId: run.pipelineId,
        wasCancelled: false,
      },
    )
  }

  return cancelStuck.length + stuckRuns.length
}
