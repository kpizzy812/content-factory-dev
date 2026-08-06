/**
 * Демо-данные раздела «Циклы» админки для проверки вёрстки глазами.
 *
 * Создаёт завершённый цикл с логами всех уровней, идущий прямо сейчас и
 * упавший — три состояния, которые интерфейс подаёт по-разному.
 *
 * Использовать ТОЛЬКО на тестовой БД.
 *
 * Запуск:
 *   set -a && source ./.env.test && set +a && bun run scripts/seed-cycles-demo.ts
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../app/generated/prisma/client'

const connectionString = process.env.DATABASE_URL
  ?? 'postgresql://contentfactory_tests:contentfactory_tests_password@localhost:5436/contentfactory_tests_db'

if (!connectionString.includes('tests')) {
  throw new Error('[cf-seed-cycles] DATABASE_URL не указывает на тестовую базу. Прерываю.')
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

const LOGS = [
  { module: 'orchestrator', level: 'info' as const, message: 'Цикл запущен, целевое количество роликов: 3' },
  { module: 'trendwatcher', level: 'info' as const, message: 'Собрано трендов: 17, из них новых 4' },
  { module: 'script-generator', level: 'info' as const, message: 'Сгенерировано 3 сценария, критик одобрил 2' },
  { module: 'script-generator', level: 'warn' as const, message: 'Вариант #2 ниже порога качества: 62/100' },
  { module: 'video-generator', level: 'info' as const, message: 'Ролик vid_17 собран за 8 минут 12 секунд' },
  { module: 'video-generator', level: 'error' as const, message: 'Ролик vid_18: провайдер клипов вернул 503 на третьей сцене' },
  { module: 'social-upload', level: 'info' as const, message: 'Опубликован 1 ролик, 1 отложен по дневному лимиту' },
]

async function main() {
  const app = await prisma.app.findFirst({ orderBy: { id: 'asc' } })
  const user = await prisma.zavodUser.findFirst({ orderBy: { id: 'asc' } })
  if (!app || !user) throw new Error('[cf-seed-cycles] нужны приложение и пользователь')

  const stamp = Date.now()

  // 1. Завершённый цикл с логами.
  const done = await prisma.productionCycle.create({
    data: {
      appId: app.id,
      startedById: user.id,
      batchKey: `demo-done-${stamp}`,
      status: 'completed',
      targetCount: 3,
      startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      completedAt: new Date(Date.now() - 2 * 60 * 60 * 1000 - 18 * 60 * 1000),
      trendsFound: 17,
      scenariosGen: 3,
      videosGen: 2,
      uploadsCount: 1,
    },
  })

  let offset = 0
  for (const log of LOGS) {
    offset += 4 * 60 * 1000
    await prisma.agentLog.create({
      data: {
        cycleId: done.id,
        module: log.module,
        level: log.level,
        message: log.message,
        createdAt: new Date(new Date(done.startedAt).getTime() + offset),
      },
    })
  }

  // 2. Цикл, который идёт прямо сейчас — доступна кнопка остановки.
  const running = await prisma.productionCycle.create({
    data: {
      appId: app.id,
      startedById: user.id,
      batchKey: `demo-running-${stamp}`,
      status: 'running',
      targetCount: 5,
      startedAt: new Date(Date.now() - 22 * 60 * 1000),
      trendsFound: 9,
      scenariosGen: 2,
    },
  })
  await prisma.agentLog.create({
    data: {
      cycleId: running.id,
      module: 'orchestrator',
      level: 'info',
      message: 'Цикл запущен, целевое количество роликов: 5',
    },
  })

  // 3. Упавший цикл — причина в карточке.
  await prisma.productionCycle.create({
    data: {
      appId: app.id,
      startedById: user.id,
      batchKey: `demo-failed-${stamp}`,
      status: 'failed',
      targetCount: 2,
      startedAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
      completedAt: new Date(Date.now() - 26 * 60 * 60 * 1000 + 6 * 60 * 1000),
      errorMessage: 'Провайдер генерации клипов недоступен: 3 попытки, последняя вернула 503.',
      trendsFound: 5,
    },
  })

  console.log(`[cf-seed-cycles] готово. Завершённый: /admin/cycles/${done.id}, идущий: /admin/cycles/${running.id}`)
}

main()
  .catch((err) => {
    console.error('[cf-seed-cycles]', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
