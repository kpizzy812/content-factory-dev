# Pipeline Execution Engine — Техническое задание

> v1.0 | Апрель 2026 | Спецификация превращения визуального конвейера ZavodCamp в полнофункциональную платформу автоматизации

---

## 1. Обзор и цель

### Что есть сейчас

ZavodCamp имеет визуальный редактор конвейеров на базе Vue Flow. Он позволяет:

- Создавать, редактировать, удалять конвейеры (CRUD через 5 API-эндпоинтов)
- Перетаскивать 7 типов нод на холст (trendwatcher, scenario, video, upload, analytics, filter, notification)
- Соединять ноды рёбрами (edges) визуально
- Настраивать каждую ноду через конфиг-формы в правом сайдбаре (7 конфиг-компонентов)
- Сохранять граф в JSON-поле `graphData` модели Pipeline

**Существующая инфраструктура:**
- Prisma-модель `Pipeline` (id, userId, name, description, status, graphData, sharedWith)
- Pinia store `pipelineEditor` (nodes, edges, isDirty, selectedNodeId)
- 16 компонентов в `app/components/pipeline/`
- 2 страницы: список (`/pipeline`) и редактор (`/pipeline/:id`)
- RBAC-модуль `pipeline` с requireScopedAccess на всех эндпоинтах

### Чего нет (критический gap)

Конвейер невозможно **запустить**. Canvas — это визуальный редактор без исполняющего движка. Отсутствуют:

1. **Execution Engine** — обход графа, передача данных между нодами, обработка ошибок
2. **Execution History** — список запусков, логи каждого шага
3. **Per-node Logs** — input/output/error для каждой ноды в запуске
4. **Triggers** — ручной запуск, расписание (cron), webhooks
5. **Error Handling** — error output paths, retry, fallback
6. **Версионирование** — снапшоты графа, откат к предыдущей версии
7. **Data Mapping** — передача данных между нодами через выражения
8. **Flow Control** — ветвление (if/switch), циклы, ожидание

### Целевое состояние

Платформа автоматизации уровня n8n/Zapier, где маркетолог (No-Code оператор) может:

1. Собрать конвейер из блоков визуально (уже есть)
2. Нажать "Запустить" и увидеть, как данные проходят по конвейеру в реальном времени
3. Просмотреть историю запусков и понять, что пошло не так в каждом блоке
4. Настроить автоматический запуск по расписанию
5. Создать ветвление логики (если метрики хорошие — загрузить на все платформы, иначе — уведомить)
6. Тестировать отдельные блоки перед запуском всего конвейера
7. Откатиться к предыдущей версии конвейера

---

## 2. Фазы реализации

### Фаза P0 — Minimum Viable Execution (без этого конвейер бесполезен)

| # | Задача | Результат |
|---|--------|-----------|
| 1 | Execution Engine | Граф исполняется последовательно, данные передаются между нодами |
| 2 | Manual Trigger | Кнопка "Запустить" в тулбаре конвейера |
| 3 | WorkflowRun + WorkflowStep (Prisma) | Каждый запуск и каждый шаг логируются в БД |
| 4 | Execution History UI | Страница со списком запусков конвейера |
| 5 | Per-node Logs | Input/output/error каждой ноды в sidebar при просмотре запуска |

**Критерий готовности P0:** оператор может нажать "Запустить", конвейер исполнится, результат каждого шага виден в UI.

### Фаза P1 — Production-Ready Features (значительно повышают ценность)

| # | Задача | Результат |
|---|--------|-----------|
| 6 | Schedule Trigger (cron) | Конвейер запускается автоматически по расписанию |
| 7 | Error Output на нодах | Второй handle для error path, красные рёбра |
| 8 | Retry Config | Настройка повторных попыток на каждой ноде |
| 9 | Node Test ("Execute Node") | Тестовый запуск одной ноды с mock/real input |
| 10 | PipelineVersion (снапшоты) | Сохранение и восстановление версий графа |

**Критерий готовности P1:** конвейер запускается по расписанию, ошибки обрабатываются через error path, ноды можно тестировать поштучно.

### Фаза P2 — Power Features (следующая итерация)

| # | Задача | Результат |
|---|--------|-----------|
| 11 | Data Pinning | Фиксация output ноды для отладки без перезапуска |
| 12 | Expression Editor | `{{ $node["Трендвотчер"].output.trends[0].title }}` |
| 13 | Webhook Trigger | Запуск конвейера через внешний HTTP-запрос |
| 14 | Undo/Redo в редакторе | История изменений графа в текущей сессии |
| 15 | Snap to Grid | Выравнивание нод по сетке |

### Фаза P3 — Advanced Automation (дальнейшее развитие)

| # | Задача | Результат |
|---|--------|-----------|
| 16 | Новые типы нод (HTTP Request, Code, Set/Transform) | Расширение возможностей автоматизации |
| 17 | Flow Control (If/Switch, Loop, Merge, Wait/Delay) | Сложная логика ветвления и циклов |
| 18 | Error Trigger, Stop And Error | Глобальная обработка ошибок |
| 19 | Sub-pipelines | Вложенные конвейеры |
| 20 | Pipeline Templates (шаблоны) | Готовые конвейеры для быстрого старта |

---

## 3. Execution Engine (P0 — ядро системы)

### 3.1. Принцип работы

Execution Engine — серверная логика в `server/utils/pipeline-engine/`, которая:

1. Принимает граф конвейера (nodes + edges из `graphData`)
2. Выполняет топологическую сортировку для определения порядка выполнения
3. Последовательно исполняет каждую ноду, передавая output предыдущей как input следующей
4. Логирует input/output/error/duration каждого шага в таблицу `WorkflowStep`
5. Обновляет статус запуска в таблице `WorkflowRun`

### 3.2. Топологическая сортировка

```
Вход: nodes[], edges[] из graphData
1. Построить adjacency list из edges (source → target)
2. Подсчитать in-degree для каждой ноды
3. Добавить в очередь все ноды с in-degree === 0 (стартовые)
4. BFS/Kahn's algorithm:
   - Извлечь ноду из очереди
   - Добавить в результат
   - Для каждого соседа уменьшить in-degree
   - Если in-degree === 0, добавить в очередь
5. Если результат.length !== nodes.length → ошибка: цикл в графе
Выход: nodes[] в порядке исполнения
```

**Обработка параллельных веток:**
- MVP (P0): последовательное исполнение в порядке топологической сортировки
- P3: параллельное исполнение независимых веток через Promise.all

### 3.3. Передача данных между нодами

Каждая нода при исполнении получает:

```typescript
interface NodeExecutionContext {
  nodeId: string           // ID ноды в графе
  nodeType: string         // Тип ноды (trendwatcher, scenario, ...)
  config: Record<string, any>  // Конфиг ноды из graphData.nodes[i].data.config
  input: Record<string, any>   // Output предыдущей ноды (или {} для стартовых)
  runId: number            // ID текущего WorkflowRun
}
```

Каждая нода возвращает:

```typescript
interface NodeExecutionResult {
  output: Record<string, any>  // Данные для передачи в следующие ноды
  status: 'success' | 'error'
  error?: string               // Сообщение об ошибке (при status === 'error')
}
```

**Правила маршрутизации данных:**
- Если у ноды один входящий edge — `input` = output предыдущей ноды
- Если у ноды несколько входящих edges — `input` = объект, где ключи = nodeId предыдущих нод, значения = их output
- Стартовая нода (in-degree === 0) получает `input = {}`

### 3.4. Node Executors (исполнители нод)

Каждый тип ноды имеет свой executor — серверную функцию, которая знает, как исполнить этот тип.

Файловая структура:

```
server/utils/pipeline-engine/
  engine.ts              — главный execution loop
  topological-sort.ts    — алгоритм сортировки
  types.ts               — интерфейсы
  executors/
    index.ts             — registry executors по типу ноды
    trendwatcher.ts      — поиск трендов через Apify / БД
    scenario.ts          — генерация сценариев через Anthropic
    video.ts             — запуск видеопайплайна
    upload.ts            — загрузка в соцсети
    analytics.ts         — сбор/анализ метрик
    filter.ts            — условное ветвление
    notification.ts      — Telegram-уведомление
```

**Пример executor (trendwatcher):**

```typescript
// server/utils/pipeline-engine/executors/trendwatcher.ts
export async function executeTrendwatcher(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
  const { config } = ctx
  // config содержит: appId, platforms, keywords, language, geo, strategy

  // 1. Найти тренды в БД по фильтрам
  const trends = await prisma.trend.findMany({
    where: {
      appId: config.appId,
      platform: { in: config.platforms },
      status: 'new',
    },
    take: config.limit || 10,
    orderBy: { viewCount: 'desc' },
  })

  // 2. Если трендов нет и включён Apify — запустить парсинг
  if (trends.length === 0 && config.strategy === 'auto') {
    // ... вызов Apify
  }

  return {
    output: { trends, count: trends.length },
    status: 'success',
  }
}
```

**Пример executor (filter):**

```typescript
// server/utils/pipeline-engine/executors/filter.ts
export async function executeFilter(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
  const { config, input } = ctx
  // config содержит: field, operator, value

  const fieldValue = getNestedValue(input, config.field)
  const passes = evaluateCondition(fieldValue, config.operator, config.value)

  return {
    output: {
      ...input,
      _filterResult: passes,
      _filterField: config.field,
      _filterOperator: config.operator,
    },
    status: 'success',
  }
}
```

### 3.5. Главный Execution Loop

```typescript
// server/utils/pipeline-engine/engine.ts — псевдокод
export async function executePipeline(pipelineId: number, triggeredBy: number, triggerType: TriggerType) {

  // 1. Загрузить конвейер из БД
  const pipeline = await prisma.pipeline.findUnique({ where: { id: pipelineId } })
  const { nodes, edges } = pipeline.graphData

  // 2. Валидация графа
  if (nodes.length === 0) throw new Error('Конвейер пустой')

  // 3. Топологическая сортировка
  const sortedNodes = topologicalSort(nodes, edges)

  // 4. Создать WorkflowRun
  const run = await prisma.workflowRun.create({
    data: {
      pipelineId,
      status: 'running',
      triggeredBy,
      triggerType,
      startedAt: new Date(),
    },
  })

  // 5. Map для хранения output каждой ноды
  const outputs: Map<string, any> = new Map()

  try {
    // 6. Последовательное исполнение
    for (const node of sortedNodes) {
      const step = await prisma.workflowStep.create({
        data: {
          runId: run.id,
          nodeId: node.id,
          nodeName: node.data.label,
          nodeType: node.data.type,
          status: 'running',
          input: buildNodeInput(node.id, edges, outputs),
        },
      })

      const startTime = Date.now()

      try {
        const executor = getExecutor(node.data.type)
        const result = await executor({
          nodeId: node.id,
          nodeType: node.data.type,
          config: node.data.config || {},
          input: buildNodeInput(node.id, edges, outputs),
          runId: run.id,
        })

        outputs.set(node.id, result.output)

        await prisma.workflowStep.update({
          where: { id: step.id },
          data: {
            status: result.status === 'success' ? 'completed' : 'failed',
            output: result.output,
            error: result.error,
            duration: Date.now() - startTime,
          },
        })

        if (result.status === 'error') {
          // P0: останавливаем конвейер при ошибке
          // P1: передаём в error output handle
          throw new Error(result.error || `Ошибка в ноде ${node.data.label}`)
        }
      } catch (err) {
        await prisma.workflowStep.update({
          where: { id: step.id },
          data: {
            status: 'failed',
            error: err.message,
            duration: Date.now() - startTime,
          },
        })
        throw err
      }
    }

    // 7. Успешное завершение
    await prisma.workflowRun.update({
      where: { id: run.id },
      data: {
        status: 'completed',
        finishedAt: new Date(),
      },
    })
  } catch (err) {
    // 8. Ошибка — помечаем запуск как failed
    await prisma.workflowRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        errorMessage: err.message,
      },
    })
  }

  return run
}
```

### 3.6. Механизм исполнения (runtime)

**P0 — Nitro in-process (без Redis):**
- Execution Engine работает в процессе Nitro-сервера
- Запуск через `POST /api/pipelines/:id/run` — fire-and-forget
- Endpoint создаёт WorkflowRun, вызывает `executePipeline()` без await, возвращает `{ data: { runId } }`
- Подходит для MVP: один сервер, один процесс, простая отладка

**Ограничения:**
- При рестарте сервера running-запуски теряются (нет recovery)
- Нет параллельного исполнения конвейеров (одна нода за раз в одном конвейере)
- При большом количестве конвейеров возможна перегрузка сервера

**Будущее (за рамками этого ТЗ):**
- Redis/BullMQ для очереди задач
- Отдельный worker-процесс для исполнения
- Recovery при рестарте

---

## 4. Prisma-модели

### 4.1. Новые модели

```prisma
// === EXECUTION ===

enum WorkflowRunStatus {
  pending
  running
  completed
  failed
  cancelled
}

enum WorkflowStepStatus {
  pending
  running
  completed
  failed
  skipped
}

enum TriggerType {
  manual
  schedule
  webhook
}

model WorkflowRun {
  id            Int               @id @default(autoincrement())
  pipelineId    Int
  pipeline      Pipeline          @relation(fields: [pipelineId], references: [id], onDelete: Cascade)
  status        WorkflowRunStatus @default(pending)
  triggeredBy   Int               // userId
  triggerType   TriggerType       @default(manual)
  startedAt     DateTime          @default(now())
  finishedAt    DateTime?
  errorMessage  String?
  createdAt     DateTime          @default(now())
  steps         WorkflowStep[]

  @@index([pipelineId, createdAt])
  @@index([status])
}

model WorkflowStep {
  id        Int                @id @default(autoincrement())
  runId     Int
  run       WorkflowRun        @relation(fields: [runId], references: [id], onDelete: Cascade)
  nodeId    String             // ID ноды в графе (из graphData)
  nodeName  String             // label ноды на момент запуска
  nodeType  String             // тип ноды (trendwatcher, scenario, ...)
  status    WorkflowStepStatus @default(pending)
  input     Json?              // входные данные
  output    Json?              // выходные данные
  error     String?            // сообщение об ошибке
  duration  Int?               // ms
  createdAt DateTime           @default(now())

  @@index([runId])
  @@index([nodeId])
}

// === VERSIONING (P1) ===

model PipelineVersion {
  id          Int      @id @default(autoincrement())
  pipelineId  Int
  pipeline    Pipeline @relation(fields: [pipelineId], references: [id], onDelete: Cascade)
  version     Int      // автоинкремент внутри pipeline
  name        String?  // опциональное имя снапшота
  graphData   Json     // копия graphData на момент снапшота
  createdById Int      // userId
  createdAt   DateTime @default(now())

  @@unique([pipelineId, version])
  @@index([pipelineId])
}

// === SCHEDULE (P1) ===

model PipelineSchedule {
  id          Int      @id @default(autoincrement())
  pipelineId  Int      @unique
  pipeline    Pipeline @relation(fields: [pipelineId], references: [id], onDelete: Cascade)
  cron        String   // cron-выражение: "0 */6 * * *"
  timezone    String   @default("UTC")
  enabled     Boolean  @default(true)
  lastRunAt   DateTime?
  nextRunAt   DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

### 4.2. Изменения существующих моделей

```prisma
model Pipeline {
  // ... существующие поля без изменений ...

  // Новые relations:
  runs       WorkflowRun[]
  versions   PipelineVersion[]   // P1
  schedule   PipelineSchedule?   // P1
}
```

### 4.3. Миграции

Каждая фаза создаёт свою миграцию:

- **P0:** `add_workflow_run_and_step` — WorkflowRun, WorkflowStep, relation к Pipeline
- **P1:** `add_pipeline_version_and_schedule` — PipelineVersion, PipelineSchedule

Использовать **только** `prisma migrate dev` (не `db push`).

---

## 5. Типы нод

### 5.1. Существующие ноды (7 штук — уже в Canvas)

| Тип | Описание | Input | Output |
|-----|----------|-------|--------|
| `trendwatcher` | Поиск трендов | `{}` (стартовая) или переданные фильтры | `{ trends: Trend[], count: number }` |
| `scenario` | Генерация сценариев | `{ trends: Trend[] }` | `{ scenarios: Scenario[], count: number }` |
| `video` | Генерация видео | `{ scenarios: Scenario[] }` | `{ videos: Video[], count: number }` |
| `upload` | Загрузка в соцсети | `{ videos: Video[] }` | `{ uploads: Upload[], count: number }` |
| `analytics` | Сбор и анализ метрик | `{ uploads: Upload[] }` | `{ metrics: PostMetrics[], analysis: string }` |
| `filter` | Условное ветвление | Любые данные | Те же данные + `_filterResult: boolean` |
| `notification` | Telegram-уведомление | Любые данные | `{ sent: boolean, message: string }` |

### 5.2. Trigger-ноды (P0 + P1)

Trigger-ноды — стартовые ноды конвейера. У них нет входного Handle (target), только выходной (source).

| Тип | Фаза | Описание | Config | Output |
|-----|------|----------|--------|--------|
| `trigger_manual` | P0 | Ручной запуск кнопкой | `{}` | `{ triggeredAt: string, triggeredBy: number }` |
| `trigger_schedule` | P1 | Запуск по cron-расписанию | `{ cron: string, timezone: string }` | `{ triggeredAt: string, scheduledTime: string }` |
| `trigger_webhook` | P2 | Запуск через HTTP-запрос | `{ path: string, method: string, auth?: string }` | `{ body: any, headers: Record, query: Record }` |

**Визуальное отличие trigger-нод:**
- Круглая форма (border-radius: 50%) вместо прямоугольной
- Иконка "молнии" (mingcute:flash-line)
- Цвет: `bg-primary/20 border-primary`
- Только один Handle: source (справа), нет target (слева)

**Логика trigger-нод при запуске:**
- `trigger_manual`: при нажатии кнопки "Запустить" в тулбаре, engine начинает обход графа с этой ноды
- `trigger_schedule`: Nitro-плагин (scheduler) проверяет PipelineSchedule каждую минуту и запускает совпавшие
- `trigger_webhook`: регистрируется динамический route `POST /api/pipelines/webhook/:webhookId`

### 5.3. Новые Action-ноды (P3)

| Тип | Описание | Config | Input | Output |
|-----|----------|--------|-------|--------|
| `http_request` | HTTP-запрос к внешнему API | `{ url, method, headers, body }` | Любые данные | `{ status, headers, body }` |
| `code` | Пользовательский JS-код | `{ code: string }` | Любые данные | Результат выполнения |
| `set_transform` | Трансформация данных | `{ fields: {key, value}[] }` | Любые данные | Новый объект |

### 5.4. Flow Control ноды (P3)

| Тип | Описание | Визуал |
|-----|----------|--------|
| `if_switch` | Ветвление по условию (true/false output) | Два source handle: "true" (зелёный) и "false" (красный) |
| `loop` | Цикл по массиву — выполняет дочернюю ветку для каждого элемента | Специальная иконка цикла |
| `merge` | Объединение данных из нескольких веток | Несколько target handle |
| `wait_delay` | Пауза на N секунд/минут | Иконка таймера |

### 5.5. Error-ноды (P3)

| Тип | Описание |
|-----|----------|
| `error_trigger` | Запускается когда любая нода в конвейере падает (глобальный catch) |
| `stop_and_error` | Принудительно останавливает конвейер с ошибкой |

---

## 6. Error Handling

### 6.1. Error Output Handle (P1)

Каждая нода (кроме trigger) получает второй source Handle — **error output**.

**Визуал:**
- Основной Handle (source, справа сверху): зелёный контур, label "main"
- Error Handle (source, справа снизу): красный контур, label "error"
- Edge из error handle → рисуется красным цветом, штрихованный

**Как хранится в graphData:**

```typescript
// Edge с указанием sourceHandle
{
  id: 'e-trendwatcher1-notification1',
  source: 'trendwatcher-1234',
  target: 'notification-5678',
  sourceHandle: 'error',    // 'main' | 'error'
  animated: true,
  style: { stroke: '#ef4444' },  // красный для error edges
}
```

**Логика в Engine:**
1. Нода возвращает `status: 'error'`
2. Engine проверяет: есть ли edges с `sourceHandle: 'error'` из этой ноды?
3. Если да — передаёт `{ error: message, nodeId, nodeType, input }` в error-ветку и продолжает
4. Если нет — останавливает конвейер (поведение P0)

### 6.2. Retry Config (P1)

Каждая нода может иметь retry-настройки в config:

```typescript
interface RetryConfig {
  enabled: boolean     // включено ли
  maxRetries: number   // максимум попыток (1-5)
  delayMs: number      // задержка между попытками (1000-60000)
  backoff: 'fixed' | 'exponential'  // стратегия задержки
}
```

**Хранение:** `node.data.config._retry: RetryConfig`

**Логика:**
1. Нода упала → проверить `_retry.enabled`
2. Если enabled и текущая попытка < maxRetries → повторить через delayMs
3. Записать в WorkflowStep.output.retries количество попыток
4. Если все попытки исчерпаны → передать в error output или остановить

### 6.3. UI для Retry Config

В правом сайдбаре (PipelineNodeSettings) для каждой ноды добавить секцию "Обработка ошибок":

- Toggle "Повторять при ошибке" (вкл/выкл)
- Input "Количество попыток" (1-5)
- Input "Задержка между попытками" (секунды)
- Select "Стратегия" (Фиксированная / Экспоненциальная)

---

## 7. API-эндпоинты

### 7.1. Execution (P0)

```
POST   /api/pipelines/:id/run
  - Guard: requireScopedAccess({ permissions: ['canRunAgent'], moduleSlug: 'pipeline' })
  - Валидация: pipeline существует, принадлежит пользователю или shared, status === 'active'
  - Валидация: нет running запуска для этого pipeline (предотвращение дублей)
  - Действие: создаёт WorkflowRun, запускает executePipeline fire-and-forget
  - Ответ: { data: { runId: number, status: 'running' } }

GET    /api/pipelines/:id/runs
  - Guard: requireScopedAccess({ permissions: ['canRead'], moduleSlug: 'pipeline' })
  - Query params: page, perPage, status (фильтр)
  - Ответ: { data: WorkflowRun[], meta: { total, page, perPage, totalPages } }

GET    /api/pipelines/:id/runs/:runId
  - Guard: requireScopedAccess({ permissions: ['canRead'], moduleSlug: 'pipeline' })
  - Include: steps (со всеми полями)
  - Ответ: { data: WorkflowRun & { steps: WorkflowStep[] } }
```

### 7.2. Node Test (P1)

```
POST   /api/pipelines/:id/nodes/:nodeId/test
  - Guard: requireScopedAccess({ permissions: ['canRunAgent'], moduleSlug: 'pipeline' })
  - Body: { input?: Record<string, any> }  — опциональный mock input
  - Действие: находит ноду в graphData, вызывает executor с переданным input
  - НЕ создаёт WorkflowRun (тестовый запуск)
  - Ответ: { data: { output: any, status: string, duration: number, error?: string } }
```

### 7.3. Versions (P1)

```
GET    /api/pipelines/:id/versions
  - Guard: requireScopedAccess({ permissions: ['canRead'], moduleSlug: 'pipeline' })
  - Ответ: { data: PipelineVersion[] } (без graphData, только метаданные)

POST   /api/pipelines/:id/versions
  - Guard: requireScopedAccess({ permissions: ['canWrite'], moduleSlug: 'pipeline' })
  - Body: { name?: string }
  - Действие: копирует текущий graphData, автоинкремент version
  - Ответ: { data: PipelineVersion }

POST   /api/pipelines/:id/versions/:versionId/restore
  - Guard: requireScopedAccess({ permissions: ['canWrite'], moduleSlug: 'pipeline' })
  - Действие: заменяет graphData конвейера на graphData из версии
  - Ответ: { data: Pipeline }
```

### 7.4. Schedule (P1)

```
GET    /api/pipelines/:id/schedule
  - Guard: requireScopedAccess({ permissions: ['canRead'], moduleSlug: 'pipeline' })
  - Ответ: { data: PipelineSchedule | null }

PUT    /api/pipelines/:id/schedule
  - Guard: requireScopedAccess({ permissions: ['canWrite'], moduleSlug: 'pipeline' })
  - Body: { cron: string, timezone?: string, enabled?: boolean }
  - Валидация: cron-выражение валидно, timezone валиден
  - Действие: upsert PipelineSchedule, пересчитать nextRunAt
  - Ответ: { data: PipelineSchedule }

DELETE /api/pipelines/:id/schedule
  - Guard: requireScopedAccess({ permissions: ['canWrite'], moduleSlug: 'pipeline' })
  - Действие: удалить PipelineSchedule
  - Ответ: { data: null }
```

### 7.5. Webhook (P2)

```
POST   /api/pipelines/webhook/:webhookId
  - Без auth (публичный endpoint, аутентификация через webhookId + optional secret)
  - Rate limit: 10 запросов в минуту на webhookId
  - Действие: найти pipeline по webhookId, запустить executePipeline
  - Ответ: { data: { runId: number } }
```

### 7.6. Сводная таблица эндпоинтов

| Метод | Путь | Фаза | Описание |
|-------|------|------|----------|
| POST | `/api/pipelines/:id/run` | P0 | Запуск конвейера |
| GET | `/api/pipelines/:id/runs` | P0 | История запусков |
| GET | `/api/pipelines/:id/runs/:runId` | P0 | Деталь запуска со шагами |
| POST | `/api/pipelines/:id/nodes/:nodeId/test` | P1 | Тест одной ноды |
| GET | `/api/pipelines/:id/versions` | P1 | Список версий |
| POST | `/api/pipelines/:id/versions` | P1 | Создать версию |
| POST | `/api/pipelines/:id/versions/:versionId/restore` | P1 | Восстановить версию |
| GET | `/api/pipelines/:id/schedule` | P1 | Получить расписание |
| PUT | `/api/pipelines/:id/schedule` | P1 | Создать/обновить расписание |
| DELETE | `/api/pipelines/:id/schedule` | P1 | Удалить расписание |
| POST | `/api/pipelines/webhook/:webhookId` | P2 | Вебхук-триггер |

---

## 8. UI-компоненты

### 8.1. Изменения в тулбаре (P0)

**Файл:** `app/components/pipeline/PipelineToolbar.vue`

Добавить:
- Кнопка **"Запустить"** (btn-success) — вызывает `POST /api/pipelines/:id/run`
  - Иконка: `mingcute:play-fill`
  - Disabled: если pipeline.status !== 'active' или есть running запуск
  - Loading state во время запуска
  - При успехе: toast "Конвейер запущен" + переход на историю запусков или открытие панели текущего запуска
- Кнопка **"История"** (btn-ghost) — открывает drawer/panel с историей запусков
  - Иконка: `mingcute:time-line`
  - Badge с количеством запусков за сегодня

### 8.2. Execution History — страница (P0)

**Файл:** `app/pages/pipeline/[id]/runs.vue`

Страница со списком запусков конвейера:

- Таблица запусков:
  - ID запуска
  - Статус (badge: running/completed/failed/cancelled — цвета: info/success/error/warning)
  - Тип триггера (manual/schedule/webhook — иконки)
  - Кто запустил (имя пользователя)
  - Время запуска
  - Длительность (human-readable: "2 мин 34 сек")
  - Ошибка (truncated, если есть)
- Фильтр по статусу
- Пагинация
- Клик по строке → переход на деталь запуска
- Empty state: "Конвейер ещё ни разу не запускался. Нажмите 'Запустить' в редакторе."

### 8.3. Run Detail — деталь запуска (P0)

**Файл:** `app/pages/pipeline/[id]/runs/[runId].vue`

Страница с визуализацией конкретного запуска:

**Верхняя панель:**
- Статус запуска (большой badge)
- Время: начало, окончание, длительность
- Тип триггера
- Кнопка "Повторить" (повторный запуск с теми же параметрами)

**Основная область — граф конвейера (read-only):**
- Тот же Vue Flow canvas, но в read-only режиме
- Каждая нода подсвечивается по статусу:
  - `completed`: зелёная рамка + галочка
  - `running`: синяя рамка + spinner
  - `failed`: красная рамка + крестик
  - `pending`: серая рамка
  - `skipped`: полупрозрачная
- Клик по ноде → открывает per-node logs в сайдбаре

**Правый сайдбар (per-node logs):**
- Имя ноды и тип
- Статус шага
- Длительность
- Tabs: "Input" / "Output" / "Error"
  - Input: JSON viewer с collapse/expand (read-only)
  - Output: JSON viewer с collapse/expand (read-only)
  - Error: текст ошибки, stack trace если есть
- Кнопка "Скопировать output" — копирует JSON в буфер обмена

### 8.4. Node Test Panel (P1)

**Файл:** `app/components/pipeline/PipelineNodeTestPanel.vue`

Панель тестирования одной ноды (в правом сайдбаре, новая tab):

- Tabs в PipelineNodeSettings: "Настройки" / "Тест"
- Tab "Тест":
  - Textarea для ввода mock input (JSON)
  - Кнопка "Выполнить ноду" (btn-info)
  - Результат:
    - Статус (success/error)
    - Output (JSON viewer)
    - Длительность
    - Ошибка (если есть)
  - Кнопка "Использовать как pin" (P2, disabled до реализации)

### 8.5. Version History Panel (P1)

**Файл:** `app/components/pipeline/PipelineVersionPanel.vue`

Панель версий (drawer или modal):

- Список версий (карточки):
  - Номер версии
  - Название (если задано)
  - Кто создал
  - Дата
  - Количество нод
- Кнопка "Сохранить текущую версию" → модал с полем "Название версии"
- Кнопка "Восстановить" у каждой версии → confirm dialog

### 8.6. Schedule Panel (P1)

**Файл:** `app/components/pipeline/PipelineSchedulePanel.vue`

Панель расписания (в тулбаре или в отдельном модале):

- Toggle "Запускать по расписанию"
- Cron builder (No-Code):
  - Select "Частота": каждые N минут / каждый час / каждый день / каждую неделю / custom
  - Для "каждый день": select времени (часы:минуты)
  - Для "каждую неделю": checkboxes дней + select времени
  - Для "custom": input для cron-выражения + подсказка формата
- Select "Часовой пояс"
- Превью: "Следующий запуск: 01 апреля 2026, 18:00 UTC"
- Информация о последнем запуске по расписанию

### 8.7. Error Path визуализация (P1)

Изменения в существующих компонентах:

**PipelineNode.vue:**
- Добавить второй source Handle снизу-справа с красным цветом
- Handle visible только если нода имеет хотя бы один edge с `sourceHandle: 'error'`
- Или: всегда показывать оба handle (main + error) для всех action-нод

**PipelineCanvas.vue:**
- Edges с `sourceHandle: 'error'` рисуются красным цветом и штриховкой:
  ```
  style: { stroke: '#ef4444', strokeDasharray: '5,5' }
  ```
- Разные label на edges: "main" (зелёный) vs "error" (красный)

### 8.8. Expression Editor (P2)

**Файл:** `app/components/pipeline/PipelineExpressionInput.vue`

Поле ввода с поддержкой выражений `{{ ... }}`:

- Input/Textarea с подсветкой `{{ }}` блоков (другой цвет)
- Autocomplete при вводе `{{ $node.`:
  - Список нод конвейера
  - После выбора ноды: `.output.` → список полей output (если есть pinned data или последний test result)
- Превью значения (если есть данные от предыдущего запуска)
- Tooltip с синтаксисом: `{{ $node["Имя ноды"].output.field }}`

**Expression Evaluator (серверная часть):**

```typescript
// server/utils/pipeline-engine/expression.ts
export function evaluateExpression(template: string, context: ExpressionContext): any {
  // Заменяет {{ $node["name"].output.field }} на реальное значение
  // НЕ использует eval() или new Function() — только парсинг шаблона
  // Поддерживает:
  //   {{ $node["Трендвотчер"].output.trends[0].title }}
  //   {{ $node["Фильтр"].output._filterResult }}
  //   {{ $trigger.triggeredAt }}
  //   {{ $run.id }}
}
```

### 8.9. Сводная таблица компонентов

| Компонент | Фаза | Новый / Изменение | Описание |
|-----------|------|-------------------|----------|
| `PipelineToolbar.vue` | P0 | Изменение | Кнопки "Запустить" и "История" |
| `PipelineRunStatusBadge.vue` | P0 | Новый | Badge статуса запуска |
| `PipelineRunCard.vue` | P0 | Новый | Карточка запуска в списке |
| `PipelineRunTimeline.vue` | P0 | Новый | Timeline шагов запуска |
| `PipelineStepLogViewer.vue` | P0 | Новый | JSON viewer input/output/error шага |
| `PipelineNode.vue` | P1 | Изменение | Второй handle (error output) |
| `PipelineCanvas.vue` | P1 | Изменение | Красные edges, read-only mode |
| `PipelineSidebar.vue` | P0+P1 | Изменение | Trigger-ноды в отдельной секции |
| `PipelineNodeSettings.vue` | P1 | Изменение | Tab "Тест", секция Retry |
| `PipelineNodeTestPanel.vue` | P1 | Новый | Тестирование одной ноды |
| `PipelineVersionPanel.vue` | P1 | Новый | Список и восстановление версий |
| `PipelineSchedulePanel.vue` | P1 | Новый | Cron builder |
| `PipelineRetryConfig.vue` | P1 | Новый | Форма настройки retry |
| `PipelineExpressionInput.vue` | P2 | Новый | Input с поддержкой выражений |
| `PipelineTriggerNode.vue` | P0 | Новый | Компонент trigger-ноды (круглая) |

---

## 9. TypeScript-типы

### 9.1. Shared Types

**Файл:** `shared/types/pipeline.ts` (расширение существующего)

```typescript
// === Execution ===

export type WorkflowRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type WorkflowStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
export type TriggerType = 'manual' | 'schedule' | 'webhook'

export interface WorkflowRun {
  id: number
  pipelineId: number
  status: WorkflowRunStatus
  triggeredBy: number
  triggerType: TriggerType
  startedAt: string
  finishedAt: string | null
  errorMessage: string | null
  createdAt: string
  steps?: WorkflowStep[]
}

export interface WorkflowStep {
  id: number
  runId: number
  nodeId: string
  nodeName: string
  nodeType: string
  status: WorkflowStepStatus
  input: Record<string, any> | null
  output: Record<string, any> | null
  error: string | null
  duration: number | null
  createdAt: string
}

export interface WorkflowRunListMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

// === Versioning ===

export interface PipelineVersion {
  id: number
  pipelineId: number
  version: number
  name: string | null
  graphData: { nodes: any[]; edges: any[] }
  createdById: number
  createdAt: string
}

// === Schedule ===

export interface PipelineSchedule {
  id: number
  pipelineId: number
  cron: string
  timezone: string
  enabled: boolean
  lastRunAt: string | null
  nextRunAt: string | null
}

// === Node Execution ===

export interface NodeExecutionContext {
  nodeId: string
  nodeType: string
  config: Record<string, any>
  input: Record<string, any>
  runId: number
}

export interface NodeExecutionResult {
  output: Record<string, any>
  status: 'success' | 'error'
  error?: string
}
```

---

## 10. Composables и Stores

### 10.1. Composables (frontend)

| Composable | Фаза | Назначение |
|------------|------|------------|
| `usePipelineRuns(pipelineId)` | P0 | Список запусков с пагинацией и фильтром |
| `usePipelineRunDetail(pipelineId, runId)` | P0 | Детали одного запуска со steps |
| `usePipelineExecution(pipelineId)` | P0 | Запуск конвейера, отслеживание статуса |
| `usePipelineVersions(pipelineId)` | P1 | Список, создание, восстановление версий |
| `usePipelineSchedule(pipelineId)` | P1 | CRUD расписания |
| `usePipelineNodeTest(pipelineId)` | P1 | Тестовый запуск одной ноды |

### 10.2. Store

**Расширение `pipelineEditor.ts`:**

Добавить в store:
- `isRunning: ref<boolean>` — конвейер сейчас исполняется
- `currentRunId: ref<number | null>` — ID текущего запуска
- `nodeStatuses: ref<Map<string, WorkflowStepStatus>>` — статус каждой ноды в текущем запуске (для подсветки на canvas)
- `viewMode: ref<'edit' | 'run'>` — режим: редактирование или просмотр запуска

### 10.3. Polling для live updates

При запуске конвейера (`viewMode === 'run'`):

1. После `POST /run` — получить `runId`
2. Polling `GET /runs/:runId` каждые 2 секунды
3. Обновлять `nodeStatuses` по данным из steps
4. Остановить polling когда `run.status` !== 'running'

Альтернатива (P3): SSE (Server-Sent Events) для real-time обновлений.

---

## 11. Scheduler (P1)

### 11.1. Nitro-плагин для cron

**Файл:** `server/plugins/pipeline-scheduler.ts`

Существующий `server/plugins/scheduler.ts` уже использует setInterval для upload scheduler и metrics. Добавить новый плагин (или расширить существующий) для pipeline cron.

**Логика:**

```typescript
// Проверка каждые 60 секунд
setInterval(async () => {
  const now = new Date()

  // 1. Найти все PipelineSchedule с enabled=true и nextRunAt <= now
  const due = await prisma.pipelineSchedule.findMany({
    where: {
      enabled: true,
      nextRunAt: { lte: now },
      pipeline: { status: 'active' },
    },
    include: { pipeline: true },
  })

  for (const schedule of due) {
    // 2. Проверить: нет ли running запуска
    const running = await prisma.workflowRun.findFirst({
      where: { pipelineId: schedule.pipelineId, status: 'running' },
    })
    if (running) continue

    // 3. Запустить конвейер
    executePipeline(schedule.pipelineId, 0, 'schedule') // triggeredBy: 0 = system

    // 4. Пересчитать nextRunAt
    const nextRunAt = getNextCronDate(schedule.cron, schedule.timezone)
    await prisma.pipelineSchedule.update({
      where: { id: schedule.id },
      data: { lastRunAt: now, nextRunAt },
    })
  }
}, 60_000)
```

### 11.2. Cron Parser

Для парсинга cron-выражений использовать библиотеку `cron-parser` (уже в npm, лёгкая, без зависимостей).

**Валидация cron на сервере:**
- Минимальный интервал: раз в 5 минут (защита от злоупотреблений)
- Максимум 1 schedule на pipeline (unique constraint в Prisma)
- Валидация timezone через `Intl.supportedValuesOf('timeZone')`

---

## 12. Версионирование (P1)

### 12.1. Логика

- При нажатии "Сохранить версию" — копируется текущий `graphData` в `PipelineVersion`
- Номер версии автоинкрементится внутри pipeline (1, 2, 3, ...)
- При "Восстановить" — `graphData` pipeline заменяется на `graphData` версии
- Старые версии не удаляются (аудитный след)
- Лимит: максимум 50 версий на pipeline. При превышении — удаляется самая старая.

### 12.2. Auto-versioning (опционально)

Автоматическое создание версии перед каждым запуском конвейера:
- Позволяет откатиться к состоянию "как было при последнем успешном запуске"
- Auto-версии помечаются `name: "auto-v{N} (перед запуском)"`

---

## 13. Структура файлов

### 13.1. Новые серверные файлы

```
server/
  utils/
    pipeline-engine/
      engine.ts                    — P0: главный execution loop
      topological-sort.ts          — P0: алгоритм сортировки графа
      types.ts                     — P0: интерфейсы engine
      build-input.ts               — P0: построение input для ноды из outputs предшественников
      executors/
        index.ts                   — P0: registry executors
        trendwatcher.ts            — P0: executor поиска трендов
        scenario.ts                — P0: executor генерации сценариев
        video.ts                   — P0: executor видеопайплайна
        upload.ts                  — P0: executor загрузки
        analytics.ts               — P0: executor аналитики
        filter.ts                  — P0: executor ветвления
        notification.ts            — P0: executor Telegram-уведомления
        trigger-manual.ts          — P0: executor ручного триггера
      expression.ts                — P2: evaluator выражений
    cron-parser.ts                 — P1: парсинг cron-выражений

  api/
    pipelines/
      [id]/
        run.post.ts                — P0: запуск конвейера
        runs.get.ts                — P0: список запусков
        runs/
          [runId].get.ts           — P0: деталь запуска
        nodes/
          [nodeId]/
            test.post.ts           — P1: тест одной ноды
        versions.get.ts            — P1: список версий
        versions.post.ts           — P1: создать версию
        versions/
          [versionId]/
            restore.post.ts        — P1: восстановить версию
        schedule.get.ts            — P1: получить расписание
        schedule.put.ts            — P1: создать/обновить расписание
        schedule.delete.ts         — P1: удалить расписание

  plugins/
    pipeline-scheduler.ts          — P1: cron scheduler plugin
```

### 13.2. Новые frontend-файлы

```
app/
  pages/
    pipeline/
      [id]/
        runs.vue                   — P0: история запусков
        runs/
          [runId].vue              — P0: деталь запуска

  components/
    pipeline/
      PipelineTriggerNode.vue      — P0: компонент trigger-ноды
      PipelineRunStatusBadge.vue   — P0: badge статуса запуска
      PipelineRunCard.vue          — P0: карточка запуска
      PipelineRunTimeline.vue      — P0: timeline шагов
      PipelineStepLogViewer.vue    — P0: JSON viewer для input/output
      PipelineNodeTestPanel.vue    — P1: тестирование ноды
      PipelineVersionPanel.vue     — P1: версии
      PipelineSchedulePanel.vue    — P1: расписание (cron builder)
      PipelineRetryConfig.vue      — P1: настройка retry
      PipelineExpressionInput.vue  — P2: expression input

  composables/
    usePipelineRuns.ts             — P0
    usePipelineRunDetail.ts        — P0
    usePipelineExecution.ts        — P0
    usePipelineVersions.ts         — P1
    usePipelineSchedule.ts         — P1
    usePipelineNodeTest.ts         — P1

  shared/types/
    pipeline.ts                    — расширение (P0+P1+P2)
```

---

## 14. Зависимости между задачами

```
P0 — Минимальный исполняемый конвейер:

  [Prisma: WorkflowRun + WorkflowStep]
       |
       v
  [topological-sort.ts]
       |
       v
  [executors/*.ts — все 7+1 executor]
       |
       v
  [engine.ts — execution loop]
       |
       v
  [POST /api/pipelines/:id/run]
       |
       +--> [GET runs, GET runs/:runId]
       |
       v
  [PipelineTriggerNode.vue + sidebar update]
       |
       v
  [PipelineToolbar.vue — кнопка "Запустить"]
       |
       v
  [runs.vue — страница истории]
       |
       v
  [runs/[runId].vue — деталь запуска + per-node logs]

P1 — Error handling + Versioning + Schedule:
  (все задачи P1 независимы друг от друга, могут делаться параллельно)

  [Prisma: PipelineVersion + PipelineSchedule]
       |
       +--> [versions API + UI]
       +--> [schedule API + scheduler plugin + UI]
       +--> [error output handle + retry config]
       +--> [node test API + UI]
```

---

## 15. Детальные задачи

### Фаза P0 (12 задач)

**P0-01. Prisma: модели WorkflowRun и WorkflowStep**
- Добавить enum WorkflowRunStatus, WorkflowStepStatus, TriggerType в schema.prisma
- Добавить модели WorkflowRun и WorkflowStep (см. раздел 4.1)
- Добавить relation runs к модели Pipeline
- Создать миграцию: `prisma migrate dev --name add_workflow_run_and_step`
- Проверить: миграция применяется без ошибок

**P0-02. TypeScript-типы**
- Расширить `shared/types/pipeline.ts` типами WorkflowRun, WorkflowStep, WorkflowRunListMeta, NodeExecutionContext, NodeExecutionResult (см. раздел 9.1)

**P0-03. Топологическая сортировка**
- Создать `server/utils/pipeline-engine/topological-sort.ts`
- Реализовать алгоритм Кана (BFS) (см. раздел 3.2)
- Обработка ошибок: пустой граф, циклы в графе, disconnected ноды
- Экспорт: `topologicalSort(nodes, edges): SortedNode[]`

**P0-04. Интерфейсы и типы engine**
- Создать `server/utils/pipeline-engine/types.ts`
- Определить NodeExecutionContext, NodeExecutionResult, NodeExecutor
- Создать `server/utils/pipeline-engine/build-input.ts`
- Реализовать buildNodeInput: по edges и outputs map определить input для ноды

**P0-05. Registry executors**
- Создать `server/utils/pipeline-engine/executors/index.ts`
- Map типа ноды → executor function
- Fallback для неизвестных типов: ошибка "Неизвестный тип ноды: {type}"

**P0-06. Executors для 7 существующих типов нод + trigger_manual**
- Создать 8 файлов executor (по одному на тип ноды)
- Каждый executor:
  - Принимает NodeExecutionContext
  - Возвращает NodeExecutionResult
  - Обрабатывает ошибки (try/catch → status: 'error')
  - Логирует через agent-logger (модуль: 'pipeline')
- `trigger_manual.ts` — возвращает `{ triggeredAt, triggeredBy }` (простейший)
- `trendwatcher.ts` — ищет тренды по config (appId, platforms, keywords). При config.strategy === 'auto' и ENABLE_PAID_APIS — запуск Apify
- `scenario.ts` — вызывает callAnthropicAgent для генерации сценариев. Принимает trends из input
- `video.ts` — вызывает runVideoPipeline. Принимает scenarios из input
- `upload.ts` — вызывает runUploadPipeline. Принимает videos из input
- `analytics.ts` — вызывает collectMetrics + analyzePost. Принимает uploads из input
- `filter.ts` — оценивает условие из config, устанавливает _filterResult (см. раздел 3.4)
- `notification.ts` — вызывает sendTelegramAlert. Формирует сообщение из input + config.message

**P0-07. Execution Engine (главный loop)**
- Создать `server/utils/pipeline-engine/engine.ts`
- Реализовать `executePipeline(pipelineId, triggeredBy, triggerType)` (см. раздел 3.5)
- Валидация: pipeline существует, nodes.length > 0, нет циклов
- Создание WorkflowRun со статусом 'running'
- Последовательный обход отсортированных нод
- Для каждой ноды: создать WorkflowStep → вызвать executor → обновить step → сохранить output
- При ошибке: пометить step как failed, run как failed, записать errorMessage
- При успехе: пометить run как completed

**P0-08. API: POST /run, GET /runs, GET /runs/:runId**
- `server/api/pipelines/[id]/run.post.ts`:
  - Guard: requireScopedAccess canRunAgent, moduleSlug: pipeline
  - Валидация: pipeline exists, status === 'active', нет running run
  - Fire-and-forget executePipeline
  - Ответ: `{ data: { runId, status: 'running' } }`
- `server/api/pipelines/[id]/runs.get.ts`:
  - Guard: requireScopedAccess canRead
  - Query: page, perPage, status
  - Пагинация, сортировка по createdAt desc
- `server/api/pipelines/[id]/runs/[runId].get.ts`:
  - Guard: requireScopedAccess canRead
  - Include: steps (orderBy: createdAt asc)

**P0-09. Компоненты: PipelineTriggerNode, PipelineRunStatusBadge**
- `PipelineTriggerNode.vue` — круглая нода для trigger_manual:
  - Только source Handle (нет target)
  - Иконка: mingcute:flash-line
  - Цвет: bg-primary/20 border-primary
  - Border-radius: 50%
- `PipelineRunStatusBadge.vue` — badge по статусу:
  - pending: badge-ghost
  - running: badge-info + spinner
  - completed: badge-success
  - failed: badge-error
  - cancelled: badge-warning
- Обновить `PipelineSidebar.vue` — добавить секцию "Триггеры" с trigger_manual
- Обновить `PipelineCanvas.vue` — добавить template для node-trigger_manual с PipelineTriggerNode

**P0-10. Обновление PipelineToolbar**
- Добавить кнопку "Запустить" (btn-success):
  - Вызывает composable usePipelineExecution
  - Disabled если status !== 'active' или isRunning
  - Loading state
- Добавить кнопку "История" (btn-ghost) — navigateTo(`/pipeline/${id}/runs`)
- Создать composable `usePipelineExecution.ts`:
  - `runPipeline(id)` — POST /api/pipelines/:id/run
  - `isRunning` — reactive ref
  - Toast при успехе/ошибке

**P0-11. Страница: история запусков**
- `app/pages/pipeline/[id]/runs.vue`
- Composable `usePipelineRuns.ts` — GET /api/pipelines/:id/runs с пагинацией
- Компонент `PipelineRunCard.vue` — карточка запуска в списке
- Фильтр по статусу (select)
- Пагинация
- Empty state
- Кнопка "Назад к редактору" → `/pipeline/:id`

**P0-12. Страница: деталь запуска**
- `app/pages/pipeline/[id]/runs/[runId].vue`
- Composable `usePipelineRunDetail.ts` — GET /api/pipelines/:id/runs/:runId
- Верхняя панель: статус, время, триггер, кнопка "Повторить"
- Компонент `PipelineRunTimeline.vue` — вертикальный timeline шагов:
  - Иконка типа ноды
  - Название ноды
  - Статус (badge)
  - Длительность
  - Клик → раскрывает input/output/error
- Компонент `PipelineStepLogViewer.vue`:
  - Tabs: Input / Output / Error
  - JSON viewer с collapse/expand (рекурсивный компонент или `<pre>` с JSON.stringify(data, null, 2))
  - Кнопка "Скопировать"
- Polling: если run.status === 'running', обновлять каждые 2 секунды

### Фаза P1 (10 задач)

**P1-01. Prisma: PipelineVersion и PipelineSchedule**
- Добавить модели PipelineVersion и PipelineSchedule (см. раздел 4.1)
- Добавить relations к Pipeline
- Миграция: `prisma migrate dev --name add_pipeline_version_and_schedule`

**P1-02. API: версии (3 эндпоинта)**
- `versions.get.ts` — список версий (без graphData), orderBy version desc
- `versions.post.ts` — создать: копия graphData, автоинкремент version, лимит 50
- `versions/[versionId]/restore.post.ts` — записать graphData версии в pipeline

**P1-03. UI: PipelineVersionPanel + composable**
- `usePipelineVersions.ts` — CRUD версий
- `PipelineVersionPanel.vue` — список + создание + восстановление
- Кнопка в тулбаре: "Версии" (открывает panel/drawer)

**P1-04. API: расписание (3 эндпоинта)**
- `schedule.get.ts` — текущее расписание или null
- `schedule.put.ts` — upsert, валидация cron и timezone, расчёт nextRunAt
- `schedule.delete.ts` — удаление

**P1-05. Cron builder UI + composable**
- `usePipelineSchedule.ts` — CRUD расписания
- `PipelineSchedulePanel.vue` — No-Code cron builder (см. раздел 8.6)
- Кнопка в тулбаре: иконка часов, с badge если schedule enabled

**P1-06. Pipeline Scheduler plugin**
- `server/plugins/pipeline-scheduler.ts` — setInterval 60 секунд
- Проверяет PipelineSchedule с nextRunAt <= now
- Запускает executePipeline с triggerType: 'schedule'
- Пересчитывает nextRunAt
- Очистка таймера на close

**P1-07. Error output handle на нодах**
- Обновить `PipelineNode.vue`:
  - Второй source Handle (Position.Right, offset вниз), красный
  - Показывать если нода не trigger-типа
- Обновить `PipelineCanvas.vue`:
  - onConnect: определять sourceHandle ('main' или 'error') по позиции
  - Стилизация error edges: красные, штрихованные
- Обновить engine.ts:
  - При status: 'error' — проверить error edges
  - Если есть → продолжить по error path
  - Если нет → остановить конвейер

**P1-08. Retry config**
- `PipelineRetryConfig.vue` — форма retry (toggle, maxRetries, delayMs, backoff)
- Добавить секцию в PipelineNodeSettings
- Обновить engine.ts:
  - Перед error handling проверить _retry config
  - Реализовать retry loop с delay и backoff

**P1-09. API: тест ноды**
- `server/api/pipelines/[id]/nodes/[nodeId]/test.post.ts`
- Находит ноду в graphData
- Вызывает executor с переданным или пустым input
- Не создаёт WorkflowRun
- Возвращает output, status, duration, error

**P1-10. UI: тест ноды**
- `usePipelineNodeTest.ts` — composable для POST test
- `PipelineNodeTestPanel.vue` — textarea для input JSON + кнопка + результат
- В PipelineNodeSettings: новая tab "Тест" (рядом с "Настройки")

### Фаза P2 (5 задач — краткое описание)

**P2-01. Data Pinning**
- Сохранение output ноды в node.data.pinnedOutput
- При запуске: если есть pinned data — использовать вместо реального execution
- UI: кнопка "Pin output" в step log viewer

**P2-02. Expression Editor**
- `PipelineExpressionInput.vue` — input с подсветкой `{{ }}`
- `server/utils/pipeline-engine/expression.ts` — mustache-like evaluator
- Интеграция в config-формы (поля title, description в UploadConfig)

**P2-03. Webhook Trigger**
- Модель: добавить поле webhookId (uuid) в Pipeline
- Executor trigger_webhook: парсинг body/headers/query
- Публичный endpoint `POST /api/pipelines/webhook/:webhookId`
- UI: в config trigger_webhook — отображение URL и кнопка копирования

**P2-04. Undo/Redo**
- History stack в pipelineEditor store
- Ctrl+Z / Ctrl+Shift+Z
- Кнопки в тулбаре

**P2-05. Snap to Grid**
- snapToGrid prop в VueFlow
- Toggle в тулбаре

---

## 16. Безопасность

### 16.1. Авторизация

- Все новые эндпоинты защищены через `requireScopedAccess`
- Permissions:
  - Просмотр запусков/версий: `canRead`
  - Запуск конвейера: `canRunAgent`
  - Создание версий, изменение расписания: `canWrite`
  - Удаление: `canDelete`
- moduleSlug: `pipeline` (уже зарегистрирован в ALL_MODULES)
- Проверка ownership: только owner, shared users или admin могут взаимодействовать с конвейером

### 16.2. Валидация

- Cron-выражения: валидация формата, минимальный интервал 5 минут
- Timezone: проверка через Intl.supportedValuesOf
- graphData: проверка структуры nodes/edges перед запуском
- NodeId: проверка что nodeId существует в graphData перед тестом
- Input JSON в тесте ноды: парсинг с try/catch, лимит размера (100KB)

### 16.3. Rate Limiting

- POST /run: максимум 1 running запуск на pipeline (реализовано через проверку в БД)
- Webhook endpoint (P2): rate limit 10 req/min через in-memory counter

### 16.4. Защита данных

- Input/Output в WorkflowStep могут содержать токены/ключи от executors
- При возврате в API: sanitize чувствительных полей (accessToken, refreshToken)
- Не логировать полные input/output в agent-logger (только summary)

---

## 17. UX для No-Code оператора

### 17.1. Пустые состояния

| Где | Текст | Действие |
|-----|-------|----------|
| История запусков (пусто) | "Конвейер ещё ни разу не запускался" | Кнопка "Перейти в редактор" |
| Версии (пусто) | "Нет сохранённых версий. Создайте первую перед важными изменениями" | Кнопка "Сохранить версию" |
| Step logs — нет input | "Стартовая нода не получает входных данных" | — |
| Step logs — нет output (failed) | "Нода завершилась с ошибкой до формирования результата" | — |

### 17.2. Loading, Success, Error

- Кнопка "Запустить": loading spinner → toast "Конвейер запущен" / alert "Ошибка запуска: ..."
- Кнопка "Сохранить версию": loading → toast "Версия {N} сохранена"
- Кнопка "Восстановить версию": confirm dialog → loading → toast "Версия восстановлена"
- Тест ноды: loading → результат в панели / alert "Ошибка: ..."
- Расписание: loading → toast "Расписание обновлено"

### 17.3. Tooltips и подсказки

- Кнопка "Запустить" disabled: tooltip "Активируйте конвейер перед запуском" (если status !== 'active')
- Trigger-нода в сайдбаре: tooltip "Стартовый блок. Добавьте его первым — с него начнётся выполнение."
- Error Handle: tooltip "Подключите сюда блок, который выполнится при ошибке"
- Cron builder: tooltip с примерами расписаний

### 17.4. PageGuide

Обновить `app/utils/guides.ts` — расширить руководство для pipeline:
- Шаг "Запустите конвейер": "Нажмите зелёную кнопку 'Запустить' в тулбаре"
- Шаг "Просмотрите результат": "Откройте 'Историю' и кликните на запуск"
- Шаг "Настройте расписание": "Нажмите иконку часов для автоматического запуска"

---

## 18. Риски и решения

| Риск | Вероятность | Решение |
|------|-------------|---------|
| Fire-and-forget теряется при рестарте сервера | Высокая | P0: помечать running runs как failed при старте (recovery-check в plugin). P3: Redis queue |
| Executor видеогенерации зависает (fal.ai таймаут) | Средняя | Таймаут на executor (10 мин по умолчанию), retry config |
| Большой output ноды (100+ трендов) перегружает WorkflowStep.output | Средняя | Лимит на размер output (1MB), truncate при превышении, ссылка на полные данные |
| Параллельный запуск одного конвейера | Средняя | Проверка running run перед запуском (unique constraint не подходит — используем SELECT + check) |
| Cron scheduler пропускает интервал при перегрузке | Низкая | nextRunAt пересчитывается после выполнения, не "с момента проверки" |
| Цикл в графе (пользователь соединил ноды в кольцо) | Низкая | topologicalSort выбрасывает ошибку при обнаружении цикла, UI показывает alert |
| Expression injection (P2: пользовательский шаблон) | Средняя | Mustache-like parser без eval/Function, whitelist доступных переменных |

---

## 19. Метрики успеха

| Метрика | Цель |
|---------|------|
| Конвейер запускается и проходит все ноды | P0 must-have |
| Каждый шаг логируется с input/output/error | P0 must-have |
| История запусков отображается корректно | P0 must-have |
| Оператор понимает почему конвейер упал (по логам) | P0 must-have |
| Расписание запускает конвейер автоматически | P1 |
| Ошибки уходят в error path, а не останавливают конвейер | P1 |
| Версии позволяют откатиться | P1 |
| Тест ноды помогает отладить конфиг | P1 |

---

## 20. Глоссарий

| Термин | Определение |
|--------|-------------|
| **Pipeline (конвейер)** | Визуальный граф из нод и рёбер, описывающий автоматизацию |
| **Node (нода)** | Блок в конвейере, выполняющий одно действие |
| **Edge (ребро)** | Связь между двумя нодами, определяющая порядок и маршрут данных |
| **Executor** | Серверная функция, знающая как исполнить конкретный тип ноды |
| **WorkflowRun (запуск)** | Одно исполнение конвейера от начала до конца |
| **WorkflowStep (шаг)** | Исполнение одной ноды в рамках запуска |
| **Trigger** | Стартовая нода, определяющая способ запуска (вручную, по расписанию, через webhook) |
| **Error Output** | Второй выход ноды, активируемый при ошибке |
| **Data Pinning** | Фиксация output ноды для отладки |
| **Expression** | Шаблон `{{ }}` для ссылки на данные из других нод |
| **PipelineVersion** | Снапшот graphData конвейера для отката |
