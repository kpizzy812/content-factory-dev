/**
 * Единый реестр типов нод конвейера. Источник истины — switch-кейсы
 * `executeNode` в `server/utils/pipeline-graph.ts`. Любая нода, которую
 * исполнитель умеет выполнять (или сознательно скипает, как `note`),
 * должна присутствовать здесь.
 *
 * Используется:
 *  - server/utils/pipeline-validator.ts
 *  - server/api/pipelines/import.post.ts
 *  - server/api/pipelines/nodes/test.post.ts
 *  - tests (drift-проверки реестр ↔ executor ↔ UI-meta)
 */

export const NODE_TYPES = [
  'trendwatcher',
  'content_strategy',
  'scenario',
  'quality_gate',
  'video',
  'caption_generator',
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
  'sub_pipeline',
  'google_drive_scanner',
  'google_drive_uploader',
  'video_analyzer',
  'character',
  'scene_composer',
  'note',
] as const

export type NodeType = typeof NODE_TYPES[number]

export function isKnownNodeType(t: string): t is NodeType {
  return (NODE_TYPES as readonly string[]).includes(t)
}

/**
 * ────────────────────────────────────────────────────────────────────────────
 *  Этап 3: Typed ports — декларация input/output портов нод.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Используется:
 *  - server/utils/pipeline-validator.ts: edge port compatibility (warning, не error).
 *  - app/composables/usePipelineEdgeValidation.ts: подсветка несовместимых рёбер
 *    в UI редактора (оранжевая обводка через VueFlow edge style).
 *  - drift-тесты: каждый NodeType из NODE_TYPES имеет запись в NODE_PORTS.
 *
 * ## Контракт PortSpec.key
 *  - для inputs:  имя поля в merged input (см. `collectInput` в pipeline-graph).
 *  - для outputs: имя поля в output executor'а.
 *  - `type: 'any'` — нода принимает/отдаёт что угодно (control-flow).
 *  - `required: false` — нода работает и без этого поля (отдаст _noData).
 *
 * ## Версионирование
 *  При breaking change порта — повысить PIPELINE_PORTS_VERSION; validator
 *  пометит pipeline'ы предыдущей версии warning'ом.
 *
 * ## Backward-compat
 *  Validator выдаёт только severity='warning' по mismatch'ам. Если нода-тип
 *  не описан в NODE_PORTS (или неизвестен) — checkPortCompatibility возвращает
 *  severity='ok'. Legacy pipelines не блокируются.
 */

export type PortType = 'array' | 'object' | 'string' | 'number' | 'boolean' | 'any'

export interface PortSpec {
  key: string
  type: PortType
  required: boolean
  description?: string
}

export const PIPELINE_PORTS_VERSION = 1

export const NODE_PORTS: Record<NodeType, { inputs: PortSpec[]; outputs: PortSpec[] }> = {
  trendwatcher: {
    inputs: [],
    outputs: [
      { key: 'trends', type: 'array', required: true, description: 'Найденные тренды' },
      { key: 'runId', type: 'number', required: false },
      { key: 'importedCount', type: 'number', required: false },
    ],
  },
  content_strategy: {
    inputs: [
      { key: 'trends', type: 'array', required: false },
      { key: 'ideas', type: 'array', required: false },
    ],
    outputs: [
      { key: 'appId', type: 'number', required: true },
      { key: 'hypothesis', type: 'object', required: true },
      { key: 'hypotheses', type: 'array', required: true },
      { key: 'trends', type: 'array', required: true },
      { key: 'funnel', type: 'object', required: false },
      { key: 'leadMagnet', type: 'object', required: true },
      { key: 'funnelReady', type: 'boolean', required: true },
    ],
  },
  scenario: {
    inputs: [
      { key: 'trends', type: 'array', required: true, description: 'Тренды от Trendwatcher или Loop' },
    ],
    outputs: [
      { key: 'scenarios', type: 'array', required: true, description: 'Созданные сценарии' },
      { key: 'scenariosCreated', type: 'number', required: false },
      { key: 'variantsCreated', type: 'number', required: false },
    ],
  },
  quality_gate: {
    inputs: [
      { key: 'hypotheses', type: 'array', required: false },
      { key: 'scenarios', type: 'array', required: false },
      { key: 'videos', type: 'array', required: false },
    ],
    outputs: [
      { key: 'qualityReview', type: 'object', required: true },
      { key: 'qualityGate', type: 'object', required: true },
      { key: 'scenarios', type: 'array', required: false },
      { key: 'videos', type: 'array', required: false },
    ],
  },  video: {
    inputs: [
      { key: 'scenarios', type: 'array', required: true, description: 'Сценарии для генерации видео' },
    ],
    outputs: [
      { key: 'videos', type: 'array', required: true, description: 'Сгенерированные видео' },
      { key: 'generatedCount', type: 'number', required: false },
    ],
  },
  caption_generator: {
    inputs: [
      { key: 'videos', type: 'array', required: false, description: 'Видео (или одиночное input.video)' },
    ],
    outputs: [
      { key: 'captions', type: 'object', required: true, description: 'Caption по каждой платформе' },
      { key: 'videos', type: 'array', required: false },
    ],
  },
  upload: {
    inputs: [
      { key: 'videos', type: 'array', required: true, description: 'Готовые видео для публикации' },
    ],
    outputs: [
      { key: 'uploads', type: 'array', required: true },
      { key: 'uploadsInitiated', type: 'number', required: false },
    ],
  },
  idea: {
    // Idea umеет два режима: 'input' (берёт URLs из upstream) и 'url' (own config).
    // Декларируем inputs как опциональные — нода работает и без upstream.
    inputs: [
      { key: 'trends', type: 'array', required: false, description: 'URL из trends для режима input' },
    ],
    outputs: [
      { key: 'ideas', type: 'array', required: true },
      { key: 'count', type: 'number', required: false },
    ],
  },
  analytics: {
    inputs: [],
    outputs: [
      { key: 'collected', type: 'number', required: false },
      { key: 'errors', type: 'array', required: false },
    ],
  },
  filter: {
    inputs: [{ key: 'any', type: 'any', required: false }],
    outputs: [{ key: 'any', type: 'any', required: false }],
  },
  notification: {
    inputs: [{ key: 'any', type: 'any', required: false }],
    outputs: [
      { key: 'sent', type: 'boolean', required: false },
    ],
  },
  http_request: {
    inputs: [{ key: 'any', type: 'any', required: false }],
    outputs: [
      { key: 'response', type: 'any', required: false },
      { key: 'statusCode', type: 'number', required: false },
    ],
  },
  code: {
    inputs: [{ key: 'any', type: 'any', required: false }],
    outputs: [{ key: 'output', type: 'any', required: false }],
  },
  set: {
    inputs: [{ key: 'any', type: 'any', required: false }],
    outputs: [{ key: 'any', type: 'any', required: false }],
  },
  if_switch: {
    inputs: [{ key: 'any', type: 'any', required: false }],
    outputs: [
      { key: '_condition', type: 'boolean', required: false },
    ],
  },
  loop: {
    // Loop — особый случай: pass-through. Его реальный output =
    // upstream ∪ {items, totalItems, currentIndex}. Validator не знает upstream,
    // checkPortCompatibility для source=loop отдаёт warning «проверьте upstream».
    inputs: [
      { key: 'items', type: 'array', required: false, description: 'Массив для итерации (или config.arrayField)' },
    ],
    outputs: [
      { key: 'items', type: 'array', required: true },
      { key: 'totalItems', type: 'number', required: true },
      { key: 'currentIndex', type: 'number', required: true },
    ],
  },
  wait: {
    inputs: [{ key: 'any', type: 'any', required: false }],
    outputs: [{ key: '_waitedSeconds', type: 'number', required: false }],
  },
  sub_pipeline: {
    inputs: [{ key: 'any', type: 'any', required: false }],
    outputs: [{ key: 'any', type: 'any', required: false }],
  },
  google_drive_scanner: {
    inputs: [],
    outputs: [
      { key: 'driveFiles', type: 'array', required: true, description: 'Файлы из Google Drive' },
      { key: 'videos', type: 'array', required: false, description: 'Импортированные Video (если auto-import)' },
    ],
  },
  google_drive_uploader: {
    inputs: [
      { key: 'videos', type: 'array', required: true, description: 'Готовые видео для загрузки на Drive' },
    ],
    outputs: [
      { key: 'uploadedCount', type: 'number', required: false },
    ],
  },
  video_analyzer: {
    inputs: [
      { key: 'videos', type: 'array', required: true, description: 'Видео для marketing-анализа' },
    ],
    outputs: [
      { key: 'analyses', type: 'array', required: true },
    ],
  },
  // Character node — source-нода библиотеки персонажей. Выбирает Character по config
  // (characterId / random из app пула / по тегам) и выпускает character object для downstream.
  character: {
    inputs: [
      { key: 'appId', type: 'number', required: false, description: 'Application from factory context' },
    ],
    outputs: [
      { key: 'character', type: 'object', required: true, description: 'Выбранный персонаж с реф-фото' },
      { key: 'characterId', type: 'string', required: true },
      { key: 'characterVisualPrompt', type: 'string', required: false },
      { key: 'characterReferenceImageUrls', type: 'array', required: false },
    ],
  },
  // Scene Composer node — материализует Scene из библиотеки в pipeline. Выпускает
  // compiledPrompt + referenceImages для следующего шага (scenario или video напрямую).
  scene_composer: {
    inputs: [],
    outputs: [
      { key: 'scene', type: 'object', required: true, description: 'Скомпилированная сцена' },
      { key: 'sceneId', type: 'string', required: true },
      { key: 'compiledPrompt', type: 'string', required: true },
      { key: 'negativePrompt', type: 'string', required: false },
      { key: 'referenceImageUrls', type: 'array', required: false },
      { key: 'characterIds', type: 'array', required: false },
    ],
  },
  note: {
    // Аннотация на канвасе, не участвует в исполнении. Порты пустые.
    inputs: [],
    outputs: [],
  },
}

/** Categories транспортных (pass-through / control-flow) нод. */
const TRANSPORT_NODE_TYPES = new Set<NodeType>([
  'loop',
  'wait',
  'set',
  'if_switch',
  'filter',
  'sub_pipeline',
  'quality_gate',
])

export function isTransportNode(t: string): boolean {
  return isKnownNodeType(t) && TRANSPORT_NODE_TYPES.has(t)
}

export interface PortCompatibilityResult {
  /**
   * compatible=true означает «связь допустима»; warning не блокирует, ok — без замечаний.
   * compatible=false — несовместимо (severity='warning' для backward compat).
   */
  compatible: boolean
  severity: 'ok' | 'warning' | 'error'
  reason?: string
  /** Поля target, которые ожидались, но не предоставлены source. */
  missingKeys?: string[]
  /** Поля с несовпадающим типом. */
  typeMismatches?: Array<{ key: string; sourceType: PortType; targetType: PortType }>
}

/**
 * Проверка совместимости edge: source.outputs ⊇ target.inputs (по required).
 *
 * Возвращает severity:
 *  - 'ok'      — всё совпадает, нет проблем.
 *  - 'warning' — есть несовместимость, но pipeline не блокируется (backward compat).
 *  - 'error'   — зарезервировано, пока не используется (план запрещает blocking).
 *
 * Особые случаи:
 *  - source=loop: pass-through. Реальный output зависит от upstream. Validator
 *    отдаёт severity='warning' с рекомендацией «проверьте upstream → loop».
 *    compatible=true чтобы UI не подсвечивал красным легитимный loop→domain edge.
 *  - source — транспортная нода (set, if_switch, wait, filter, sub_pipeline):
 *    она пробрасывает upstream через withPassthrough — validator не знает,
 *    что именно. Возвращаем severity='ok' без проверки (нет ложных алертов).
 *  - source или target — неизвестный тип / нет в NODE_PORTS: severity='ok'
 *    (legacy graph не должны падать).
 */
export function checkPortCompatibility(
  sourceType: string,
  targetType: string,
): PortCompatibilityResult {
  // Неизвестные типы или отсутствие декларации портов — skip без warning.
  // Покрывает: legacy graphs, кастомные форки реестра, опечатки в data.type.
  if (!isKnownNodeType(sourceType) || !isKnownNodeType(targetType)) {
    return { compatible: true, severity: 'ok' }
  }
  const source = NODE_PORTS[sourceType]
  const target = NODE_PORTS[targetType]
  if (!source || !target) {
    return { compatible: true, severity: 'ok' }
  }

  // Loop — special case: pass-through делает реальные outputs зависимыми от
  // upstream. Подсвечивать красным нельзя — это валидный паттерн
  // (trendwatcher → loop → scenario). Но даём подсказку проверить upstream.
  if (sourceType === 'loop') {
    return {
      compatible: true,
      severity: 'warning',
      reason: 'Loop пробрасывает upstream — проверьте, что upstream нода отдаёт нужные поля',
    }
  }

  // Прочие транспортные ноды (set, wait, if_switch, filter, sub_pipeline)
  // тоже pass-through. Без знания upstream — не алертим (severity ok).
  if (isTransportNode(sourceType)) {
    return { compatible: true, severity: 'ok' }
  }

  const sourceOutputs = new Map(source.outputs.map(p => [p.key, p]))
  const missingKeys: string[] = []
  const typeMismatches: PortCompatibilityResult['typeMismatches'] = []

  for (const inputPort of target.inputs) {
    if (!inputPort.required) continue
    if (inputPort.type === 'any') continue

    const matched = sourceOutputs.get(inputPort.key)
    if (!matched) {
      missingKeys.push(inputPort.key)
      continue
    }
    if (matched.type !== 'any' && matched.type !== inputPort.type) {
      typeMismatches!.push({
        key: inputPort.key,
        sourceType: matched.type,
        targetType: inputPort.type,
      })
    }
  }

  if (missingKeys.length === 0 && typeMismatches!.length === 0) {
    return { compatible: true, severity: 'ok' }
  }

  const reasonParts: string[] = []
  if (missingKeys.length > 0) {
    reasonParts.push(`нода "${targetType}" ожидает поля [${missingKeys.join(', ')}], но "${sourceType}" их не отдаёт`)
  }
  if (typeMismatches!.length > 0) {
    const mm = typeMismatches!
      .map(t => `${t.key}: source=${t.sourceType}, target=${t.targetType}`)
      .join('; ')
    reasonParts.push(`несовпадение типов (${mm})`)
  }

  return {
    compatible: false,
    severity: 'warning', // backward compat: warning, не error
    reason: reasonParts.join('; '),
    missingKeys: missingKeys.length > 0 ? missingKeys : undefined,
    typeMismatches: typeMismatches!.length > 0 ? typeMismatches : undefined,
  }
}
