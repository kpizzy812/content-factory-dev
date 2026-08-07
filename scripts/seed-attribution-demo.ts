/**
 * Демо-события атрибуции: воронка от перехода до продажи.
 *
 * Макет 07 строится вокруг сквозной воронки «тренды → продажи», а в базе
 * стенда `FactoryPublication` и `AttributionEvent` пусты: события присылают
 * мессенджер и conversion sink живого клиента, которых на стенде нет.
 *
 * Числа не выдуманы «красивыми», а выведены из уже посчитанных метрик
 * публикации: переходов столько, сколько даёт её собственный CTR из
 * `PostMetrics`. Иначе на экране появляется ролик с 40 000 просмотров и
 * 900 заявками, и любые выводы по такому экрану бессмысленны.
 *
 * Часть людей касается нескольких публикаций до заявки — иначе переключатель
 * «по первому касанию / по последнему» показывает одно и то же, и проверять
 * его нечем.
 *
 * Требует публикаций с замерами, циклов и запусков:
 *   seed-uploads-demo → seed-post-metrics-demo → seed-cycles-demo →
 *   seed-pipeline-runs-demo.
 * Использовать ТОЛЬКО на тестовой БД.
 *
 * Запуск:
 *   bun run scripts/seed-attribution-demo.ts
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../app/generated/prisma/client'
import { createSeededRng } from '../shared/utils/seedable-rng'
import {
  createAttributionIdempotencyKey,
  hashContentFactoryWebhookSecret,
  type AttributionEventType,
} from '../server/utils/content-factory-attribution'

const connectionString = process.env.DATABASE_URL
  ?? 'postgresql://contentfactory_tests:contentfactory_tests_password@localhost:5436/contentfactory_tests_db'

if (!connectionString.includes('tests')) {
  throw new Error('[cf-seed-attribution] DATABASE_URL не указывает на тестовую базу. Прерываю.')
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const rng = createSeededRng('cf-attribution-demo')
const now = Date.now()

const app = await prisma.app.findFirst({ orderBy: { id: 'asc' } })
if (!app) throw new Error('[cf-seed-attribution] в базе нет приложения — сначала seed-dev-user')

const cycle = await prisma.productionCycle.findFirst({
  where: { appId: app.id },
  orderBy: { id: 'asc' },
})
if (!cycle) throw new Error('[cf-seed-attribution] нет производственных циклов — сначала seed-cycles-demo')

const runs = await prisma.workflowRun.findMany({ orderBy: { id: 'asc' }, select: { id: true } })
if (runs.length === 0) throw new Error('[cf-seed-attribution] нет запусков конвейера — сначала seed-pipeline-runs-demo')

const uploads = await prisma.upload.findMany({
  where: { status: 'published' },
  orderBy: { id: 'asc' },
  select: {
    id: true,
    videoId: true,
    socialAccountId: true,
    createdAt: true,
    socialAccount: { select: { platform: true } },
    metrics: { orderBy: { collectedAt: 'desc' }, take: 1, select: { views: true, ctr: true } },
  },
})
if (uploads.length === 0) {
  throw new Error('[cf-seed-attribution] нет опубликованных роликов — сначала seed-uploads-demo')
}

// --- Лид-магнит и воронка ---------------------------------------------------
// Одна воронка на приложение: кодовое слово в комментарии, лид-магнит в
// мессенджере, заявка на посадочной. Ровно тот путь, который описывает
// `content-factory-attribution`.

await prisma.attributionEvent.deleteMany({})
await prisma.factoryPublication.deleteMany({})
await prisma.contentFunnel.deleteMany({ where: { appId: app.id } })
await prisma.leadMagnet.deleteMany({ where: { appId: app.id } })

const leadMagnet = await prisma.leadMagnet.create({
  data: {
    appId: app.id,
    title: 'Чек-лист замера',
    problem: 'Люди боятся ошибиться в замере и откладывают заказ',
    audience: 'Владельцы квартир на ремонте',
    content: {
      sections: [
        { title: 'Что померить до звонка', items: ['ниша по трём точкам', 'высота потолка', 'плинтус и трубы'] },
        { title: 'Частые ошибки', items: ['замер по обоям', 'забыли про наличник'] },
      ],
    },
    deliveryMessage: 'Отправляю чек-лист замера. Скажите размеры ниши — посчитаю стоимость.',
    status: 'active',
  },
})

const funnel = await prisma.contentFunnel.create({
  data: {
    appId: app.id,
    leadMagnetId: leadMagnet.id,
    name: 'Чек-лист замера · Direct',
    keyword: 'ЗАМЕР',
    deliveryAdapter: 'telegram_bot',
    automationAdapter: 'comment_reply',
    conversionAdapter: 'webhook',
    conversionUrl: 'https://example.test/lead',
    conversionTrackingParam: 'tracking_token',
    webhookSecretHash: hashContentFactoryWebhookSecret('cfw_demo_secret_not_a_real_key'),
    status: 'active',
  },
})

// --- Фабричные публикации ---------------------------------------------------
// У `FactoryPublication` уникальна пара (runId, socialAccountId): один запуск
// не публикует в один аккаунт дважды. Пары раздаются перебором, а не по
// индексу, иначе вторая публикация того же аккаунта падает на constraint.

const usedPairs = new Set<string>()

interface Publication {
  id: string
  uploadId: number
  trackingToken: string
  views: number
  ctr: number
  publishedAt: Date
}

const publications: Publication[] = []

for (const [index, upload] of uploads.entries()) {
  const runId = runs.find(run => !usedPairs.has(`${run.id}:${upload.socialAccountId}`))?.id
  if (!runId) continue
  usedPairs.add(`${runId}:${upload.socialAccountId}`)

  const trackingToken = `tt_${(index + 1).toString().padStart(2, '0')}${rng.int(100000, 999999).toString(16)}`
  const created = await prisma.factoryPublication.create({
    data: {
      appId: app.id,
      cycleId: cycle.id,
      runId,
      funnelId: funnel.id,
      socialAccountId: upload.socialAccountId,
      platform: upload.socialAccount.platform,
      trackingToken,
      keyword: funnel.keyword,
      videoId: upload.videoId,
      uploadId: upload.id,
      status: 'published',
      publishedAt: upload.createdAt,
    },
  })

  publications.push({
    id: created.id,
    uploadId: upload.id,
    trackingToken,
    views: upload.metrics[0]?.views ?? 0,
    ctr: upload.metrics[0]?.ctr ?? 0,
    publishedAt: upload.createdAt,
  })
}

// --- События ----------------------------------------------------------------

interface EventInput {
  publicationId: string
  trackingToken: string
  type: AttributionEventType
  source: string
  occurredAt: Date
  messengerUserId?: string
  externalUserId?: string
  payload?: Record<string, unknown>
}

const events: EventInput[] = []

function push(input: EventInput) {
  events.push(input)
}

/** Момент внутри окна жизни публикации: чем свежее публикация, тем плотнее. */
function momentAfter(publishedAt: Date, minMs: number, maxMs: number): Date {
  const from = publishedAt.getTime() + minMs
  const to = Math.min(publishedAt.getTime() + maxMs, now - MINUTE)
  if (to <= from) return new Date(Math.max(from, now - HOUR))
  return new Date(from + rng.float() * (to - from))
}

const COMMENTS = [
  'А в нишу 82 см встанет? Сколько ждать?',
  'Цена вопроса?',
  'Сколько по времени делаете такой шкаф?',
  'Замер платный?',
  'В другой город возите?',
]

let personCounter = 0
/** Люди, уже касавшиеся других публикаций: из них берутся многошаговые цепочки. */
const knownPeople: Array<{ id: string; firstSeenAt: number }> = []

for (const publication of publications) {
  // Бот отвечает на комментарии и уходит в Direct — это наши собственные
  // действия, они не зависят от того, перешёл человек или нет.
  const commentCount = rng.int(1, 3)
  for (let i = 0; i < commentCount; i += 1) {
    const at = momentAfter(publication.publishedAt, 20 * MINUTE, 2 * DAY)
    push({
      publicationId: publication.id,
      trackingToken: publication.trackingToken,
      type: 'automation_comment',
      source: 'automation',
      occurredAt: at,
      externalUserId: `ig_${rng.int(1000, 9999)}`,
      payload: { text: COMMENTS[rng.int(0, COMMENTS.length - 1)] },
    })
    push({
      publicationId: publication.id,
      trackingToken: publication.trackingToken,
      type: 'automation_direct',
      source: 'automation',
      occurredAt: new Date(at.getTime() + rng.int(1, 20) * MINUTE),
      payload: { text: `Отправили ссылку на «${leadMagnet.title}» по кодовому слову ${funnel.keyword}` },
    })
  }

  // Переходов столько, сколько даёт собственный CTR публикации. Верхняя
  // граница — чтобы стенд не распухал: на живом заводе их считает платформа.
  const clicks = Math.min(90, Math.max(0, Math.round(publication.views * publication.ctr)))

  for (let i = 0; i < clicks; i += 1) {
    // Каждый пятый переход — человек, которого мы уже видели на другой
    // публикации: именно на таких цепочках расходятся первое и последнее
    // касание.
    const reuse = knownPeople.length > 0 && rng.chance(0.2)
    const person = reuse
      ? knownPeople[rng.int(0, knownPeople.length - 1)]!
      : { id: `tg_${(personCounter += 1).toString().padStart(4, '0')}`, firstSeenAt: 0 }

    const openedAt = momentAfter(publication.publishedAt, 30 * MINUTE, 5 * DAY)
    if (!reuse) knownPeople.push({ id: person.id, firstSeenAt: openedAt.getTime() })

    push({
      publicationId: publication.id,
      trackingToken: publication.trackingToken,
      type: 'messenger_opened',
      source: 'messenger',
      occurredAt: openedAt,
      messengerUserId: person.id,
      externalUserId: person.id,
    })

    // Лид-магнит отдаётся почти всем, кто дошёл: бот отвечает сразу.
    if (!rng.chance(0.92)) continue
    const deliveredAt = new Date(openedAt.getTime() + rng.int(1, 6) * MINUTE)
    push({
      publicationId: publication.id,
      trackingToken: publication.trackingToken,
      type: 'lead_magnet_delivered',
      source: 'messenger',
      occurredAt: deliveredAt,
      messengerUserId: person.id,
      payload: { leadMagnet: leadMagnet.title },
    })

    // Форму открывает меньше половины, отправляет — часть из них.
    if (!rng.chance(0.38)) continue
    const openedFormAt = new Date(deliveredAt.getTime() + rng.int(4, 90) * MINUTE)
    push({
      publicationId: publication.id,
      trackingToken: publication.trackingToken,
      type: 'conversion_opened',
      source: 'conversion',
      occurredAt: openedFormAt,
      messengerUserId: person.id,
    })

    if (!rng.chance(0.42)) continue
    const submittedAt = new Date(openedFormAt.getTime() + rng.int(2, 40) * MINUTE)
    push({
      publicationId: publication.id,
      trackingToken: publication.trackingToken,
      type: 'conversion_submitted',
      source: 'conversion',
      occurredAt: submittedAt,
      messengerUserId: person.id,
      externalUserId: `lead_${rng.int(1000, 9999)}`,
      payload: { form: 'Замер по месту', phone: '+7 9•• ••• ••••' },
    })

    // Продажа приходит из CRM отдельным событием и заметно позже.
    if (!rng.chance(0.11)) continue
    push({
      publicationId: publication.id,
      trackingToken: publication.trackingToken,
      type: 'sale_attributed',
      source: 'crm',
      occurredAt: new Date(Math.min(submittedAt.getTime() + rng.int(3, 40) * HOUR, now - MINUTE)),
      messengerUserId: person.id,
      payload: { amount: rng.int(38_000, 210_000), currency: 'RUB' },
    })
  }
}

// Идемпотентность как на живом заводе: ключ считает та же функция, что и
// приёмник вебхука, а повтор одного события в базу не попадает.
let created = 0
for (const event of events) {
  const idempotencyKey = createAttributionIdempotencyKey({
    publicationId: event.publicationId,
    type: event.type,
    source: event.source,
    externalUserId: event.externalUserId,
    payload: { ...event.payload, at: event.occurredAt.toISOString() },
  })
  await prisma.attributionEvent.upsert({
    where: { idempotencyKey },
    update: {},
    create: {
      publicationId: event.publicationId,
      trackingToken: event.trackingToken,
      type: event.type,
      source: event.source,
      idempotencyKey,
      externalUserId: event.externalUserId ?? null,
      messengerUserId: event.messengerUserId ?? null,
      payload: event.payload ?? undefined,
      occurredAt: event.occurredAt,
    },
  })
  created += 1
}

const byType = new Map<string, number>()
for (const event of events) byType.set(event.type, (byType.get(event.type) ?? 0) + 1)

console.log(
  `[cf-seed-attribution] готово: публикаций ${publications.length}, событий ${created}\n`
  + [...byType.entries()].map(([type, count]) => `  ${type}: ${count}`).join('\n'),
)

await prisma.$disconnect()
