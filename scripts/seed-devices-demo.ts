/**
 * Демо-данные унаследованной зоны «Устройства» для проверки вёрстки глазами.
 *
 * Заводит профили в разных состояниях: синхронизированный с прокси и
 * аккаунтами, запущенный прямо сейчас, локальный без облака, с ошибкой
 * синхронизации и без прокси (запуск заблокирован).
 *
 * Зона включается флагом `LEGACY_DEVICE_AUTOMATION_ENABLED=true` — без него её
 * API отдаёт 404 и страницы честно пишут, что зона выключена.
 *
 * Использовать ТОЛЬКО на тестовой БД.
 *
 * Запуск:
 *   set -a && source ./.env.test && set +a && bun run scripts/seed-devices-demo.ts
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../app/generated/prisma/client'
import { encryptSecret } from '../server/utils/crypto'

const connectionString = process.env.DATABASE_URL
  ?? 'postgresql://contentfactory_tests:contentfactory_tests_password@localhost:5436/contentfactory_tests_db'

if (!connectionString.includes('tests')) {
  throw new Error('[cf-seed-devices] DATABASE_URL не указывает на тестовую базу. Прерываю.')
}

if (!process.env.ENCRYPTION_KEY) {
  throw new Error('[cf-seed-devices] нет ENCRYPTION_KEY — адрес и доступы прокси нечем шифровать.')
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

async function main() {
  const stamp = Date.now()

  const owner = await prisma.zavodUser.findFirst({ orderBy: { id: 'asc' } })
  if (!owner) throw new Error('[cf-seed-devices] в базе нет пользователей — прокси не на кого записать')

  // Прокси нужен двум профилям: без него запуск заблокирован, и это отдельное
  // состояние карточки.
  //
  // Адрес и доступы хранятся зашифрованными: DTO списка прокси их расшифровывает,
  // и на открытом тексте `GET /api/proxies` падает с «Неверный формат
  // зашифрованных данных» — вся зона прокси при этом недоступна.
  const usProxy = await prisma.proxy.create({
    data: {
      label: `US резидентный ${stamp % 1000}`,
      type: 'residential',
      host: encryptSecret('198.51.100.20'),
      port: 8080,
      username: encryptSecret('demo'),
      password: encryptSecret('demo'),
      status: 'healthy',
      expectedCountry: 'US',
      expectedCity: 'New York',
      createdById: owner.id,
    },
  })

  const deadProxy = await prisma.proxy.create({
    data: {
      label: `DE мёртвый ${stamp % 1000}`,
      type: 'datacenter',
      host: encryptSecret('203.0.113.9'),
      port: 3128,
      status: 'dead',
      expectedCountry: 'DE',
      createdById: owner.id,
    },
  })

  // 1. Синхронизирован, остановлен, есть прокси и аккаунты.
  const synced = await prisma.deviceProfile.create({
    data: {
      name: 'US-01 · основной',
      indigoId: `demo-cloud-${stamp}`,
      indigoFolderId: `demo-folder-${stamp}`,
      platformType: 'mobile_android',
      os: 'Android 13',
      // Значения берутся из shared/data/device-presets — иначе селект в форме
      // покажет пустоту: значения вне списка в нём нет.
      screenResolution: '412x915',
      language: 'en-US',
      timezone: 'America/New_York',
      proxyId: usProxy.id,
      syncStatus: 'synced',
      lastSyncedAt: new Date(),
      totalSessions: 12,
      lastSessionStartedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      lastSessionEndedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      notes: 'Прогрет вручную, публикует утром.',
      tags: ['us', 'instagram', 'основной'],
      config: {
        duoplus: {
          deviceStatus: 2,
          adbAddress: null,
          area: 'US-East',
          size: '412x915',
        },
      },
    },
  })

  // Привязываем аккаунт, если он есть в базе: иначе блок аккаунтов пустой.
  // Схема допускает одну строку на профиль (@@unique([profileId])), поэтому
  // привязываем ровно один и делаем его основным.
  const account = await prisma.socialAccount.findFirst({
    where: { deviceProfileId: null },
    orderBy: { id: 'asc' },
  })
  if (account) {
    await prisma.deviceProfileAccount.create({
      data: { profileId: synced.id, socialAccountId: account.id, isPrimary: true },
    })
    await prisma.deviceProfile.update({
      where: { id: synced.id },
      data: { socialAccountId: account.id },
    })
  }

  // 2. Запущен прямо сейчас, с портом WebDriver.
  const running = await prisma.deviceProfile.create({
    data: {
      name: 'US-02 · запущен',
      indigoId: `demo-cloud-run-${stamp}`,
      platformType: 'desktop',
      os: 'Windows 11',
      screenResolution: '1920x1080',
      language: 'en-US',
      timezone: 'America/Chicago',
      proxyId: usProxy.id,
      syncStatus: 'synced',
      lastSyncedAt: new Date(),
      totalSessions: 4,
      lastSessionStartedAt: new Date(Date.now() - 20 * 60 * 1000),
      lastSessionEndedAt: null,
      lastSessionPort: 9515,
      tags: ['us', 'прогрев'],
      config: {
        duoplus: {
          deviceStatus: 1,
          adbAddress: '127.0.0.1:5555',
          area: 'US-Central',
          size: '1920x1080',
        },
      },
    },
  })

  // 3. Локальный: в облако не запушен, запускать нечего.
  await prisma.deviceProfile.create({
    data: {
      name: 'Черновик без облака',
      platformType: 'mobile_ios',
      os: 'iOS 17',
      screenResolution: '1170x2532',
      proxyId: usProxy.id,
      syncStatus: 'local_only',
      tags: ['черновик'],
    },
  })

  // 4. Ошибка последней синхронизации — сообщение видно в шапке профиля.
  await prisma.deviceProfile.create({
    data: {
      name: 'DE-01 · конфликт',
      indigoId: `demo-cloud-err-${stamp}`,
      platformType: 'desktop',
      os: 'Windows 10',
      proxyId: deadProxy.id,
      syncStatus: 'conflict',
      lastSyncedAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
      lastSyncError: 'Облако вернуло 409: профиль изменён на другой стороне.',
      totalSessions: 2,
      tags: ['de'],
      config: { duoplus: { deviceStatus: 12, adbAddress: null, area: 'EU-West', size: '1920x1080' } },
    },
  })

  // 5. Без прокси: старт заблокирован, чтобы не утёк реальный адрес.
  await prisma.deviceProfile.create({
    data: {
      name: 'Без прокси',
      indigoId: `demo-cloud-noproxy-${stamp}`,
      platformType: 'desktop',
      syncStatus: 'synced',
      lastSyncedAt: new Date(),
      tags: [],
    },
  })

  const total = await prisma.deviceProfile.count()
  console.log(`[cf-seed-devices] готово, профилей: ${total}.`)
  console.log(`[cf-seed-devices] синхронизированный: /devices/${synced.id}`)
  console.log(`[cf-seed-devices] запущенный:         /devices/${running.id}`)
}

main()
  .catch((err) => {
    console.error('[cf-seed-devices]', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
