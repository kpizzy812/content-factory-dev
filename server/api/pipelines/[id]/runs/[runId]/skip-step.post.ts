/**
 * POST /api/pipelines/:id/runs/:runId/skip-step — пропустить упавший шаг и
 * продолжить запуск.
 *
 * В макете монитора это отдельная кнопка рядом с повтором, и она отвечает на
 * реальный случай: некритичный блок (уведомление, аналитика) упал и держит
 * весь запуск, а переисполнять его бессмысленно — чат удалён, метрик не будет.
 * Повтор шага здесь не помогает: он снова упрётся в ту же причину.
 *
 * Реализация опирается на семантику resume, которая у движка уже есть:
 * шаг переводится в `skipped`, и `executePipeline` при следующем проходе
 * считает его выполненным (`completedNodeIds`), отдавая downstream пустой
 * вход — ровно так же, как если бы исполнитель вернул null.
 *
 * Downstream не удаляется и не сбрасывается: пропуск — это «идём дальше с
 * того места», а не «переигрываем ветку». Если ниже по графу что-то уже
 * выполнилось, движок это переиспользует.
 */

import type { GraphNode } from '~~/server/utils/pipeline-graph'
import { recalcRunCost } from '~~/server/utils/pipeline-cost'

interface SkipStepBody {
  nodeId?: string
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

  const body = await readBody<SkipStepBody>(event).catch(() => ({} as SkipStepBody))
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

  const isOwner = run.pipeline.userId === user.id
  const isShared = run.pipeline.sharedWith.includes(user.id)
  if (!isOwner && !isShared && !user.canAdmin) {
    throw createError({ statusCode: 403, message: 'Нет доступа' })
  }

  if (run.pipeline.status !== 'active') {
    throw createError({ statusCode: 400, message: 'Конвейер не активен' })
  }

  if (run.status === 'running' || run.status === 'pending') {
    throw createError({
      statusCode: 409,
      message: `Невозможно пропустить шаг: запуск ещё в статусе "${run.status}"`,
    })
  }

  if (run.status === 'success') {
    throw createError({
      statusCode: 409,
      message: 'Запуск завершён успешно — пропускать нечего',
    })
  }

  const graphSource = (run.graphSnapshot ?? run.pipeline.graphData) as
    | { nodes?: GraphNode[] }
    | null
  const nodes = Array.isArray(graphSource?.nodes) ? graphSource!.nodes! : []
  const targetNode = nodes.find(n => n.id === nodeId)
  if (!targetNode) {
    throw createError({ statusCode: 404, message: 'Шаг не найден в графе' })
  }

  const targetStep = await prisma.workflowStep.findFirst({
    where: { runId, nodeId },
    orderBy: { createdAt: 'desc' },
  })

  if (!targetStep) {
    throw createError({ statusCode: 404, message: 'Шаг не выполнялся в этом запуске' })
  }

  if (!['failed', 'cancelled'].includes(targetStep.status)) {
    throw createError({
      statusCode: 409,
      message: `Пропустить можно только упавший или остановленный шаг, а он в статусе "${targetStep.status}"`,
    })
  }

  const logs = Array.isArray(targetStep.logs) ? targetStep.logs as unknown[] : []
  logs.push({
    ts: new Date().toISOString(),
    level: 'warn',
    message: `Шаг пропущен оператором, запуск продолжен с этого места`,
    data: { userId: user.id, previousStatus: targetStep.status },
  })

  await prisma.workflowStep.update({
    where: { id: targetStep.id },
    data: {
      status: 'skipped',
      // Ошибку не стираем: почему шаг пропустили, видно в разборе.
      output: { skipped: true, skippedByUserId: user.id } as never,
      // Пропуск не отменяет уже потраченного: если шаг успел списать деньги
      // до отказа, мы этого не знаем, и обнулять сумму было бы враньём.
      logs: logs as never,
      finishedAt: targetStep.finishedAt ?? new Date(),
    },
  })

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

  await recalcRunCost(runId)

  enqueueRun(runId).catch(() => {})

  await logAgent('pipeline-skip-step', 'warn',
    `Шаг "${targetNode.data?.label ?? nodeId}" пропущен в run #${runId} конвейера #${id}`,
    { runId, pipelineId: id, userId: user.id, nodeId, previousStatus: targetStep.status },
  )

  return {
    data: {
      runId,
      skippedNodeId: nodeId,
      previousStatus: targetStep.status,
    },
  }
})
