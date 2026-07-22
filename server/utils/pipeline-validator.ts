/**
 * Pipeline Validation & Readiness Check — production-grade.
 *
 * Validates graph structure, node configuration, expressions,
 * and production readiness across all critical zones:
 * - Graph validity & node config
 * - Execution safety (code node isolation)
 * - Runtime capacity & mode
 * - Webhook security posture
 * - Credential health (expiry, revocation, test status)
 * - Schedule readiness
 */

import type { GraphNode, GraphEdge } from './pipeline-graph'
import type { ValidationIssue, ReadinessResult } from '~~/shared/types/workflow'
import { getModel } from './video-models'
import { falProbeAccessBatch } from './fal'
import { isKnownNodeType, checkPortCompatibility } from '~~/shared/utils/pipeline-node-registry'

/** Required config fields per node type. */
const REQUIRED_CONFIG: Record<string, string[]> = {
  trendwatcher: [],
  content_strategy: [],
  scenario: [],
  quality_gate: [],
  video: [],
  // upload: проверяется кастомно (account vs group + dispatchMode), см. validateNodeConfig
  upload: [],
  idea: [],
  analytics: [],
  filter: ['metric', 'threshold'],
  notification: [],
  http_request: ['url'],
  code: ['code'],
  set: [],
  if_switch: ['field', 'operator'],
  loop: [],
  wait: [],
  sub_pipeline: ['pipelineId'],
}

/** Check for cycles using DFS (returns cycle path if found). */
function detectCycle(nodes: GraphNode[], edges: GraphEdge[]): string[] | null {
  const nodeIds = new Set(nodes.map(n => n.id))
  const adj = new Map<string, string[]>()
  for (const id of nodeIds) adj.set(id, [])
  for (const edge of edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      adj.get(edge.source)!.push(edge.target)
    }
  }

  const visited = new Set<string>()
  const inStack = new Set<string>()
  const path: string[] = []

  function dfs(node: string): boolean {
    visited.add(node)
    inStack.add(node)
    path.push(node)

    for (const neighbor of adj.get(node) ?? []) {
      if (inStack.has(neighbor)) {
        path.push(neighbor)
        return true
      }
      if (!visited.has(neighbor) && dfs(neighbor)) return true
    }

    path.pop()
    inStack.delete(node)
    return false
  }

  for (const id of nodeIds) {
    if (!visited.has(id) && dfs(id)) return path
  }
  return null
}

/** Find entry nodes (no incoming edges). */
function findEntryNodes(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  const targets = new Set(edges.map(e => e.target))
  return nodes.filter(n => !targets.has(n.id))
}

/** Validate a single node's configuration. */
function validateNodeConfig(node: GraphNode): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const type = node.data?.type ?? ''
  const config = (node.data?.config ?? {}) as Record<string, unknown>
  const label = node.data?.label ?? node.id

  // Note ноды — аннотации, не требуют конфигурации и не участвуют в выполнении
  if (type === 'note') return issues

  if (!isKnownNodeType(type)) {
    issues.push({
      severity: 'error',
      nodeId: node.id,
      message: `Неизвестный тип ноды: "${type}"`,
      code: 'unknown_node_type',
    })
    return issues
  }

  const required = REQUIRED_CONFIG[type] ?? []
  for (const field of required) {
    const value = config[field]
    if (value === undefined || value === null || value === '') {
      issues.push({
        severity: 'error',
        nodeId: node.id,
        field,
        message: `Нода "${label}": обязательное поле "${field}" не заполнено`,
        code: 'missing_required_field',
      })
    }
  }

  // Type-specific validation
  // Scenario node validation
  if (type === 'scenario') {
    const variantsCount = Number(config.variantsCount)
    if (variantsCount && (variantsCount < 1 || variantsCount > 10)) {
      issues.push({
        severity: 'warning',
        nodeId: node.id,
        field: 'variantsCount',
        message: `Нода "${label}": количество вариантов (${variantsCount}) вне рекомендуемого диапазона 1-10`,
        code: 'scenario_variants_out_of_range',
      })
    }

    const appConfig = config.app as Record<string, unknown> | undefined
    if (appConfig?.appId) {
      // Will be checked in full validation with DB access
    }

    const subtitles = config.subtitles as Record<string, unknown> | undefined
    if (subtitles?.enabled) {
      const maxLineLength = Number(subtitles.maxLineLength)
      if (maxLineLength && (maxLineLength < 10 || maxLineLength > 100)) {
        issues.push({
          severity: 'warning',
          nodeId: node.id,
          field: 'subtitles.maxLineLength',
          message: `Нода "${label}": длина строки субтитров (${maxLineLength}) вне допустимого диапазона`,
          code: 'scenario_subtitle_line_length',
        })
      }
    }

    const storytelling = config.storytelling as Record<string, unknown> | undefined
    if (storytelling?.enabled && storytelling.sceneCountStrategy === 'cinematic') {
      issues.push({
        severity: 'warning',
        nodeId: node.id,
        message: `Нода "${label}": кинематографичный режим (6+ сцен) значительно увеличивает время генерации`,
        code: 'scenario_cinematic_warning',
      })
    }

    // Валидация storytelling enum полей
    if (storytelling?.enabled) {
      const validProtagonistModes = ['person', 'object', 'abstract', 'auto']
      if (storytelling.protagonistMode && !validProtagonistModes.includes(String(storytelling.protagonistMode))) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          field: 'storytelling.protagonistMode',
          message: `Нода "${label}": недопустимый режим протагониста "${storytelling.protagonistMode}"`,
          code: 'scenario_invalid_enum',
        })
      }
      const validContinuity = ['strict', 'moderate', 'relaxed']
      if (storytelling.continuityStrictness && !validContinuity.includes(String(storytelling.continuityStrictness))) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          field: 'storytelling.continuityStrictness',
          message: `Нода "${label}": недопустимый уровень continuity "${storytelling.continuityStrictness}"`,
          code: 'scenario_invalid_enum',
        })
      }
      const validSceneStrategies = ['auto', 'minimal', 'detailed', 'cinematic', 'longform']
      if (storytelling.sceneCountStrategy && !validSceneStrategies.includes(String(storytelling.sceneCountStrategy))) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          field: 'storytelling.sceneCountStrategy',
          message: `Нода "${label}": недопустимая стратегия сцен "${storytelling.sceneCountStrategy}"`,
          code: 'scenario_invalid_enum',
        })
      }
      const validAppStyles = ['native', 'prominent', 'subtle']
      if (storytelling.appIntegrationStyle && !validAppStyles.includes(String(storytelling.appIntegrationStyle))) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          field: 'storytelling.appIntegrationStyle',
          message: `Нода "${label}": недопустимый стиль интеграции приложения "${storytelling.appIntegrationStyle}"`,
          code: 'scenario_invalid_enum',
        })
      }
    }

    // Кросс-секционная согласованность: storytelling + app
    if (storytelling?.enabled && appConfig?.appId && storytelling.appIntegrationStyle === undefined) {
      issues.push({
        severity: 'warning',
        nodeId: node.id,
        message: `Нода "${label}": storytelling включён с привязанным приложением, но appIntegrationStyle не задан`,
        code: 'scenario_cross_section_warning',
      })
    }

    // Валидация voiceover config
    const voiceover = config.voiceover as Record<string, unknown> | undefined
    if (voiceover?.enabled) {
      const validPacing = ['slow', 'moderate', 'fast']
      if (voiceover.pacing && !validPacing.includes(String(voiceover.pacing))) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          field: 'voiceover.pacing',
          message: `Нода "${label}": недопустимый темп озвучки "${voiceover.pacing}"`,
          code: 'scenario_invalid_enum',
        })
      }
      const validSyncModes = ['scene', 'continuous', 'highlights']
      if (voiceover.syncMode && !validSyncModes.includes(String(voiceover.syncMode))) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          field: 'voiceover.syncMode',
          message: `Нода "${label}": недопустимый режим синхронизации озвучки "${voiceover.syncMode}"`,
          code: 'scenario_invalid_enum',
        })
      }
    }

    // Кросс-секционная согласованность: voiceover + subtitles
    if (voiceover?.enabled && subtitles?.enabled === false) {
      issues.push({
        severity: 'warning',
        nodeId: node.id,
        message: `Нода "${label}": озвучка включена, но субтитры отключены — рекомендуется включить субтитры для accessibility`,
        code: 'scenario_cross_section_warning',
      })
    }

    // Кросс-секционная: subtitles maxLines + readabilityLevel
    if (subtitles?.enabled) {
      const maxLines = Number(subtitles.maxLines)
      if (maxLines && (maxLines < 1 || maxLines > 4)) {
        issues.push({
          severity: 'warning',
          nodeId: node.id,
          field: 'subtitles.maxLines',
          message: `Нода "${label}": максимальное количество строк субтитров (${maxLines}) вне допустимого 1-4`,
          code: 'scenario_subtitle_max_lines',
        })
      }

      const validPlacements = ['auto', 'top', 'center', 'bottom']
      if (subtitles.placementStrategy && !validPlacements.includes(String(subtitles.placementStrategy))) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          field: 'subtitles.placementStrategy',
          message: `Нода "${label}": недопустимая стратегия placement субтитров "${subtitles.placementStrategy}"`,
          code: 'scenario_invalid_enum',
        })
      }
    }

    // Кросс-секционная: app contextMode
    if (appConfig?.appId && appConfig.contextMode) {
      const validContextModes = ['full', 'light', 'manual_only', 'off']
      if (!validContextModes.includes(String(appConfig.contextMode))) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          field: 'app.contextMode',
          message: `Нода "${label}": недопустимый режим контекста приложения "${appConfig.contextMode}"`,
          code: 'scenario_invalid_enum',
        })
      }
    }

    // Кросс-секционная: app + storytelling disabled = предупреждение
    if (appConfig?.appId && appConfig.contextMode !== 'off' && !storytelling?.enabled) {
      issues.push({
        severity: 'warning',
        nodeId: node.id,
        message: `Нода "${label}": приложение подключено, но storytelling отключён — app integration будет минимальной`,
        code: 'scenario_cross_section_warning',
      })
    }
  }

  if (type === 'trendwatcher') {
    const profileMode = String(config.profileMode ?? 'linked')
    const VALID_MODES = ['linked', 'inline']
    if (!VALID_MODES.includes(profileMode)) {
      issues.push({
        severity: 'error',
        nodeId: node.id,
        field: 'profileMode',
        message: `Нода "${label}": недопустимый режим "${profileMode}". Допустимо: linked | inline`,
        code: 'trendwatcher_invalid_mode',
      })
      return issues
    }

    if (profileMode === 'linked') {
      const profileId = Number(config.profileId)
      if (!profileId || profileId <= 0) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          field: 'profileId',
          message: `Нода "${label}": выбран режим "Профиль", но профиль не выбран`,
          code: 'trendwatcher_profile_missing',
        })
      }
    } else {
      const appId = Number(config.appId)
      if (!appId || appId <= 0) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          field: 'appId',
          message: `Нода "${label}": inline-режим требует выбора приложения`,
          code: 'trendwatcher_inline_app_missing',
        })
      }

      const platforms = Array.isArray(config.platforms) ? config.platforms as string[] : []
      const validPlatforms = platforms.filter(p => ['tiktok', 'instagram', 'youtube'].includes(p))
      if (validPlatforms.length === 0) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          field: 'platforms',
          message: `Нода "${label}": нужно выбрать хотя бы одну платформу`,
          code: 'trendwatcher_platforms_missing',
        })
      }

      const keywords = Array.isArray(config.keywords) ? config.keywords as string[] : []
      const validKeywords = keywords.filter(k => typeof k === 'string' && k.trim().length > 0)
      if (validKeywords.length === 0) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          field: 'keywords',
          message: `Нода "${label}": добавьте хотя бы одно ключевое слово для парсинга`,
          code: 'trendwatcher_keywords_missing',
        })
      }

      const actorId = typeof config.actorId === 'string' ? config.actorId.trim() : ''
      if (actorId && !/^[a-z0-9_-]+\/[a-z0-9_-]+$/i.test(actorId)) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          field: 'actorId',
          message: `Нода "${label}": некорректный actorId "${actorId}". Формат: owner/actor-name`,
          code: 'trendwatcher_actor_invalid',
        })
      }

      const vmin = config.viewCountMin == null ? null : Number(config.viewCountMin)
      const vmax = config.viewCountMax == null ? null : Number(config.viewCountMax)
      if (vmin != null && (Number.isNaN(vmin) || vmin < 0)) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          field: 'viewCountMin',
          message: `Нода "${label}": viewCountMin должен быть ≥ 0`,
          code: 'trendwatcher_invalid_range',
        })
      }
      if (vmax != null && (Number.isNaN(vmax) || vmax < 0)) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          field: 'viewCountMax',
          message: `Нода "${label}": viewCountMax должен быть ≥ 0`,
          code: 'trendwatcher_invalid_range',
        })
      }
      if (vmin != null && vmax != null && vmin > vmax) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          field: 'viewCountMax',
          message: `Нода "${label}": viewCountMin (${vmin}) > viewCountMax (${vmax})`,
          code: 'trendwatcher_range_swapped',
        })
      }

      const maxItems = config.maxItems == null ? null : Number(config.maxItems)
      if (maxItems != null && (Number.isNaN(maxItems) || maxItems < 1 || maxItems > 100)) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          field: 'maxItems',
          message: `Нода "${label}": maxItems должен быть в диапазоне 1-100`,
          code: 'trendwatcher_invalid_range',
        })
      }

      if (validKeywords.length > 30) {
        issues.push({
          severity: 'warning',
          nodeId: node.id,
          field: 'keywords',
          message: `Нода "${label}": очень много keywords (${validKeywords.length}). Обычно 6-15 достаточно`,
          code: 'trendwatcher_keywords_too_many',
        })
      }
    }
  }

  if (type === 'notification') {
    const mode = String(config.mode || 'message')
    if (mode === 'template') {
      if (!config.templateKey) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          field: 'templateKey',
          message: `Нода "${label}": не выбран шаблон`,
          code: 'missing_required_field',
        })
      }
    } else {
      if (!config.message) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          field: 'message',
          message: `Нода "${label}": обязательное поле "message" не заполнено`,
          code: 'missing_required_field',
        })
      }
    }
  }

  if (type === 'http_request' && config.url) {
    try {
      new URL(String(config.url))
    } catch {
      issues.push({
        severity: 'error',
        nodeId: node.id,
        field: 'url',
        message: `Нода "${label}": некорректный URL`,
        code: 'invalid_url',
      })
    }
  }

  if (type === 'wait') {
    const delay = Number(config.delaySeconds)
    if (delay && delay > 900) {
      issues.push({
        severity: 'warning',
        nodeId: node.id,
        field: 'delaySeconds',
        message: `Нода "${label}": задержка более 15 минут`,
        code: 'long_wait',
      })
    }
  }

  if (type === 'code' && config.code) {
    const code = String(config.code)
    const forbidden: Array<[RegExp, string]> = [
      [/\bprocess\b/i, 'process'],
      [/\brequire\b/i, 'require'],
      [/\bimport\b/i, 'import'],
      [/\bfetch\b/i, 'fetch'],
      [/\bprisma\b/i, 'prisma'],
      [/\beval\b/i, 'eval'],
      [/\bnew\s+Function\b/i, 'Function'],
      [/\basync\b/, 'async'],
      [/\bawait\b/, 'await'],
      [/\bsetTimeout\b/, 'setTimeout'],
      [/\bsetInterval\b/, 'setInterval'],
      [/\bthis\b/, 'this'],
      [/\\u[\da-fA-F]{4}/, 'unicode escape'],
    ]
    for (const [pattern, name] of forbidden) {
      if (pattern.test(code)) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          field: 'code',
          message: `Нода "${label}": запрещённая конструкция "${name}" в трансформации`,
          code: 'forbidden_code',
        })
      }
    }

    if (code.length > 10_000) {
      issues.push({
        severity: 'warning',
        nodeId: node.id,
        field: 'code',
        message: `Нода "${label}": код слишком длинный (>${10_000} символов)`,
        code: 'code_too_long',
      })
    }
  }

  // Sub-pipeline validation
  if (type === 'sub_pipeline') {
    const pipelineId = Number(config.pipelineId)
    if (!pipelineId || Number.isNaN(pipelineId)) {
      // Already covered by REQUIRED_CONFIG, but explicit for clarity
    } else {
      const mode = String(config.mode || 'wait')
      if (mode !== 'wait' && mode !== 'fire_and_forget') {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          field: 'mode',
          message: `Нода "${label}": недопустимый режим подконвейера "${mode}" (допустимо: wait, fire_and_forget)`,
          code: 'sub_pipeline_invalid_mode',
        })
      }
    }
  }

  // Upload node: account vs group + dispatchMode (структурная проверка, без БД)
  if (type === 'upload') {
    const usesFactoryAssignments = config.factoryAssignments === true
    const accountMode = String(config.accountMode || '').trim()
    const socialAccountId = Number(config.socialAccountId || config.accountId) || 0
    const accountGroupId = Number(config.accountGroupId || config.accountGroup) || 0

    const effectiveMode: 'account' | 'group' = accountMode === 'group'
      ? 'group'
      : accountMode === 'account'
        ? 'account'
        : accountGroupId
          ? 'group'
          : 'account'

    if (!usesFactoryAssignments && effectiveMode === 'account' && !socialAccountId) {
      issues.push({
        severity: 'error',
        nodeId: node.id,
        field: 'socialAccountId',
        message: `Нода "${label}": в режиме "Аккаунт" нужно выбрать социальный аккаунт`,
        code: 'upload_account_missing',
      })
    }
    if (!usesFactoryAssignments && effectiveMode === 'group') {
      if (!accountGroupId) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          field: 'accountGroupId',
          message: `Нода "${label}": в режиме "Группа" нужно выбрать группу аккаунтов`,
          code: 'upload_group_missing',
        })
      }
      const dispatchMode = String(config.groupDispatchMode || '').trim()
      const VALID_MODES = ['round_robin', 'all', 'first_active']
      if (dispatchMode && !VALID_MODES.includes(dispatchMode)) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          field: 'groupDispatchMode',
          message: `Нода "${label}": неизвестная стратегия распределения "${dispatchMode}" (допустимо: round_robin | all | first_active)`,
          code: 'upload_dispatch_invalid',
        })
      }
    }
  }

  // Video node: incompatible config combinations
  if (type === 'video') {
    const sceneCount = Number(config.sceneCount) || 3
    const clipDuration = Number(config.clipDuration) || 5

    // Dangerous cost combinations
    if (sceneCount > 6 && clipDuration > 10) {
      issues.push({
        severity: 'warning',
        nodeId: node.id,
        message: `Нода "${label}": ${sceneCount} сцен × ${clipDuration}с — высокая стоимость fal.ai. Рассмотрите уменьшение.`,
        code: 'video_high_cost_config',
      })
    }

    if (sceneCount > 10) {
      issues.push({
        severity: 'warning',
        nodeId: node.id,
        field: 'sceneCount',
        message: `Нода "${label}": ${sceneCount} сцен — превышает рекомендуемый лимит (10). Генерация будет очень долгой.`,
        code: 'video_excessive_scenes',
      })
    }
  }

  // Caption Generator node: непустой platforms[] + валидные enum'ы
  if (type === 'caption_generator') {
    const rawPlatforms = Array.isArray(config.platforms) ? config.platforms as string[] : []
    const VALID_PLATFORMS = ['tiktok', 'youtube', 'instagram']
    const validPlatforms = rawPlatforms.filter(p => VALID_PLATFORMS.includes(String(p).toLowerCase()))
    if (validPlatforms.length === 0) {
      issues.push({
        severity: 'error',
        nodeId: node.id,
        field: 'platforms',
        message: `Нода "${label}": нужно выбрать хотя бы одну платформу (tiktok / youtube / instagram)`,
        code: 'caption_generator_platforms_missing',
      })
    }

    const styleVariant = config.styleVariant
    if (styleVariant != null && styleVariant !== '') {
      const VALID_STYLES = ['viral', 'informative', 'storytelling']
      if (!VALID_STYLES.includes(String(styleVariant))) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          field: 'styleVariant',
          message: `Нода "${label}": недопустимый стиль captions "${styleVariant}" (допустимо: viral | informative | storytelling)`,
          code: 'caption_generator_style_invalid',
        })
      }
    }

    const language = config.language
    if (language != null && language !== '') {
      const VALID_LANGUAGES = ['auto', 'en', 'ru', 'es']
      if (!VALID_LANGUAGES.includes(String(language))) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          field: 'language',
          message: `Нода "${label}": недопустимый язык "${language}" (допустимо: auto | en | ru | es)`,
          code: 'caption_generator_language_invalid',
        })
      }
    }

    const styleHints = config.styleHints
    if (typeof styleHints === 'string' && styleHints.length > 500) {
      issues.push({
        severity: 'warning',
        nodeId: node.id,
        field: 'styleHints',
        message: `Нода "${label}": подсказки стиля длиннее 500 символов (${styleHints.length}) — будут обрезаны`,
        code: 'caption_generator_style_hints_too_long',
      })
    }
  }

  return issues
}

/**
 * Edge port compatibility (Этап 3).
 *
 * Проверяет каждое ребро happy-path (sourceHandle !== 'error') на совместимость
 * выходных портов source и входных портов target. Возвращает warning issues
 * для несовместимых рёбер. Не блокирует pipeline — это backward-compatible
 * расширение для legacy pipelines.
 *
 * Особые случаи (см. `checkPortCompatibility`):
 *  - source=loop отдаёт severity='warning' с подсказкой проверить upstream.
 *  - source — другая транспортная нода (set/wait/if_switch/filter/sub_pipeline):
 *    проверка пропускается (severity='ok'), потому что upstream неизвестен.
 *  - Неизвестные node types: severity='ok' (legacy).
 */
function validateEdgeCompatibility(
  nodes: GraphNode[],
  edges: GraphEdge[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const nodeById = new Map(nodes.map(n => [n.id, n]))

  for (const edge of edges) {
    if (edge.sourceHandle === 'error') continue
    const source = nodeById.get(edge.source)
    const target = nodeById.get(edge.target)
    if (!source || !target) continue

    const sType = source.data?.type ?? ''
    const tType = target.data?.type ?? ''
    const check = checkPortCompatibility(sType, tType)

    // Только warning (compatible=false или явный warning loop'а).
    // 'ok' пропускаем, 'error' (зарезервировано) пока не возникает.
    if (check.severity === 'warning') {
      const sourceLabel = source.data?.label ?? sType
      const targetLabel = target.data?.label ?? tType
      issues.push({
        severity: 'warning',
        nodeId: target.id,
        message: `Связь "${sourceLabel}" → "${targetLabel}": ${check.reason ?? 'возможна несовместимость портов'}`,
        code: check.compatible ? 'port_passthrough_check' : 'port_incompatibility',
      })
    }
  }

  return issues
}

/** Validate expression syntax in node configs. */
function validateExpressions(nodes: GraphNode[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const nodeLabels = new Set(nodes.map(n => n.data?.label ?? n.id))

  for (const node of nodes) {
    const config = (node.data?.config ?? {}) as Record<string, unknown>
    const label = node.data?.label ?? node.id

    for (const [key, value] of Object.entries(config)) {
      if (typeof value !== 'string') continue
      const matches = value.matchAll(/\{\{(.+?)\}\}/g)
      for (const match of matches) {
        const path = match[1]!.trim()
        if (path.startsWith('$node.')) {
          const parts = path.split('.')
          const refLabel = parts[1]
          if (refLabel && !nodeLabels.has(refLabel)) {
            issues.push({
              severity: 'warning',
              nodeId: node.id,
              field: key,
              message: `Нода "${label}": выражение ссылается на несуществующую ноду "${refLabel}"`,
              code: 'invalid_expression_ref',
            })
          }
        }
      }
    }
  }

  return issues
}

/** Full pipeline readiness check — production-grade across all 4 critical zones. */
export async function validatePipeline(
  pipelineId: number,
): Promise<ReadinessResult> {
  const pipeline = await prisma.pipeline.findUnique({
    where: { id: pipelineId },
    include: { schedule: true },
  })

  if (!pipeline) {
    return {
      ready: false,
      issues: [{ severity: 'error', message: 'Конвейер не найден', code: 'not_found' }],
      checklist: {
        graphValid: false,
        nodesConfigured: false,
        noCycles: false,
        hasEntryNode: false,
        expressionsValid: false,
        scheduleReady: null,
        webhookReady: null,
      },
    }
  }

  const graph = pipeline.graphData as { nodes?: GraphNode[]; edges?: GraphEdge[] }
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
  const edges = Array.isArray(graph?.edges) ? graph.edges : []
  const issues: ValidationIssue[] = []

  // =============================================
  // ZONE: Graph validity
  // =============================================

  const graphValid = nodes.length > 0
  if (!graphValid) {
    issues.push({
      severity: 'error',
      message: 'Конвейер не содержит ни одного блока',
      code: 'empty_graph',
    })
  }

  const cyclePath = nodes.length > 0 ? detectCycle(nodes, edges) : null
  const noCycles = !cyclePath
  if (cyclePath) {
    issues.push({
      severity: 'error',
      message: `Граф содержит цикл: ${cyclePath.join(' → ')}`,
      code: 'graph_cycle',
    })
  }

  const entryNodes = findEntryNodes(nodes, edges)
  const hasEntryNode = entryNodes.length > 0
  if (!hasEntryNode && nodes.length > 0) {
    issues.push({
      severity: 'error',
      message: 'Нет входных блоков (все блоки имеют входящие связи)',
      code: 'no_entry_node',
    })
  }

  // Disconnected nodes
  if (nodes.length > 1) {
    const connected = new Set<string>()
    const queue = [...entryNodes.map(n => n.id)]
    while (queue.length > 0) {
      const nodeId = queue.shift()!
      if (connected.has(nodeId)) continue
      connected.add(nodeId)
      for (const edge of edges) {
        if (edge.source === nodeId && !connected.has(edge.target)) {
          queue.push(edge.target)
        }
      }
    }
    const disconnected = nodes.filter(n => !connected.has(n.id))
    for (const node of disconnected) {
      issues.push({
        severity: 'warning',
        nodeId: node.id,
        message: `Блок "${node.data?.label ?? node.id}" не подключён к основному графу`,
        code: 'disconnected_node',
      })
    }
  }

  // Node configuration
  const nodeIssues = nodes.flatMap(n => validateNodeConfig(n))
  issues.push(...nodeIssues)
  const nodesConfigured = !nodeIssues.some(i => i.severity === 'error')

  // Expressions
  const exprIssues = validateExpressions(nodes)
  issues.push(...exprIssues)
  const expressionsValid = !exprIssues.some(i => i.severity === 'error')

  // =============================================
  // ZONE: Edge port compatibility (Этап 3)
  // =============================================
  // Только warnings — не блокируют запуск (backward compat для legacy pipelines).
  // Error edges (sourceHandle='error') пропускаем: они передают {_error, errorMessage},
  // shape всегда отличается от happy-path и port spec неприменима.
  issues.push(...validateEdgeCompatibility(nodes, edges))

  // =============================================
  // ZONE 1: Execution isolation — code node assessment
  // =============================================

  const codeNodes = nodes.filter(n => n.data?.type === 'code')
  if (codeNodes.length > 0) {
    issues.push({
      severity: 'warning',
      message: `${codeNodes.length} блок(ов) трансформации кода — выполняется в изолированном worker_threads с жёстким таймаутом (5с) и лимитом памяти (64МБ)`,
      code: 'code_node_isolated',
    })
  }

  // =============================================
  // ZONE 2: Runtime capacity & mode
  // =============================================

  const stats = getRuntimeStats()
  if (stats.activeRuns >= stats.maxConcurrent) {
    issues.push({
      severity: 'warning',
      message: `Все слоты выполнения заняты (${stats.activeRuns}/${stats.maxConcurrent}). Запуск будет поставлен в очередь.`,
      code: 'runtime_at_capacity',
    })
  }

  // Runtime mode indicator
  issues.push({
    severity: 'warning',
    message: `Runtime: hardened single-instance mode (${stats.instanceId}). Для multi-instance требуется внешняя очередь (Redis/BullMQ).`,
    code: 'runtime_single_instance',
  })

  // =============================================
  // ZONE 3: Webhook security posture
  // =============================================

  let webhookReady: boolean | null = null
  if (pipeline.webhookToken) {
    webhookReady = pipeline.webhookEnabled
    if (!pipeline.webhookEnabled) {
      issues.push({
        severity: 'warning',
        message: 'Webhook настроен, но отключён',
        code: 'webhook_disabled',
      })
    }

    // HMAC security check
    if (!pipeline.webhookSecret && pipeline.webhookEnabled) {
      issues.push({
        severity: 'warning',
        message: 'Webhook без HMAC-подписи — перегенерируйте токен для включения подписи запросов',
        code: 'webhook_no_hmac',
      })
    }

    // Abuse pattern check
    if (pipeline.webhookEnabled) {
      const recentErrors = await prisma.webhookLog.count({
        where: {
          pipelineId: pipeline.id,
          statusCode: { not: 200 },
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      })

      if (recentErrors > 100) {
        issues.push({
          severity: 'error',
          message: `Webhook: ${recentErrors} ошибочных запросов за 24ч — критический уровень злоупотребления. Рекомендуется отключить webhook.`,
          code: 'webhook_abuse_critical',
        })
      } else if (recentErrors > 50) {
        issues.push({
          severity: 'warning',
          message: `Webhook: ${recentErrors} ошибочных запросов за 24ч — подозрительная активность`,
          code: 'webhook_abuse_risk',
        })
      }

      // Check for recent 401s (signature failures)
      const signatureFailures = await prisma.webhookLog.count({
        where: {
          pipelineId: pipeline.id,
          statusCode: 401,
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      })

      if (signatureFailures > 10) {
        issues.push({
          severity: 'warning',
          message: `Webhook: ${signatureFailures} отклонённых запросов с неверной подписью за 24ч`,
          code: 'webhook_signature_failures',
        })
      }
    }
  }

  // =============================================
  // ZONE 4: Credential health
  // =============================================

  const now = new Date()
  const warningCutoff = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  for (const node of nodes) {
    const config = (node.data?.config ?? {}) as Record<string, unknown>
    const label = node.data?.label ?? node.id

    for (const [key, value] of Object.entries(config)) {
      if (key.endsWith('CredentialId') && value) {
        const credId = Number(value)
        if (credId > 0) {
          const cred = await prisma.pipelineCredential.findUnique({
            where: { id: credId },
            select: {
              id: true, expiresAt: true, lastTestStatus: true,
              name: true, revokedAt: true, lastTestedAt: true,
            },
          })
          if (!cred) {
            issues.push({
              severity: 'error',
              nodeId: node.id,
              field: key,
              message: `Нода "${label}": привязанные учётные данные #${credId} не найдены`,
              code: 'missing_credential',
            })
          } else if (cred.revokedAt) {
            issues.push({
              severity: 'error',
              nodeId: node.id,
              field: key,
              message: `Нода "${label}": учётные данные "${cred.name}" отозваны`,
              code: 'revoked_credential',
            })
          } else if (cred.expiresAt && cred.expiresAt < now) {
            issues.push({
              severity: 'error',
              nodeId: node.id,
              field: key,
              message: `Нода "${label}": учётные данные "${cred.name}" истекли`,
              code: 'expired_credential',
            })
          } else if (cred.expiresAt && cred.expiresAt < warningCutoff) {
            issues.push({
              severity: 'warning',
              nodeId: node.id,
              field: key,
              message: `Нода "${label}": учётные данные "${cred.name}" истекают в ближайшие 7 дней`,
              code: 'expiring_credential',
            })
          } else if (cred.lastTestStatus && cred.lastTestStatus.startsWith('invalid')) {
            issues.push({
              severity: 'warning',
              nodeId: node.id,
              field: key,
              message: `Нода "${label}": учётные данные "${cred.name}" не прошли последнюю проверку`,
              code: 'failed_credential_test',
            })
          } else if (!cred.lastTestedAt) {
            issues.push({
              severity: 'warning',
              nodeId: node.id,
              field: key,
              message: `Нода "${label}": учётные данные "${cred.name}" не были проверены`,
              code: 'untested_credential',
            })
          }
        }
      }
    }

    const type = node.data?.type ?? ''

    // Domain-specific: upload node — проверка существования и health'а аккаунта/группы.
    if (type === 'upload') {
      const accountMode = String(config.accountMode || '').trim()
      const socialAccountId = Number(config.socialAccountId || config.accountId) || 0
      const accountGroupId = Number(config.accountGroupId || config.accountGroup) || 0

      const effectiveMode: 'account' | 'group' = accountMode === 'group'
        ? 'group'
        : accountMode === 'account'
          ? 'account'
          : accountGroupId
            ? 'group'
            : 'account'

      // Целевая платформа берётся из upstream video-ноды (если есть)
      const videoCfg = nodes
        .filter(n => n.data?.type === 'video')
        .map(n => (n.data?.config ?? {}) as Record<string, unknown>)[0]
      const targetPlatform = videoCfg?.targetPlatform
        ? String(videoCfg.targetPlatform)
        : ''

      if (effectiveMode === 'account' && socialAccountId) {
        const account = await prisma.socialAccount.findUnique({
          where: { id: socialAccountId },
          select: { id: true, status: true, displayName: true, platform: true },
        })
        if (!account) {
          issues.push({
            severity: 'error',
            nodeId: node.id,
            field: 'socialAccountId',
            message: `Нода "${label}": аккаунт #${socialAccountId} не найден`,
            code: 'upload_account_not_found',
          })
        } else {
          if (account.status !== 'active') {
            issues.push({
              severity: 'error',
              nodeId: node.id,
              field: 'socialAccountId',
              message: `Нода "${label}": аккаунт «${account.displayName}» в статусе ${account.status} — публикация будет отклонена`,
              code: 'upload_account_not_active',
            })
          }
          if (targetPlatform && account.platform !== targetPlatform) {
            issues.push({
              severity: 'warning',
              nodeId: node.id,
              field: 'socialAccountId',
              message: `Нода "${label}": платформа аккаунта (${account.platform}) не совпадает с целевой платформой видео (${targetPlatform})`,
              code: 'upload_platform_mismatch',
            })
          }
        }
      }

      if (effectiveMode === 'group' && accountGroupId) {
        const group = await prisma.accountGroup.findUnique({
          where: { id: accountGroupId },
          select: {
            id: true, name: true, dispatchMode: true,
            members: {
              select: { socialAccount: { select: { id: true, status: true, platform: true } } },
            },
          },
        })
        if (!group) {
          issues.push({
            severity: 'error',
            nodeId: node.id,
            field: 'accountGroupId',
            message: `Нода "${label}": группа #${accountGroupId} не найдена`,
            code: 'upload_group_not_found',
          })
        } else {
          const activeMembers = group.members.filter(m => m.socialAccount.status === 'active')
          if (activeMembers.length === 0) {
            issues.push({
              severity: 'error',
              nodeId: node.id,
              field: 'accountGroupId',
              message: `Нода "${label}": в группе «${group.name}» нет активных аккаунтов`,
              code: 'upload_group_no_active_members',
            })
          } else if (targetPlatform) {
            const platformMatches = activeMembers.filter(m => m.socialAccount.platform === targetPlatform)
            if (platformMatches.length === 0) {
              issues.push({
                severity: 'warning',
                nodeId: node.id,
                field: 'accountGroupId',
                message: `Нода "${label}": в группе «${group.name}» нет активных аккаунтов платформы ${targetPlatform}`,
                code: 'upload_platform_mismatch',
              })
            }
          }
        }
      }
    }

    // Domain-specific: scenario node app validation
    if (type === 'scenario') {
      const appConfig = config.app as Record<string, unknown> | undefined
      if (appConfig?.appId && appConfig.contextMode !== 'off') {
        const appExists = await prisma.app.findUnique({
          where: { id: Number(appConfig.appId) },
          select: { id: true },
        })
        if (!appExists) {
          issues.push({
            severity: 'error',
            nodeId: node.id,
            field: 'app.appId',
            message: `Нода "${label}": привязанное приложение #${appConfig.appId} не найдено`,
            code: 'scenario_app_not_found',
          })
        }
      }
    }

    // Domain-specific: fal.ai model access for video nodes
    if (type === 'video') {
      const imageModelId = config.imageModelId ? String(config.imageModelId) : undefined
      const videoModelId = config.videoModelId ? String(config.videoModelId) : undefined

      // Validate models are known and integrated
      if (imageModelId) {
        const model = getModel(imageModelId)
        if (!model) {
          issues.push({
            severity: 'error',
            nodeId: node.id,
            field: 'imageModelId',
            message: `Нода "${label}": неизвестная модель изображений "${imageModelId}"`,
            code: 'unknown_model',
          })
        } else if (!model.integrated) {
          issues.push({
            severity: 'error',
            nodeId: node.id,
            field: 'imageModelId',
            message: `Нода "${label}": модель "${model.name}" не подключена к pipeline`,
            code: 'model_not_integrated',
          })
        }
      }
      if (videoModelId) {
        const model = getModel(videoModelId)
        if (!model) {
          issues.push({
            severity: 'error',
            nodeId: node.id,
            field: 'videoModelId',
            message: `Нода "${label}": неизвестная модель видео "${videoModelId}"`,
            code: 'unknown_model',
          })
        } else if (!model.integrated) {
          issues.push({
            severity: 'error',
            nodeId: node.id,
            field: 'videoModelId',
            message: `Нода "${label}": модель "${model.name}" не подключена к pipeline`,
            code: 'model_not_integrated',
          })
        }
      }

      // Probe real fal.ai access for configured models
      const modelsToProbe = [
        imageModelId || 'fal-ai/flux/dev',
        videoModelId || 'fal-ai/kling-video/v3/standard/text-to-video',
      ]
      try {
        const accessResults = await falProbeAccessBatch(modelsToProbe)
        for (const [endpoint, result] of accessResults) {
          if (result.status !== 'available') {
            const modelMeta = getModel(endpoint)
            issues.push({
              severity: 'error',
              nodeId: node.id,
              field: endpoint === modelsToProbe[0] ? 'imageModelId' : 'videoModelId',
              message: `Нода "${label}": модель "${modelMeta?.name ?? endpoint}" недоступна — ${result.reason}`,
              code: 'model_access_blocked',
            })
          }
        }
      } catch {
        issues.push({
          severity: 'warning',
          nodeId: node.id,
          message: `Нода "${label}": не удалось проверить доступ к моделям fal.ai`,
          code: 'model_access_probe_failed',
        })
      }
    }
  }

  // =============================================
  // ZONE 5: Cost & fan-out forecast
  // =============================================

  const hasTrendwatcher = nodes.some(n => n.data?.type === 'trendwatcher')
  const scenarioNodes = nodes.filter(n => n.data?.type === 'scenario')
  const videoNodes = nodes.filter(n => n.data?.type === 'video')

  if (hasTrendwatcher && scenarioNodes.length > 0 && videoNodes.length > 0) {
    // Detect fan-out chain: trendwatcher → scenario → video
    // Each trend produces 1 scenario, each scenario produces 1 video
    // But trendwatcher may find 1-20+ trends, so cost multiplies

    for (const vn of videoNodes) {
      const cfg = (vn.data?.config ?? {}) as Record<string, unknown>
      const sceneCount = Number(cfg.sceneCount) || 3
      const clipDuration = Number(cfg.clipDuration) || 5
      const maxVideos = Number(cfg.maxVideos) || 0
      const label = vn.data?.label ?? vn.id

      // Check if scenario node has maxTrends limiter
      const scLimiters = scenarioNodes.map(sn => {
        const scCfg = (sn.data?.config ?? {}) as Record<string, unknown>
        return Number(scCfg.maxTrends) || 0
      })
      const hasLimiter = scLimiters.some(l => l > 0) || maxVideos > 0
      const effectiveMax = maxVideos > 0 ? maxVideos : Math.max(...scLimiters.filter(l => l > 0), 0)

      if (!hasLimiter) {
        issues.push({
          severity: 'warning',
          nodeId: vn.id,
          message: `Fan-out: Trendwatcher → Сценарии → "${label}" без лимитов. `
            + `Каждый найденный тренд создаст видео (${sceneCount} сцен × ${clipDuration}с). `
            + `Установите "Лимит трендов" или "Лимит видео" для контроля затрат.`,
          code: 'fanout_unlimited',
        })
      } else if (effectiveMax > 5) {
        issues.push({
          severity: 'warning',
          nodeId: vn.id,
          message: `Fan-out: лимит ${effectiveMax} видео. Ожидаемые затраты на fal.ai — до ${effectiveMax} видео × ${sceneCount} сцен.`,
          code: 'fanout_high_cardinality',
        })
      }
    }
  }

  // =============================================
  // ZONE 6: Sub-pipeline recursion safety
  // =============================================

  const subPipelineNodes = nodes.filter(n => n.data?.type === 'sub_pipeline')
  for (const spNode of subPipelineNodes) {
    const spConfig = (spNode.data?.config ?? {}) as Record<string, unknown>
    const targetId = Number(spConfig.pipelineId)
    const label = spNode.data?.label ?? spNode.id

    if (!targetId) continue

    // Self-reference: pipeline calls itself
    if (targetId === pipelineId) {
      issues.push({
        severity: 'error',
        nodeId: spNode.id,
        field: 'pipelineId',
        message: `Нода "${label}": подконвейер ссылается на самого себя — бесконечная рекурсия`,
        code: 'sub_pipeline_self_reference',
      })
      continue
    }

    // Check if target pipeline exists and is active
    const targetPipeline = await prisma.pipeline.findUnique({
      where: { id: targetId },
      select: { id: true, name: true, status: true, graphData: true },
    })

    if (!targetPipeline) {
      issues.push({
        severity: 'error',
        nodeId: spNode.id,
        field: 'pipelineId',
        message: `Нода "${label}": целевой конвейер #${targetId} не найден`,
        code: 'sub_pipeline_not_found',
      })
      continue
    }

    if (targetPipeline.status !== 'active') {
      issues.push({
        severity: 'warning',
        nodeId: spNode.id,
        message: `Нода "${label}": целевой конвейер "${targetPipeline.name}" не активен`,
        code: 'sub_pipeline_inactive',
      })
    }

    // Indirect cycle detection (depth 1): target pipeline calls back to this pipeline
    const targetGraph = targetPipeline.graphData as { nodes?: GraphNode[] } | null
    if (targetGraph?.nodes) {
      const targetSubNodes = targetGraph.nodes.filter(n => n.data?.type === 'sub_pipeline')
      for (const tsn of targetSubNodes) {
        const tsnConfig = (tsn.data?.config ?? {}) as Record<string, unknown>
        const backRefId = Number(tsnConfig.pipelineId)
        if (backRefId === pipelineId) {
          issues.push({
            severity: 'error',
            nodeId: spNode.id,
            field: 'pipelineId',
            message: `Нода "${label}": взаимная рекурсия — конвейер "${targetPipeline.name}" (#${targetId}) вызывает обратно этот конвейер (#${pipelineId})`,
            code: 'sub_pipeline_mutual_recursion',
          })
        }
      }
    }
  }

  // Warn about nested sub-pipeline chains (fan-out depth)
  if (subPipelineNodes.length > 2) {
    issues.push({
      severity: 'warning',
      message: `${subPipelineNodes.length} подконвейерных блоков в одном конвейере — высокий risk fan-out и сложность отладки`,
      code: 'sub_pipeline_high_count',
    })
  }

  // Schedule readiness
  let scheduleReady: boolean | null = null
  if (pipeline.schedule) {
    scheduleReady = pipeline.schedule.enabled && !!pipeline.schedule.cronExpr
    if (!pipeline.schedule.enabled) {
      issues.push({
        severity: 'warning',
        message: 'Расписание настроено, но выключено',
        code: 'schedule_disabled',
      })
    }
  }

  // Pipeline status
  if (pipeline.status !== 'active') {
    issues.push({
      severity: 'warning',
      message: 'Конвейер не активирован. Активируйте для запуска.',
      code: 'pipeline_inactive',
    })
  }

  const hasErrors = issues.some(i => i.severity === 'error')

  return {
    ready: !hasErrors,
    issues,
    checklist: {
      graphValid,
      nodesConfigured,
      noCycles,
      hasEntryNode,
      expressionsValid,
      scheduleReady,
      webhookReady,
    },
  }
}

/**
 * Quick graph-only validation (no DB access).
 * Used for client-side-like validation in the editor.
 */
export function validateGraphQuick(
  nodes: GraphNode[],
  edges: GraphEdge[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (nodes.length === 0) {
    issues.push({ severity: 'error', message: 'Граф пуст', code: 'empty_graph' })
    return issues
  }

  const cyclePath = detectCycle(nodes, edges)
  if (cyclePath) {
    issues.push({
      severity: 'error',
      message: `Граф содержит цикл: ${cyclePath.join(' → ')}`,
      code: 'graph_cycle',
    })
  }

  issues.push(...nodes.flatMap(n => validateNodeConfig(n)))
  issues.push(...validateExpressions(nodes))
  issues.push(...validateEdgeCompatibility(nodes, edges))

  return issues
}
