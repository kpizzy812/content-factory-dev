# Модуль "Конвейер" (Pipeline) -- Полный анализ

## Оглавление

1. [Общее описание](#общее-описание)
2. [Архитектура](#архитектура)
3. [База данных (Prisma)](#база-данных-prisma)
4. [Типы (Shared Types)](#типы-shared-types)
5. [API эндпоинты](#api-эндпоинты)
6. [Движок исполнения (Pipeline Engine)](#движок-исполнения-pipeline-engine)
7. [Граф и алгоритмы (Pipeline Graph)](#граф-и-алгоритмы-pipeline-graph)
8. [Исполнители нод (Node Executors)](#исполнители-нод-node-executors)
9. [Суб-пайплайны (Video, Upload, Scenario, Idea)](#суб-пайплайны)
10. [Утилиты (Expression Evaluator, Cron Parser, Logger)](#утилиты)
11. [Планировщик (Scheduler Plugin)](#планировщик-scheduler-plugin)
12. [Фронтенд: страницы](#фронтенд-страницы)
13. [Фронтенд: компоненты](#фронтенд-компоненты)
14. [Фронтенд: Pinia Store](#фронтенд-pinia-store)
15. [Фронтенд: композаблы](#фронтенд-композаблы)
16. [Модель прав доступа](#модель-прав-доступа)
17. [Ключевые архитектурные паттерны](#ключевые-архитектурные-паттерны)
18. [Полный список файлов](#полный-список-файлов)

---

## Общее описание

Модуль "Конвейер" -- визуальный редактор автоматизированных workflow для создания контента. Позволяет строить граф из 13 типов нод, соединять их, запускать вручную, по расписанию (cron) или через webhook. Каждый запуск проходит через топологическую сортировку графа и последовательное выполнение нод с передачей данных между ними.

**Стек:**
- Frontend: Nuxt 3, Vue Flow, Pinia, DaisyUI
- Backend: Nitro (H3), Prisma ORM, PostgreSQL
- AI: Anthropic Claude (сценарии, промты)
- Media: fal.ai (изображения, клипы, музыка)
- Соцсети: TikTok / Instagram / YouTube API (загрузка)

---

## Архитектура

```
[UI: Visual Editor] --> [API: CRUD + Run] --> [Engine: executePipeline()]
                                                    |
                                          [Graph: topologicalSort()]
                                                    |
                                    [Executors: executeNode() per type]
                                          /       |       \
                                  [Trendwatcher] [Scenario] [Video] ...
                                                    |
                                      [Sub-pipelines: async fire-and-forget]
                                          /                \
                            [runVideoPipeline()]   [runUploadPipeline()]
```

**Потоки запуска:**
- Manual: UI -> `POST /api/pipelines/[id]/run` -> `executePipeline(runId)`
- Schedule: `pipeline-scheduler.ts` plugin (каждые 60с) -> `executePipeline(runId)`
- Webhook: `POST /api/webhooks/[token]` (без авторизации) -> `executePipeline(runId)`

---

## База данных (Prisma)

### Enums

| Enum | Значения |
|------|----------|
| `PipelineStatus` | `active`, `inactive` |
| `RunStatus` | `pending`, `running`, `success`, `failed`, `cancelled` |
| `StepStatus` | `pending`, `running`, `success`, `failed`, `skipped` |
| `TriggerType` | `manual`, `schedule`, `webhook` |

### Модель `Pipeline`

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | `Int` PK | ID конвейера |
| `userId` | `Int` FK | Создатель |
| `name` | `String` | Название |
| `description` | `String?` | Описание |
| `status` | `PipelineStatus` | Активен / неактивен (default: `inactive`) |
| `graphData` | `Json` | `{ nodes: [], edges: [] }` -- граф нод |
| `sharedWith` | `Int[]` | ID пользователей с доступом |
| `webhookToken` | `String?` unique | Токен для внешнего запуска |
| `createdAt` | `DateTime` | Дата создания |
| `updatedAt` | `DateTime` | Дата обновления |

**Связи:** `runs[]` (WorkflowRun), `versions[]` (PipelineVersion), `schedule?` (PipelineSchedule)

### Модель `WorkflowRun`

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | `Int` PK | ID запуска |
| `pipelineId` | `Int` FK | Конвейер |
| `status` | `RunStatus` | Статус (default: `pending`) |
| `triggerType` | `TriggerType` | Тип запуска (default: `manual`) |
| `triggeredBy` | `Int?` | Кто запустил |
| `startedAt` | `DateTime` | Время старта |
| `finishedAt` | `DateTime?` | Время завершения |
| `errorMessage` | `String?` | Сообщение об ошибке |
| `createdAt` | `DateTime` | Дата создания |

**Индексы:** `(pipelineId, createdAt)`, `(status)`
**Связи:** `steps[]` (WorkflowStep)

### Модель `WorkflowStep`

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | `Int` PK | ID шага |
| `runId` | `Int` FK | Запуск |
| `nodeId` | `String` | ID ноды в графе |
| `nodeName` | `String` | Отображаемое имя |
| `nodeType` | `String` | Тип ноды (trendwatcher, scenario, ...) |
| `status` | `StepStatus` | Статус шага (default: `pending`) |
| `input` | `Json?` | Входные данные |
| `output` | `Json?` | Выходные данные |
| `error` | `String?` | Текст ошибки |
| `duration` | `Int?` | Длительность (ms) |
| `createdAt` | `DateTime` | Дата создания |

**Индекс:** `(runId, nodeId)`

### Модель `PipelineVersion`

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | `Int` PK | ID версии |
| `pipelineId` | `Int` FK | Конвейер |
| `version` | `Int` | Номер версии (auto-increment) |
| `graphData` | `Json` | Снимок nodes/edges на момент версии |
| `name` | `String?` | Опциональный лейбл |
| `createdById` | `Int?` | Кто создал |
| `createdAt` | `DateTime` | Дата |

**Unique:** `(pipelineId, version)`

### Модель `PipelineSchedule`

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | `Int` PK | ID |
| `pipelineId` | `Int` FK unique | Конвейер (один на один) |
| `cronExpr` | `String` | Cron-выражение (5 полей) |
| `timezone` | `String` | Часовой пояс (default: `UTC`) |
| `enabled` | `Boolean` | Включен ли |
| `lastRunAt` | `DateTime?` | Последний запуск |
| `nextRunAt` | `DateTime?` | Следующий запуск |
| `createdAt` | `DateTime` | Дата создания |
| `updatedAt` | `DateTime` | Дата обновления |

### Связанные модели контента

#### `Trend`
Источник контента (парсинг из TikTok/Instagram/YouTube):
- `id`, `appId`, `platform`, `sourceUrl`, `title`, `description`, `viewCount`, `hashtags`
- `status`: `new` | `reviewed` | `in_work` | `completed` | `dismissed`
- `analysisStatus`: `none` | `pending` | `running` | `completed` | `failed`
- Связи: `insights[]`, `brief?` (CreativeBrief), `scenarios[]`

#### `CreativeBrief`
AI-анализ тренда:
- `trendId` (unique FK), `hookAnalysis` (Json), `sceneStructure` (Json), `visualStyle` (Json), `viralityReasons` (Json)
- `summary`, `modelVersion`, `promptVersion`, `confidence`, `errorMessage`

#### `Scenario`
Сгенерированная концепция видео:
- `trendId` FK, `briefId?` FK, `appId?` FK
- `status`: `draft` | `generating` | `generated` | `selected` | `rejected` | `needs_rework` | `archived`
- `selectedVariantId`, `operatorNotes`, `reworkRequest`
- Связи: `variants[]`, `reviewActions[]`, `videos[]`

#### `ScenarioVariant`
Конкретный вариант сценария:
- `scenarioId` FK, `variantIndex`, `status`
- `title`, `hook`, `body`, `cta`, `fullScript`
- `visualStyleText`, `visualStyleStructured` (Json)
- `toneProfile`, `rationale`, `promptVersion`, `agentVersion`

#### `Video`
Сгенерированный видеоролик:
- `scenarioId` FK, `variantId?`
- `status`: `pending` | `configuring` | `generating_prompts` | `generating_images` | `generating_clips` | `generating_music` | `assembling` | `completed` | `failed` | `canceled`
- `format`: `portrait` | `landscape`
- `filePath`, `fileUrl`, `duration`
- `subtitlesEnabled`, `musicEnabled`, `clipDuration`, `imageCount`
- `isLocked`, `lockedAt`, `lockedReason` -- защита от параллельных запусков
- `totalCostEstimate`, `totalCostActual`
- Связи: `assets[]`, `uploads[]`, `steps[]` (VideoGenerationStep)

#### `VideoGenerationStep`
Шаги генерации видео (5 шагов):
- `videoId` FK, `stepKey`: `prompt_generation` | `image_generation` | `clip_generation` | `music_generation` | `assembly`
- `status`, `attemptCount`, `maxAttempts` (default: 3)
- `inputSnapshot`, `outputSnapshot`, `artifacts` (Json)
- `estimatedCost`, `actualCost`
- fal.ai поля: `falRequestId`, `falEndpoint`, `falQueueStatus`, `falResultUrl`, `falErrorCode`

#### `Upload`
Публикация в соцсеть:
- `videoId` FK, `socialAccountId` FK
- `status`: `pending` | `uploading` | `published` | `failed` | `scheduled` | `canceled` | `blocked_by_env`
- `publishMode`, `scheduledAt?`, `platformPostId?`, `platformPostUrl?`
- `title`, `description`, `hashtags[]`
- `idempotencyKey` (unique), `attemptCount`, `lastAttemptAt`
- Связи: `attempts[]` (SocialUploadAttempt)

---

## Типы (Shared Types)

### `shared/types/pipeline.ts`

```typescript
interface Pipeline {
  id: number
  userId: number
  name: string
  description: string | null
  status: string
  graphData: { nodes: any[]; edges: any[] }
  sharedWith: number[]
  createdAt: string
  updatedAt: string
}

interface PipelineListMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}
```

### `shared/types/workflow.ts`

```typescript
type RunStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
type StepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped'
type TriggerType = 'manual' | 'schedule' | 'webhook'

interface WorkflowStep {
  id: number
  runId: number
  nodeId: string
  nodeName: string
  nodeType: string
  status: StepStatus
  input: unknown
  output: unknown
  error: string | null
  duration: number | null
  createdAt: string
}

interface WorkflowRun {
  id: number
  pipelineId: number
  status: RunStatus
  triggerType: TriggerType
  triggeredBy: number | null
  startedAt: string
  finishedAt: string | null
  errorMessage: string | null
  createdAt: string
  steps?: WorkflowStep[]
  _count?: { steps: number }
}

interface WorkflowRunListMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}
```

### `shared/types/scenario.ts`

```typescript
type ScenarioStatus = 'draft' | 'generating' | 'generated' | 'selected' | 'rejected' | 'needs_rework' | 'archived'
type VariantStatus = 'draft' | 'accepted' | 'rejected' | 'needs_rework' | 'superseded'

interface VisualStyleStructured {
  colors: string[]
  atmosphere: string
  character: string
  stylePrompt: string
  improvedPrompt?: string
  lighting?: string
  cameraWork?: string
  effects?: string[]
}
```

---

## API эндпоинты

### CRUD конвейеров

| Метод | Путь | Право | Описание |
|-------|------|-------|----------|
| `GET` | `/api/pipelines` | `canRead` | Список конвейеров (page, perPage). Возвращает свои + shared |
| `POST` | `/api/pipelines` | `canCreate` | Создать конвейер (`name`, `description?`) |
| `GET` | `/api/pipelines/[id]` | `canRead` | Получить конвейер. Проверка доступа (owner/shared/admin) |
| `PUT` | `/api/pipelines/[id]` | `canWrite` | Обновить (`name?`, `description?`, `status?`, `graphData?`, `sharedWith?`) |
| `DELETE` | `/api/pipelines/[id]` | `canDelete` | Удалить конвейер |

### Запуск и история

| Метод | Путь | Право | Описание |
|-------|------|-------|----------|
| `POST` | `/api/pipelines/[id]/run` | `canRunAgent` | Ручной запуск. Проверяет: active, нет дублей, есть ноды. Fire-and-forget `executePipeline()` |
| `GET` | `/api/pipelines/[id]/runs` | `canRead` | Список запусков (page, perPage, status?). Включает `_count.steps` |
| `GET` | `/api/pipelines/[id]/runs/[runId]` | `canRead` | Детали запуска со всеми steps |

### Версии

| Метод | Путь | Право | Описание |
|-------|------|-------|----------|
| `GET` | `/api/pipelines/[id]/versions` | `canRead` | Список версий (max 50, desc) |
| `POST` | `/api/pipelines/[id]/versions` | `canWrite` | Сохранить текущий graphData как новую версию (`name?`) |
| `POST` | `/api/pipelines/[id]/versions/[versionId]/restore` | `canWrite` | Восстановить граф из версии |

### Расписание

| Метод | Путь | Право | Описание |
|-------|------|-------|----------|
| `GET` | `/api/pipelines/[id]/schedule` | `canRead` | Получить расписание |
| `PUT` | `/api/pipelines/[id]/schedule` | `canWrite` | Создать/обновить (`cronExpr`, `enabled`, `timezone?`). Валидация cron, расчет nextRunAt |
| `DELETE` | `/api/pipelines/[id]/schedule` | `canWrite` | Удалить расписание |

### Webhook

| Метод | Путь | Право | Описание |
|-------|------|-------|----------|
| `POST` | `/api/pipelines/[id]/webhook` | `canWrite` | Сгенерировать токен (UUID) |
| `DELETE` | `/api/pipelines/[id]/webhook` | `canWrite` | Отозвать токен |
| `POST` | `/api/webhooks/[token]` | **Без авторизации** | Публичный эндпоинт запуска по токену. Проверяет: токен существует, pipeline active, есть ноды |

### Тестирование нод

| Метод | Путь | Право | Описание |
|-------|------|-------|----------|
| `POST` | `/api/pipelines/nodes/test` | `canRunAgent` | Тест одной ноды (`nodeType`, `nodeConfig`, `mockInput`). Возвращает `{ success, output, duration }` |

---

## Движок исполнения (Pipeline Engine)

**Файл:** `server/utils/pipeline-engine.ts`

### `executePipeline(runId: number): Promise<void>`

Главная функция оркестрации запуска конвейера.

**Алгоритм:**
1. Загрузить `WorkflowRun` и связанный `Pipeline`
2. Обновить статус run -> `running`
3. Извлечь `nodes[]` и `edges[]` из `graphData`
4. Выполнить `topologicalSort(nodes, edges)` -- получить порядок выполнения
5. Для каждой ноды по порядку:
   - Создать `WorkflowStep` (status: `running`)
   - Собрать input из outputs предыдущих нод (`collectInput()`)
   - Разрешить выражения в конфиге (`resolveConfigExpressions()`)
   - Если есть `pinnedOutput` -- использовать его вместо выполнения
   - Выполнить ноду через `processNode()` с ретраями
   - Сохранить output/error в step
   - При ошибке: найти error edge -> перейти к обработчику ошибок
6. Обновить статус run -> `success` / `failed`
7. Записать `finishedAt`

### `processNode(type, data, input): Promise<unknown>`

Выполняет одну ноду с логикой ретраев.

- Читает `retryCount` и `retryDelay` из `data.config`
- Макс. 3 попытки
- Экспоненциальная задержка между попытками
- Вызывает `executeNode(type, data, input)` из `pipeline-graph.ts`

### `buildExpressionContext(outputs): Record<string, any>`

Строит контекст для подстановки `{{ }}` выражений из накопленных outputs предыдущих нод.

---

## Граф и алгоритмы (Pipeline Graph)

**Файл:** `server/utils/pipeline-graph.ts`

### Интерфейсы

```typescript
interface GraphNode {
  id: string
  data?: {
    type?: string
    label?: string
    config?: Record<string, unknown>
    pinnedOutput?: Record<string, unknown>
  }
}

interface GraphEdge {
  source: string
  target: string
  sourceHandle?: string | null  // "error" для error edges
}
```

### `topologicalSort(nodes, edges): string[]`

Топологическая сортировка алгоритмом Кана:
- Строит граф смежности и считает in-degree
- Обнаруживает циклы (throws error)
- Возвращает ID нод в порядке выполнения
- Обрабатывает отключенные компоненты

### `executeNode(type, data, input): Promise<unknown>`

Диспетчер -- маршрутизирует вызов к нужному исполнителю по типу ноды:
- `trendwatcher` -> `executeTrendwatcherNode()`
- `scenario` -> `executeScenarioNode()`
- `video` -> `executeVideoNode()`
- `upload` -> `executeUploadNode()`
- `analytics` -> `executeAnalyticsNode()`
- `filter` -> `executeFilterNode()`
- `notification` -> `executeNotificationNode()`
- `http_request` -> `executeHttpRequestNode()`
- `code` -> `executeCodeNode()`
- `set` -> `executeSetNode()`
- `if_switch` -> `executeIfNode()`
- `loop` -> `executeLoopNode()`
- `wait` -> `executeWaitNode()`

### `collectInput(nodeId, edges, outputs): Record<string, unknown>`

Собирает input для ноды из outputs всех предшественников (merge).

### `findErrorEdgeTarget(nodeId, edges): string | null`

Ищет ноду-обработчик ошибок (edge с `sourceHandle === "error"`).

---

## Исполнители нод (Node Executors)

### Основные (`server/utils/pipeline-executors.ts`)

#### 1. `executeTrendwatcherNode(config, input)`
- Запрашивает тренды из БД по фильтрам (`appId`, статус)
- Возвращает: `{ trends: Trend[] }`

#### 2. `executeScenarioNode(config, input)`
- Вход: `{ trends: Trend[] }`
- Конфиг: `{ appId?, variantsCount? }`
- Вызывает `generateScenarios()` (Anthropic Claude AI)
- Создает записи `Scenario` + `ScenarioVariant`
- Возвращает: `{ scenarios: Scenario[] }`

#### 3. `executeVideoNode(config, input)`
- Вход: `{ scenarios: Scenario[] }`
- Создает записи `Video`
- Асинхронно запускает `runVideoPipeline()` (fire-and-forget)
- Возвращает: `{ videos: Video[] }`

#### 4. `executeUploadNode(config, input)`
- Вход: `{ videos: Video[] }`
- Конфиг: `{ accountId: number }`
- Создает записи `Upload`
- Асинхронно запускает `runUploadPipeline()` (fire-and-forget)
- Возвращает: `{ uploads: Upload[] }`

#### 5. `executeAnalyticsNode(config, input)`
- Собирает метрики с опубликованных видео
- Вызывает `collectMetrics()`
- Возвращает: `{ collected: number, errors: number }`

#### 6. `executeFilterNode(config, input)`
- Конфиг: `{ metric: string, threshold: number }`
- Возвращает `null` для пропуска downstream (или input для продолжения)

#### 7. `executeNotificationNode(config, input)`
- Конфиг: `{ message: string }`
- Отправляет Telegram-алерт через `sendTelegramAlert()`

### Дополнительные (`server/utils/pipeline-executors-extra.ts`)

#### 8. `executeHttpRequestNode(config, input)`
- Конфиг: `{ url, method?, headers?, body? }`
- Выполняет HTTP-запрос через `$fetch()`
- Возвращает: `{ response, statusCode }`

#### 9. `executeCodeNode(config, input)`
- Конфиг: `{ code: string }`
- Песочница: запрещает `process`, `require`, `fetch`, `prisma`, `fs`
- Доступны только `input` и `config`
- Возвращает: `{ output: result }`

#### 10. `executeSetNode(config, input)`
- Конфиг: `{ fields: Array<{ name, value }> }`
- Перезаписывает поля в объекте input
- Возвращает: обновленный input

#### 11. `executeIfNode(config, input)`
- Конфиг: `{ field, operator, value }`
- Операторы: `>`, `<`, `==`, `!=`, `contains`
- Возвращает: `{ ...input, _condition: boolean, _conditionField: string }`

#### 12. `executeLoopNode(config, input)`
- Конфиг: `{ arrayField?: string }`
- Итерирует по массиву
- Возвращает: `{ items, totalItems, currentIndex }`

#### 13. `executeWaitNode(config, input)`
- Конфиг: `{ delaySeconds?: number }`
- `await delay(ms)`
- Возвращает: input без изменений

---

## Суб-пайплайны

### Video Pipeline (`server/utils/video-pipeline.ts`)

**`runVideoPipeline(videoId): Promise<void>`**

5-шаговый пайплайн генерации видео:

| Шаг | StepKey | Описание |
|-----|---------|----------|
| 1 | `prompt_generation` | AI (Anthropic) создает промты для изображений и музыки из текста сценария |
| 2 | `image_generation` | fal.ai (flux/dev) генерирует изображения по промтам |
| 3 | `clip_generation` | fal.ai создает видеоклипы из изображений |
| 4 | `music_generation` | fal.ai генерирует фоновую музыку |
| 5 | `assembly` | Сборка: изображения + клипы + музыка + субтитры -> финальное видео |

**Ключевые механизмы:**
- **Job Locking:** `isLocked` + `lockedAt` предотвращает параллельные запуски
- **Skip Completed:** завершенные шаги можно пропустить при повторе
- **fal.ai Integration:** polling с `falRequestId`, статусы, webhook
- **Asset Management:** сохранение файлов на диск
- **Cost Tracking:** оценка и фактическая стоимость
- **Retry:** per-step retry (max 3 attempts)

**Дополнительные экспорты:**
- `rerunVideoStep(videoId, stepKey)` -- перезапуск конкретного шага
- `cancelVideoPipeline(videoId)` -- отмена текущего пайплайна
- `resumeVideoPipeline(videoId)` -- продолжение с последнего упавшего шага

### Upload Pipeline (`server/utils/upload-pipeline.ts`)

**`runUploadPipeline(uploadId): Promise<void>`**

Процесс публикации видео в соцсети:
1. Загрузка `Upload` + `Video` + `SocialAccount`
2. Расшифровка креденшалов соцсети
3. Выбор адаптера платформы (TikTok / Instagram / YouTube)
4. Retry-логика с записью `SocialUploadAttempt`
5. Обновление статуса и метрик

**Механизмы:**
- Platform Adapters -- разная логика на каждую платформу
- Token Refresh -- обработка истечения OAuth
- Idempotency Key -- защита от дубликатов
- Attempt Tracking -- каждая попытка записывается

### Scenario Pipeline (`server/utils/agents/scenario-pipeline.ts`)

**`generateScenarios(input, app, variantsCount): Promise<GeneratedVariant[]>`**

5-этапный AI-пайплайн генерации сценариев:

| Этап | Описание |
|------|----------|
| 1. Hook Generation | Создание хуков (question, shock, story, controversy, pain_point, promise) |
| 2. Scene Breakdown | Построение нарративной структуры (3-6 сцен) |
| 3. Body Text | Написание основного текста скрипта |
| 4. Visual Style | Генерация описания визуального стиля |
| 5. Humanization | Полировка текста до естественного звучания |

**Вход:**
```typescript
interface ScenarioInput {
  trendTitle: string
  trendDescription?: string | null
  platform: string
  hashtags: string[]
  viewCount: number
  brief: BriefData | null           // Основной источник (CreativeBrief)
  insights: InsightFallback[]       // Fallback если нет brief
  appName: string
  appDescription?: string | null
  appKeywords: string[]
  variantsCount?: number
}
```

**Выход:**
```typescript
interface GeneratedVariant {
  title: string
  hook: string
  body: string
  cta: string
  fullScript: string
  visualStyleText: string
  visualStyleStructured: VisualStyleStructured | null
  toneProfile: string
  rationale: string
}
```

### Idea Pipeline (`server/utils/idea-pipeline.ts`)

**`processIdea(ideaId): Promise<void>`**

3-этапная обработка идеи:
1. **Metadata Extraction** -- oEmbed + OG-теги для получения метаданных видео
2. **Basic AI Analysis** -- создание `IdeaBasicResult`
3. **Structured Analysis** -- полный `IdeaAnalysis` в формате CreativeBrief

---

## Утилиты

### Expression Evaluator (`server/utils/expression-evaluator.ts`)

```typescript
evaluateExpression(template: string, context: Record<string, any>): string
// Подставляет {{ path.to.value }} значениями из контекста

hasExpressions(value: string): boolean
// Проверяет наличие {{ }} паттернов

resolveConfigExpressions(config, context): Record<string, unknown>
// Применяет подстановку ко всем строковым полям конфига
// Используется движком для передачи данных между нодами
```

### Cron Parser (`server/utils/cron-parser.ts`)

```typescript
getNextRunTime(cronExpr: string, base?: Date): Date
// Вычисляет следующее время запуска
// Формат: minute hour day month day-of-week
// Поддержка: */N, N-M, списки, wildcard
// Макс. итераций: 525960 (~1 год)

isValidCron(expr: string): boolean
// Валидация формата cron-выражения
```

### Agent Logger (`server/utils/agent-logger.ts`)

```typescript
logAgent(module: string, level: 'info'|'warn'|'error', message: string, details?, cycleId?): Promise<void>
// Пишет в таблицу AgentLog
// При level === 'error' отправляет Telegram-алерт
```

---

## Планировщик (Scheduler Plugin)

**Файл:** `server/plugins/pipeline-scheduler.ts`

Nitro-плагин автоматического запуска конвейеров по cron.

**Работа:**
- Запускается каждые 60 секунд
- Выбирает записи `PipelineSchedule` с `enabled: true` и `nextRunAt <= now`
- Берет максимум 20 расписаний за интервал
- Для каждого:
  1. Проверяет статус pipeline = `active`
  2. Проверяет наличие нод
  3. Создает `WorkflowRun` с `triggerType: 'schedule'`
  4. Fire-and-forget `executePipeline(runId)`
  5. Обновляет `lastRunAt` и пересчитывает `nextRunAt`
- Ошибки логируются через `logAgent()` + Telegram

---

## Фронтенд: страницы

### `app/pages/pipeline/index.vue`

Список всех конвейеров с пагинацией (20 на страницу). Карточки конвейеров, кнопка создания, онбординг-гайд.

### `app/pages/pipeline/[id].vue`

Основной визуальный редактор конвейера:
- **Vue Flow** канвас для графа нод
- **Тулбар:** сохранение, запуск, статус, расписание, версии, webhook, история
- **Левый сайдбар:** 13 типов блоков для drag-and-drop
- **Правый сайдбар:** настройки выбранной ноды, тест, последний запуск
- **Хоткеи:** Ctrl+S (сохранить), Ctrl+Z / Ctrl+Shift+Z (undo/redo)
- Синхронизация с Pinia store

### `app/pages/pipeline/[id]/runs/index.vue`

Таблица истории запусков: статус, тип триггера, длительность, пагинация.

### `app/pages/pipeline/[id]/runs/[runId].vue`

Детали запуска: раскрывающиеся шаги с input/output/error. Живой polling каждые 2с пока run активен.

---

## Фронтенд: компоненты

### Основные компоненты редактора

| Компонент | Файл | Описание |
|-----------|------|----------|
| `PipelineCanvas` | `app/components/pipeline/PipelineCanvas.vue` | Канвас Vue Flow: 13 типов нод, drag-and-drop, connections, mini-map, grid snap (20px) |
| `PipelineToolbar` | `app/components/pipeline/PipelineToolbar.vue` | Верхняя панель: имя, статус, dirty-индикатор, кнопки действий, undo/redo |
| `PipelineSidebar` | `app/components/pipeline/PipelineSidebar.vue` | Левый сайдбар: 13 перетаскиваемых блоков по категориям |
| `PipelineNodeSettings` | `app/components/pipeline/PipelineNodeSettings.vue` | Правый сайдбар: форма конфига ноды, тест, pin output, удаление |
| `PipelineNode` | `app/components/pipeline/PipelineNode.vue` | Шаблон ноды: иконка, цвет, handles (main + error), индикаторы |
| `PipelineCard` | `app/components/pipeline/PipelineCard.vue` | Карточка в списке: имя, кол-во нод, дата обновления |
| `PipelineStatusBadge` | `app/components/pipeline/PipelineStatusBadge.vue` | Бейдж: active (зеленый) / inactive (серый) |
| `PipelineNodeLastRun` | `app/components/pipeline/PipelineNodeLastRun.vue` | Инфо о последнем запуске ноды: input/output JSON, статус, ошибка |

### Модальные окна

| Компонент | Файл | Описание |
|-----------|------|----------|
| `PipelineCreateModal` | `app/components/pipeline/PipelineCreateModal.vue` | Создание конвейера: имя (обязательно), описание |
| `PipelineVersionsModal` | `app/components/pipeline/PipelineVersionsModal.vue` | Версии: список (max 50), сохранить текущую, восстановить |
| `PipelineScheduleModal` | `app/components/pipeline/PipelineScheduleModal.vue` | Расписание: cron-выражение, пресеты (hourly, daily 9am, weekly), вкл/выкл |
| `PipelineWebhookModal` | `app/components/pipeline/PipelineWebhookModal.vue` | Webhook: генерация токена, URL, копирование, отзыв |

### Конфиги нод (PipelineNodeConfigForm -> type-specific)

| Компонент | Тип ноды | Параметры |
|-----------|----------|-----------|
| `TrendwatcherConfig` | `trendwatcher` | App, платформы (multi), ключевые слова (tags), гео, язык (ru/en/es), стратегия (aggressive/organic/viral), AI-подсказка |
| `ScenarioConfig` | `scenario` | Кол-во вариантов (1/3/5), стили хуков (question/shock/story/controversy/pain_point/promise), AI-подсказка |
| `VideoConfig` | `video` | Формат (vertical/horizontal), качество (720p/1080p), музыка (toggle) |
| `UploadConfig` | `upload` | App, группа аккаунтов, платформа (TikTok/Instagram/YouTube), заголовок, описание, хештеги, AI-подсказки |
| `AnalyticsConfig` | `analytics` | Метрики (checkboxes: views/likes/shares/comments/watchTime/ctr), порог |
| `FilterConfig` | `filter` | Метрика, оператор (>/</=/>=/<=), значение |
| `NotificationConfig` | `notification` | Канал (Telegram), сообщение (textarea), AI-подсказка |
| `HttpRequestConfig` | `http_request` | Метод (GET/POST/PUT/DELETE), URL, заголовки (JSON), тело (JSON) |
| `CodeConfig` | `code` | JavaScript-код (textarea), доступны `input` и `config` |
| `SetConfig` | `set` | Динамические пары name/value, добавление/удаление полей |
| `IfConfig` | `if_switch` | Поле, оператор (>/</==/!=/contains), значение. main=true, error=false |
| `LoopConfig` | `loop` | Имя поля-массива |
| `WaitConfig` | `wait` | Задержка (5s/30s/1m/5m/15m) |

### Метаданные нод (`app/utils/pipeline-node-meta.ts`)

Экспортирует:
- `nodeTypeLabels` -- маппинг type -> отображаемое имя
- `nodeTypeDescriptions` -- маппинг type -> описание
- `nodeTypeIcons` -- маппинг type -> mingcute-иконка

---

## Фронтенд: Pinia Store

### `app/stores/pipelineEditor.ts`

**Store Name:** `pipelineEditor`

#### State

| Поле | Тип | Описание |
|------|-----|----------|
| `pipelineId` | `number \| null` | Текущий ID |
| `name` | `string` | Название |
| `description` | `string` | Описание |
| `status` | `string` | Статус (active/inactive) |
| `nodes` | `GraphNode[]` | Ноды графа |
| `edges` | `GraphEdge[]` | Связи |
| `webhookToken` | `string \| null` | Текущий webhook-токен |
| `isDirty` | `boolean` | Есть несохраненные изменения |
| `selectedNodeId` | `string \| null` | Выбранная нода |
| `history` | `HistoryEntry[]` | Стек undo/redo (max 50) |
| `historyIndex` | `number` | Текущая позиция в истории |

#### Actions

| Action | Описание |
|--------|----------|
| `loadFromApi(pipeline)` | Загрузить данные из API |
| `toGraphData()` | Экспорт `{ nodes, edges }` |
| `addNode(node)` | Добавить ноду + push history |
| `removeNode(id)` | Удалить ноду + все связанные edges |
| `updateNodeData(id, data)` | Обновить конфиг ноды |
| `addEdge(edge)` | Добавить связь |
| `selectNode(id)` | Выбрать ноду |
| `undo()` | Откат |
| `redo()` | Повтор |
| `pushHistory()` | Сохранить состояние в историю |
| `$reset()` | Полный сброс |

#### Computed

| Computed | Описание |
|----------|----------|
| `canUndo` | Доступен ли undo |
| `canRedo` | Доступен ли redo |

---

## Фронтенд: композаблы

| Композабл | Файл | Экспорты |
|-----------|------|----------|
| `usePipelines` | `app/composables/usePipelines.ts` | `usePipelines(filters)` -- `useFetch` списка конвейеров с пагинацией |
| `usePipelineDetail` | `app/composables/usePipelineDetail.ts` | `usePipelineDetail(id)` -- `useFetch` одного конвейера |
| `usePipelineRuns` | `app/composables/usePipelineRuns.ts` | `usePipelineRuns(pipelineId, page?)` -- `useFetch` списка запусков |
| `usePipelineRunDetail` | `app/composables/usePipelineRunDetail.ts` | `usePipelineRunDetail(pipelineId, runId)` -- детали + auto-polling (2с) при active |
| `usePipelineActions` | `app/composables/usePipelineActions.ts` | `createPipeline()`, `savePipeline()`, `deletePipeline()` + `isSaving`, `isDeleting`, `error` |

---

## Модель прав доступа

| Право | Что позволяет |
|-------|---------------|
| `canRead` | Просмотр конвейеров, запусков, версий, расписаний |
| `canCreate` | Создание новых конвейеров |
| `canWrite` | Редактирование, версии, расписание, webhook |
| `canDelete` | Удаление конвейеров |
| `canRunAgent` | Запуск конвейеров, тестирование нод |
| `canAdmin` | Обход всех проверок доступа |

**Проверка доступа:** owner (userId), shared (sharedWith[]), admin (canAdmin).

---

## Ключевые архитектурные паттерны

| Паттерн | Описание |
|---------|----------|
| **Fire-and-Forget** | Video и Upload пайплайны запускаются асинхронно, не блокируя основной pipeline |
| **Job Locking** | `isLocked` + `lockedAt` на Video предотвращает дублирование запусков |
| **Step Caching** | Завершенные шаги video pipeline можно пропустить при ретрае |
| **Expression Templating** | `{{ path.to.value }}` в конфигах нод подставляются из outputs предыдущих нод |
| **Topological Execution** | Ноды выполняются в порядке зависимостей (алгоритм Кана) с детекцией циклов |
| **Error Routing** | Ноды могут иметь error edge для обработки ошибок (dashed red connection) |
| **Pinned Output** | Ноды могут иметь "закрепленный" output для тестирования без реального выполнения |
| **Retry Strategy** | Конфигурируемый per-node retry (count + delay) с экспоненциальным backoff |
| **Versioning** | Полная история графа с восстановлением любой версии |
| **Cron Scheduling** | Фоновый плагин проверяет расписания каждые 60с, запускает до 20 конвейеров за интервал |
| **Webhook Trigger** | Публичный эндпоинт (без авторизации) по UUID-токену |
| **Sandbox Execution** | `executeCodeNode` запрещает опасные объекты (process, require, fs) |
| **Idempotency** | Upload использует `idempotencyKey` для защиты от дубликатов |

---

## Полный список файлов

### Страницы
- `app/pages/pipeline/index.vue`
- `app/pages/pipeline/[id].vue`
- `app/pages/pipeline/[id]/runs/index.vue`
- `app/pages/pipeline/[id]/runs/[runId].vue`

### Компоненты
- `app/components/pipeline/PipelineCanvas.vue`
- `app/components/pipeline/PipelineToolbar.vue`
- `app/components/pipeline/PipelineSidebar.vue`
- `app/components/pipeline/PipelineNodeSettings.vue`
- `app/components/pipeline/PipelineNode.vue`
- `app/components/pipeline/PipelineCard.vue`
- `app/components/pipeline/PipelineStatusBadge.vue`
- `app/components/pipeline/PipelineNodeLastRun.vue`
- `app/components/pipeline/PipelineCreateModal.vue`
- `app/components/pipeline/PipelineVersionsModal.vue`
- `app/components/pipeline/PipelineScheduleModal.vue`
- `app/components/pipeline/PipelineWebhookModal.vue`
- `app/components/pipeline/PipelineNodeConfigForm.vue`
- `app/components/pipeline/config/TrendwatcherConfig.vue`
- `app/components/pipeline/config/ScenarioConfig.vue`
- `app/components/pipeline/config/VideoConfig.vue`
- `app/components/pipeline/config/UploadConfig.vue`
- `app/components/pipeline/config/AnalyticsConfig.vue`
- `app/components/pipeline/config/FilterConfig.vue`
- `app/components/pipeline/config/NotificationConfig.vue`
- `app/components/pipeline/config/HttpRequestConfig.vue`
- `app/components/pipeline/config/CodeConfig.vue`
- `app/components/pipeline/config/SetConfig.vue`
- `app/components/pipeline/config/IfConfig.vue`
- `app/components/pipeline/config/LoopConfig.vue`
- `app/components/pipeline/config/WaitConfig.vue`

### Store
- `app/stores/pipelineEditor.ts`

### Композаблы
- `app/composables/usePipelines.ts`
- `app/composables/usePipelineDetail.ts`
- `app/composables/usePipelineRuns.ts`
- `app/composables/usePipelineRunDetail.ts`
- `app/composables/usePipelineActions.ts`

### Утилиты (frontend)
- `app/utils/pipeline-node-meta.ts`

### Типы
- `shared/types/pipeline.ts`
- `shared/types/workflow.ts`
- `shared/types/scenario.ts`

### API маршруты
- `server/api/pipelines.get.ts`
- `server/api/pipelines.post.ts`
- `server/api/pipelines/[id].get.ts`
- `server/api/pipelines/[id].put.ts`
- `server/api/pipelines/[id].delete.ts`
- `server/api/pipelines/[id]/run.post.ts`
- `server/api/pipelines/[id]/runs.get.ts`
- `server/api/pipelines/[id]/runs/[runId].get.ts`
- `server/api/pipelines/[id]/versions.get.ts`
- `server/api/pipelines/[id]/versions.post.ts`
- `server/api/pipelines/[id]/versions/[versionId]/restore.post.ts`
- `server/api/pipelines/[id]/schedule.get.ts`
- `server/api/pipelines/[id]/schedule.put.ts`
- `server/api/pipelines/[id]/schedule.delete.ts`
- `server/api/pipelines/[id]/webhook.post.ts`
- `server/api/pipelines/[id]/webhook.delete.ts`
- `server/api/webhooks/[token].post.ts`
- `server/api/pipelines/nodes/test.post.ts`

### Серверные утилиты
- `server/utils/pipeline-engine.ts`
- `server/utils/pipeline-graph.ts`
- `server/utils/pipeline-executors.ts`
- `server/utils/pipeline-executors-extra.ts`
- `server/utils/video-pipeline.ts`
- `server/utils/upload-pipeline.ts`
- `server/utils/agents/scenario-pipeline.ts`
- `server/utils/idea-pipeline.ts`
- `server/utils/expression-evaluator.ts`
- `server/utils/cron-parser.ts`
- `server/utils/agent-logger.ts`

### Плагины
- `server/plugins/pipeline-scheduler.ts`

### Prisma
- `prisma/schema.prisma`
