/**
 * Демо-запуски конвейера для проверки монитора глазами.
 *
 * Заводит конвейер с графом из девяти блоков (макет 05) и запуски во всех
 * состояниях, которые видит оператор: идущий с упавшим некритичным шагом,
 * успешный, упавший на гейте, остановленный человеком, завершившийся без
 * данных и ждущий очереди. У шагов есть логи, входы, выходы, попытки и
 * категории ошибок — иначе раскрытый шаг проверять нечем.
 *
 * Использовать ТОЛЬКО на тестовой БД.
 *
 * Запуск:
 *   bun run scripts/seed-pipeline-runs-demo.ts
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../app/generated/prisma/client'
import { COST_ACTUAL_KEY, COST_ESTIMATE_KEY, readStepCost, sumAmounts } from '../server/utils/pipeline-cost'

const connectionString = process.env.DATABASE_URL
  ?? 'postgresql://contentfactory_tests:contentfactory_tests_password@localhost:5436/contentfactory_tests_db'

if (!connectionString.includes('tests')) {
  throw new Error('[cf-seed-runs] DATABASE_URL не указывает на тестовую базу. Прерываю.')
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

const MIN = 60 * 1000
const HOUR = 60 * MIN
const now = Date.now()

function at(offsetMs: number) {
  return new Date(now - offsetMs)
}

const user = await prisma.zavodUser.findFirst({ orderBy: { id: 'asc' } })
if (!user) throw new Error('[cf-seed-runs] в базе нет пользователей')

// ── Граф конвейера ─────────────────────────────────────────────────────────
function node(id: string, type: string, label: string, x: number, y: number) {
  // Тип ноды пишем настоящий: редактор регистрирует шаблоны по нему, и
  // «custom» падал на стандартную ноду Vue Flow — белый прямоугольник.
  return { id, type, position: { x: x * 280, y: y * 160 }, data: { label, type, config: {} } }
}
function edge(source: string, target: string, sourceHandle?: string) {
  return {
    id: `e-${source}-${target}${sourceHandle ? `-${sourceHandle}` : ''}`,
    source,
    target,
    sourceHandle: sourceHandle ?? null,
    animated: true,
    type: 'smoothstep',
  }
}

const graphData = {
  nodes: [
    node('tw-1', 'trendwatcher', 'Трендвотчер', 0, 0),
    node('qg-1', 'quality_gate', 'Гейт качества', 1, 0),
    node('sc-1', 'scenario', 'Сценарий · 2 варианта на тренд', 2, 0),
    node('if-1', 'if_switch', 'Условие · критик ≥ 7,0', 3, 0),
    node('vid-1', 'video', 'Видео · Мастер Игорь, 6 вариантов', 4, -1),
    node('notif-1', 'notification', 'Уведомление · Telegram цех', 4, 1),
    node('cap-1', 'caption_generator', 'Генератор подписей', 5, -1),
    node('up-1', 'upload', 'Публикация · @zavod.mebel.ru', 6, -1),
    node('an-1', 'analytics', 'Аналитика', 7, -1),
  ],
  edges: [
    edge('tw-1', 'qg-1'),
    edge('qg-1', 'sc-1'),
    edge('sc-1', 'if-1'),
    edge('if-1', 'vid-1', 'yes'),
    edge('if-1', 'notif-1', 'no'),
    edge('vid-1', 'cap-1'),
    edge('cap-1', 'up-1'),
    edge('up-1', 'an-1'),
  ],
}

const PIPELINE_NAME = 'Тренд → сценарий → видео → Reels'

const existing = await prisma.pipeline.findFirst({ where: { name: PIPELINE_NAME } })

const pipeline = existing
  ? await prisma.pipeline.update({
      where: { id: existing.id },
      data: { graphData, status: 'active', color: 'primary', icon: 'mingcute:rocket-line' },
    })
  : await prisma.pipeline.create({
      data: {
        userId: user.id,
        name: PIPELINE_NAME,
        description: 'Полный путь: поиск трендов, отбор, сценарий, ролики, публикация и сбор метрик.',
        icon: 'mingcute:rocket-line',
        color: 'primary',
        status: 'active',
        graphData,
      },
    })

// Чистим прошлые демо-запуски этого конвейера, чтобы повторный прогон сида
// не плодил историю.
await prisma.workflowRun.deleteMany({ where: { pipelineId: pipeline.id } })

// ── Описание шагов ─────────────────────────────────────────────────────────
interface StepSpec {
  nodeId: string
  status: 'pending' | 'running' | 'success' | 'partial' | 'no_data' | 'failed' | 'skipped' | 'cancelled'
  /** Смещение старта от старта запуска, мс. */
  startOffset?: number
  durationMs?: number
  attempts?: number
  maxRetries?: number
  error?: string
  errorCategory?: string
  input?: unknown
  output?: unknown
  logs?: Array<{ level: 'info' | 'warn' | 'error' | 'debug'; message: string; offset: number; data?: unknown }>
}

const NODE_NAMES: Record<string, { name: string; type: string }> = Object.fromEntries(
  graphData.nodes.map(n => [n.id, { name: n.data.label, type: n.data.type }]),
)

const SCRIPTS_OUTPUT = {
  scenarios: Array.from({ length: 14 }, (_, i) => ({
    script_id: `scr_${4471 + i}`,
    trend_id: `trd_${44120 + i}`,
    variant: i % 2 === 0 ? 'A' : 'B',
    critic_score: Number((6.4 + (i % 5) * 0.3).toFixed(1)),
    hook: 'боль с доставкой, вопрос в лоб',
    body: 'Сначала кажется, что шкаф в нишу можно собрать по картинке из интернета. Потом выясняется, что стена косая на два сантиметра, потолок гуляет, а дверь открывается не в ту сторону. Мы такие ниши закрываем за неделю: замер, чертёж, сборка на месте — и ни одного зазора. Показываем, как это выглядит изнутри.',
    scenes: Array.from({ length: 6 }, (_, s) => ({ index: s, duration: 8 + s })),
  })),
  scenariosCreated: 14,
  variantsCreated: 28,
  meta: { step: 'script-generator', model: 'claude-sonnet-4' },
}

const DONE_VIDEOS = [
  { id: 101, status: 'completed', duration: 74, totalCostEstimate: 1.8, totalCostActual: 2.05, imageModelId: 'flux-1.1-pro', videoModelId: 'kling-v2' },
  { id: 102, status: 'completed', duration: 68, totalCostEstimate: 1.8, totalCostActual: 1.74, imageModelId: 'flux-1.1-pro', videoModelId: 'kling-v2' },
  { id: 103, status: 'failed', errorMessage: 'lip-sync: не удалось выровнять артикуляцию, попытки исчерпаны', totalCostEstimate: 1.8 },
  { id: 104, status: 'timeout', errorMessage: 'провайдер не ответил за 600 с', totalCostEstimate: 1.8 },
]

const VIDEO_OUTPUT_DONE = {
  generatedCount: 12,
  failedCount: 2,
  timeoutCount: 1,
  _domainStatus: 'partial',
  _domainDegraded: true,
  // Те же ключи, что кладёт executeVideoNode — иначе шаг в сиде будет без суммы,
  // а на живом запуске с суммой.
  [COST_ACTUAL_KEY]: sumAmounts(DONE_VIDEOS, 'totalCostActual'),
  [COST_ESTIMATE_KEY]: sumAmounts(DONE_VIDEOS, 'totalCostEstimate'),
  videos: DONE_VIDEOS,
}

function buildSteps(runStart: Date, specs: StepSpec[]) {
  return specs.map((spec) => {
    const meta = NODE_NAMES[spec.nodeId]!
    const startedAt = spec.startOffset == null
      ? null
      : new Date(runStart.getTime() + spec.startOffset)
    const finishedAt = startedAt && spec.durationMs != null && spec.status !== 'running'
      ? new Date(startedAt.getTime() + spec.durationMs)
      : null
    const cost = readStepCost(meta.type, spec.output)
    return {
      nodeId: spec.nodeId,
      nodeName: meta.name,
      nodeType: meta.type,
      status: spec.status,
      costActual: cost.actual,
      costEstimate: cost.estimate,
      input: (spec.input ?? null) as never,
      output: (spec.output ?? null) as never,
      error: spec.error ?? null,
      errorCategory: spec.errorCategory ?? null,
      attemptCount: spec.attempts ?? (spec.status === 'pending' ? 0 : 1),
      retryPolicy: spec.maxRetries != null ? ({ maxRetries: spec.maxRetries, delayMs: 30_000 } as never) : null,
      logs: (spec.logs ?? []).map(l => ({
        ts: new Date(runStart.getTime() + l.offset).toISOString(),
        level: l.level,
        message: l.message,
        ...(l.data ? { data: l.data } : {}),
      })) as never,
      startedAt,
      finishedAt,
      duration: spec.durationMs ?? null,
      createdAt: startedAt ?? runStart,
    }
  })
}

interface RunSpec {
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled' | 'no_data'
  trigger: 'manual' | 'schedule' | 'webhook'
  startOffset: number
  finishOffset?: number
  errorMessage?: string
  errorCategory?: string
  cancelOffset?: number
  steps: StepSpec[]
}

const HEAD_STEPS: StepSpec[] = [
  {
    nodeId: 'tw-1',
    status: 'success',
    startOffset: 0,
    durationMs: 12_000,
    output: { trends: Array.from({ length: 50 }, (_, i) => ({ id: 44120 + i, platform: 'tiktok', virality: 60 + (i % 40) })), importedCount: 50 },
    logs: [
      { level: 'info', message: 'запуск начат, платформа tiktok, язык ru', offset: 500 },
      { level: 'info', message: 'собрано 50 трендов', offset: 11_500 },
    ],
  },
  {
    nodeId: 'qg-1',
    status: 'success',
    startOffset: 12_000,
    durationMs: 400,
    output: { passed: 18, total: 50, threshold: 70 },
    logs: [{ level: 'info', message: 'прошло 18 из 50, порог virality ≥ 70', offset: 12_300 }],
  },
  {
    nodeId: 'sc-1',
    status: 'success',
    startOffset: 13_000,
    durationMs: 4 * MIN + 26_000,
    input: { trends: 18 },
    output: SCRIPTS_OUTPUT,
    logs: [
      { level: 'info', message: 'создано 14 сценариев, средняя оценка критика 6,9', offset: 4 * MIN + 39_000 },
    ],
  },
  {
    nodeId: 'if-1',
    status: 'success',
    startOffset: 4 * MIN + 40_000,
    durationMs: 200,
    output: { yes: 14, no: 4, threshold: 7 },
    logs: [
      { level: 'warn', message: '4 из 18 сценариев ниже порога 7,0 — уходят в ветку «нет»', offset: 4 * MIN + 40_200 },
    ],
  },
]

const RUNS: RunSpec[] = [
  // Идёт прямо сейчас: некритичный шаг упал, основной считается.
  {
    status: 'running',
    trigger: 'manual',
    startOffset: 18 * MIN,
    steps: [
      ...HEAD_STEPS,
      {
        nodeId: 'notif-1',
        status: 'failed',
        startOffset: 5 * MIN,
        durationMs: 72_000,
        attempts: 3,
        maxRetries: 2,
        error: 'Telegram не принял сообщение: бот удалён из чата «Цех · производство»',
        errorCategory: 'external_api',
        input: { chatId: '-1001923…', template: 'run-finished' },
        output: { sent: false, renderStatus: 'blocked_template_error', error: '403 bot_kicked', resolvedVariables: ['run_id'], resolvedSnapshot: { run_id: '1', chat: 'Цех · производство' } },
        logs: [
          { level: 'error', message: 'telegram: 403 bot_kicked, чат «Цех · производство»', offset: 6 * MIN, data: { attempt: 3, max_attempts: 3, chat_id: '-1001923…', response: { ok: false, error_code: 403, description: 'Forbidden: bot was kicked from the supergroup chat' } } },
        ],
      },
      {
        nodeId: 'vid-1',
        status: 'running',
        startOffset: 6 * MIN + 20_000,
        attempts: 1,
        maxRetries: 2,
        input: { scenarios: 14, variants: 6, model: 'kling-v2' },
        logs: [
          { level: 'info', message: 'начата генерация 14 роликов, 6 вариантов', offset: 6 * MIN + 21_000 },
          { level: 'warn', message: 'vid_10851: повтор 1 из 3, таймаут провайдера 60 с', offset: 12 * MIN },
          { level: 'info', message: 'готово 6 из 14', offset: 17 * MIN },
        ],
      },
      { nodeId: 'cap-1', status: 'pending' },
      { nodeId: 'up-1', status: 'pending' },
      { nodeId: 'an-1', status: 'pending' },
    ],
  },
  // Успешный вчерашний.
  {
    status: 'success',
    trigger: 'schedule',
    startOffset: 26 * HOUR,
    finishOffset: 26 * HOUR - (31 * MIN + 12_000),
    steps: [
      ...HEAD_STEPS,
      {
        nodeId: 'notif-1',
        status: 'success',
        startOffset: 5 * MIN,
        durationMs: 900,
        output: { sent: true, renderStatus: 'rendered_ok', resolvedVariables: ['run_id', 'videos_count'], resolvedSnapshot: { run_id: '88198', videos_count: '12' } },
        logs: [{ level: 'info', message: 'уведомление отправлено в «Цех · производство»', offset: 5 * MIN + 900 }],
      },
      {
        nodeId: 'vid-1',
        status: 'partial',
        startOffset: 5 * MIN + 2000,
        durationMs: 19 * MIN,
        attempts: 2,
        maxRetries: 2,
        input: { scenarios: 14, variants: 6 },
        output: VIDEO_OUTPUT_DONE,
        logs: [
          { level: 'info', message: 'начата генерация 14 роликов', offset: 5 * MIN + 3000 },
          { level: 'error', message: 'vid_103: lip-sync не сошёлся, попытки исчерпаны', offset: 18 * MIN },
          { level: 'warn', message: 'vid_104: таймаут провайдера, задача осталась висеть', offset: 20 * MIN },
          { level: 'info', message: 'готово 12 из 14', offset: 24 * MIN },
        ],
      },
      {
        nodeId: 'cap-1',
        status: 'success',
        startOffset: 24 * MIN + 5000,
        durationMs: 46_000,
        output: { captions: 12, hashtags: 84 },
      },
      {
        nodeId: 'up-1',
        status: 'success',
        startOffset: 25 * MIN,
        durationMs: 5 * MIN,
        output: { uploadsInitiated: 12, account: '@zavod.mebel.ru' },
        logs: [{ level: 'info', message: '12 роликов поставлены в очередь публикации', offset: 30 * MIN }],
      },
      { nodeId: 'an-1', status: 'success', startOffset: 30 * MIN + 10_000, durationMs: 62_000, output: { tracked: 12 } },
    ],
  },
  // Упал на гейте качества.
  {
    status: 'failed',
    trigger: 'webhook',
    startOffset: 3 * HOUR,
    finishOffset: 3 * HOUR - 51 * MIN,
    errorMessage: 'Гейт качества: провайдер метрик не отдал просмотры, 3 попытки из 3',
    errorCategory: 'external_api',
    steps: [
      HEAD_STEPS[0]!,
      {
        nodeId: 'qg-1',
        status: 'failed',
        startOffset: 12_000,
        durationMs: 50 * MIN,
        attempts: 3,
        maxRetries: 2,
        error: 'Провайдер метрик не отдал просмотры: 504 gateway timeout',
        errorCategory: 'external_api',
        input: { trends: 50 },
        logs: [
          { level: 'warn', message: 'попытка 1 из 3: 504 gateway timeout', offset: 60_000 },
          { level: 'warn', message: 'попытка 2 из 3: 504 gateway timeout', offset: 10 * MIN },
          { level: 'error', message: 'попытка 3 из 3: 504 gateway timeout, шаг остановлен', offset: 50 * MIN },
        ],
      },
    ],
  },
  // Остановлен человеком.
  {
    status: 'cancelled',
    trigger: 'manual',
    startOffset: 5 * HOUR,
    finishOffset: 5 * HOUR - (4 * MIN + 2000),
    cancelOffset: 5 * HOUR - (4 * MIN),
    steps: [
      HEAD_STEPS[0]!,
      {
        nodeId: 'qg-1',
        status: 'cancelled',
        startOffset: 12_000,
        durationMs: 3 * MIN + 50_000,
        logs: [{ level: 'info', message: 'остановлено оператором', offset: 4 * MIN }],
      },
    ],
  },
  // Завершился без данных.
  {
    status: 'no_data',
    trigger: 'schedule',
    startOffset: 7 * HOUR,
    finishOffset: 7 * HOUR - 42_000,
    steps: [
      {
        nodeId: 'tw-1',
        status: 'no_data',
        startOffset: 0,
        durationMs: 41_000,
        output: { _noData: true, _noDataReason: 'По запросу «кухни на заказ» за сутки не нашлось ни одного ролика выше порога', trends: [], skipped: true },
        logs: [{ level: 'warn', message: 'источник вернул 0 трендов', offset: 40_000 }],
      },
      { nodeId: 'qg-1', status: 'skipped', startOffset: 41_000, durationMs: 0, output: { skipped: true, reason: 'нет входных данных' } },
      { nodeId: 'sc-1', status: 'skipped', startOffset: 41_000, durationMs: 0, output: { skipped: true, reason: 'нет входных данных' } },
    ],
  },
  // Ждёт очереди.
  {
    status: 'pending',
    trigger: 'schedule',
    startOffset: 40_000,
    steps: [],
  },
  // Ещё один упавший сегодня — чтобы «только упавшие» показывало не одну строку.
  {
    status: 'failed',
    trigger: 'schedule',
    startOffset: 9 * HOUR,
    finishOffset: 9 * HOUR - 12 * MIN,
    errorMessage: 'Публикация: аккаунт @zavod.mebel.ru отдал 401, токен отозван',
    errorCategory: 'permission',
    steps: [
      ...HEAD_STEPS,
      {
        nodeId: 'vid-1',
        status: 'success',
        startOffset: 5 * MIN,
        durationMs: 5 * MIN,
        output: { generatedCount: 3, failedCount: 0, _domainStatus: 'success', [COST_ACTUAL_KEY]: 1.94, [COST_ESTIMATE_KEY]: 1.8, videos: [{ id: 201, status: 'completed', duration: 71, totalCostActual: 1.94 }] },
      },
      { nodeId: 'cap-1', status: 'success', startOffset: 10 * MIN, durationMs: 30_000, output: { captions: 3 } },
      {
        nodeId: 'up-1',
        status: 'failed',
        startOffset: 11 * MIN,
        durationMs: 60_000,
        attempts: 3,
        maxRetries: 2,
        error: 'Instagram Graph API: 401 invalid_token, токен отозван владельцем аккаунта',
        errorCategory: 'permission',
        logs: [{ level: 'error', message: 'instagram: 401 invalid_token', offset: 12 * MIN, data: { account: '@zavod.mebel.ru', http: 401 } }],
      },
      { nodeId: 'an-1', status: 'pending' },
    ],
  },
  // Вчерашний успешный ночной.
  {
    status: 'success',
    trigger: 'schedule',
    startOffset: 34 * HOUR,
    finishOffset: 34 * HOUR - (1 * HOUR + 48 * MIN),
    steps: [
      ...HEAD_STEPS,
      { nodeId: 'vid-1', status: 'success', startOffset: 5 * MIN, durationMs: 1 * HOUR + 20 * MIN, output: { generatedCount: 40, failedCount: 0, _domainStatus: 'success', [COST_ACTUAL_KEY]: 71.6, [COST_ESTIMATE_KEY]: 72, videos: [] } },
      { nodeId: 'cap-1', status: 'success', startOffset: 1 * HOUR + 26 * MIN, durationMs: 3 * MIN, output: { captions: 40 } },
      { nodeId: 'up-1', status: 'success', startOffset: 1 * HOUR + 30 * MIN, durationMs: 17 * MIN, output: { uploadsInitiated: 40 } },
      { nodeId: 'an-1', status: 'success', startOffset: 1 * HOUR + 47 * MIN, durationMs: 55_000, output: { tracked: 40 } },
    ],
  },
]

/** Тот же агрегат, что считает движок: сумма шагов, null пока сумм нет. */
function runCost(steps: ReturnType<typeof buildSteps>) {
  const known = <K extends 'costActual' | 'costEstimate'>(field: K) => {
    const values = steps.map(s => s[field]).filter((v): v is number => v != null)
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null
  }
  return { costActual: known('costActual'), costEstimate: known('costEstimate') }
}

let created = 0
for (const spec of RUNS) {
  const startedAt = at(spec.startOffset)
  const steps = buildSteps(startedAt, spec.steps)
  const cost = runCost(steps)
  const run = await prisma.workflowRun.create({
    data: {
      pipelineId: pipeline.id,
      status: spec.status,
      triggerType: spec.trigger,
      triggeredBy: user.id,
      graphSnapshot: graphData as never,
      inputContext: { source: 'seed-pipeline-runs-demo' } as never,
      errorMessage: spec.errorMessage ?? null,
      errorCategory: spec.errorCategory ?? null,
      costActual: cost.costActual,
      costEstimate: cost.costEstimate,
      cancelRequestedAt: spec.cancelOffset != null ? at(spec.cancelOffset) : null,
      cancelRequestedBy: spec.cancelOffset != null ? user.id : null,
      startedAt,
      finishedAt: spec.finishOffset != null ? at(spec.finishOffset) : null,
      createdAt: startedAt,
      steps: { create: steps as never },
    },
  })
  created += 1
  console.log(`[cf-seed-runs] запуск #${run.id} · ${spec.status} · шагов ${spec.steps.length}`)
}

console.log(`[cf-seed-runs] готово: конвейер #${pipeline.id} «${pipeline.name}», запусков ${created}`)

await prisma.$disconnect()
