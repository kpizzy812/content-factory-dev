/**
 * usePipelineEdgeValidation — composable, рассчитывающий совместимость портов
 * для каждого ребра в редакторе pipeline. Использует `checkPortCompatibility`
 * из shared registry.
 *
 * Возвращает:
 *  - edgeIssues: Map<edgeId, { reason, severity }> — для рёбер с проблемами.
 *  - hasIssues: boolean — есть ли хоть один edge с warning'ом.
 *  - nodeWarningCounts: Map<nodeId, number> — сколько входящих несовместимых
 *    рёбер у каждой ноды (для бейджа на ноде).
 *
 * НЕ изменяет стор pipeline. Чисто computed/derived.
 *
 * Backward-compat: severity всегда 'warning' или 'ok' — не блокирует сохранение.
 */
import type { Ref } from 'vue'
import { checkPortCompatibility } from '~~/shared/utils/pipeline-node-registry'

export interface EdgeIssue {
  reason: string
  severity: 'warning'
  /** true для loop pass-through hint (не реальный mismatch). */
  isHint: boolean
}

interface PipelineNodeLike {
  id: string
  data?: { type?: string }
}

interface PipelineEdgeLike {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
}

export function usePipelineEdgeValidation(
  nodes: Ref<PipelineNodeLike[]>,
  edges: Ref<PipelineEdgeLike[]>,
) {
  // Толерантный getter: store передаёт `as unknown as Ref<any[]>` через TS cast,
  // на runtime это либо Ref, либо прямой массив. Старые версии работали по совпадению —
  // когда массив пустой, итерация `for of undefined` не возникала, потому что
  // computed не пересчитывался. С новыми типами (character/scene_composer) reactivity
  // тригерится раньше — и `edges.value` может быть undefined.
  function readArray<T>(src: any): T[] {
    if (Array.isArray(src)) return src
    if (src && Array.isArray(src.value)) return src.value
    return []
  }
  const edgeIssues = computed(() => {
    const result = new Map<string, EdgeIssue>()
    const nodesArr = readArray<PipelineNodeLike>(nodes)
    const edgesArr = readArray<PipelineEdgeLike>(edges)
    const nodeById = new Map(nodesArr.map(n => [n.id, n]))
    for (const edge of edgesArr) {
      // Error edges не валидируем — они передают {_error, errorMessage}.
      if (edge.sourceHandle === 'error') continue
      const source = nodeById.get(edge.source)
      const target = nodeById.get(edge.target)
      if (!source || !target) continue
      const check = checkPortCompatibility(
        source.data?.type ?? '',
        target.data?.type ?? '',
      )
      if (check.severity === 'warning') {
        result.set(edge.id, {
          reason: check.reason ?? 'Возможна несовместимость портов',
          severity: 'warning',
          // compatible=true с warning — это hint loop pass-through, не реальная проблема.
          isHint: check.compatible,
        })
      }
    }
    return result
  })

  const hasIssues = computed(() => {
    for (const issue of edgeIssues.value.values()) {
      if (!issue.isHint) return true
    }
    return false
  })

  /**
   * Счётчик входящих НЕсовместимых рёбер по каждой ноде (без hints loop'а).
   * Используется для индикатора на PipelineNode.
   */
  const nodeWarningCounts = computed(() => {
    const counts = new Map<string, number>()
    const edgesArr = readArray<PipelineEdgeLike>(edges)
    for (const edge of edgesArr) {
      const issue = edgeIssues.value.get(edge.id)
      if (!issue || issue.isHint) continue
      counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1)
    }
    return counts
  })

  return { edgeIssues, hasIssues, nodeWarningCounts }
}
