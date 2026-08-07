/**
 * Контекст для рейтингов аналитики: хуки, вторые варианты сценария и гео
 * трендов.
 *
 * Экран аналитики отвечает на вопрос «что сработало», а отвечать было нечем:
 * демо-ролики шли без `variantId`, поэтому хук у публикации не читался; у
 * каждого сценария был ровно один вариант, поэтому A/B сравнивать было не с
 * чем; у трендов не заполнены `geo` и `keyword`, поэтому разрез по странам и
 * рейтинг источников оставались пустыми.
 *
 * Сид ничего не выдумывает поверх существующего: он дописывает поля уже
 * созданным сущностям и добавляет вторую версию ролика тем сценариям, у
 * которых уже есть опубликованная первая. A/B честно только внутри сценария —
 * тренд, персонаж и аккаунт у вариантов общие, отличается хук.
 *
 * Требует роликов и публикаций: seed-videos-demo → seed-uploads-demo.
 * Прогонять ДО seed-post-metrics-demo и seed-attribution-demo — им нужны
 * готовые публикации.
 * Использовать ТОЛЬКО на тестовой БД.
 *
 * Запуск:
 *   bun run scripts/seed-ab-variants-demo.ts
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../app/generated/prisma/client'

const connectionString = process.env.DATABASE_URL
  ?? 'postgresql://contentfactory_tests:contentfactory_tests_password@localhost:5436/contentfactory_tests_db'

if (!connectionString.includes('tests')) {
  throw new Error('[cf-seed-ab] DATABASE_URL не указывает на тестовую базу. Прерываю.')
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

const HOUR = 3_600_000
const DAY = 24 * HOUR

/**
 * Пять приёмов, которые действительно отличаются друг от друга: рейтинг хуков
 * должен показывать разницу между подходами, а не пять формулировок одного.
 */
const HOOKS = [
  'Боль с доставкой, вопрос в лоб',
  'Цена против цены: 40 тысяч и 400 тысяч',
  'Ошибка, из-за которой переделывают',
  'Таймлапс сборки без слов',
  'Без хука в первых 3 секундах',
]

/** Источники парсинга: площадка и ниша, как их задаёт профиль. */
const SOURCES = [
  { geo: 'RU', language: 'ru', keyword: 'шкафы в нишу' },
  { geo: 'RU', language: 'ru', keyword: 'кухни на заказ' },
  { geo: 'KZ', language: 'ru', keyword: 'замер и монтаж' },
  { geo: 'RU', language: 'ru', keyword: 'шкафы в нишу' },
  { geo: 'BY', language: 'ru', keyword: 'обзоры мебели' },
]

// --- Тренды: страна, язык и ключевое слово ----------------------------------

const trends = await prisma.trend.findMany({
  where: { isDeleted: false },
  orderBy: { id: 'asc' },
  select: { id: true, geo: true },
})

let trendsPatched = 0
for (const [index, trend] of trends.entries()) {
  if (trend.geo) continue
  const source = SOURCES[index % SOURCES.length]!
  await prisma.trend.update({
    where: { id: trend.id },
    data: { geo: source.geo, language: source.language, keyword: source.keyword },
  })
  trendsPatched += 1
}

// --- Хуки вариантов и связь ролика с вариантом ------------------------------

const scenarios = await prisma.scenario.findMany({
  where: { isDeleted: false },
  orderBy: { id: 'asc' },
  select: {
    id: true,
    selectedVariantId: true,
    variants: { orderBy: { variantIndex: 'asc' }, select: { id: true, variantIndex: true } },
    videos: { orderBy: { id: 'asc' }, select: { id: true, variantId: true } },
  },
})

let hooksPatched = 0
let videosLinked = 0

for (const [index, scenario] of scenarios.entries()) {
  const first = scenario.variants[0]
  if (!first) continue

  await prisma.scenarioVariant.update({
    where: { id: first.id },
    data: { hook: HOOKS[index % HOOKS.length]! },
  })
  hooksPatched += 1

  const variantId = scenario.selectedVariantId ?? first.id
  for (const video of scenario.videos) {
    if (video.variantId) continue
    await prisma.video.update({ where: { id: video.id }, data: { variantId } })
    videosLinked += 1
  }
}

// --- A/B: вторая версия у сценариев с опубликованным роликом ----------------
// Берём сценарии, чей ролик уже опубликован: сравнивать вариант с публикацией
// и вариант без неё бессмысленно, а заводить публикацию «про запас» — значит
// рисовать в очереди то, чего не было.

const publishedUploads = await prisma.upload.findMany({
  where: { status: 'published' },
  orderBy: { id: 'asc' },
  select: {
    id: true,
    socialAccountId: true,
    applicationId: true,
    title: true,
    description: true,
    hashtags: true,
    createdAt: true,
    video: {
      select: {
        id: true,
        scenarioId: true,
        duration: true,
        format: true,
        targetPlatform: true,
        totalCostActual: true,
        totalCostEstimate: true,
      },
    },
  },
})

const seenScenarios = new Set<number>()
const candidates = publishedUploads.filter((upload) => {
  const scenarioId = upload.video.scenarioId
  if (seenScenarios.has(scenarioId)) return false
  seenScenarios.add(scenarioId)
  return true
})

let pairs = 0
for (const upload of candidates.slice(0, 2)) {
  const scenarioId = upload.video.scenarioId
  const variantA = await prisma.scenarioVariant.findFirst({
    where: { scenarioId, variantIndex: 0 },
    select: { hook: true },
  })
  // Хук у B обязан отличаться от A — иначе сравнивать нечего: A/B в макете
  // подписан «различие только в хуке».
  const hookB = HOOKS.find(hook => hook !== variantA?.hook) ?? HOOKS[0]!

  const existing = await prisma.scenarioVariant.findFirst({
    where: { scenarioId, variantIndex: 1 },
    select: { id: true },
  })
  if (existing) {
    await prisma.scenarioVariant.update({ where: { id: existing.id }, data: { hook: hookB } })
    continue
  }

  const variantB = await prisma.scenarioVariant.create({
    data: {
      scenarioId,
      variantIndex: 1,
      status: 'accepted',
      title: `${upload.title} · вариант B`,
      hook: hookB,
      body: 'Тот же сюжет, но первые три секунды — про срок доставки, а не про материал.',
      cta: 'Заберите чек-лист замера в закреплённом сообщении.',
      fullScript: 'Полный текст варианта B для сравнения хуков.',
      visualStyleText: 'Тёплый дневной свет, живая камера с рук, крупные планы фурнитуры.',
      qualityScore: 7.2,
      qualityCheckedAt: new Date(),
    },
  })

  const videoB = await prisma.video.create({
    data: {
      scenarioId,
      variantId: variantB.id,
      status: 'completed',
      format: upload.video.format,
      duration: upload.video.duration ?? 82,
      renderQuality: 'high',
      targetPlatform: upload.video.targetPlatform,
      subtitlesEnabled: true,
      musicEnabled: false,
      totalCostEstimate: upload.video.totalCostEstimate,
      totalCostActual: upload.video.totalCostActual,
      startedAt: new Date(Date.now() - 4 * DAY),
      finishedAt: new Date(Date.now() - 4 * DAY + 11 * 60_000),
      createdAt: new Date(Date.now() - 4 * DAY),
    },
  })

  const publishedAt = new Date(Date.now() - 3 * DAY)
  await prisma.upload.create({
    data: {
      videoId: videoB.id,
      socialAccountId: upload.socialAccountId,
      applicationId: upload.applicationId,
      status: 'published',
      publishMode: 'immediate',
      title: `${upload.title} · вариант B`,
      description: upload.description,
      hashtags: upload.hashtags,
      platformPostId: `p_ab_${videoB.id}`,
      platformPostUrl: `https://example.test/p_ab_${videoB.id}`,
      idempotencyKey: `demo-ab-${videoB.id}`,
      attemptCount: 1,
      lastAttemptAt: publishedAt,
      createdAt: publishedAt,
    },
  })

  pairs += 1
}

console.log(
  `[cf-seed-ab] готово: трендам проставлено гео ${trendsPatched}, хуков переписано ${hooksPatched}, `
  + `роликов связано с вариантом ${videosLinked}, пар A/B ${pairs}`,
)

await prisma.$disconnect()
