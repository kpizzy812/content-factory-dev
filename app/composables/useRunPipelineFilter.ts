/**
 * Синхронизирует runId/pipelineId из URL с filter-стором и обратно.
 *
 * Используется на страницах юнитов (scenarios, trends, videos, uploads, ideas,
 * analytics) для поддержки кнопки «К юниту» из монитора исполнений
 * (`/pipeline?runId=X&pipelineId=Y`).
 *
 * URL → state: при старте страницы читаем query и применяем к стору.
 * state → URL: при изменении runId/pipelineId в сторе обновляем URL через router.replace,
 * сохраняя остальные query-параметры.
 */
export function useRunPipelineFilter(store: {
  runId?: number | undefined
  pipelineId?: number | undefined
}) {
  const route = useRoute()
  const router = useRouter()

  // URL → state при старте
  const initRun = Number(route.query.runId)
  const initPipe = Number(route.query.pipelineId)
  if (Number.isFinite(initRun) && initRun > 0) store.runId = initRun
  if (Number.isFinite(initPipe) && initPipe > 0) store.pipelineId = initPipe

  // state → URL при изменении
  watch(
    [() => store.runId, () => store.pipelineId],
    ([rid, pid]) => {
      const q: Record<string, string> = {}
      for (const [k, v] of Object.entries(route.query)) {
        if (k !== 'runId' && k !== 'pipelineId' && typeof v === 'string') q[k] = v
      }
      if (rid) q.runId = String(rid)
      if (pid) q.pipelineId = String(pid)
      router.replace({ query: q })
    },
  )
}
