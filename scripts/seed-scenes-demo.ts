/**
 * Демо-данные раздела «Сцены» для проверки вёрстки глазами.
 *
 * Создаёт собранную сцену со всеми шестью типами блоков и эталонными кадрами
 * в трёх состояниях разбора (готов, идёт, упал), пустую сцену, сцену в
 * генерации и архивную — чтобы было что смотреть в списке и в композиторе.
 * Картинки — встроенные SVG в data-URI: объектного хранилища на тестовой
 * машине нет, а пустые рамки не показывают, как ведёт себя раскладка.
 *
 * Порядок: сначала `seed-characters-demo` — блок «Персонаж» ссылается на
 * реального персонажа, иначе селектор пустой.
 *
 * Использовать ТОЛЬКО на тестовой БД.
 *
 * Запуск:
 *   set -a && source ./.env.test && set +a && bun run scripts/seed-scenes-demo.ts
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../app/generated/prisma/client'

const connectionString = process.env.DATABASE_URL
  ?? 'postgresql://contentfactory_tests:contentfactory_tests_password@localhost:5436/contentfactory_tests_db'

if (!connectionString.includes('tests')) {
  throw new Error('[cf-seed-scenes] DATABASE_URL не указывает на тестовую базу. Прерываю.')
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

/** Плашка-заглушка вместо кадра: прямоугольник с подписью. */
function placeholder(label: string, bg: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="540" height="960">
    <rect width="540" height="960" fill="${bg}"/>
    <text x="270" y="490" font-family="sans-serif" font-size="42" fill="#ffffff"
      text-anchor="middle">${label}</text>
  </svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

async function main() {
  const app = await prisma.app.findFirst({ orderBy: { id: 'asc' } })
  if (!app) throw new Error('[cf-seed-scenes] нет ни одного приложения — сначала заведите его')

  const stamp = Date.now()

  const characters = await prisma.character.findMany({
    where: { appId: app.id, archived: false },
    orderBy: { createdAt: 'asc' },
    take: 2,
  })
  if (characters.length === 0) {
    throw new Error('[cf-seed-scenes] нет персонажей — сначала прогоните seed-characters-demo')
  }

  // Блок «Скрин экрана» ссылается на AppReferenceImage. Если скриншотов у
  // приложения нет, заводим один — без него блок нечем заполнить.
  let screen = await prisma.appReferenceImage.findFirst({ where: { appId: app.id } })
  if (!screen) {
    screen = await prisma.appReferenceImage.create({
      data: {
        appId: app.id,
        fileUrl: placeholder('экран приложения', '#2f3540'),
        sha1: `demo-screen-${stamp}`,
        mimeType: 'image/svg+xml',
        storageProvider: 'local',
        aiTags: ['dashboard', 'main_screen'],
        aiCaption: 'Главный экран приложения со списком заказов.',
        aiHasUI: true,
        aiPrimaryAction: 'Открыть заказ',
        aiAnalyzedAt: new Date(),
      },
    })
  }

  // 1. Собранная сцена: все шесть типов блоков.
  const full = await prisma.scene.create({
    data: {
      appId: app.id,
      name: 'Утро замерщика: выезд на объект',
      description: 'Ведущая выходит из машины, объясняет, зачем нужен замер, показывает приложение.',
      status: 'ready',
      tags: ['утро', 'выезд', 'демо'],
      blocks: [
        {
          id: `blk-char-${stamp}`,
          kind: 'character',
          characterId: characters[0]!.id,
          action: 'выходит из машины с планшетом',
          emotion: 'спокойная уверенность',
        },
        {
          id: `blk-style-${stamp}`,
          kind: 'style',
          visualStyle: 'cinematic, warm palette, soft grain',
          mood: 'бодрое утро',
          camera: 'medium shot, лёгкий следящий проезд',
        },
        {
          id: `blk-env-${stamp}`,
          kind: 'environment',
          location: 'двор частного дома, припаркованная машина',
          timeOfDay: 'раннее утро',
          lighting: 'мягкий боковой свет',
          weather: 'ясно, лёгкая дымка',
        },
        {
          id: `blk-act-${stamp}`,
          kind: 'action',
          description: 'Ведущая здоровается, открывает планшет и показывает список заказов.',
          dialog: 'Замер занимает двадцать минут — покажу, как это выглядит.',
        },
        {
          id: `blk-ctx-${stamp}`,
          kind: 'app_context',
          focus: 'заявка на замер оформляется в два экрана',
        },
        {
          id: `blk-screen-${stamp}`,
          kind: 'app_screen',
          referenceImageId: screen.id,
          intent: 'реакция на интерфейс',
        },
      ],
      promptCompiled: 'Characters: Маша (protagonist): 30y woman, short brown hair, grey work jacket, выходит из машины с планшетом. Action: Ведущая здоровается, открывает планшет. Environment: двор частного дома, раннее утро, мягкий боковой свет. Style: cinematic, warm palette, soft grain.',
      negativeCompiled: 'blurry, watermark, distorted hands',
    },
  })

  await prisma.sceneReferenceImage.createMany({
    data: [
      {
        sceneId: full.id,
        kind: 'mood',
        fileUrl: placeholder('настроение', '#3f3a2f'),
        sha1: `demo-mood-${stamp}`,
        mimeType: 'image/svg+xml',
        storageProvider: 'local',
        order: 0,
        aiTags: ['golden_hour', 'warm', 'outdoor'],
        aiCaption: 'Тёплое утреннее освещение, длинные тени.',
        aiVisualDescription: 'warm golden hour light, long soft shadows, hazy air, calm morning mood',
        aiAnalyzedAt: new Date(),
      },
      {
        sceneId: full.id,
        kind: 'shot',
        fileUrl: placeholder('композиция', '#2f3a3f'),
        sha1: `demo-shot-${stamp}`,
        mimeType: 'image/svg+xml',
        storageProvider: 'local',
        order: 1,
        aiTags: ['medium_shot', 'center_framing'],
        aiCaption: 'Средний план, героиня по центру кадра.',
        aiVisualDescription: 'medium shot, subject centered, shallow depth of field',
        aiAnalyzedAt: new Date(),
        generationPrompt: 'medium shot of a woman stepping out of a car in a suburban yard, warm morning light, cinematic',
        generationModel: 'fal-ai/flux/schnell',
        generationCostUsd: '0.003000',
      },
      {
        // Разбор ещё идёт — карточка показывает опрос.
        sceneId: full.id,
        kind: 'environment',
        fileUrl: placeholder('разбирается', '#3a2f3f'),
        sha1: `demo-pending-${stamp}`,
        mimeType: 'image/svg+xml',
        storageProvider: 'local',
        order: 2,
        aiTags: [],
      },
      {
        // Разбор упал — карточка показывает причину.
        sceneId: full.id,
        kind: 'other',
        fileUrl: placeholder('ошибка', '#3f2f2f'),
        sha1: `demo-failed-${stamp}`,
        mimeType: 'image/svg+xml',
        storageProvider: 'local',
        order: 3,
        aiTags: [],
        aiError: 'Модель не смогла описать кадр: изображение слишком тёмное.',
        aiAnalyzedAt: new Date(),
        aiAttempts: 2,
      },
    ],
  })

  // 2. Пустая сцена — проверка пустого состояния сборки.
  const empty = await prisma.scene.create({
    data: {
      appId: app.id,
      name: 'Черновик без блоков',
      description: 'Заведена, но ещё не собрана — сборщик показывает пустое состояние.',
      status: 'draft',
      tags: ['черновик'],
      blocks: [],
    },
  })

  // 3. Сцена в генерации — статус живёт своим бейджем.
  await prisma.scene.create({
    data: {
      appId: app.id,
      name: 'Вечерний монтаж: два героя в кадре',
      description: 'Диалог замерщика и монтажника, сцена уже ушла в генерацию.',
      status: 'generating',
      tags: ['диалог', 'вечер'],
      blocks: [
        {
          id: `blk-char2-${stamp}`,
          kind: 'character',
          characterId: (characters[1] ?? characters[0])!.id,
          action: 'закручивает крепёж, поглядывает в камеру',
        },
        {
          id: `blk-act2-${stamp}`,
          kind: 'action',
          description: 'Двое обсуждают, почему замер лучше делать до закупки материалов.',
        },
      ],
      promptCompiled: 'Characters: Игорь (support): 40y man, short beard. Action: Двое обсуждают замер до закупки материалов.',
    },
  })

  // 4. Сцена, из которой уже собран сценарий — если сценарии в базе есть.
  const scenario = await prisma.scenario.findFirst({ orderBy: { id: 'desc' } })
  if (scenario) {
    await prisma.scene.create({
      data: {
        appId: app.id,
        name: 'Готовая сцена со сценарием',
        description: 'Из этой сцены уже собран сценарий — в композиторе видна ссылка на него.',
        status: 'done',
        tags: ['готово'],
        blocks: [
          {
            id: `blk-act3-${stamp}`,
            kind: 'action',
            description: 'Финальный кадр: результат работы крупным планом.',
          },
        ],
        generatedScenarioId: scenario.id,
        promptCompiled: 'Action: Финальный кадр, результат работы крупным планом.',
      },
    })
  }

  // 5. Архивная сцена — видна только под фильтром «Показать архив».
  await prisma.scene.create({
    data: {
      appId: app.id,
      name: 'Старая заставка (архив)',
      description: 'Убрана в архив: сменили тон роликов.',
      status: 'draft',
      archived: true,
      tags: ['архив'],
      blocks: [],
    },
  })

  const total = await prisma.scene.count({ where: { appId: app.id } })
  console.log(`[cf-seed-scenes] готово, сцен: ${total}.`)
  console.log(`[cf-seed-scenes] собранная: /scenes/${full.id}`)
  console.log(`[cf-seed-scenes] пустая:     /scenes/${empty.id}`)
}

main()
  .catch((err) => {
    console.error('[cf-seed-scenes]', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
