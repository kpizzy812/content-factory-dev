/**
 * Демо-журнал списаний для панели «Расход за сутки по типам операций».
 *
 * Ничего не выдумывает: проходит по шагам уже созданных роликов
 * (`VideoGenerationStep.actualCost`) и раскладывает их в `AiAuditLog` ровно так,
 * как это делает `logStepCost` на живом заводе — по одной строке на
 * (ролик × шаг × сервис). Поэтому суммы в панели сходятся с фактической
 * стоимостью роликов, а не живут отдельной жизнью.
 *
 * Требует роликов: сначала `seed-videos-demo`.
 * Использовать ТОЛЬКО на тестовой БД.
 *
 * Запуск:
 *   bun run scripts/seed-cost-ledger-demo.ts
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../app/generated/prisma/client'
import { mapStepKeyToService } from '../server/utils/balance/cost-attribution'

const connectionString = process.env.DATABASE_URL
  ?? 'postgresql://contentfactory_tests:contentfactory_tests_password@localhost:5436/contentfactory_tests_db'

if (!connectionString.includes('tests')) {
  throw new Error('[cf-seed-ledger] DATABASE_URL не указывает на тестовую базу. Прерываю.')
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

// Чистим прошлые демо-строки, чтобы повторный прогон не удваивал расход.
const removed = await prisma.aiAuditLog.deleteMany({ where: { action: 'external_api_call' } })
if (removed.count > 0) console.log(`[cf-seed-ledger] убрано прошлых списаний: ${removed.count}`)

const steps = await prisma.videoGenerationStep.findMany({
  where: { actualCost: { gt: 0 } },
  select: {
    videoId: true,
    stepKey: true,
    actualCost: true,
    finishedAt: true,
    falEndpoint: true,
  },
})

if (steps.length === 0) {
  throw new Error('[cf-seed-ledger] в базе нет шагов роликов со стоимостью — сначала seed-videos-demo')
}

let written = 0
let skipped = 0

for (const step of steps) {
  const service = mapStepKeyToService(step.stepKey as string, step.falEndpoint)
  if (!service) {
    // assembly и прочее локальное не списывается — так же ведёт себя cost-ledger
    skipped += 1
    continue
  }

  await prisma.aiAuditLog.create({
    data: {
      action: 'external_api_call',
      model: step.falEndpoint ?? service,
      service,
      stepKey: step.stepKey as string,
      videoId: step.videoId,
      costUsd: step.actualCost,
      status: 'applied',
      createdAt: step.finishedAt ?? new Date(),
    },
  })
  written += 1
}

// Панель делит расход на ролики, завершённые за сутки. У демо-роликов
// finishedAt не проставлен — без него делить не на что.
const completed = await prisma.video.findMany({
  where: { status: 'completed', finishedAt: null },
  select: { id: true },
})
for (const video of completed) {
  const last = await prisma.videoGenerationStep.findFirst({
    where: { videoId: video.id, finishedAt: { not: null } },
    orderBy: { finishedAt: 'desc' },
    select: { finishedAt: true },
  })
  await prisma.video.update({
    where: { id: video.id },
    data: { finishedAt: last?.finishedAt ?? new Date() },
  })
}

console.log(
  `[cf-seed-ledger] готово: списаний ${written}, локальных шагов пропущено ${skipped}, `
  + `роликам проставлено время завершения: ${completed.length}`,
)

await prisma.$disconnect()
