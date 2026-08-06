/**
 * Демо-данные разделов «Персонажи» и «Сцены» для проверки вёрстки глазами.
 *
 * Создаёт персонажей с референс-фото в трёх состояниях разбора (готов, идёт,
 * упал) и сцену композитора с блоками. Картинки — встроенные SVG в data-URI:
 * объектного хранилища на тестовой машине нет, а пустые рамки не показывают,
 * как раскладка ведёт себя с реальным изображением.
 *
 * Использовать ТОЛЬКО на тестовой БД.
 *
 * Запуск:
 *   set -a && source ./.env.test && set +a && bun run scripts/seed-characters-demo.ts
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../app/generated/prisma/client'

const connectionString = process.env.DATABASE_URL
  ?? 'postgresql://contentfactory_tests:contentfactory_tests_password@localhost:5436/contentfactory_tests_db'

if (!connectionString.includes('tests')) {
  throw new Error('[cf-seed-characters] DATABASE_URL не указывает на тестовую базу. Прерываю.')
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

/** Плашка-заглушка вместо фото: нейтральный прямоугольник с подписью. */
function placeholder(label: string, bg: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
    <rect width="512" height="512" fill="${bg}"/>
    <text x="256" y="270" font-family="sans-serif" font-size="34" fill="#ffffff"
      text-anchor="middle">${label}</text>
  </svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

async function main() {
  const app = await prisma.app.findFirst({ orderBy: { id: 'asc' } })
  if (!app) throw new Error('[cf-seed-characters] нет ни одного приложения — сначала заведите его')

  const stamp = Date.now()

  // 1. Персонаж с разобранными фото.
  const masha = await prisma.character.create({
    data: {
      appId: app.id,
      name: 'Маша, замерщик',
      role: 'protagonist',
      description: 'Тридцать лет, короткая стрижка, спокойная манера, говорит по делу.',
      visualPrompt: '30y woman, short brown hair, grey work jacket, calm confident face',
      emotionDefault: 'calm',
      ageRange: '28-32',
      tags: ['замерщик', 'ведущая', 'спецодежда'],
    },
  })

  await prisma.characterReferenceImage.createMany({
    data: [
      {
        characterId: masha.id,
        kind: 'face',
        fileUrl: placeholder('лицо', '#3f3a2f'),
        sha1: `demo-face-${stamp}`,
        mimeType: 'image/svg+xml',
        order: 0,
        aiTags: ['short_hair', 'adult_woman', 'neutral_background'],
        aiCaption: 'Женщина около тридцати, короткие тёмные волосы, нейтральный фон.',
        aiVisualDescription: '30y woman, short dark hair, neutral studio background, soft light',
        aiAnalyzedAt: new Date(),
      },
      {
        characterId: masha.id,
        kind: 'outfit',
        fileUrl: placeholder('одежда', '#2f3a3f'),
        sha1: `demo-outfit-${stamp}`,
        mimeType: 'image/svg+xml',
        order: 1,
        aiTags: ['grey_jacket', 'workwear'],
        aiCaption: 'Серая рабочая куртка поверх футболки.',
        aiAnalyzedAt: new Date(),
        generationPrompt: 'grey work jacket over white t-shirt, studio light, full body',
        generationModel: 'fal-ai/flux/schnell',
      },
      {
        // Разбор ещё идёт — карточка показывает опрос.
        characterId: masha.id,
        kind: 'face',
        fileUrl: placeholder('разбирается', '#3a2f3f'),
        sha1: `demo-pending-${stamp}`,
        mimeType: 'image/svg+xml',
        order: 2,
        aiTags: [],
      },
      {
        // Разбор упал — карточка показывает причину.
        characterId: masha.id,
        kind: 'other',
        fileUrl: placeholder('ошибка', '#3f2f2f'),
        sha1: `demo-failed-${stamp}`,
        mimeType: 'image/svg+xml',
        order: 3,
        aiTags: [],
        aiError: 'Модель не увидела лица на изображении.',
        aiAnalyzedAt: new Date(),
        aiAttempts: 2,
      },
    ],
  })

  // 2. Второстепенные персонажи — для навигации по соседям.
  await prisma.character.createMany({
    data: [
      {
        appId: app.id,
        name: 'Игорь, монтажник',
        role: 'support',
        description: 'Сорок лет, борода, немногословный, работает руками в кадре.',
        visualPrompt: '40y man, short beard, dark hoodie, focused',
        ageRange: '38-45',
        tags: ['монтажник'],
      },
      {
        appId: app.id,
        name: 'Клиент в кадре',
        role: 'extra',
        description: 'Появляется на пять секунд в финале, реагирует на результат.',
        tags: ['массовка'],
      },
      {
        appId: app.id,
        name: 'Старый ведущий',
        role: 'protagonist',
        description: 'Отправлен в архив: сменили тон роликов.',
        archived: true,
        tags: ['архив'],
      },
    ],
  })

  const total = await prisma.character.count({ where: { appId: app.id } })
  console.log(`[cf-seed-characters] готово, персонажей: ${total}. Полный: /characters/${masha.id}`)
}

main()
  .catch((err) => {
    console.error('[cf-seed-characters]', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
