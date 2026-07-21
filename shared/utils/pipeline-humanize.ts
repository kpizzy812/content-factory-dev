/**
 * Словарь переводов технических ключей и значений в человеко-читаемый вид
 * для страницы деталей рана конвейера (/pipeline/[id]/runs/[runId]).
 *
 * Используется компонентом StepDataViewer в режиме "Читаемый" — ключи
 * рендерятся по-русски, enum-значения (статусы, триггеры, платформы)
 * переводятся по контексту поля.
 */

import { pipelineRunStatusConfig, triggerConfig, errorCategoryLabels } from './pipeline-status'

/** Ключи JSON → человеко-читаемые метки. */
export const FIELD_LABELS: Record<string, string> = {
  // Step / Run общие
  id: 'ID',
  runId: 'ID запуска',
  pipelineId: 'ID конвейера',
  nodeId: 'ID блока',
  nodeName: 'Имя блока',
  nodeType: 'Тип блока',
  status: 'Статус',
  input: 'Входные данные',
  output: 'Результат',
  error: 'Ошибка',
  errors: 'Ошибки',
  errorMessage: 'Сообщение об ошибке',
  errorCategory: 'Категория ошибки',
  logs: 'Логи',
  message: 'Сообщение',
  level: 'Уровень',
  ts: 'Время',
  attemptCount: 'Попыток',
  retryPolicy: 'Политика ретраев',
  maxRetries: 'Макс. попыток',
  delayMs: 'Задержка (мс)',
  artifacts: 'Артефакты',
  startedAt: 'Начато',
  finishedAt: 'Завершено',
  createdAt: 'Создано',
  updatedAt: 'Обновлено',
  deletedAt: 'Удалено',
  isDeleted: 'Удалён',
  importedAt: 'Импортировано',
  publishedAt: 'Опубликовано',
  duration: 'Длительность',
  triggerType: 'Тип запуска',
  triggeredBy: 'Инициатор',
  graphVersionId: 'Версия графа',
  retryOfRunId: 'Retry от запуска',
  replayOfRunId: 'Перезапуск от запуска',
  parentRunId: 'Родительский запуск',
  cancelRequestedAt: 'Отмена запрошена',
  retryAttempts: 'Попыток ретрая',

  // Системный контекст ноды (pipeline-engine добавляет к input c префиксом "_")
  _pipelineId: 'ID конвейера',
  _pipelineName: 'Имя конвейера',
  _runId: 'ID запуска конвейера',
  _triggerType: 'Тип запуска',
  _nodeCanvasId: 'ID блока на канвасе',
  _retryAttempts: 'Попыток ретрая',
  _retryPolicy: 'Политика ретраев',

  // Блок Видео
  generatedCount: 'Сгенерировано',
  failedCount: 'С ошибкой',
  timeoutCount: 'Таймаутов',
  videos: 'Видео',
  videoModelId: 'Модель видео',
  imageModelId: 'Модель изображений',
  voiceoverModelId: 'Модель озвучки',
  generateAudio: 'Генерировать звук',
  totalCostEstimate: 'Оценочная стоимость',
  totalCostActual: 'Фактическая стоимость',
  sceneCount: 'Количество сцен',
  clipDuration: 'Длительность клипа',
  modelStrategy: 'Стратегия моделей',
  enableMusic: 'Музыка',
  musicMood: 'Настроение музыки',
  musicVolume: 'Громкость музыки',
  musicVolumeWithVoiceover: 'Громкость музыки с озвучкой',
  voiceoverEnabled: 'Озвучка включена',
  voiceoverLanguage: 'Язык озвучки',
  voiceoverVoiceId: 'ID голоса',
  voiceoverPacing: 'Темп озвучки',
  voiceoverReconciliation: 'Согласование озвучки',
  subtitlesEnabled: 'Субтитры',
  subtitlePreset: 'Пресет субтитров',
  maxVideos: 'Лимит видео',

  // Блок Сценарий
  scenariosCreated: 'Сценариев создано',
  scenariosProcessed: 'Сценариев обработано',
  scenariosReceived: 'Сценариев получено',
  variantsCreated: 'Вариантов создано',
  variantsCount: 'Количество вариантов',
  scenarios: 'Сценарии',
  storyPlan: 'План истории',
  sceneCountStrategy: 'Стратегия количества сцен',
  generationMode: 'Режим генерации',
  contextMode: 'Режим контекста приложения',
  trendId: 'ID тренда',
  briefId: 'ID брифа',
  profileId: 'ID профиля',
  selectedVariantId: 'Выбранный вариант',
  generationStatus: 'Статус генерации',
  operatorNotes: 'Заметки оператора',
  reworkRequest: 'Запрос доработки',
  sourceBriefVersion: 'Версия брифа',
  sourcePromptVersion: 'Версия промпта',

  // Блок Тренды / модель Trend
  trendsReceived: 'Трендов получено',
  trendsProcessed: 'Трендов обработано',
  trends: 'Тренды',
  maxTrends: 'Лимит трендов',
  maxItems: 'Макс. результатов',
  keywords: 'Ключевые слова',
  keyword: 'Ключевое слово',
  geo: 'Гео',
  language: 'Язык',
  platform: 'Платформа',
  externalId: 'Внешний ID',
  authorName: 'Автор',
  thumbnailUrl: 'Обложка',
  videoUrl: 'Ссылка на видео',
  sourceUrl: 'Ссылка на источник',
  viewCount: 'Просмотров',
  likeCount: 'Лайков',
  commentCount: 'Комментариев',
  shareCount: 'Репостов',
  hashtags: 'Хештеги',
  analysisStatus: 'Статус анализа',
  brief: 'Бриф',
  insights: 'Инсайты',
  importedCount: 'Импортировано',
  skippedCount: 'Пропущено',
  skippedDeleted: 'Пропущено удалённых',

  // Блок Загрузка
  uploadsInitiated: 'Загрузок запущено',
  uploadedCount: 'Загружено',
  targetPlatform: 'Целевая платформа',
  format: 'Формат',
  quality: 'Качество',

  // Блок Идеи
  count: 'Количество',
  ideas: 'Идеи',

  // Блок Уведомление
  sent: 'Отправлено',
  mode: 'Режим',
  alertType: 'Тип уведомления',
  renderStatus: 'Статус рендеринга',
  unresolvedVariables: 'Неразрешённые переменные',
  strippedExpressions: 'Удалённые выражения',
  resolvedVariables: 'Подставленные переменные',
  resolvedSnapshot: 'Снимок переменных',
  noDataSources: 'Источники без данных',
  noDataReason: 'Причина отсутствия данных',
  noDataDetected: 'Обнаружено отсутствие данных',
  skipReason: 'Причина пропуска',

  // Переменные шаблона уведомлений (resolvedSnapshot keys)
  timestamp: 'Время',
  errorsCount: 'Ошибок',
  trendsCount: 'Трендов',
  videosCount: 'Видео',
  pipelineName: 'Имя конвейера',

  // Общие служебные
  skipped: 'Пропущено',
  skippedDuplicates: 'Пропущено дубликатов',
  reason: 'Причина',
  title: 'Название',
  description: 'Описание',
  name: 'Имя',
  score: 'Оценка',
  query: 'Запрос',
  limit: 'Лимит',
  offset: 'Смещение',
  filters: 'Фильтры',
  category: 'Категория',
  upstreamData: 'Данные от предыдущих блоков',
  appId: 'Приложение',

  // Служебные префиксы домена (ключи начинаются с _)
  _noData: 'Нет данных',
  _noDataReason: 'Причина отсутствия данных',
  _cardinalityLimited: 'Применён лимит',
  _limitApplied: 'Применённый лимит',
  _totalAvailable: 'Всего доступно',
  _domainStatus: 'Статус домена',
  _domainDegraded: 'Частичное выполнение',
}

/**
 * Переводы значений-enum по ключу поля.
 * Если ключа нет в таблице — значение выводится как есть.
 */
const VALUE_LABELS_BY_KEY: Record<string, Record<string, string>> = {
  // Общий status — покрывает шаги/раны + статусы тренда и сценария.
  // Множества не пересекаются, поэтому маппим все в одну таблицу.
  status: {
    ...Object.fromEntries(
      Object.entries(pipelineRunStatusConfig).map(([k, v]) => [k, v.label]),
    ),
    // Trend.status
    new: 'Новый',
    reviewed: 'Просмотрен',
    in_work: 'В работе',
    completed: 'Завершён',
    dismissed: 'Отклонён',
    // Scenario.status
    draft: 'Черновик',
    generating: 'Генерируется',
    generated: 'Сгенерирован',
    selected: 'Выбран',
    rejected: 'Отклонён',
    needs_rework: 'Требует доработки',
    archived: 'Архив',
  },
  triggerType: Object.fromEntries(
    Object.entries(triggerConfig).map(([k, v]) => [k, v.label]),
  ),
  errorCategory: errorCategoryLabels,
  analysisStatus: {
    none: 'Нет',
    pending: 'Ожидает',
    running: 'Выполняется',
    completed: 'Завершён',
    failed: 'С ошибкой',
  },
  generationStatus: {
    started: 'Запущено',
    completed: 'Завершено',
  },
  platform: {
    tiktok: 'TikTok',
    instagram: 'Instagram',
    youtube: 'YouTube',
  },
  alertType: {
    cycle_started: 'Цикл запущен',
    upload_success: 'Загрузка завершена',
    critical_error: 'Критическая ошибка',
    idea_created: 'Новая идея',
    test: 'Тестовое сообщение',
    custom: 'Пользовательское',
  },
  mode: {
    template: 'По шаблону',
    message: 'Прямое сообщение',
  },
  renderStatus: {
    rendered_ok: 'Успешно отрендерено',
    sent_degraded: 'Отправлено с неразрешёнными переменными',
    blocked_no_data: 'Заблокировано: нет данных',
    blocked_unresolved_variables: 'Заблокировано: неразрешённые переменные',
    blocked_template_error: 'Заблокировано: ошибка шаблона',
  },
  _domainStatus: {
    success: 'Успешно',
    partial: 'Частично',
    failed: 'С ошибкой',
    no_data: 'Нет данных',
  },
  skipReason: {
    no_data: 'Нет данных для отправки',
    blocked: 'Заблокировано',
    manual: 'Пропущено вручную',
  },
  level: {
    info: 'Инфо',
    warn: 'Предупреждение',
    error: 'Ошибка',
    debug: 'Отладка',
  },
}

/** Общая таблица переводов значений-enum вне зависимости от имени поля. */
const FALLBACK_VALUE_LABELS: Record<string, string> = {
  manual: 'Вручную',
  schedule: 'По расписанию',
  webhook: 'Webhook',
}

/**
 * Разбивает camelCase/snake_case-ключ на читаемый текст
 * (fallback для ключей, которых нет в FIELD_LABELS).
 * Пример: "totalCostEstimate" → "Total cost estimate".
 */
function splitCamelCase(key: string): string {
  if (!key) return key
  const cleaned = key.replace(/^_+/, '')
  return cleaned
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, c => c.toUpperCase())
    .trim()
}

/** Локализованная метка ключа или fallback на camelCase-split. */
export function humanizeKey(key: string): string {
  return FIELD_LABELS[key] ?? splitCamelCase(key)
}

/** Локализованное значение с учётом имени поля (enum-переводы). */
export function humanizeValue(value: unknown, key?: string): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет'
  if (typeof value === 'string') {
    if (key && VALUE_LABELS_BY_KEY[key]?.[value]) {
      return VALUE_LABELS_BY_KEY[key][value]
    }
    if (FALLBACK_VALUE_LABELS[value]) {
      return FALLBACK_VALUE_LABELS[value]
    }
    // ISO-дата → локальный формат
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const d = new Date(value)
      if (!isNaN(d.getTime())) {
        return d.toLocaleString('ru-RU', {
          day: '2-digit', month: '2-digit', year: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        })
      }
    }
    return value === '' ? '—' : value
  }
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—'
  return String(value)
}

/** Определяет тип значения для рендеринга. */
export type HumanizedKind = 'primitive' | 'object' | 'array' | 'empty'

export function detectKind(value: unknown): HumanizedKind {
  if (value === null || value === undefined) return 'empty'
  if (Array.isArray(value)) return value.length === 0 ? 'empty' : 'array'
  if (typeof value === 'object') {
    return Object.keys(value as object).length === 0 ? 'empty' : 'object'
  }
  return 'primitive'
}
