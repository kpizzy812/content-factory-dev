/**
 * Демо-очередь публикаций для проверки вёрстки глазами.
 *
 * Задачи во всех состояниях, которые видит оператор: в плане на ближайшие часы,
 * идущая прямо сейчас, опубликованная, упавшая с попытками, ждущая повтора и
 * снятая. Часть расставлена по ближайшим суткам — иначе сетку «аккаунт × час»
 * проверять нечем.
 *
 * Зона включается флагом `LEGACY_DEVICE_AUTOMATION_ENABLED=true` — без него
 * `/api/posting-jobs` отдаёт 404 и страница честно пишет, что зона выключена.
 *
 * Требует роликов и аккаунтов: `seed-videos-demo`, затем `seed-accounts-demo`.
 *
 * Использовать ТОЛЬКО на тестовой БД.
 *
 * Запуск:
 *   set -a && source ./.env.test && set +a && bun run scripts/seed-posting-jobs-demo.ts
 */
import { createHash } from 'node:crypto'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../app/generated/prisma/client'

const connectionString = process.env.DATABASE_URL
  ?? 'postgresql://contentfactory_tests:contentfactory_tests_password@localhost:5436/contentfactory_tests_db'

if (!connectionString.includes('tests')) {
  throw new Error('[cf-seed-posting] DATABASE_URL не указывает на тестовую базу. Прерываю.')
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

const HOUR = 60 * 60 * 1000
const now = Date.now()

const videos = await prisma.video.findMany({ take: 6, orderBy: { id: 'asc' } })
if (!videos.length) {
  throw new Error('[cf-seed-posting] в базе нет роликов — сначала seed-videos-demo')
}

const accounts = await prisma.socialAccount.findMany({
  where: { status: 'active' },
  orderBy: { id: 'asc' },
})
if (!accounts.length) {
  throw new Error('[cf-seed-posting] в базе нет активных аккаунтов — сначала seed-accounts-demo')
}

function pick<T>(list: T[], i: number): T {
  return list[i % list.length]!
}

/** Ключ идемпотентности считается так же, как на сервере. */
function idempotencyKey(videoId: number, accountId: number, scheduledAt: Date | null) {
  const raw = `${videoId}:${accountId}:${scheduledAt ? scheduledAt.toISOString() : 'asap'}`
  return createHash('sha256').update(raw).digest('hex').slice(0, 32)
}

interface JobSpec {
  status: string
  offsetHours: number | null
  attemptCount?: number
  startedAt?: Date | null
  finishedAt?: Date | null
  durationMs?: number | null
  platformPostUrl?: string | null
  lastError?: string | null
  errorCategory?: string | null
  retryAt?: Date | null
  cancelReason?: string | null
}

const SPECS: JobSpec[] = [
  { status: 'scheduled', offsetHours: 1 },
  { status: 'scheduled', offsetHours: 2 },
  { status: 'scheduled', offsetHours: 3 },
  { status: 'scheduled', offsetHours: 5 },
  { status: 'scheduled', offsetHours: 8 },
  { status: 'scheduled', offsetHours: 13 },
  { status: 'scheduled', offsetHours: 20 },
  { status: 'queued', offsetHours: 0 },
  {
    status: 'uploading',
    offsetHours: 0,
    attemptCount: 1,
    startedAt: new Date(now - 3 * 60 * 1000),
  },
  {
    status: 'published',
    offsetHours: -4,
    attemptCount: 1,
    startedAt: new Date(now - 4 * HOUR),
    finishedAt: new Date(now - 4 * HOUR + 92_000),
    durationMs: 92_000,
    platformPostUrl: 'https://example.invalid/p/demo-1',
  },
  {
    status: 'published',
    offsetHours: -9,
    attemptCount: 1,
    startedAt: new Date(now - 9 * HOUR),
    finishedAt: new Date(now - 9 * HOUR + 71_000),
    durationMs: 71_000,
    platformPostUrl: 'https://example.invalid/p/demo-2',
  },
  {
    status: 'retry_queued',
    offsetHours: 2,
    attemptCount: 2,
    lastError: 'Platform returned 503 Service Unavailable',
    errorCategory: 'platform_5xx',
    retryAt: new Date(now + 8 * 60 * 1000),
  },
  {
    status: 'failed',
    offsetHours: -2,
    attemptCount: 3,
    startedAt: new Date(now - 2 * HOUR),
    finishedAt: new Date(now - 2 * HOUR + 40_000),
    durationMs: 40_000,
    lastError: 'Publishing quota exhausted (50/50)',
    errorCategory: 'platform_rate_limit',
  },
  {
    status: 'cancelled',
    offsetHours: 6,
    cancelReason: 'ролик заменили на новый вариант',
  },
]

let created = 0
for (const [i, spec] of SPECS.entries()) {
  const video = pick(videos, i)
  const account = pick(accounts, i)
  const scheduledAt = spec.offsetHours === null
    ? null
    : new Date(now + spec.offsetHours * HOUR)
  const key = idempotencyKey(video.id, account.id, scheduledAt)

  const existing = await prisma.postingJob.findUnique({ where: { idempotencyKey: key } })
  if (existing) continue

  await prisma.postingJob.create({
    data: {
      videoId: video.id,
      socialAccountId: account.id,
      platform: account.platform,
      status: spec.status as never,
      scheduledAt,
      idempotencyKey: key,
      contentSnapshot: {
        title: `Демо-публикация ${i + 1}`,
        description: 'Демо-данные для проверки вёрстки очереди.',
        hashtags: ['мебель', 'ремонт'],
      },
      attemptCount: spec.attemptCount ?? 0,
      maxAttempts: 3,
      startedAt: spec.startedAt ?? null,
      finishedAt: spec.finishedAt ?? null,
      durationMs: spec.durationMs ?? null,
      platformPostUrl: spec.platformPostUrl ?? null,
      lastError: spec.lastError ?? null,
      errorCategory: (spec.errorCategory ?? null) as never,
      retryAt: spec.retryAt ?? null,
      cancelReason: spec.cancelReason ?? null,
      cancelledAt: spec.status === 'cancelled' ? new Date(now - HOUR) : null,
    },
  })
  created++
}

const total = await prisma.postingJob.count()
console.log(JSON.stringify({ created, total }))
await prisma.$disconnect()
