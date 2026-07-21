/**
 * GET /api/pipelines/:id/nodes/:nodeId/upstream-context
 *
 * Возвращает контекст upstream-нод в графе пайплайна для заданного узла.
 * Основной кейс: VideoConfig запрашивает для своего nodeId, чтобы узнать -
 * есть ли upstream scenario block и какой у него sceneCountStrategy. Если есть,
 * UI переходит в режим "синхронизация со сценарием" - sliders sceneCount/
 * clipDuration становятся readonly с подсвеченными значениями от scenario,
 * estimate стоимости рассчитывается по SCENE_BUDGET_LIMITS.
 */
import { getExpectedScenePlan } from "~~/shared/utils/scene-budget"

interface GraphNode {
  id: string
  data?: {
    type?: string
    config?: {
      storytelling?: { sceneCountStrategy?: string }
      [key: string]: unknown
    }
  }
}

interface GraphEdge {
  source: string
  target: string
}

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'pipeline',
  })

  const pipelineId = Number(getRouterParam(event, 'id'))
  const nodeId = String(getRouterParam(event, 'nodeId') ?? '')

  if (!Number.isFinite(pipelineId) || pipelineId <= 0 || !nodeId) {
    throw createError({ statusCode: 400, message: 'Некорректные параметры' })
  }

  const pipeline = await prisma.pipeline.findUnique({
    where: { id: pipelineId },
    select: { id: true, userId: true, sharedWith: true, graphData: true },
  })

  if (!pipeline) {
    throw createError({ statusCode: 404, message: 'Конвейер не найден' })
  }

  const isOwner = pipeline.userId === user.id
  const isShared = pipeline.sharedWith.includes(user.id)
  if (!isOwner && !isShared && !user.canAdmin) {
    throw createError({ statusCode: 403, message: 'Нет доступа к конвейеру' })
  }

  const graph = (pipeline.graphData as unknown ?? { nodes: [], edges: [] }) as { nodes: GraphNode[]; edges: GraphEdge[] }
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : []
  const edges = Array.isArray(graph.edges) ? graph.edges : []

  // BFS назад по edges от nodeId - находим все upstream узлы
  const upstreamIds = new Set<string>()
  const queue = [nodeId]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const e of edges) {
      if (e.target === current && !upstreamIds.has(e.source)) {
        upstreamIds.add(e.source)
        queue.push(e.source)
      }
    }
  }

  // Находим ближайший scenario-узел в upstream-множестве
  const scenarioNode = nodes.find(n => upstreamIds.has(n.id) && n.data?.type === 'scenario')

  if (!scenarioNode) {
    return {
      data: {
        hasUpstreamScenario: false as const,
      },
    }
  }

  const strategy = (scenarioNode.data?.config?.storytelling?.sceneCountStrategy ?? 'auto') as
    'auto' | 'minimal' | 'detailed' | 'cinematic'
  const expected = getExpectedScenePlan(strategy)

  return {
    data: {
      hasUpstreamScenario: true as const,
      scenarioNodeId: scenarioNode.id,
      sceneCountStrategy: strategy,
      expectedSceneCount: expected.sceneCount,
      expectedAvgDurationSec: expected.avgDurationSec,
      expectedPerSceneDurations: expected.perSceneDurations,
      expectedTotalSec: expected.totalSec,
    },
  }
})
