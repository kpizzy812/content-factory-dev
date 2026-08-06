/**
 * Учётка для проверки стенда глазами.
 *
 * MarketingCamp на стенде не подключён, а без пользователя не работает ни
 * `/api/dev/set-session`, ни вход по паролю — то есть открыть нельзя ни одну
 * страницу. Раньше эта строка заводилась руками и пропадала после первого же
 * прогона DB-тестов (`TRUNCATE` всей схемы), поэтому она здесь.
 *
 * Использовать ТОЛЬКО на тестовой БД.
 *
 * Запуск:
 *   bun run scripts/seed-dev-user.ts
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../app/generated/prisma/client'
import { hashPassword } from '../server/utils/auth/password'
import { ALL_MODULES_LIST, ROLE_PRESETS } from '../server/utils/rbac-presets'

const connectionString = process.env.DATABASE_URL
  ?? 'postgresql://contentfactory_tests:contentfactory_tests_password@localhost:5436/contentfactory_tests_db'

if (!connectionString.includes('tests')) {
  throw new Error('[cf-seed-user] DATABASE_URL не указывает на тестовую базу. Прерываю.')
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

const EMAIL = 'dev@contentfactory.local'
const PASSWORD = 'frontend-rebuild-dev-2026'

const permissions = ROLE_PRESETS.admin

const user = await prisma.zavodUser.upsert({
  where: { email: EMAIL },
  update: {
    ...permissions,
    rolePreset: 'admin',
    moduleAccess: ALL_MODULES_LIST,
    isActive: true,
  },
  create: {
    externalId: 1,
    email: EMAIL,
    name: 'Стенд',
    surname: 'Разработки',
    passwordHash: await hashPassword(PASSWORD),
    rolePreset: 'admin',
    roleName: 'Администратор',
    rolePresetName: 'admin',
    moduleAccess: ALL_MODULES_LIST,
    ...permissions,
  },
})

// Приложение — общий контекст для трендов, сценариев, персонажей и циклов:
// половина сидов ищет первое приложение в базе и падает без него.
const appCount = await prisma.app.count()
if (appCount === 0) {
  const app = await prisma.app.create({
    data: {
      name: 'Мебельный цех',
      description: 'Кухни и шкафы на заказ, замер и сборка за неделю',
      keywords: ['мебель', 'кухни', 'шкаф в нишу'],
      brandTone: 'дружелюбный, без канцелярита',
      corePain: 'готовая мебель не встаёт в кривые стены',
      transformationPromise: 'ниша закрывается за неделю, без зазоров',
      forbiddenClaims: ['гарантия результата', 'медицинские заявления'],
    },
  })
  console.log(`[cf-seed-user] заведено приложение #${app.id} «${app.name}»`)
}

console.log(`[cf-seed-user] пользователь #${user.id} ${EMAIL}, пароль ${PASSWORD}`)

await prisma.$disconnect()
