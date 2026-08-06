/**
 * Демо-аккаунты соцсетей для проверки вёрстки глазами.
 *
 * Шесть аккаунтов в разных состояниях: активный со стиль-профилем, активный без
 * профиля, аккаунт через устройство намеренно без прокси, аккаунт с истекающим
 * токеном, аккаунт с истёкшим токеном и отозванный. Плюс пачка аккаунтов —
 * без неё раздел «Пачки» проверить нечем.
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

const DAY = 24 * 60 * 60 * 1000
const now = Date.now()

const ACCOUNTS = [
  {
    platform: 'tiktok',
    displayName: '@zavod.mebel.ru',
    postingMethod: 'api',
    status: 'active',
    expiresAt: new Date(now + 45 * DAY),
    warmupStatus: 'ready',
    totalPostsPublished: 142,
    lastPostedAt: new Date(now - 3 * 60 * 60 * 1000),
    style: 'complete',
  },
  {
    platform: 'youtube',
    displayName: 'Завод мебели',
    postingMethod: 'api',
    status: 'active',
    expiresAt: new Date(now + 12 * DAY),
    warmupStatus: 'ready',
    totalPostsPublished: 64,
    lastPostedAt: new Date(now - 26 * 60 * 60 * 1000),
    style: 'partial',
  },
  {
    platform: 'instagram',
    displayName: '@zavod.mebel',
    postingMethod: 'browser_automation',
    status: 'active',
    expiresAt: null,
    warmupStatus: 'warming',
    totalPostsPublished: 18,
    lastPostedAt: null,
    style: null,
  },
  {
    platform: 'instagram',
    displayName: '@kuhni.optom',
    postingMethod: 'api',
    status: 'active',
    // Токен живёт меньше трёх суток — отметка ТКН становится жёлтой.
    expiresAt: new Date(now + 2 * DAY),
    warmupStatus: 'ready',
    totalPostsPublished: 97,
    lastPostedAt: new Date(now - 5 * 60 * 60 * 1000),
    style: 'complete',
  },
  {
    platform: 'tiktok',
    displayName: '@stoly.dv.shop',
    postingMethod: 'api',
    status: 'expired',
    expiresAt: new Date(now - 4 * DAY),
    warmupStatus: 'cold',
    totalPostsPublished: 31,
    lastPostedAt: new Date(now - 9 * DAY),
    style: 'partial',
  },
  {
    platform: 'instagram',
    displayName: '@mebel.spb.pro',
    postingMethod: 'api',
    status: 'revoked',
    expiresAt: new Date(now - 11 * DAY),
    warmupStatus: 'new',
    totalPostsPublished: 8,
    lastPostedAt: new Date(now - 12 * DAY),
    style: null,
  },
] as const

const STYLE_DATA = {
  tone: 'разговорный, без канцелярита',
  hashtagsCount: 3,
  leadMagnet: 'Чек-лист замера',
}

const created: Record<string, number> = {}

for (const acc of ACCOUNTS) {
  let account = await prisma.socialAccount.findFirst({
    where: { displayName: acc.displayName },
  })

  if (!account) {
    account = await prisma.socialAccount.create({
      data: {
        appId: app.id,
        platform: acc.platform as never,
        displayName: acc.displayName,
        status: acc.status as never,
        postingMethod: acc.postingMethod as never,
        expiresAt: acc.expiresAt,
        warmupStatus: acc.warmupStatus as never,
        totalPostsPublished: acc.totalPostsPublished,
        lastPostedAt: acc.lastPostedAt,
      },
    })
  }
  else {
    // Существующие три аккаунта из первой версии сида дополняем состояниями.
    account = await prisma.socialAccount.update({
      where: { id: account.id },
      data: {
        status: acc.status as never,
        expiresAt: acc.expiresAt,
        warmupStatus: acc.warmupStatus as never,
        totalPostsPublished: acc.totalPostsPublished,
        lastPostedAt: acc.lastPostedAt,
      },
    })
  }

  created[acc.displayName] = account.id

  if (acc.style) {
    const existingStyle = await prisma.accountStyleProfile.findUnique({
      where: { socialAccountId: account.id },
    })
    if (!existingStyle) {
      await prisma.accountStyleProfile.create({
        data: {
          socialAccountId: account.id,
          status: acc.style,
          version: 1,
          data: STYLE_DATA,
        },
      })
    }
  }
}

const GROUP_NAME = 'Мебель · RU'
let group = await prisma.accountGroup.findFirst({ where: { name: GROUP_NAME } })
if (!group) {
  group = await prisma.accountGroup.create({
    data: { appId: app.id, name: GROUP_NAME, dispatchMode: 'round_robin' },
  })
}

for (const name of ['@zavod.mebel.ru', 'Завод мебели', '@kuhni.optom']) {
  const socialAccountId = created[name]
  if (!socialAccountId) continue
  await prisma.accountGroupMember.upsert({
    where: { groupId_socialAccountId: { groupId: group.id, socialAccountId } },
    update: {},
    create: { groupId: group.id, socialAccountId },
  })
}

const total = await prisma.socialAccount.count()
console.log(JSON.stringify({ appId: app.id, accounts: total, groupId: group.id }))
await prisma.$disconnect()
