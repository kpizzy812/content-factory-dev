/**
 * Демо-данные раздела «Идеи» для проверки вёрстки глазами.
 *
 * Создаёт идеи во всех состояниях, которые различает интерфейс: разобранная с
 * глубоким анализом и разбором референса, разбирающаяся прямо сейчас, упавшая,
 * пришедшая из MarketingCamp с конфликтом синхронизации, и десяток обычных —
 * чтобы работали навигация по соседям и пагинация.
 *
 * Использовать ТОЛЬКО на тестовой БД.
 *
 * Запуск:
 *   set -a && source ./.env.test && set +a && bun run scripts/seed-ideas-demo.ts
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../app/generated/prisma/client'

const connectionString = process.env.DATABASE_URL
  ?? 'postgresql://contentfactory_tests:contentfactory_tests_password@localhost:5436/contentfactory_tests_db'

if (!connectionString.includes('tests')) {
  throw new Error('[cf-seed-ideas] DATABASE_URL не указывает на тестовую базу. Прерываю.')
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

const ANALYSIS = {
  summary: 'Ролик держится на обещании «за один день» и показывает результат в первые три секунды.',
  modelVersion: 'anthropic/claude-sonnet',
  promptVersion: '3',
  confidence: 0.82,
  hookAnalysis: {
    type: 'обещание результата',
    description: 'Первый кадр показывает готовый шкаф, голос называет срок. Зритель остаётся ради проверки обещания.',
    strength: 78,
    emotionalTrigger: 'недоверие',
    textOnScreen: 'Собрали за 1 день',
  },
  sceneStructure: {
    estimatedDuration: '32 с',
    narrativeArc: 'проблема → работа → результат',
    pacingNotes: 'Первые 5 секунд без монтажных склеек, дальше — короткие врезки.',
    scenes: [
      { order: 1, name: 'Ниша', description: 'Пустая ниша, рулетка, замер.', estimatedDuration: '6 с', purpose: 'показать исходную проблему' },
      { order: 2, name: 'Сборка', description: 'Раскрой и монтаж на ускоренной съёмке.', estimatedDuration: '18 с', purpose: 'доказать скорость' },
      { order: 3, name: 'Итог', description: 'Готовый шкаф, дверь закрывается заподлицо.', estimatedDuration: '8 с', purpose: 'закрыть обещание' },
    ],
  },
  visualStyle: {
    colorTone: 'тёплый, с деревянными полутонами',
    lighting: 'дневной свет из окна, без досветки',
    cameraWork: 'с рук, короткие проезды',
    aesthetic: 'документальная съёмка',
    textOverlays: true,
    effects: ['таймлапс', 'подписи-стикеры'],
  },
  viralityReasons: {
    primaryReason: 'Проверяемое обещание с конкретным сроком.',
    targetAudience: 'Владельцы квартир 30–45 лет в ремонте',
    replicability: 74,
    replicabilityNotes: 'Схема переносится на любую мебель под заказ, если есть съёмка процесса.',
    factors: [
      { factor: 'Срок в кадре', description: 'Цифра «1 день» звучит в первые две секунды.', impact: 'high' },
      { factor: 'Таймлапс сборки', description: 'Показывает труд, а не только результат.', impact: 'medium' },
      { factor: 'Отсутствие музыки поверх речи', description: 'Речь читается без субтитров.', impact: 'low' },
    ],
  },
}

const REFERENCE_BREAKDOWN = {
  confidence: 0.76,
  mediaType: 'video',
  dataAvailability: {
    hasTranscript: true,
    hasTimedSegments: true,
    hasThumbnail: false,
    hasDescription: true,
    metadataRichness: 'moderate',
  },
  abstractedPatterns: [
    {
      name: 'Обещание с числом',
      category: 'hook',
      abstractDescription: 'Хук называет измеримую величину, которую ролик потом подтверждает.',
      applicationGuide: 'Взять любую проверяемую цифру своего процесса — срок, цену, количество.',
      strength: 84,
    },
    {
      name: 'Труд крупным планом',
      category: 'visual',
      abstractDescription: 'Между обещанием и результатом стоит видимая работа.',
      applicationGuide: 'Снять 3–4 плана процесса, даже если он рутинный.',
      strength: 67,
    },
  ],
  sceneTimeline: [
    {
      order: 1,
      startMarker: '0:00',
      duration: '6 с',
      action: 'Замер ниши рулеткой',
      purpose: 'обозначить исходную задачу',
      onScreenText: 'Ниша 180 см',
      visualCues: 'пустая стена, рулетка',
      emotionalTone: 'деловой',
      cameraWork: 'статичный план',
    },
    {
      order: 2,
      startMarker: '0:06',
      duration: '18 с',
      action: 'Таймлапс раскроя и сборки',
      purpose: 'доказать заявленный срок',
      onScreenText: null,
      visualCues: 'стружка, шуруповёрт',
      emotionalTone: 'энергичный',
      cameraWork: 'ускоренная съёмка',
    },
  ],
  narrativeMechanics: {
    hookType: 'обещание результата',
    hookDescription: 'Готовый результат показан раньше процесса.',
    bodyMechanic: 'Процесс подан ускоренно и без пояснений — работает как доказательство.',
    ctaMechanic: 'Мягкий призыв за материалом в закреплённом сообщении.',
    emotionalArc: ['недоверие', 'интерес', 'удовлетворение'],
    pacing: 'быстрый после шестой секунды',
    narrativeTemplate: 'transformation',
    transformationArc: 'пустая ниша → встроенный шкаф',
  },
  visualPatterns: {
    colorPalette: ['#c9a227', '#3f2d1e', '#f2ede4'],
    lighting: 'дневной свет из окна',
    cameraStyle: 'съёмка с рук',
    composition: 'объект по центру, воздух сверху',
    textOverlayStyle: 'крупные подписи внизу кадра',
    aesthetic: 'документальная',
    effects: ['таймлапс'],
  },
  originalityGuide: {
    safeToReuse: ['Схема «обещание → процесс → результат»', 'Таймлапс монтажа'],
    mustTransform: ['Дословный текст хука', 'Порядок и длительность врезок'],
    requireOriginal: ['Съёмка своего объекта'],
    transformationSuggestions: [
      'Заменить срок на свою проверяемую величину.',
      'Дать голос мастера вместо закадрового текста.',
    ],
    targetOriginalityScore: 0.7,
  },
  transcript: {
    fullText: 'Ниша сто восемьдесят сантиметров. Замер, раскрой, сборка — за один день. Смотрите, что получилось.',
    segments: [
      { start: 0, duration: 3, text: 'Ниша сто восемьдесят сантиметров.' },
      { start: 3, duration: 5, text: 'Замер, раскрой, сборка — за один день.' },
      { start: 24, duration: 4, text: 'Смотрите, что получилось.' },
    ],
    source: 'whisper',
    language: 'ru',
  },
}

async function main() {
  const existing = await prisma.idea.count()
  if (existing > 0) {
    console.log(`[cf-seed-ideas] в базе уже ${existing} идей — добавляю ещё, дубли не страшны`)
  }

  // 1. Разобранная идея с глубоким разбором и разбором референса.
  const full = await prisma.idea.create({
    data: {
      source: 'manual',
      sourceUrl: 'https://www.tiktok.com/@zavod.mebel/video/589144823276',
      platform: 'tiktok',
      mediaType: 'video',
      status: 'ready',
      analysisStatus: 'completed',
      referenceStatus: 'completed',
      title: 'Шкаф в нишу за один день',
      hook: 'Ниша шириной 180 см — и мебельщики называют цену как за кухню.',
      body: 'Показываем замер, раскрой и сборку за один день.\nБез скрытых доплат и без «привезём через месяц».',
      cta: 'Заберите чек-лист замера в закреплённом сообщении.',
      visualStyle: 'Тёплый дневной свет, живая камера с рук, крупные планы фурнитуры.',
      whyViral: 'Обещание проверяется прямо в ролике: срок назван в первые секунды и подтверждён таймлапсом.',
      operatorNotes: 'Снять свою версию на объекте в Химках. Нужен доступ на площадку в будни.',
      tags: ['мебель', 'до-после', 'таймлапс'],
      transcription: 'Ниша сто восемьдесят сантиметров. Замер, раскрой, сборка — за один день.',
      language: 'ru',
    },
  })

  await prisma.ideaAnalysis.create({
    data: {
      ideaId: full.id,
      ...ANALYSIS,
      referenceBreakdown: REFERENCE_BREAKDOWN,
      referenceVersion: '2',
    },
  })

  await prisma.ideaOperatorAction.createMany({
    data: [
      { ideaId: full.id, actionType: 'create', reason: null },
      { ideaId: full.id, actionType: 'edit', reason: 'Поправил хук под свою аудиторию' },
      { ideaId: full.id, actionType: 'reanalyze', reason: 'Первый разбор промахнулся с аудиторией' },
    ],
  })

  // 2. Разбирается прямо сейчас — видно прогресс разбора референса.
  await prisma.idea.create({
    data: {
      source: 'telegram',
      sourceUrl: 'https://www.instagram.com/reel/C8xQ1a2bZzz/',
      platform: 'instagram',
      mediaType: 'video',
      status: 'processing',
      analysisStatus: 'running',
      referenceStatus: 'running',
      analysisProgress: JSON.stringify({
        stage: 'analyzing_frames',
        framesDone: 7,
        framesTotal: 12,
        elapsedSec: 96,
      }),
      title: 'Кухня без верхних шкафов',
      tags: ['кухня'],
    },
  })

  // 3. Упавшая — интерфейс должен показать причину.
  await prisma.idea.create({
    data: {
      source: 'manual',
      sourceUrl: 'https://www.youtube.com/shorts/broken-link',
      platform: 'youtube',
      status: 'failed',
      analysisStatus: 'failed',
      referenceStatus: 'failed',
      errorMessage: 'Не удалось скачать медиа: источник ответил 403.',
      title: null,
    },
  })

  // 4. Пришла из MarketingCamp и разошлась с ним — вкладка синхронизации.
  await prisma.idea.create({
    data: {
      source: 'marketingcamp',
      externalId: 90210,
      syncStatus: 'conflict',
      syncDirection: 'bidirectional',
      lastSyncedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      lastSyncError: 'Запись изменена с обеих сторон после последней синхронизации.',
      localDirty: true,
      remoteSnapshot: {
        id: 90210,
        title: 'Гардеробная из кладовки',
        tags: ['гардеробная'],
        updatedAt: '2026-08-05T19:12:00.000Z',
      },
      platform: 'tiktok',
      status: 'ready',
      analysisStatus: 'none',
      title: 'Гардеробная из кладовки',
      hook: 'Кладовка 1,2 м² — и в ней помещается весь зимний гардероб.',
      tags: ['гардеробная', 'хранение'],
    },
  })

  // 5. Фон для пагинации и навигации по соседям.
  const PLATFORMS = ['tiktok', 'instagram', 'youtube'] as const
  for (let i = 1; i <= 12; i++) {
    await prisma.idea.create({
      data: {
        source: i % 3 === 0 ? 'pipeline' : 'manual',
        platform: PLATFORMS[i % 3],
        mediaType: i % 4 === 0 ? 'image' : 'video',
        status: i % 5 === 0 ? 'in_work' : 'ready',
        analysisStatus: i % 2 === 0 ? 'completed' : 'none',
        title: `Идея для проверки вёрстки ${i}`,
        hook: 'Короткий хук для строки списка.',
        tags: i % 2 === 0 ? ['фон'] : [],
      },
    })
  }

  const total = await prisma.idea.count()
  console.log(`[cf-seed-ideas] готово, идей в базе: ${total}. Полная идея: /ideas/${full.id}`)
}

main()
  .catch((err) => {
    console.error('[cf-seed-ideas]', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
