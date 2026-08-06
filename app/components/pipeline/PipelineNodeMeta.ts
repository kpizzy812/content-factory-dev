/**
 * Подпись, иконка и категория ноды конвейера.
 *
 * Категория — это тон принадлежности с канваса редактора (`--color-cat-*`),
 * а не статус: в мониторе цветом статуса красится только строка шага, а
 * категория остаётся тонкой полоской слева в схеме графа.
 *
 * Состав типов совпадает с `shared/utils/pipeline-node-registry`; подписи и
 * иконки — те же, что видит оператор в палитре редактора. Две иконки палитры
 * (`shield-check-line`, `cloud-upload-line`) в наборе mingcute не существуют
 * и молча не рисуются — здесь стоят существующие.
 */
export type NodeCategory = 'src' | 'prod' | 'ctrl' | 'out' | 'util'

export interface PipelineNodeMeta {
  label: string
  icon: string
  category: NodeCategory
}

export const PIPELINE_NODE_META: Record<string, PipelineNodeMeta> = {
  google_drive_scanner: { label: 'Drive Scanner', icon: 'mingcute:cloud-line', category: 'src' },
  trendwatcher: { label: 'Трендвотчер', icon: 'mingcute:eye-line', category: 'src' },

  content_strategy: { label: 'Контент-стратегия', icon: 'mingcute:target-line', category: 'prod' },
  character: { label: 'Персонаж', icon: 'mingcute:user-3-line', category: 'prod' },
  scene_composer: { label: 'Сцена-блок', icon: 'mingcute:layers-line', category: 'prod' },
  scenario: { label: 'Сценарии', icon: 'mingcute:document-line', category: 'prod' },
  video: { label: 'Видео', icon: 'mingcute:video-line', category: 'prod' },
  video_analyzer: { label: 'Анализ видео', icon: 'mingcute:scan-2-line', category: 'prod' },
  caption_generator: { label: 'Описания', icon: 'mingcute:hashtag-line', category: 'prod' },
  idea: { label: 'Идея', icon: 'mingcute:bulb-line', category: 'prod' },

  quality_gate: { label: 'Контроль качества', icon: 'mingcute:shield-line', category: 'ctrl' },
  filter: { label: 'Фильтр', icon: 'mingcute:filter-line', category: 'ctrl' },
  if_switch: { label: 'Условие', icon: 'mingcute:git-branch-line', category: 'ctrl' },
  loop: { label: 'Цикл', icon: 'mingcute:refresh-2-line', category: 'ctrl' },
  wait: { label: 'Ожидание', icon: 'mingcute:time-line', category: 'ctrl' },
  set: { label: 'Установить', icon: 'mingcute:edit-2-line', category: 'ctrl' },

  upload: { label: 'Загрузка', icon: 'mingcute:upload-3-line', category: 'out' },
  analytics: { label: 'Аналитика', icon: 'mingcute:chart-bar-line', category: 'out' },
  notification: { label: 'Уведомление', icon: 'mingcute:notification-line', category: 'out' },
  google_drive_uploader: { label: 'Загрузка в Drive', icon: 'mingcute:cloud-line', category: 'out' },

  http_request: { label: 'HTTP запрос', icon: 'mingcute:globe-line', category: 'util' },
  code: { label: 'Трансформация', icon: 'mingcute:code-line', category: 'util' },
  sub_pipeline: { label: 'Подконвейер', icon: 'mingcute:route-line', category: 'util' },
  note: { label: 'Заметка', icon: 'mingcute:notebook-line', category: 'util' },
}

const FALLBACK: PipelineNodeMeta = {
  label: 'Блок',
  icon: 'mingcute:box-line',
  category: 'util',
}

export function pipelineNodeMeta(type: string | null | undefined): PipelineNodeMeta {
  return PIPELINE_NODE_META[type ?? ''] ?? FALLBACK
}

/** Полоска принадлежности слева от ноды в схеме запуска. */
export const NODE_CATEGORY_STRIP: Record<NodeCategory, string> = {
  src: 'bg-cat-src',
  prod: 'bg-cat-prod',
  ctrl: 'bg-cat-ctrl',
  out: 'bg-cat-out',
  util: 'bg-cat-util',
}
