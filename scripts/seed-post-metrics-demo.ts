/**
 * Демо-метрики публикаций.
 *
 * Аналитика (макет 07) переносить было не на что: схема и endpoint'ы есть, а
 * `PostMetrics` в базе пуст — сбор ходит в социальные платформы, а на стенде
 * их нет. Здесь история замеров у опубликованных роликов: несколько точек на
 * публикацию, чтобы график роста был не одной точкой, и разброс между
 * площадками, чтобы сравнение имело смысл.
 *
 * Числа выведены из одного «характера» ролика (виральный / средний / провал),
 * а не набраны случайно: иначе в таблице оказывается ролик с 40 000 просмотров
 * и нулём лайков, и любые выводы по такому экрану бессмысленны.
 *
 * Требует публикаций: сначала `seed-uploads-demo`.
 * Использовать ТОЛЬКО на тестовой БД.
 *
 * Запуск:
 *   bun run scripts/seed-post-metrics-demo.ts
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../app/generated/prisma/client'
import { createSeededRng } from '../shared/utils/seedable-rng'

const connectionString = process.env.DATABASE_URL
  ?? 'postgresql://contentfactory_tests:contentfactory_tests_password@localhost:5436/contentfactory_tests_db'

if (!connectionString.includes('tests')) {
  throw new Error('[cf-seed-metrics] DATABASE_URL не указывает на тестовую базу. Прерываю.')
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

const HOUR = 3_600_000
const DAY = 24 * HOUR

const uploads = await prisma.upload.findMany({
  where: { status: 'published' },
  select: { id: true, createdAt: true, socialAccount: { select: { platform: true } } },
  orderBy: { id: 'asc' },
})

if (uploads.length === 0) {
  throw new Error('[cf-seed-metrics] в базе нет опубликованных роликов — сначала seed-uploads-demo')
}

await prisma.postMetrics.deleteMany({})

/**
 * Характер публикации задаёт всю связку чисел: у виральной высокий досмотр и
 * много репостов, у провальной — низкий досмотр и почти нет реакций.
 */
const PROFILES = [
  { key: 'viral', peakViews: 412_000, likeRate: 0.092, commentRate: 0.006, shareRate: 0.021, watch: 0.71, ctr: 0.058, follow: 1840 },
  { key: 'good', peakViews: 74_000, likeRate: 0.061, commentRate: 0.004, shareRate: 0.008, watch: 0.54, ctr: 0.031, follow: 210 },
  { key: 'average', peakViews: 18_400, likeRate: 0.037, commentRate: 0.002, shareRate: 0.003, watch: 0.41, ctr: 0.017, follow: 42 },
  { key: 'weak', peakViews: 2_150, likeRate: 0.014, commentRate: 0.001, shareRate: 0.001, watch: 0.22, ctr: 0.006, follow: 3 },
] as const

/** Кривая набора просмотров: половина в первые сутки, дальше затухание. */
const SNAPSHOT_OFFSETS = [
  { afterMs: 2 * HOUR, share: 0.22 },
  { afterMs: 12 * HOUR, share: 0.48 },
  { afterMs: DAY, share: 0.66 },
  { afterMs: 3 * DAY, share: 0.87 },
  { afterMs: 7 * DAY, share: 1 },
]

const rng = createSeededRng('post-metrics-demo')

/** Разброс ±12%: одинаковые числа у соседних замеров выглядят подделкой. */
function jitter(value: number): number {
  return Math.round(value * (0.88 + rng.float() * 0.24))
}

let created = 0
const now = Date.now()

for (const [index, upload] of uploads.entries()) {
  const profile = PROFILES[index % PROFILES.length]!
  const publishedAt = upload.createdAt.getTime()

  for (const snapshot of SNAPSHOT_OFFSETS) {
    const collectedAt = new Date(publishedAt + snapshot.afterMs)
    // Замеров из будущего не бывает: у публикации, вышедшей час назад, история
    // обрывается на первом замере — так же, как на живом заводе.
    if (collectedAt.getTime() > now) break

    const views = jitter(profile.peakViews * snapshot.share)
    await prisma.postMetrics.create({
      data: {
        uploadId: upload.id,
        views,
        likes: Math.round(views * profile.likeRate),
        comments: Math.round(views * profile.commentRate),
        shares: Math.round(views * profile.shareRate),
        // Досмотр и CTR от числа замеров не зависят — это доли, а не счётчики.
        watchThrough: Number((profile.watch * (0.95 + rng.float() * 0.1)).toFixed(3)),
        ctr: Number((profile.ctr * (0.95 + rng.float() * 0.1)).toFixed(4)),
        followerGain: Math.round(profile.follow * snapshot.share),
        collectedAt,
      },
    })
    created += 1
  }
}

console.log(
  `[cf-seed-metrics] готово: публикаций ${uploads.length}, замеров ${created}`,
)

await prisma.$disconnect()
