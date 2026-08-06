/**
 * Порядок блоков графа для линейных представлений: хронологии шагов и схемы
 * запуска.
 *
 * Движок заводит строку шага заранее, поэтому сортировка по времени создания
 * ставила «в очереди» раньше уже выполненных. Здесь обход в ширину от блоков
 * без входящих связей; циклы и неподключённые блоки добираются в конец, чтобы
 * ни один не потерялся.
 */
export interface GraphNodeView {
  id: string
  label: string
  type: string
}

interface RawGraph {
  nodes?: any[]
  edges?: any[]
}

export function orderGraphNodes(graph: RawGraph | null | undefined): GraphNodeView[] {
  const nodes = Array.isArray(graph?.nodes) ? graph!.nodes! : []
  const edges = Array.isArray(graph?.edges) ? graph!.edges! : []
  if (!nodes.length) return []

  const incoming = new Map<string, number>()
  for (const n of nodes) incoming.set(n.id, 0)
  for (const e of edges) {
    if (incoming.has(e.target)) incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1)
  }

  const outgoing = new Map<string, string[]>()
  for (const e of edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, [])
    outgoing.get(e.source)!.push(e.target)
  }

  const byId = new Map<string, any>(nodes.map((n: any) => [n.id, n]))
  const seen = new Set<string>()
  const out: any[] = []
  const queue = nodes
    .filter((n: any) => (incoming.get(n.id) ?? 0) === 0)
    .sort((a: any, b: any) =>
      (a.position?.y ?? 0) - (b.position?.y ?? 0) || (a.position?.x ?? 0) - (b.position?.x ?? 0))
    .map((n: any) => n.id)

  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    const node = byId.get(id)
    if (node) out.push(node)
    for (const next of outgoing.get(id) ?? []) {
      if (!seen.has(next)) queue.push(next)
    }
  }
  for (const n of nodes) {
    if (!seen.has(n.id)) out.push(n)
  }

  return out
    .map((n: any) => ({
      id: n.id as string,
      label: (n.data?.label as string) || '',
      type: (n.data?.type ?? n.type ?? '') as string,
    }))
    .filter(n => n.type !== 'note')
}

/** Карта «id блока → его место в графе» для сортировки шагов. */
export function graphOrderIndex(graph: RawGraph | null | undefined): Map<string, number> {
  const map = new Map<string, number>()
  orderGraphNodes(graph).forEach((node, i) => map.set(node.id, i))
  return map
}
