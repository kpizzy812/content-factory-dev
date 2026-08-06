/**
 * Демо-данные Telegram: чаты, шаблоны, ключи, доставки и аудит.
 *
 * Шесть вкладок админки нечем было проверить глазами — в базе не было ни
 * одного чата, и все они показывали пустое состояние. Здесь состояния, из-за
 * которых на эти вкладки заходят: чат без прав, доставка, которая не дошла,
 * ключ с истекающим сроком, команда от неавторизованного.
 *
 * Использовать ТОЛЬКО на тестовой БД.
 *
 * Запуск:
 *   bun run scripts/seed-telegram-demo.ts
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../app/generated/prisma/client'

const connectionString = process.env.DATABASE_URL
  ?? 'postgresql://contentfactory_tests:contentfactory_tests_password@localhost:5436/contentfactory_tests_db'

if (!connectionString.includes('tests')) {
  throw new Error('[cf-seed-telegram] DATABASE_URL не указывает на тестовую базу. Прерываю.')
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

const MIN = 60_000
const HOUR = 60 * MIN
const now = Date.now()
const at = (offsetMs: number) => new Date(now - offsetMs)

const user = await prisma.zavodUser.findFirst({ orderBy: { id: 'asc' } })

// Повторный прогон не плодит записи.
await prisma.telegramCommandAudit.deleteMany({})
await prisma.telegramDelivery.deleteMany({})
await prisma.telegramChat.deleteMany({})
await prisma.telegramMessageTemplate.deleteMany({})
await prisma.telegramApiKey.deleteMany({})

// ── Чаты ──────────────────────────────────────────────────────────────────
const chats = await Promise.all([
  prisma.telegramChat.create({
    data: {
      chatId: '-1001923445566',
      chatType: 'supergroup',
      title: 'Цех · производство',
      alertsEnabled: true,
      isAuthorized: true,
      routingTags: [],
      userId: user?.id ?? null,
      createdAt: at(30 * 24 * HOUR),
    },
  }),
  prisma.telegramChat.create({
    data: {
      chatId: '-1001777001122',
      chatType: 'channel',
      title: 'Только аварии',
      username: 'zavod_alerts',
      alertsEnabled: true,
      isAuthorized: true,
      routingTags: ['critical_error'],
      createdAt: at(12 * 24 * HOUR),
    },
  }),
  prisma.telegramChat.create({
    data: {
      chatId: '448273910',
      chatType: 'private',
      title: null,
      username: 'd_kuznetsov',
      alertsEnabled: false,
      isAuthorized: true,
      routingTags: ['cycle_started', 'video_complete'],
      userId: user?.id ?? null,
      createdAt: at(5 * 24 * HOUR),
    },
  }),
  prisma.telegramChat.create({
    data: {
      chatId: '-4102938471',
      chatType: 'group',
      title: 'Подрядчики (не подтверждён)',
      alertsEnabled: true,
      isAuthorized: false,
      routingTags: [],
      createdAt: at(2 * HOUR),
    },
  }),
])

// ── Шаблоны ───────────────────────────────────────────────────────────────
const templates = await Promise.all([
  prisma.telegramMessageTemplate.create({
    data: {
      key: 'run_finished',
      title: 'Запуск конвейера завершён',
      category: 'notification',
      messageBody: 'Конвейер «{{pipelineName}}» отработал.\nРоликов готово: {{videosCount}}, публикаций: {{uploadsCount}}.',
      variablesSchema: {
        pipelineName: 'Название конвейера',
        videosCount: 'Сколько роликов вышло',
        uploadsCount: 'Сколько публикаций поставлено',
      },
      isActive: true,
    },
  }),
  prisma.telegramMessageTemplate.create({
    data: {
      key: 'critical_error',
      title: 'Авария на заводе',
      category: 'alert',
      messageBody: 'Запуск #{{runId}} конвейера «{{pipelineName}}» упал.\nПричина: {{errorMessage}}',
      variablesSchema: {
        runId: 'Номер запуска',
        pipelineName: 'Название конвейера',
        errorMessage: 'Текст ошибки',
      },
      isActive: true,
    },
  }),
  prisma.telegramMessageTemplate.create({
    data: {
      key: 'weekly_report',
      title: 'Итоги недели',
      category: 'report',
      // Намеренно с переменной не из реестра: так виден разбор предупреждения
      // «такой переменной нет — подставлена не будет».
      messageBody: 'За неделю: {{videosCount}} роликов, {{revenue}} выручки.',
      variablesSchema: { videosCount: 'Роликов', revenue: 'Выручка' },
      isActive: false,
    },
  }),
])

// ── Ключи ─────────────────────────────────────────────────────────────────
await prisma.telegramApiKey.createMany({
  data: [
    {
      key: 'tgk_9f2c41ab7d3e4f5a8b6c0d1e2f3a4b5c',
      label: 'Сборка CI — уведомления о деплое',
      isActive: true,
      createdAt: at(60 * 24 * HOUR),
      lastUsedAt: at(3 * HOUR),
    },
    {
      key: 'tgk_1a2b3c4d5e6f7081920a1b2c3d4e5f60',
      label: 'Внешний планировщик подрядчика',
      isActive: true,
      createdAt: at(20 * 24 * HOUR),
      lastUsedAt: at(9 * 24 * HOUR),
      expiresAt: new Date(now + 6 * 24 * HOUR),
    },
    {
      key: 'tgk_deadbeef00112233445566778899aabb',
      label: 'Старый бот поддержки',
      isActive: false,
      createdAt: at(180 * 24 * HOUR),
      lastUsedAt: at(120 * 24 * HOUR),
    },
  ],
})

// ── Доставки ──────────────────────────────────────────────────────────────
const deliveries = [
  {
    templateId: templates[0]!.id,
    eventType: 'cycle_started',
    targetChatId: chats[0]!.chatId,
    status: 'sent' as const,
    telegramMessageId: 40218,
    messageText: 'Конвейер «Тренд → сценарий → видео → Reels» отработал за 31 м 12 с.\nРоликов готово: 12.',
    sentAt: at(40 * MIN),
    createdAt: at(40 * MIN),
    relatedEntityType: 'cycle',
    relatedEntityId: 1,
  },
  {
    templateId: templates[1]!.id,
    eventType: 'critical_error',
    targetChatId: chats[1]!.chatId,
    status: 'failed' as const,
    errorMessage: 'Forbidden: bot was kicked from the channel chat',
    messageText: 'Запуск #7 упал на шаге «Публикация».\nПричина: Instagram Graph API 401 invalid_token',
    createdAt: at(2 * HOUR),
    relatedEntityType: 'cycle',
    relatedEntityId: 2,
  },
  {
    templateId: null,
    eventType: 'test',
    targetChatId: chats[0]!.chatId,
    status: 'sent' as const,
    telegramMessageId: 40190,
    messageText: 'Тестовое сообщение из панели администратора',
    sentAt: at(6 * HOUR),
    createdAt: at(6 * HOUR),
  },
  {
    templateId: templates[1]!.id,
    eventType: 'critical_error',
    targetChatId: chats[3]!.chatId,
    status: 'failed' as const,
    errorMessage: 'Bad Request: chat not found',
    messageText: 'Запуск #5 завершился без данных.',
    createdAt: at(20 * HOUR),
  },
  {
    templateId: templates[0]!.id,
    eventType: 'upload_success',
    targetChatId: chats[2]!.chatId,
    status: 'pending' as const,
    messageText: 'Публикация ушла в @zavod.mebel.ru',
    createdAt: at(9 * MIN),
  },
]

for (const delivery of deliveries) {
  await prisma.telegramDelivery.create({ data: delivery as never })
}

// ── Аудит команд ──────────────────────────────────────────────────────────
const audits = [
  {
    chatId: chats[0]!.chatId,
    telegramUserId: '448273910',
    telegramUsername: 'd_kuznetsov',
    command: '/status',
    resultStatus: 'success',
    createdAt: at(25 * MIN),
  },
  {
    chatId: chats[0]!.chatId,
    telegramUserId: '448273910',
    telegramUsername: 'd_kuznetsov',
    command: '/start_cycle',
    parsedArgs: 'appId=1',
    resultStatus: 'success',
    relatedEntityType: 'cycle',
    relatedEntityId: 2,
    createdAt: at(3 * HOUR),
  },
  {
    chatId: chats[3]!.chatId,
    telegramUserId: '772811993',
    telegramUsername: null,
    command: '/stop',
    resultStatus: 'unauthorized',
    errorMessage: 'Чат не привязан к учётной записи завода',
    createdAt: at(2 * HOUR),
  },
  {
    chatId: chats[2]!.chatId,
    telegramUserId: '448273910',
    telegramUsername: 'd_kuznetsov',
    command: 'video_url',
    parsedArgs: 'https://www.tiktok.com/@zavod.mebel/video/7382…',
    resultStatus: 'error',
    errorMessage: 'Источник вернул 403 — ролик закрыт настройками автора',
    createdAt: at(28 * HOUR),
  },
  {
    chatId: chats[2]!.chatId,
    telegramUserId: '448273910',
    telegramUsername: 'd_kuznetsov',
    command: '/link',
    parsedArgs: 'dev@contentfactory.local',
    resultStatus: 'success',
    createdAt: at(5 * 24 * HOUR),
  },
]

for (const audit of audits) {
  await prisma.telegramCommandAudit.create({ data: audit as never })
}

console.log(
  `[cf-seed-telegram] готово: чатов ${chats.length}, шаблонов ${templates.length}, `
  + `ключей 3, доставок ${deliveries.length}, записей аудита ${audits.length}`,
)

await prisma.$disconnect()
