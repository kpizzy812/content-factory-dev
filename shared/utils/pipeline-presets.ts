import type { PipelinePreset } from '../types/pipeline'

/**
 * Готовые пресеты конвейеров для быстрого старта.
 * Каждый пресет содержит предварительно настроенные ноды и связи.
 */

function pos(x: number, y: number) {
  return { x: x * 280, y: y * 160 }
}

function node(id: string, type: string, label: string, x: number, y: number, config: Record<string, any> = {}) {
  return { id, type, position: pos(x, y), data: { label, type, config } }
}

function edge(source: string, target: string, sourceHandle?: string) {
  const suffix = sourceHandle === 'error' ? '-error' : ''
  return {
    id: `e-${source}-${target}${suffix}`,
    source,
    target,
    sourceHandle: sourceHandle ?? null,
    animated: sourceHandle !== 'error',
    type: 'smoothstep',
    ...(sourceHandle === 'error' ? { style: { stroke: 'oklch(0.65 0.3 25)', strokeDasharray: '6 3' } } : {}),
  }
}

export const pipelinePresets: PipelinePreset[] = [
  {
    id: 'content-factory-vertical',
    name: 'AI-контент-завод 70-90 секунд',
    description: 'Один уникальный вертикальный ролик на запуск: гипотеза, сценарий, presenter lip-sync, двойной QA и официальный постинг.',
    category: 'Контент-завод',
    difficulty: 'advanced',
    useCase: 'Массовый выпуск до 300 уникальных Reels, TikTok и Shorts в сутки через страницу Фабрика',
    icon: 'mingcute:factory-line',
    color: 'primary',
    graphData: {
      nodes: [
        node('strategy-1', 'content_strategy', 'Контент-гипотеза', 0, 0, {
          useInternalMetrics: true,
          useTrendBank: true,
        }),
        node('character-1', 'character', 'Ведущий из исходников', 2, 1.4, {
          mode: 'first',
          role: 'protagonist',
          requireSourceClips: true,
        }),
        node('scenario-1', 'scenario', 'Сценарий 70-90 секунд', 1, 0, {
          variantsCount: 1,
          maxTrends: 1,
          generationMode: 'story_driven',
          storytelling: {
            enabled: true,
            protagonistMode: 'person',
            continuityStrictness: 'moderate',
            sceneCountStrategy: 'longform',
            appIntegrationStyle: 'native',
          },
          subtitles: { enabled: true },
          voiceover: { enabled: true, pacing: 'moderate' },
        }),
        node('qa-script-1', 'quality_gate', 'QA сценария', 2, 0, {
          stage: 'script', minDurationSec: 70, maxDurationSec: 90, minCriticScore: 70,
          requireFunnel: true, requireApprovedLeadMagnet: true, blockOnFailure: true,
        }),
        node('video-1', 'video', 'Вертикальное видео с lip-sync', 3, 0, {
          format: 'vertical', quality: '1080p', maxVideos: 1,
          voiceoverEnabled: true,
          lipSyncEnabled: true, lipSyncModelId: 'kwaivgi/kling-lip-sync', requireLipSyncCharacter: true,
          subtitlesEnabled: true, enableMusic: false,
        }),
        node('qa-final-1', 'quality_gate', 'QA готового видео', 4, 0, {
          stage: 'final', minDurationSec: 70, maxDurationSec: 90, minCriticScore: 70,
          requireFunnel: true, requireApprovedLeadMagnet: true, blockOnFailure: true,
        }),
        node('caption-1', 'caption_generator', 'Описания и хэштеги', 5, 0, {
          platforms: ['instagram', 'tiktok', 'youtube'], styleVariant: 'viral',
        }),
        node('upload-1', 'upload', 'Официальная публикация', 6, 0, {
          factoryAssignments: true,
          uploadPlatforms: ['instagram', 'tiktok', 'youtube'], scheduledMode: 'auto', requiresApproval: false,
          instagramPublishMode: 'trial_auto',
        }),
      ],
      edges: [
        edge('strategy-1', 'scenario-1'),
        edge('strategy-1', 'character-1'),
        edge('scenario-1', 'qa-script-1'),
        edge('qa-script-1', 'video-1'),
        edge('character-1', 'video-1'),
        edge('video-1', 'qa-final-1'),
        edge('qa-final-1', 'caption-1'),
        edge('caption-1', 'upload-1'),
      ],
    },
  },
  {
    id: 'trend-to-video',
    name: 'Тренд → Видео → Публикация',
    description: 'Полный цикл: поиск трендов, генерация сценария, создание видео и публикация в соцсети.',
    category: 'Контент',
    difficulty: 'beginner',
    useCase: 'Автоматическое создание контента на основе трендов',
    icon: 'mingcute:rocket-line',
    color: 'primary',
    graphData: {
      nodes: [
        node('tw-1', 'trendwatcher', 'Поиск трендов', 0, 0),
        node('sc-1', 'scenario', 'Генерация сценария', 1, 0),
        node('vid-1', 'video', 'Создание видео', 2, 0),
        node('up-1', 'upload', 'Публикация', 3, 0),
        node('notif-1', 'notification', 'Уведомление', 4, 0),
      ],
      edges: [
        edge('tw-1', 'sc-1'),
        edge('sc-1', 'vid-1'),
        edge('vid-1', 'up-1'),
        edge('up-1', 'notif-1'),
      ],
    },
  },
  {
    id: 'trend-scout',
    name: 'Разведка трендов',
    description: 'Мониторинг трендов с фильтрацией и уведомлением о найденных результатах.',
    category: 'Аналитика',
    difficulty: 'beginner',
    useCase: 'Регулярный мониторинг трендов без создания контента',
    icon: 'mingcute:eye-line',
    color: 'info',
    graphData: {
      nodes: [
        node('tw-1', 'trendwatcher', 'Поиск трендов', 0, 0),
        node('filter-1', 'filter', 'Фильтр качества', 1, 0),
        node('notif-1', 'notification', 'Уведомление', 2, 0),
      ],
      edges: [
        edge('tw-1', 'filter-1'),
        edge('filter-1', 'notif-1'),
      ],
    },
  },
  {
    id: 'idea-analysis',
    name: 'Анализ идеи → Сценарий',
    description: 'Анализ видео по URL, извлечение CreativeBrief и генерация сценария.',
    category: 'Контент',
    difficulty: 'beginner',
    useCase: 'Создание контента на основе конкретного видео-референса',
    icon: 'mingcute:bulb-line',
    color: 'warning',
    graphData: {
      nodes: [
        node('idea-1', 'idea', 'Анализ идеи', 0, 0),
        node('sc-1', 'scenario', 'Генерация сценария', 1, 0),
        node('vid-1', 'video', 'Создание видео', 2, 0),
      ],
      edges: [
        edge('idea-1', 'sc-1'),
        edge('sc-1', 'vid-1'),
      ],
    },
  },
  {
    id: 'multi-platform-publish',
    name: 'Мультиплатформенная публикация',
    description: 'Создание видео и параллельная публикация на несколько платформ с аналитикой.',
    category: 'Дистрибуция',
    difficulty: 'intermediate',
    useCase: 'Одновременная публикация на TikTok, Instagram, YouTube',
    icon: 'mingcute:share-forward-line',
    color: 'success',
    graphData: {
      nodes: [
        node('sc-1', 'scenario', 'Сценарий', 0, 1),
        node('vid-1', 'video', 'Создание видео', 1, 1),
        node('up-1', 'upload', 'TikTok', 2, 0),
        node('up-2', 'upload', 'Instagram', 2, 1),
        node('up-3', 'upload', 'YouTube', 2, 2),
        node('notif-1', 'notification', 'Уведомление', 3, 1),
      ],
      edges: [
        edge('sc-1', 'vid-1'),
        edge('vid-1', 'up-1'),
        edge('vid-1', 'up-2'),
        edge('vid-1', 'up-3'),
        edge('up-1', 'notif-1'),
        edge('up-2', 'notif-1'),
        edge('up-3', 'notif-1'),
      ],
    },
  },
  {
    id: 'content-with-error-handling',
    name: 'Контент с обработкой ошибок',
    description: 'Полный цикл создания контента с отдельной веткой обработки ошибок на каждом этапе.',
    category: 'Контент',
    difficulty: 'intermediate',
    useCase: 'Надёжный конвейер с уведомлениями об ошибках',
    icon: 'mingcute:shield-line',
    color: 'error',
    graphData: {
      nodes: [
        node('tw-1', 'trendwatcher', 'Поиск трендов', 0, 0),
        node('sc-1', 'scenario', 'Сценарий', 1, 0),
        node('vid-1', 'video', 'Видео', 2, 0),
        node('up-1', 'upload', 'Публикация', 3, 0),
        node('err-1', 'notification', 'Ошибка трендов', 1, 1.5),
        node('err-2', 'notification', 'Ошибка сценария', 2, 1.5),
        node('err-3', 'notification', 'Ошибка видео', 3, 1.5),
      ],
      edges: [
        edge('tw-1', 'sc-1'),
        edge('sc-1', 'vid-1'),
        edge('vid-1', 'up-1'),
        edge('tw-1', 'err-1', 'error'),
        edge('sc-1', 'err-2', 'error'),
        edge('vid-1', 'err-3', 'error'),
      ],
    },
  },
  {
    id: 'batch-processing',
    name: 'Пакетная обработка трендов',
    description: 'Поиск трендов, итерация по каждому найденному и создание контента в цикле.',
    category: 'Автоматизация',
    difficulty: 'advanced',
    useCase: 'Массовое создание контента из нескольких трендов за один запуск',
    icon: 'mingcute:refresh-2-line',
    color: 'accent',
    graphData: {
      nodes: [
        node('tw-1', 'trendwatcher', 'Поиск трендов', 0, 0),
        node('loop-1', 'loop', 'Цикл по трендам', 1, 0),
        node('sc-1', 'scenario', 'Сценарий', 2, 0),
        node('vid-1', 'video', 'Видео', 3, 0),
        node('up-1', 'upload', 'Публикация', 4, 0),
        node('wait-1', 'wait', 'Пауза', 4, 1),
      ],
      edges: [
        edge('tw-1', 'loop-1'),
        edge('loop-1', 'sc-1'),
        edge('sc-1', 'vid-1'),
        edge('vid-1', 'up-1'),
        edge('up-1', 'wait-1'),
      ],
    },
  },
  {
    id: 'external-api-integration',
    name: 'Интеграция с внешним API',
    description: 'Получение данных из внешнего API, трансформация через JS и отправка уведомления.',
    category: 'Интеграции',
    difficulty: 'intermediate',
    useCase: 'Связь с внешними сервисами и CRM',
    icon: 'mingcute:globe-line',
    color: 'secondary',
    graphData: {
      nodes: [
        node('http-1', 'http_request', 'Запрос к API', 0, 0),
        node('code-1', 'code', 'Трансформация', 1, 0),
        node('if-1', 'if_switch', 'Проверка', 2, 0),
        node('notif-1', 'notification', 'Уведомление ОК', 3, 0),
        node('notif-2', 'notification', 'Уведомление ошибки', 3, 1),
      ],
      edges: [
        edge('http-1', 'code-1'),
        edge('code-1', 'if-1'),
        edge('if-1', 'notif-1'),
        edge('if-1', 'notif-2', 'error'),
      ],
    },
  },
  {
    id: 'analytics-report',
    name: 'Аналитический отчёт',
    description: 'Сбор аналитики опубликованных видео с агрегацией и отправкой отчёта.',
    category: 'Аналитика',
    difficulty: 'intermediate',
    useCase: 'Регулярный мониторинг эффективности контента',
    icon: 'mingcute:chart-bar-line',
    color: 'secondary',
    graphData: {
      nodes: [
        node('analytics-1', 'analytics', 'Сбор аналитики', 0, 0),
        node('code-1', 'code', 'Агрегация данных', 1, 0),
        node('notif-1', 'notification', 'Отчёт в Telegram', 2, 0),
      ],
      edges: [
        edge('analytics-1', 'code-1'),
        edge('code-1', 'notif-1'),
      ],
    },
  },
  {
    id: 'conditional-pipeline',
    name: 'Условная маршрутизация',
    description: 'Шаблон с условными ветвлениями: разные действия в зависимости от данных.',
    category: 'Логика',
    difficulty: 'intermediate',
    useCase: 'A/B тестирование контента, разные пути для разных типов данных',
    icon: 'mingcute:git-branch-line',
    color: 'warning',
    graphData: {
      nodes: [
        node('set-1', 'set', 'Входные данные', 0, 1),
        node('if-1', 'if_switch', 'Условие A', 1, 1),
        node('sc-1', 'scenario', 'Сценарий A', 2, 0),
        node('sc-2', 'scenario', 'Сценарий B', 2, 2),
        node('vid-1', 'video', 'Видео', 3, 1),
      ],
      edges: [
        edge('set-1', 'if-1'),
        edge('if-1', 'sc-1'),
        edge('if-1', 'sc-2', 'error'),
        edge('sc-1', 'vid-1'),
        edge('sc-2', 'vid-1'),
      ],
    },
  },
  {
    id: 'sub-pipeline-orchestrator',
    name: 'Оркестратор подконвейеров',
    description: 'Главный конвейер вызывает дочерние конвейеры и собирает результаты.',
    category: 'Автоматизация',
    difficulty: 'advanced',
    useCase: 'Модульная архитектура: разделение сложных процессов на переиспользуемые блоки',
    icon: 'mingcute:route-line',
    color: 'primary',
    graphData: {
      nodes: [
        node('set-1', 'set', 'Параметры', 0, 1),
        node('sub-1', 'sub_pipeline', 'Подконвейер: Тренды', 1, 0),
        node('sub-2', 'sub_pipeline', 'Подконвейер: Контент', 1, 2),
        node('code-1', 'code', 'Объединение', 2, 1),
        node('notif-1', 'notification', 'Итог', 3, 1),
      ],
      edges: [
        edge('set-1', 'sub-1'),
        edge('set-1', 'sub-2'),
        edge('sub-1', 'code-1'),
        edge('sub-2', 'code-1'),
        edge('code-1', 'notif-1'),
      ],
    },
  },
]

export const presetCategories = [...new Set(pipelinePresets.map(p => p.category))]

export function getPresetById(id: string): PipelinePreset | undefined {
  return pipelinePresets.find(p => p.id === id)
}
