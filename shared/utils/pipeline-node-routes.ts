/**
 * Маршруты "К юниту" для типов нод пайплайна.
 * Используется в мониторе исполнений для перехода на страницу-раздел модуля.
 */

export interface NodeUnitTarget {
  href: string
  label: string
  icon: string
}

const ROUTES: Record<string, { path: string, label: string, icon: string }> = {
  trendwatcher: { path: '/trends', label: 'Тренды', icon: 'mingcute:trending-up-line' },
  scenario: { path: '/scenarios', label: 'Сценарии', icon: 'mingcute:document-line' },
  video: { path: '/videos', label: 'Видео', icon: 'mingcute:video-line' },
  upload: { path: '/uploads', label: 'Загрузки', icon: 'mingcute:upload-3-line' },
  idea: { path: '/ideas', label: 'Идеи', icon: 'mingcute:bulb-line' },
  analytics: { path: '/analytics', label: 'Аналитика', icon: 'mingcute:chart-bar-line' },
}

export function getNodeUnitTarget(
  nodeType: string | null | undefined,
  opts?: { runId?: number, pipelineId?: number },
): NodeUnitTarget | null {
  if (!nodeType) return null
  const r = ROUTES[nodeType]
  if (!r) return null
  const qs = new URLSearchParams()
  if (opts?.runId) qs.set('runId', String(opts.runId))
  if (opts?.pipelineId) qs.set('pipelineId', String(opts.pipelineId))
  const query = qs.toString()
  return {
    label: r.label,
    icon: r.icon,
    href: query ? `${r.path}?${query}` : r.path,
  }
}
