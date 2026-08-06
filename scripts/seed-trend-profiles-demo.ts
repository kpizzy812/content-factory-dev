/**
 * Демо-профили парсинга и их запуски.
 *
 * Вкладки «Профили парсинга» и «Запуски» на /trends нечем было проверять
 * глазами: в базе не было ни одного профиля, и обе вкладки показывали пустое
 * состояние. Здесь профили во всех состояниях, которые видит оператор:
 * работающий прямо сейчас, с расписанием, выключенный, со сломанным конфигом
 * и ни разу не запускавшийся.
 *
 * Использовать ТОЛЬКО на тестовой БД.
 *
 * Запуск:
 *   bun run scripts/seed-trend-profiles-demo.ts
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../app/generated/prisma/client'

const connectionString = process.env.DATABASE_URL
  ?? 'postgresql://contentfactory_tests:contentfactory_tests_password@localhost:5436/contentfactory_tests_db'

if (!connectionString.includes('tests')) {
  throw new Error('[cf-seed-trend-profiles] DATABASE_URL не указывает на тестовую базу. Прерываю.')
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

const app = await prisma.app.findFirst({ orderBy: { id: 'asc' } })
if (!app) throw new Error('[cf-seed-trend-profiles] в базе нет приложений — сначала seed-dev-user')

const MIN = 60_000
const HOUR = 60 * MIN
const now = Date.now()
const at = (offsetMs: number) => new Date(now - offsetMs)

// Повторный прогон не плодит профили.
await prisma.trendwatcherProfile.deleteMany({ where: { appId: app.id, isInline: false } })

interface LogSpec {
  level: 'info' | 'warn' | 'error'
  step: string
  message: string
  offset: number
}

interface RunSpec {
  status: 'pending' | 'starting' | 'running' | 'importing' | 'analyzing' | 'completed' | 'failed' | 'canceled' | 'partially_completed'
  trigger: 'manual' | 'scheduled' | 'pipeline'
  startOffset: number
  finishOffset?: number
  found?: number
  imported?: number
  skipped?: number
  warnings?: number
  failureReason?: string
  errorCategory?: string
  errorStep?: string
  errorSummary?: string
  apifyStatus?: string
  apifyStatusMessage?: string
  canRetry?: boolean
  needsProfileFix?: boolean
  initiatedBy?: string
  logs: LogSpec[]
}

interface ProfileSpec {
  name: string
  actorId: string
  keywords: string[]
  platforms: Array<'tiktok' | 'instagram' | 'youtube'>
  language?: string
  geo?: string
  viewCountMin?: number
  maxItems: number
  enabled: boolean
  scheduleCron?: string
  validationStatus?: string
  validationSummary?: string
  runs: RunSpec[]
}

const PROFILES: ProfileSpec[] = [
  {
    name: 'Кухни на заказ · TikTok',
    actorId: 'clockworks/tiktok-scraper',
    keywords: ['кухня на заказ', 'шкаф в нишу', 'мебель по размеру', 'ремонт кухни'],
    platforms: ['tiktok'],
    language: 'ru',
    geo: 'RU',
    viewCountMin: 50_000,
    maxItems: 40,
    enabled: true,
    scheduleCron: '0 */6 * * *',
    validationStatus: 'valid',
    validationSummary: 'Актор доступен, токен принят',
    runs: [
      {
        status: 'running',
        trigger: 'scheduled',
        startOffset: 6 * MIN,
        found: 0,
        logs: [
          { level: 'info', step: 'init', message: 'профиль проверен, актор clockworks/tiktok-scraper', offset: 1000 },
          { level: 'info', step: 'starting', message: 'прогон Apify запущен, до 40 результатов', offset: 4000 },
          { level: 'info', step: 'running', message: 'Apify собирает выдачу, статус RUNNING', offset: 30_000 },
        ],
      },
      {
        status: 'completed',
        trigger: 'scheduled',
        startOffset: 6 * HOUR,
        finishOffset: 6 * HOUR - (3 * MIN + 12_000),
        found: 40,
        imported: 17,
        skipped: 23,
        apifyStatus: 'SUCCEEDED',
        initiatedBy: 'расписание',
        logs: [
          { level: 'info', step: 'init', message: 'профиль проверен', offset: 800 },
          { level: 'info', step: 'running', message: 'Apify вернул 40 элементов', offset: 2 * MIN },
          { level: 'warn', step: 'importing', message: '23 ролика отброшены: уже есть в базе или ниже порога просмотров', offset: 3 * MIN },
          { level: 'info', step: 'completed', message: 'импортировано 17 трендов', offset: 3 * MIN + 12_000 },
        ],
      },
      {
        status: 'partially_completed',
        trigger: 'manual',
        startOffset: 26 * HOUR,
        finishOffset: 26 * HOUR - (5 * MIN),
        found: 40,
        imported: 11,
        skipped: 25,
        warnings: 4,
        errorCategory: 'import_partial_failure',
        errorStep: 'importing',
        errorSummary: 'Четыре ролика не удалось скачать: источник вернул 403',
        apifyStatus: 'SUCCEEDED',
        canRetry: true,
        initiatedBy: 'Стенд Разработки',
        logs: [
          { level: 'info', step: 'running', message: 'Apify вернул 40 элементов', offset: 2 * MIN },
          { level: 'error', step: 'importing', message: 'video 7382…: 403 при скачивании обложки', offset: 4 * MIN },
          { level: 'warn', step: 'completed', message: 'импорт завершён частично: 11 из 15 годных', offset: 5 * MIN },
        ],
      },
    ],
  },
  {
    name: 'Ремонт под ключ · Instagram',
    actorId: 'apify/instagram-scraper',
    keywords: ['ремонт под ключ', 'дизайн интерьера'],
    platforms: ['instagram'],
    language: 'ru',
    maxItems: 25,
    enabled: true,
    validationStatus: 'valid',
    validationSummary: 'Актор доступен, токен принят',
    runs: [
      {
        status: 'failed',
        trigger: 'manual',
        startOffset: 2 * HOUR,
        finishOffset: 2 * HOUR - (11 * MIN),
        found: 0,
        errorCategory: 'apify_timeout',
        errorStep: 'running',
        errorSummary: 'Apify не уложился в отведённое время',
        apifyStatus: 'TIMED-OUT',
        apifyStatusMessage: 'Actor run exceeded the memory-time limit',
        canRetry: true,
        initiatedBy: 'Стенд Разработки',
        failureReason: 'ApifyRunTimeout: run cmshu7… exceeded 600s\n  at waitForRun (apify-client.ts:214)\n  at importTrends (trendwatcher.ts:88)',
        logs: [
          { level: 'info', step: 'init', message: 'профиль проверен', offset: 900 },
          { level: 'info', step: 'starting', message: 'прогон Apify запущен', offset: 3000 },
          { level: 'warn', step: 'running', message: 'прогон идёт больше 5 минут', offset: 5 * MIN },
          { level: 'error', step: 'running', message: 'таймаут 600 с, прогон прерван', offset: 11 * MIN },
        ],
      },
    ],
  },
  {
    name: 'Мебель для спальни · YouTube Shorts',
    actorId: 'streamers/youtube-scraper',
    keywords: ['спальня дизайн', 'шкаф-купе'],
    platforms: ['youtube'],
    maxItems: 20,
    enabled: false,
    validationStatus: 'actor_not_found',
    validationSummary: 'Актор streamers/youtube-scraper не найден или закрыт для этого токена',
    runs: [],
  },
  {
    name: 'Три площадки сразу',
    actorId: 'apidojo/tiktok-scraper',
    keywords: [
      'мебель на заказ', 'кухня', 'шкаф', 'гардеробная', 'прихожая',
      'детская мебель', 'столешница', 'фасады',
    ],
    platforms: ['tiktok', 'instagram', 'youtube'],
    language: 'ru',
    geo: 'RU',
    viewCountMin: 100_000,
    maxItems: 60,
    enabled: true,
    validationStatus: 'valid',
    validationSummary: 'Актор доступен, токен принят',
    runs: [
      {
        status: 'canceled',
        trigger: 'manual',
        startOffset: 30 * HOUR,
        finishOffset: 30 * HOUR - (2 * MIN),
        found: 12,
        imported: 3,
        errorCategory: 'canceled',
        errorStep: 'canceled',
        errorSummary: 'Отменён оператором на середине сбора',
        initiatedBy: 'Стенд Разработки',
        logs: [
          { level: 'info', step: 'running', message: 'Apify собрал 12 элементов', offset: 90_000 },
          { level: 'warn', step: 'canceled', message: 'остановлено оператором', offset: 2 * MIN },
        ],
      },
    ],
  },
  {
    name: 'Новый профиль без прогонов',
    actorId: 'apidojo/youtube-scraper',
    keywords: [],
    platforms: ['youtube'],
    maxItems: 20,
    enabled: true,
    runs: [],
  },
]

let profileCount = 0
let runCount = 0

for (const spec of PROFILES) {
  const profile = await prisma.trendwatcherProfile.create({
    data: {
      appId: app.id,
      name: spec.name,
      actorId: spec.actorId,
      keywords: spec.keywords,
      platforms: spec.platforms as never,
      language: spec.language ?? null,
      geo: spec.geo ?? null,
      viewCountMin: spec.viewCountMin ?? null,
      maxItems: spec.maxItems,
      enabled: spec.enabled,
      scheduleEnabled: !!spec.scheduleCron,
      scheduleCron: spec.scheduleCron ?? null,
      scheduleTimezone: 'Europe/Moscow',
      scheduleNextRunAt: spec.scheduleCron ? new Date(now + 2 * HOUR) : null,
      scheduleLastRunAt: spec.scheduleCron ? at(6 * HOUR) : null,
      validationStatus: spec.validationStatus ?? null,
      validationSummary: spec.validationSummary ?? null,
      validatedAt: spec.validationStatus ? at(HOUR) : null,
    },
  })
  profileCount += 1

  let lastRunId: number | null = null
  let lastSuccessAt: Date | null = null

  for (const runSpec of spec.runs) {
    const startedAt = at(runSpec.startOffset)
    const run = await prisma.trendwatcherRun.create({
      data: {
        profileId: profile.id,
        status: runSpec.status as never,
        triggerType: runSpec.trigger as never,
        externalRunId: `apify_${profile.id}_${runSpec.startOffset}`,
        startedAt,
        completedAt: runSpec.finishOffset != null ? at(runSpec.finishOffset) : null,
        canceledAt: runSpec.status === 'canceled' && runSpec.finishOffset != null ? at(runSpec.finishOffset) : null,
        failureReason: runSpec.failureReason ?? null,
        errorCategory: runSpec.errorCategory ?? null,
        errorStep: runSpec.errorStep ?? null,
        errorSummary: runSpec.errorSummary ?? null,
        apifyStatus: runSpec.apifyStatus ?? null,
        apifyStatusMessage: runSpec.apifyStatusMessage ?? null,
        canRetry: runSpec.canRetry ?? false,
        needsProfileFix: runSpec.needsProfileFix ?? false,
        foundCount: runSpec.found ?? 0,
        importedCount: runSpec.imported ?? 0,
        skippedCount: runSpec.skipped ?? 0,
        warningCount: runSpec.warnings ?? 0,
        initiatedBy: runSpec.initiatedBy ?? null,
        createdAt: startedAt,
        logs: {
          create: runSpec.logs.map(log => ({
            level: log.level as never,
            step: log.step,
            message: log.message,
            createdAt: new Date(startedAt.getTime() + log.offset),
          })),
        },
      },
    })
    runCount += 1
    if (lastRunId == null) lastRunId = run.id
    if (runSpec.status === 'completed' && !lastSuccessAt) {
      lastSuccessAt = runSpec.finishOffset != null ? at(runSpec.finishOffset) : startedAt
    }
  }

  if (lastRunId != null) {
    await prisma.trendwatcherProfile.update({
      where: { id: profile.id },
      data: { lastRunId, lastSuccessfulRunAt: lastSuccessAt },
    })
  }

  console.log(`[cf-seed-trend-profiles] профиль #${profile.id} «${profile.name}», запусков ${spec.runs.length}`)
}

console.log(`[cf-seed-trend-profiles] готово: профилей ${profileCount}, запусков ${runCount}`)

await prisma.$disconnect()
