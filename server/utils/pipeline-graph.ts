/**
 * Вспомогательные функции для обхода графа конвейера.
 * Топологическая сортировка, сбор input, маршрутизация ошибок.
 */

import type { NodeType } from '~~/shared/utils/pipeline-node-registry'

/**
 * Зеркальный список типов, для которых в `executeNode` ниже есть `case`.
 * Сверяется с `NODE_TYPES` из реестра в drift-тесте — если разъехались,
 * это значит «забыли case в switch» или «забыли пункт в registry».
 */
export const EXECUTOR_HANDLED_TYPES: readonly NodeType[] = [
  'trendwatcher',
  'scenario',
  'video',
  'upload',
  'idea',
  'analytics',
  'filter',
  'notification',
  'http_request',
  'code',
  'set',
  'if_switch',
  'loop',
  'wait',
  'caption_generator',
  'google_drive_scanner',
  'google_drive_uploader',
  'video_analyzer',
  'sub_pipeline',
  'character',
  'scene_composer',
  'note',
]

export interface GraphNode {
  id: string
  data?: {
    type?: string
    label?: string
    config?: Record<string, unknown>
    pinnedOutput?: Record<string, unknown>
  }
}

export interface GraphEdge {
  source: string
  target: string
  sourceHandle?: string | null
}

/**
 * Топологическая сортировка нод (алгоритм Кана / BFS).
 * При обнаружении цикла выбрасывает ошибку.
 */
export function topologicalSort(nodes: GraphNode[], edges: GraphEdge[]): string[] {
  const nodeIds = new Set(nodes.map(n => n.id))
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()

  for (const id of nodeIds) {
    inDegree.set(id, 0)
    adj.set(id, [])
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue

    adj.get(edge.source)!.push(edge.target)
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }
  const sorted: string[] = []
  while (queue.length > 0) {
    const current = queue.shift()!
    sorted.push(current)

    for (const neighbor of adj.get(current) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1
      inDegree.set(neighbor, newDeg)
      if (newDeg === 0) queue.push(neighbor)
    }
  }

  if (sorted.length !== nodeIds.size) {
    throw new Error('Граф содержит цикл: выполнение невозможно')
  }

  return sorted
}

/** Вызывает исполнитель ноды по типу. Signal передаётся для hard cancel. */
export async function executeNode(
  type: string,
  data: Record<string, unknown>,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown> | null> {
  const config = (data.config ?? {}) as Record<string, unknown>

  switch (type) {
    case 'trendwatcher':
      return executeTrendwatcherNode(config, input, signal)
    case 'scenario':
      return executeScenarioNode(config, input, signal)
    case 'video':
      return executeVideoNode(config, input, signal)
    case 'upload':
      return executeUploadNode(config, input, signal)
    case 'idea':
      return executeIdeaNode(config, input, signal)
    case 'analytics':
      return executeAnalyticsNode(config, input)
    case 'filter':
      return executeFilterNode(config, input)
    case 'notification':
      return executeNotificationNode(config, input)
    case 'http_request':
      return executeHttpRequestNode(config, input, signal)
    case 'code':
      return executeCodeNode(config, input)
    case 'set':
      return executeSetNode(config, input)
    case 'if_switch':
      return executeIfNode(config, input)
    case 'loop':
      return executeLoopNode(config, input)
    case 'wait':
      return executeWaitNode(config, input, signal)
    case 'caption_generator':
      return executeCaptionGeneratorNode(config, input, signal)
    case 'google_drive_scanner':
      return (await import('./pipeline-drive-scanner'))
        .executeGoogleDriveScannerNode(config, input, signal)
    case 'google_drive_uploader':
      return (await import('./pipeline-drive-uploader'))
        .executeGoogleDriveUploaderNode(config, input, signal)
    case 'video_analyzer':
      return (await import('./pipeline-video-analyzer'))
        .executeVideoAnalyzerNode(config, input, signal)
    case 'sub_pipeline':
      return executeSubPipelineNode(config, input, signal)
    case 'character':
      return (await import('./pipeline-character-node'))
        .executeCharacterNode(config, input, signal)
    case 'scene_composer':
      return (await import('./pipeline-scene-composer-node'))
        .executeSceneComposerNode(config, input, signal)
    case 'note':
      return { skipped: true, reason: 'Аннотация — не выполняется' }
    default:
      return { skipped: true, reason: `Неизвестный тип ноды: ${type}` }
  }
}

/** Собирает input для ноды из output предыдущих нод (по рёбрам). */
export function collectInput(
  nodeId: string,
  edges: GraphEdge[],
  outputs: Map<string, Record<string, unknown>>,
): Record<string, unknown> {
  const incoming = edges.filter(e => e.target === nodeId)
  if (incoming.length === 0) return {}
  let merged: Record<string, unknown> = {}
  for (const edge of incoming) {
    const prev = outputs.get(edge.source)
    if (prev) {
      merged = { ...merged, ...prev }
    }
  }

  return merged
}

/**
 * Собирает input для notification-ноды из output ВСЕХ выполненных нод pipeline.
 * В отличие от collectInput (только прямые предшественники), эта функция
 * мержит все outputs в порядке топологической сортировки.
 * Это гарантирует, что notification node видит весь pipeline context:
 * trendsCount, scenariosCount, videosCount и т.д.
 */
export function collectFullPipelineInput(
  outputs: Map<string, Record<string, unknown>>,
  sortedNodeIds?: string[],
): Record<string, unknown> {
  let merged: Record<string, unknown> = {}
  if (sortedNodeIds) {
    // Мержим в порядке топологической сортировки — более поздние ноды перезаписывают
    for (const nodeId of sortedNodeIds) {
      const out = outputs.get(nodeId)
      if (out) merged = { ...merged, ...out }
    }
  } else {
    for (const out of outputs.values()) {
      merged = { ...merged, ...out }
    }
  }
  return merged
}

/** Находит error edge (ребро с sourceHandle === 'error') для ноды. */
export function findErrorEdgeTarget(
  nodeId: string,
  edges: GraphEdge[],
): string | null {
  const errorEdge = edges.find(
    e => e.source === nodeId && e.sourceHandle === 'error',
  )
  return errorEdge?.target ?? null
}
