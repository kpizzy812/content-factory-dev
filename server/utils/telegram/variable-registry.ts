/**
 * Canonical Variable Registry для Telegram notification templates.
 *
 * Это единственный source of truth для переменных, которые можно использовать
 * в шаблонах Telegram-уведомлений. AI-генератор, preview, validation и send
 * используют этот реестр.
 */

export type VariableScope =
  | "pipeline"      // Доступны в pipeline notification block
  | "trendwatcher"  // Доступны после trendwatcher node
  | "scenario"      // Доступны после scenario node
  | "video"         // Доступны после video node
  | "upload"        // Доступны после upload node
  | "idea"          // Доступны после idea node
  | "error"         // Доступны при ошибках
  | "system"        // Глобальные, всегда доступны

export type VariableType = "string" | "number" | "date" | "boolean"

/**
 * Доступность переменной в runtime:
 * - guaranteed: всегда доступна (system variables, timestamp)
 * - summary: доступна из pipeline summary (trendsCount, videosCount и т.д.)
 *   — гарантирована когда соответствующий node есть в pipeline
 * - conditional: доступна при определённых условиях (ошибки, upload)
 */
export type VariableAvailability = "guaranteed" | "summary" | "conditional"

export interface RegistryVariable {
  /** Machine key, используется в {{key}} */
  key: string
  /** Человекочитаемое название */
  label: string
  /** Описание для AI и пользователя */
  description: string
  /** Тип значения */
  type: VariableType
  /** Scopes, в которых переменная доступна */
  scopes: VariableScope[]
  /** Категория для группировки в UI */
  category: string
  /** Пример значения */
  example: string
  /** Путь для resolution из pipeline input (dot-notation) */
  inputPath?: string
  /** Доступность переменной в pipeline notification runtime */
  availability: VariableAvailability
  /** Какая нода-источник (для summary переменных) */
  sourceNode?: string
}

/**
 * Canonical registry — все допустимые переменные.
 * Менять/дополнять только здесь.
 */
export const VARIABLE_REGISTRY: RegistryVariable[] = [
  // ─── Pipeline / System ───────────────────────────
  {
    key: "pipelineName",
    label: "Название конвейера",
    description: "Название pipeline, который отправил уведомление",
    type: "string",
    scopes: ["pipeline", "system"],
    category: "Конвейер",
    example: "Автоматический цикл",
    inputPath: "_pipelineName",
    availability: "guaranteed",
  },
  {
    key: "runId",
    label: "ID запуска",
    description: "Идентификатор текущего запуска pipeline",
    type: "number",
    scopes: ["pipeline", "system"],
    category: "Конвейер",
    example: "42",
    inputPath: "_runId",
    availability: "guaranteed",
  },
  {
    key: "timestamp",
    label: "Время события",
    description: "Дата и время события",
    type: "date",
    scopes: ["system"],
    category: "Система",
    example: "2026-04-14 15:30",
    availability: "guaranteed",
  },

  // ─── Trendwatcher ────────────────────────────────
  {
    key: "trendsCount",
    label: "Количество трендов",
    description: "Сколько трендов найдено/импортировано",
    type: "number",
    scopes: ["pipeline", "trendwatcher"],
    category: "Тренды",
    example: "5",
    inputPath: "importedCount",
    availability: "summary",
    sourceNode: "trendwatcher",
  },
  {
    key: "skippedCount",
    label: "Пропущено трендов",
    description: "Сколько дублей пропущено при импорте",
    type: "number",
    scopes: ["pipeline", "trendwatcher"],
    category: "Тренды",
    example: "2",
    inputPath: "skippedCount",
    availability: "summary",
    sourceNode: "trendwatcher",
  },

  // ─── Idea ────────────────────────────────────────
  {
    key: "ideasCount",
    label: "Количество идей",
    description: "Сколько идей создано",
    type: "number",
    scopes: ["pipeline", "idea"],
    category: "Идеи",
    example: "3",
    inputPath: "count",
    availability: "summary",
    sourceNode: "idea",
  },

  // ─── Scenario ────────────────────────────────────
  {
    key: "scenariosCount",
    label: "Количество сценариев",
    description: "Сколько сценариев сгенерировано",
    type: "number",
    scopes: ["pipeline", "scenario"],
    category: "Сценарии",
    example: "3",
    availability: "summary",
    sourceNode: "scenario",
  },
  {
    key: "scenariosSkipped",
    label: "Сценариев пропущено",
    description: "Сколько трендов пропущено при генерации сценариев (удалённые, без вариантов)",
    type: "number",
    scopes: ["pipeline", "scenario"],
    category: "Сценарии",
    example: "0",
    availability: "summary",
    sourceNode: "scenario",
  },

  // ─── Video ───────────────────────────────────────
  {
    key: "videosCount",
    label: "Количество видео",
    description: "Сколько видео успешно сгенерировано (только completed)",
    type: "number",
    scopes: ["pipeline", "video"],
    category: "Видео",
    example: "2",
    availability: "summary",
    sourceNode: "video",
  },
  {
    key: "generatedCount",
    label: "Успешно сгенерировано",
    description: "Количество успешно завершённых видео",
    type: "number",
    scopes: ["pipeline", "video"],
    category: "Видео",
    example: "2",
    inputPath: "generatedCount",
    availability: "summary",
    sourceNode: "video",
  },
  {
    key: "failedCount",
    label: "Не удалось сгенерировать",
    description: "Количество видео, генерация которых не удалась",
    type: "number",
    scopes: ["pipeline", "video"],
    category: "Видео",
    example: "0",
    inputPath: "failedCount",
    availability: "summary",
    sourceNode: "video",
  },

  // ─── Upload ──────────────────────────────────────
  {
    key: "uploadsCount",
    label: "Количество загрузок",
    description: "Сколько видео загружено на платформы",
    type: "number",
    scopes: ["pipeline", "upload"],
    category: "Загрузка",
    example: "2",
    availability: "summary",
    sourceNode: "upload",
  },
  {
    key: "uploadsInitiated",
    label: "Загрузок запущено",
    description: "Сколько загрузок инициировано (включая ещё не завершённые)",
    type: "number",
    scopes: ["pipeline", "upload"],
    category: "Загрузка",
    example: "3",
    inputPath: "uploadsInitiated",
    availability: "summary",
    sourceNode: "upload",
  },

  // ─── Video Extended ──────────────────────────────
  {
    key: "timeoutCount",
    label: "Таймауты генерации",
    description: "Количество видео с таймаутом (remote job может ещё выполняться)",
    type: "number",
    scopes: ["pipeline", "video"],
    category: "Видео",
    example: "0",
    inputPath: "timeoutCount",
    availability: "summary",
    sourceNode: "video",
  },
  {
    key: "domainStatus",
    label: "Итоговый статус",
    description: "Общий итог операции: success, partial, failed, timeout, no_data",
    type: "string",
    scopes: ["pipeline", "system"],
    category: "Конвейер",
    example: "success",
    inputPath: "_domainStatus",
    availability: "summary",
    sourceNode: "video",
  },

  // ─── Error ───────────────────────────────────────
  {
    key: "errorsCount",
    label: "Количество ошибок",
    description: "Количество ошибок на текущем шаге (0 если ошибок нет)",
    type: "number",
    scopes: ["pipeline", "error"],
    category: "Ошибки",
    example: "1",
    availability: "conditional",
  },
  {
    key: "errorMessage",
    label: "Текст ошибки",
    description: "Сообщение последней ошибки",
    type: "string",
    scopes: ["pipeline", "error"],
    category: "Ошибки",
    example: "Таймаут при генерации видео",
    inputPath: "errorMessage",
    availability: "conditional",
  },

  // ─── Balance (system, всегда доступны) ───────────
  {
    key: "balance",
    label: "Балансы сервисов",
    description: "Сводка балансов всех сервисов (fal.ai, Anthropic, NodeMaven и т.д.) одной строкой",
    type: "string",
    scopes: ["system", "pipeline"],
    category: "Балансы",
    example: "🟢 fal.ai: 12.50 USD, 🟡 Anthropic: 5.00 USD, ⚪ NodeMaven: —",
    availability: "guaranteed",
  },
  {
    key: "balance_low_services",
    label: "Сервисы с низким балансом",
    description: "Список сервисов где status=low/critical через запятую. Пусто если всё ОК",
    type: "string",
    scopes: ["system", "pipeline"],
    category: "Балансы",
    example: "Anthropic Claude: 1.50 USD",
    availability: "guaranteed",
  },
  {
    key: "balance_total_usd",
    label: "Итого USD",
    description: "Сумма балансов в USD по всем сервисам",
    type: "string",
    scopes: ["system", "pipeline"],
    category: "Балансы",
    example: "$24.50",
    availability: "guaranteed",
  },
  {
    key: "balance_burn_rate",
    label: "Расход в день (топ-3)",
    description: "Расход в день по топ-3 сервисам за 7 дней",
    type: "string",
    scopes: ["system", "pipeline"],
    category: "Балансы",
    example: "fal.ai $1.20/д, anthropic $0.45/д",
    availability: "guaranteed",
  },

  // ─── No-data awareness ───────────────────────────
  {
    key: "noDataDetected",
    label: "Есть ли no-data",
    description: "«да» если хотя бы одна upstream-нода завершилась без данных",
    type: "string",
    scopes: ["pipeline", "system"],
    category: "Статус",
    example: "да",
    inputPath: "noDataDetected",
    availability: "guaranteed",
  },
  {
    key: "noDataReason",
    label: "Причина отсутствия данных",
    description: "Человекочитаемая причина, почему upstream не дал полезных данных",
    type: "string",
    scopes: ["pipeline", "system"],
    category: "Статус",
    example: "Нет активного профиля Трендвотчера",
    inputPath: "noDataReason",
    availability: "summary",
  },
  {
    key: "noDataSources",
    label: "Источники без данных",
    description: "Список upstream-нод (имена), которые вернули _noData",
    type: "string",
    scopes: ["pipeline", "system"],
    category: "Статус",
    example: "Трендвотчер, Сценарии",
    inputPath: "noDataSources",
    availability: "summary",
  },
]

/** Быстрый lookup по ключу */
const REGISTRY_MAP = new Map<string, RegistryVariable>(
  VARIABLE_REGISTRY.map(v => [v.key, v]),
)

/** Получить переменную по ключу */
export function getRegistryVariable(key: string): RegistryVariable | undefined {
  return REGISTRY_MAP.get(key)
}

/** Получить все переменные для указанных scopes */
export function getVariablesByScopes(scopes: VariableScope[]): RegistryVariable[] {
  const scopeSet = new Set(scopes)
  return VARIABLE_REGISTRY.filter(v => v.scopes.some(s => scopeSet.has(s)))
}

/** Получить все допустимые ключи */
export function getAllVariableKeys(): string[] {
  return VARIABLE_REGISTRY.map(v => v.key)
}

/** Проверить, является ли ключ допустимой переменной */
export function isValidVariableKey(key: string): boolean {
  return REGISTRY_MAP.has(key)
}

/** Валидировать список ключей и вернуть invalid */
export function validateVariableKeys(keys: string[]): { valid: string[]; invalid: string[] } {
  const valid: string[] = []
  const invalid: string[] = []
  for (const key of keys) {
    if (REGISTRY_MAP.has(key)) valid.push(key)
    else invalid.push(key)
  }
  return { valid, invalid }
}

/** Извлечь {{переменные}} из текста шаблона */
export function extractVariablesFromTemplate(messageBody: string): string[] {
  const matches = messageBody.match(/\{\{(\w+)\}\}/g)
  return matches ? [...new Set(matches.map(m => m.replace(/[{}]/g, "")))] : []
}

/**
 * Полная валидация messageBody по registry.
 * Возвращает список проблем.
 */
export function validateTemplateBody(messageBody: string): {
  variables: string[]
  valid: string[]
  invalid: string[]
  unsupportedExpressions: string[]
} {
  const variables = extractVariablesFromTemplate(messageBody)
  const { valid, invalid } = validateVariableKeys(variables)

  const unsupportedExpressions = messageBody
    .split("\n")
    .filter(line => {
      const t = line.trim()
      if (/^.+\?\s*["'«"].+["'»"]\s*:\s*["'«"].+["'»"]\s*$/.test(t)) return true
      if (/\{\{.*\}\}\s*[><=!]+\s*\d+/.test(t)) return true
      return false
    })

  return { variables, valid, invalid, unsupportedExpressions }
}

/**
 * Resolve переменные из pipeline input по registry.
 * Строгая модель: используем только inputPath из registry, не эвристику.
 */
export function resolveVariablesFromInput(
  input: Record<string, unknown>,
  variableKeys: string[],
): { resolved: Record<string, string>; unresolved: string[] } {
  const resolved: Record<string, string> = {}
  const unresolved: string[] = []

  for (const key of variableKeys) {
    const regVar = REGISTRY_MAP.get(key)
    if (!regVar) {
      unresolved.push(key)
      continue
    }

    let value: unknown

    // 1. Попробовать inputPath из registry
    if (regVar.inputPath) {
      value = resolveDeepPath(input, regVar.inputPath)
    }

    // 2. Попробовать direct key match
    if (value === undefined) {
      value = input[key]
    }

    // 3. Computed values
    if (value === undefined) {
      value = computeVariableValue(regVar, input)
    }

    if (value !== undefined && value !== null) {
      resolved[key] = formatVariableValue(regVar, value)
    } else {
      unresolved.push(key)
    }
  }

  return { resolved, unresolved }
}

/** Вычисляемые переменные на основе input данных */
function computeVariableValue(regVar: RegistryVariable, input: Record<string, unknown>): unknown {
  // No-data awareness: если upstream вернул _noData, числовые переменные дефолтятся в 0
  const isNoDataContext = !!input._noData || !!input.skipped

  switch (regVar.key) {
    case "trendsCount":
      if (Array.isArray(input.trends)) return input.trends.length
      if (input.importedCount !== undefined) return input.importedCount
      return isNoDataContext ? 0 : undefined
    case "scenariosCount":
      // Canonical source из executeScenarioNode — scenariosCreated (без учёта duplicates)
      if (input.scenariosCreated !== undefined) return input.scenariosCreated
      if (Array.isArray(input.scenarios)) return input.scenarios.length
      return isNoDataContext ? 0 : undefined
    case "videosCount":
      // Canonical: количество УСПЕШНО сгенерированных видео, не total array length
      if (input.generatedCount !== undefined) return input.generatedCount
      if (Array.isArray(input.videos)) {
        return input.videos.filter((v: any) => v.status === "completed").length
      }
      return isNoDataContext ? 0 : undefined
    case "uploadsCount":
      if (Array.isArray(input.uploads)) return input.uploads.length
      return isNoDataContext ? 0 : undefined
    case "ideasCount":
      if (Array.isArray(input.ideas)) return input.ideas.length
      if (input.count !== undefined) return input.count
      return isNoDataContext ? 0 : undefined
    case "scenariosSkipped": {
      // Canonical source из executeScenarioNode — skippedDuplicates + skippedDeleted
      if (input.scenariosSkipped !== undefined) return input.scenariosSkipped
      const dupes = Number(input.skippedDuplicates ?? 0)
      const deleted = Number(input.skippedDeleted ?? 0)
      if (input.skippedDuplicates !== undefined || input.skippedDeleted !== undefined) {
        return dupes + deleted
      }
      if (input.skipped) return 1
      return isNoDataContext ? 0 : undefined
    }
    case "uploadsInitiated": {
      if (input.uploadsInitiated !== undefined) return input.uploadsInitiated
      if (Array.isArray(input.uploads)) return input.uploads.length
      return isNoDataContext ? 0 : undefined
    }
    case "errorsCount": {
      // Canonical: учитывает failedCount, errors array, launchErrors
      if (input.errorsCount !== undefined) return input.errorsCount
      const failedCount = typeof input.failedCount === "number" ? input.failedCount : 0
      const errorsLen = Array.isArray(input.errors) ? input.errors.length : 0
      const launchLen = Array.isArray(input.launchErrors) ? input.launchErrors.length : 0
      const total = Math.max(failedCount, errorsLen, launchLen)
      if (total > 0) return total
      if (input.failedCount !== undefined || input.errors !== undefined || input.launchErrors !== undefined) return 0
      // В no-data контексте ошибок тоже 0
      return isNoDataContext ? 0 : undefined
    }
    case "timeoutCount": {
      if (input.timeoutCount !== undefined) return input.timeoutCount
      if (Array.isArray(input.videos)) {
        return input.videos.filter((v: any) => v.status === "timeout").length
      }
      return isNoDataContext ? 0 : undefined
    }
    case "domainStatus": {
      // Общий итог: success | partial | failed | timeout | no_data
      if (input._domainStatus) return input._domainStatus
      if (input._noData) return "no_data"
      if (input._error) return "failed"
      if (input._domainDegraded) return "partial"
      return isNoDataContext ? "no_data" : undefined
    }
    case "timestamp":
      return new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })
    case "noDataDetected":
      if (typeof input.noDataDetected === "string") return input.noDataDetected
      return isNoDataContext ? "да" : "нет"
    case "noDataReason":
      if (typeof input.noDataReason === "string" && input.noDataReason) return input.noDataReason
      if (typeof input._noDataReason === "string") return input._noDataReason
      return isNoDataContext ? "Нет данных от upstream-нод" : ""
    case "noDataSources":
      if (typeof input.noDataSources === "string") return input.noDataSources
      if (Array.isArray(input.noDataSources)) return input.noDataSources.join(", ")
      return isNoDataContext ? "" : ""
    default:
      return undefined
  }
}

function formatVariableValue(regVar: RegistryVariable, value: unknown): string {
  if (regVar.type === "date" && value instanceof Date) {
    return value.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })
  }
  return String(value)
}

function resolveDeepPath(obj: Record<string, unknown>, path: string): unknown {
  if (obj[path] !== undefined) return obj[path]
  const parts = path.split(".")
  let current: unknown = obj
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * Рендеринг шаблона с подстановкой переменных.
 * Единый renderer для preview и отправки.
 */
export function renderTemplate(
  messageBody: string,
  variables: Record<string, string>,
  opts?: { strict?: boolean },
): {
  text: string
  unresolvedVariables: string[]
  strippedExpressions: string[]
} {
  let text = messageBody
  const strippedExpressions: string[] = []

  // Подстановка переменных
  for (const [key, value] of Object.entries(variables)) {
    text = text.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value)
  }

  // Detect remaining unresolved
  const unresolvedVariables: string[] = []
  text = text.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    unresolvedVariables.push(varName)
    return opts?.strict ? match : "[н/д]"
  })

  // Strip unsupported expressions
  text = text
    .split("\n")
    .filter(line => {
      const trimmed = line.trim()
      if (!trimmed) return true
      if (/^.+\?\s*["'«"].+["'»"]\s*:\s*["'«"].+["'»"]\s*$/.test(trimmed)) {
        strippedExpressions.push(trimmed)
        return false
      }
      if (/\[н\/д\]\s*[><=!]+\s*\d+/.test(trimmed) || /\{\{.*\}\}\s*[><=!]+\s*\d+/.test(trimmed)) {
        strippedExpressions.push(trimmed)
        return false
      }
      return true
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")

  return { text, unresolvedVariables, strippedExpressions }
}

/**
 * Формат registry для передачи в AI prompt.
 * Возвращает строку с описанием всех допустимых переменных.
 */
const AVAILABILITY_LABELS: Record<VariableAvailability, string> = {
  guaranteed: "всегда доступна",
  summary: "доступна из pipeline summary",
  conditional: "доступна при определённых условиях",
}

export function registryForAiPrompt(scopes?: VariableScope[]): string {
  const vars = scopes ? getVariablesByScopes(scopes) : VARIABLE_REGISTRY
  const grouped = new Map<string, RegistryVariable[]>()

  for (const v of vars) {
    const list = grouped.get(v.category) || []
    list.push(v)
    grouped.set(v.category, list)
  }

  const lines: string[] = []
  for (const [category, items] of grouped) {
    lines.push(`## ${category}`)
    for (const v of items) {
      const avail = AVAILABILITY_LABELS[v.availability]
      const source = v.sourceNode ? ` [из блока: ${v.sourceNode}]` : ""
      lines.push(`- {{${v.key}}} — ${v.description} (пример: "${v.example}") [${avail}${source}]`)
    }
    lines.push("")
  }

  return lines.join("\n")
}

/**
 * Registry в формате для API response (frontend variable picker).
 */
export function registryForApi(scopes?: VariableScope[]): Array<{
  key: string
  label: string
  description: string
  type: VariableType
  category: string
  example: string
  scopes: VariableScope[]
  availability: VariableAvailability
  sourceNode?: string
}> {
  const vars = scopes ? getVariablesByScopes(scopes) : VARIABLE_REGISTRY
  return vars.map(v => ({
    key: v.key,
    label: v.label,
    description: v.description,
    type: v.type,
    category: v.category,
    example: v.example,
    scopes: v.scopes,
    availability: v.availability,
    sourceNode: v.sourceNode,
  }))
}
