/**
 * Демо-данные раздела «Публикации» для проверки вёрстки глазами.
 *
 * Берёт готовые ролики и аккаунты, созданные seed-videos-demo и
 * seed-accounts-demo, и раскладывает по ним публикации во всех состояниях,
 * которые различает интерфейс: опубликована, упала с историей попыток,
 * запланирована, ждёт очереди и заблокирована выключенным постингом.
 *
 * Использовать ТОЛЬКО на тестовой БД.
 *
 * Запуск:
 *   set -a && source ./.env.test && set +a && bun run scripts/seed-uploads-demo.ts
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../app/generated/prisma/client'

const connectionString = process.env.DATABASE_URL
  ?? 'postgresql://contentfactory_tests:contentfactory_tests_password@localhost:5436/contentfactory_tests_db'

if (!connectionString.includes('tests')) {
  throw new Error('[cf-seed-uploads] DATABASE_URL не указывает на тестовую базу. Прерываю.')
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

async function main() {
  const videos = await prisma.video.findMany({ where: { status: 'completed' }, take: 10, orderBy: { id: 'asc' } })
  const accounts = await prisma.socialAccount.findMany({ orderBy: { id: 'asc' } })

  if (!videos.length || !accounts.length) {
    throw new Error('[cf-seed-uploads] нужны ролики и аккаунты: запустите seed-videos-demo и seed-accounts-demo')
  }

  const stamp = Date.now()
  let n = 0
  const pick = () => {
    const video = videos[n % videos.length]!
    const account = accounts[n % accounts.length]!
    n++
    return { video, account }
  }

  // 1. Опубликована — есть ссылка на пост и одна успешная попытка.
  {
    const { video, account } = pick()
    const upload = await prisma.upload.create({
      data: {
        videoId: video.id,
        socialAccountId: account.id,
        applicationId: account.appId,
        status: 'published',
        publishMode: 'immediate',
        title: 'Шкаф в нишу за один день',
        description: 'Замер, раскрой и сборка за смену.\nЧек-лист замера — в закреплённом сообщении.',
        hashtags: ['мебель', 'ремонт', 'дизайнинтерьера'],
        platformPostId: 'p_7412998',
        platformPostUrl: 'https://www.tiktok.com/@zavod.mebel.ru/video/7412998',
        idempotencyKey: `demo-published-${stamp}`,
        attemptCount: 1,
        lastAttemptAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
      },
    })
    await prisma.socialUploadAttempt.create({
      data: {
        uploadId: upload.id,
        attemptNumber: 1,
        status: 'published',
        startedAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
        finishedAt: new Date(Date.now() - 26 * 60 * 60 * 1000 + 94_000),
        externalPostId: 'p_7412998',
      },
    })
    console.log(`[cf-seed-uploads] опубликованная: /uploads/${upload.id}`)
  }

  // 2. Упала после трёх попыток — интерфейс показывает историю и причину.
  {
    const { video, account } = pick()
    const upload = await prisma.upload.create({
      data: {
        videoId: video.id,
        socialAccountId: account.id,
        applicationId: account.appId,
        status: 'failed',
        publishMode: 'immediate',
        title: 'Кухня без верхних шкафов',
        description: 'Показываем, куда уехало хранение.',
        hashtags: ['кухня', 'хранение'],
        errorMessage: 'Платформа отклонила загрузку: превышен дневной лимит публикаций аккаунта.',
        idempotencyKey: `demo-failed-${stamp}`,
        attemptCount: 3,
        lastAttemptAt: new Date(Date.now() - 40 * 60 * 1000),
      },
    })
    for (let i = 1; i <= 3; i++) {
      await prisma.socialUploadAttempt.create({
        data: {
          uploadId: upload.id,
          attemptNumber: i,
          status: 'failed',
          startedAt: new Date(Date.now() - (60 - i * 10) * 60 * 1000),
          finishedAt: new Date(Date.now() - (60 - i * 10) * 60 * 1000 + 41_000),
          errorMessage: i < 3
            ? 'Таймаут ответа платформы на шаге publish.'
            : 'Платформа отклонила загрузку: превышен дневной лимит публикаций аккаунта.',
        },
      })
    }
    console.log(`[cf-seed-uploads] упавшая: /uploads/${upload.id}`)
  }

  // 3. Запланирована на будущее.
  {
    const { video, account } = pick()
    const upload = await prisma.upload.create({
      data: {
        videoId: video.id,
        socialAccountId: account.id,
        applicationId: account.appId,
        status: 'scheduled',
        publishMode: 'scheduled',
        scheduledAt: new Date(Date.now() + 18 * 60 * 60 * 1000),
        title: 'Гардеробная из кладовки',
        description: 'Полтора квадрата, а помещается весь зимний гардероб.',
        hashtags: ['гардеробная'],
        idempotencyKey: `demo-scheduled-${stamp}`,
      },
    })
    console.log(`[cf-seed-uploads] запланированная: /uploads/${upload.id}`)
  }

  // 4. Заблокирована выключенным постингом — не ошибка, а выключенный флаг.
  {
    const { video, account } = pick()
    const upload = await prisma.upload.create({
      data: {
        videoId: video.id,
        socialAccountId: account.id,
        applicationId: account.appId,
        status: 'blocked_by_env',
        blockedByEnv: true,
        title: 'Прихожая с зеркалом во всю стену',
        description: 'Собрали за два дня.',
        hashtags: ['прихожая'],
        errorMessage: 'Публикация выключена переключателем ENABLE_SOCIAL_POSTING.',
        idempotencyKey: `demo-blocked-${stamp}`,
      },
    })
    console.log(`[cf-seed-uploads] заблокированная: /uploads/${upload.id}`)
  }

  // 5. Фон для пагинации и навигации по соседям.
  for (let i = 1; i <= 10; i++) {
    const { video, account } = pick()
    await prisma.upload.create({
      data: {
        videoId: video.id,
        socialAccountId: account.id,
        applicationId: account.appId,
        status: i % 4 === 0 ? 'uploading' : 'pending',
        title: `Публикация для проверки вёрстки ${i}`,
        description: 'Текст публикации для строки списка.',
        hashtags: i % 2 === 0 ? ['мебель'] : [],
        idempotencyKey: `demo-bg-${stamp}-${i}`,
      },
    })
  }

  const total = await prisma.upload.count()
  console.log(`[cf-seed-uploads] готово, публикаций в базе: ${total}`)
}

main()
  .catch((err) => {
    console.error('[cf-seed-uploads]', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
