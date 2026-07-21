/**
 * Per-edge telemetry helper (Этап 4 pipeline refactor).
 *
 * ## Зачем
 *
 * В UI монитора `/pipeline/:id/runs/:runId` оператор видит input/output каждого
 * шага, но не видит **какое именно ребро** что передало. Когда `scenario` падает
 * с «Нет трендов на входе», по logs не сразу понятно: то ли upstream `loop`
 * пропустил `trends`, то ли `trendwatcher` ничего не нашёл.
 *
 * `buildEdgeSnapshot` собирает для текущей ноды снимок ключей output'а каждого
 * upstream-источника. Engine после executor'а кладёт результат в
 * `step.output._edgeSnapshot` (опциональное поле, JSON, без миграций БД).
 *
 * UI компонент `StepEdgeSnapshot.vue` рисует:
 *   «Нода {sourceLabel} передала [items, _runId, trends]»
 *   + подсветка warning если ожидаемый required input не пришёл.
 *
 * ## Контракт
 *
 * - Только **верхнеуровневые** ключи. Не уходим в рекурсию по значениям —
 *   это раздувает logs и легко вытаскивается из самого `output` если нужно.
 * - Системные ключи (`_noData`, `_runId`, `_edgeSnapshot` и т.п.) — включаются.
 *   `_edgeSnapshot` снимается, чтобы не было бесконечного вложения через
 *   pass-through ноды (loop пробрасывает `_edgeSnapshot` upstream → snapshot
 *   ноды-потомка показал бы устаревшие upstream'ы дедушки).
 * - Если у upstream'а output ещё нет (типовой случай — error edge) — этот
 *   источник опускается.
 * - Если output upstream'а не object (null/string/number) — snapshot=`[]`.
 *   Такое бывает после `filter` который вернул `null` (skip-downstream); ноды
 *   получают пустой merged input от других предков — engine `outputs.set`
 *   просто не вызывается для скипнутого filter'а.
 *
 * ## Размер
 *
 * Типичный pipeline `trendwatcher → loop → scenario`:
 *   - scenario step._edgeSnapshot = { "loop-1": ["trends","items","totalItems",
 *     "currentIndex","_runId","_pipelineId","_nodeCanvasId","_triggerType",
 *     "_pipelineName"] } — ~9 ключей × средняя длина 12 байт + JSON overhead
 *     ≈ 200-300 байт. Для графа в 10 нод — единицы килобайт суммарно. OK.
 */

export interface EdgeSnapshotEdge {
  source: string
  target: string
  sourceHandle?: string | null
}

export type EdgeSnapshot = Record<string, string[]>

/** Ключи, которые ноды передают через pass-through и не должны попадать в snapshot
 * (иначе цепочка через 3+ ноды раздувается). */
const SNAPSHOT_BLACKLIST = new Set<string>(['_edgeSnapshot'])

/**
 * Собирает snapshot верхнеуровневых ключей output по каждому incoming edge.
 *
 * @param nodeId  id ноды, для которой собираем snapshot.
 * @param edges   все рёбра графа (фильтруем по target===nodeId внутри).
 * @param outputs map id→output uжe выполненных upstream-нод (из engine).
 * @returns mapping sourceNodeId → keys[] или null если нет incoming edges с резолвимым output.
 */
export function buildEdgeSnapshot(
  nodeId: string,
  edges: EdgeSnapshotEdge[],
  outputs: Map<string, unknown>,
): EdgeSnapshot | null {
  const incoming = edges.filter(e => e.target === nodeId)
  if (incoming.length === 0) return null

  const snapshot: EdgeSnapshot = {}
  for (const edge of incoming) {
    const sourceOutput = outputs.get(edge.source)
    if (sourceOutput === undefined) continue // upstream ещё не выполнился (или скипнут) — пропускаем

    if (sourceOutput === null || typeof sourceOutput !== 'object' || Array.isArray(sourceOutput)) {
      // output не object — нода не выдала ничего структурного (filter→null, скаляр).
      // Пишем пустой массив: edge физически есть, ключей нет.
      snapshot[edge.source] = []
      continue
    }

    const keys = Object.keys(sourceOutput as Record<string, unknown>)
      .filter(k => !SNAPSHOT_BLACKLIST.has(k))
    snapshot[edge.source] = keys
  }

  return Object.keys(snapshot).length > 0 ? snapshot : null
}
