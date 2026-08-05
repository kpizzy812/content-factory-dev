/**
 * Демо-аккаунты соцсетей для проверки вёрстки глазами.
 *
 * Три активных аккаунта: два публикуют через официальный API, один — через
 * устройство и намеренно без прокси и device-профиля, чтобы был виден путь
 * «аккаунт не готов публиковать».
 *
 * Использовать ТОЛЬКО на тестовой БД.
 *
 * Запуск:
 *   set -a && source ./.env.test && set +a && bun run scripts/seed-accounts-demo.ts
 */

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../app/generated/prisma/client'

const connectionString = process.env.DATABASE_URL
  ?? 'postgresql://contentfactory_tests:contentfactory_tests_password@localhost:5436/contentfactory_tests_db'

if (!connectionString.includes('tests')) {
  throw new Error('[seed-accounts-demo] DATABASE_URL не указывает на тестовую базу. Прерываю.')
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

const app = await prisma.app.findFirst() ?? await prisma.app.create({
  data: { name: 'Демо-приложение' },
})

const ACCOUNTS = [
  { platform: 'tiktok', displayName: '@zavod.mebel.ru', postingMethod: 'api' },
  { platform: 'youtube', displayName: 'Завод мебели', postingMethod: 'api' },
  { platform: 'instagram', displayName: '@zavod.mebel', postingMethod: 'browser_automation' },
] as const

for (const acc of ACCOUNTS) {
  const existing = await prisma.socialAccount.findFirst({
    where: { displayName: acc.displayName },
  })
  if (existing) continue

  await prisma.socialAccount.create({
    data: {
      appId: app.id,
      platform: acc.platform as never,
      displayName: acc.displayName,
      status: 'active',
      postingMethod: acc.postingMethod as never,
    },
  })
}

const total = await prisma.socialAccount.count()
console.log(JSON.stringify({ appId: app.id, accounts: total }))
await prisma.$disconnect()
