/**
 * Демо-данные раздела «Видео» для проверки вёрстки глазами.
 *
 * Создаёт тренд → сценарий → ролик со всеми шагами генерации в трёх состояниях
 * (готово, упало, идёт прямо сейчас) плюс полтора десятка обычных роликов —
 * чтобы работали навигация по соседям и пагинация. Файлов на диске нет: путь
 * восстановления после пропавшего persistent disk проверяется тем же способом.
 *
 * Использовать ТОЛЬКО на тестовой БД.
 *
 * Запуск:
 *   set -a && source ./.env.test && set +a && bun run scripts/seed-videos-demo.ts
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../app/generated/prisma/client'

const connectionString = process.env.DATABASE_URL
  ?? 'postgresql://contentfactory_tests:contentfactory_tests_password@localhost:5436/contentfactory_tests_db'

if (!connectionString.includes('tests')) {
  throw new Error('[cf-seed-videos] DATABASE_URL не указывает на тестовую базу. Прерываю.')
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

const STEPS = [
  { stepKey: 'prompt_generation', estimatedCost: 1.5, actualCost: 1.8, sec: 12, endpoint: 'anthropic/claude-sonnet', skipped: false },
  { stepKey: 'image_generation', estimatedCost: 9, actualCost: 9.4, sec: 154, endpoint: 'fal-ai/flux/dev', skipped: false },
  { stepKey: 'clip_generation', estimatedCost: 12, actualCost: 18.2, sec: 242, endpoint: 'replicate/kling-v3', skipped: false },
  { stepKey: 'voiceover_generation', estimatedCost: 4.6, actualCost: 4.6, sec: 34, endpoint: 'elevenlabs/ru_male_2', skipped: false },
  { stepKey: 'music_generation', estimatedCost: 2.4, actualCost: null, sec: 0, endpoint: null, skipped: true },
  { stepKey: 'assembly', estimatedCost: 3, actualCost: 3.1, sec: 171, endpoint: 'ffmpeg', skipped: false },
]

async function makeScenario(title: string, trendId: number | null) {
  const scenario = await prisma.scenario.create({ data: { trendId, status: 'selected' } })
  const variant = await prisma.scenarioVariant.create({
    data: {
      scenarioId: scenario.id,
      variantIndex: 0,
      status: 'accepted',
      title,
      hook: 'Ниша шириной 180 см — и мебельщики называют цену как за кухню.',
      body: 'Показываем замер, раскрой и сборку за один день.\nБез скрытых доплат и без «привезём через месяц».',
      cta: 'Заберите чек-лист замера в закреплённом сообщении.',
      fullScript: 'Полный текст сценария для проверки вёрстки.',
      visualStyleText: 'Тёплый дневной свет, живая камера с рук, крупные планы фурнитуры.',
    },
  })
  await prisma.scenario.update({ where: { id: scenario.id }, data: { selectedVariantId: variant.id } })
  return scenario
}

async function makeVideo(opts: {
  title: string
  status: string
  failAt?: string
  runningAt?: string
  withFiles?: boolean
}) {
  const trend = await prisma.trend.create({
    data: {
      platform: 'tiktok',
      sourceUrl: `https://www.tiktok.com/@zavod.mebel/video/${Math.floor(Math.random() * 1e12)}`,
      title: 'Как за 30 секунд собрать шкаф в нишу',
      viewCount: 412000,
      likeCount: 38100,
      authorFollowers: 12400,
      viralityScore: 33.2,
      status: 'in_work',
    },
  })
  const scenario = await makeScenario(opts.title, trend.id)

  const video = await prisma.video.create({
    data: {
      scenarioId: scenario.id,
      status: opts.status as never,
      format: 'portrait',
      duration: 82,
      renderQuality: 'high',
      targetPlatform: 'tiktok',
      subtitlesEnabled: true,
      subtitlePreset: 'tiktok_bold_yellow',
      musicEnabled: false,
      totalCostEstimate: 32.5,
      totalCostActual: opts.status === 'completed' ? 37.1 : 29.4,
      errorMessage: opts.failAt ? 'Провайдер вернул 422: длительность речи больше видеодорожки.' : null,
      // Файла на диске нет — плеер поймает 404 и покажет ветку восстановления.
      fileUrl: opts.withFiles ? `videos/seed_${video_seq()}.mp4` : null,
    },
  })

  const failIndex = opts.failAt ? STEPS.findIndex(s => s.stepKey === opts.failAt) : -1
  const runIndex = opts.runningAt ? STEPS.findIndex(s => s.stepKey === opts.runningAt) : -1

  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i]!
    const started = new Date(Date.now() - (STEPS.length - i) * 300000)
    const finished = new Date(started.getTime() + step.sec * 1000)

    let status = 'completed'
    if (step.skipped) status = 'skipped'
    if (failIndex >= 0 && i === failIndex) status = 'failed'
    if (runIndex >= 0 && i === runIndex) status = 'running'
    if (failIndex >= 0 && i > failIndex) status = 'pending'
    if (runIndex >= 0 && i > runIndex) status = 'pending'

    await prisma.videoGenerationStep.create({
      data: {
        videoId: video.id,
        stepKey: step.stepKey as never,
        stepIndex: i + 1,
        status: status as never,
        startedAt: status === 'pending' ? null : started,
        finishedAt: ['completed', 'failed', 'skipped'].includes(status) ? finished : null,
        attemptCount: step.stepKey === 'clip_generation' ? 2 : 1,
        estimatedCost: step.estimatedCost,
        actualCost: status === 'pending' ? null : step.actualCost,
        falEndpoint: step.endpoint,
        errorMessage: status === 'failed'
          ? 'HTTP 422 · speech track (11.4s) exceeds scene duration (9.0s)'
          : null,
        logs: status === 'pending'
          ? undefined
          : [
              { ts: started.toISOString(), msg: `submit → ${step.endpoint ?? 'local'}` },
              { ts: finished.toISOString(), msg: status === 'failed' ? 'provider returned 422' : 'done' },
            ],
      },
    })
  }

  if (opts.status === 'completed' || opts.failAt) {
    for (let i = 0; i < 6; i++) {
      await prisma.videoAsset.create({
        data: {
          videoId: video.id,
          type: 'image',
          order: i,
          prompt: `Сцена ${i + 1}. Мастерская, тёплый свет, крупный план фурнитуры, кадр ${i + 1} из 6.`,
          fileUrl: `videos/seed_frame_${video.id}_${i}.png`,
        },
      })
    }
    for (let i = 0; i < 3; i++) {
      await prisma.videoAsset.create({
        data: { videoId: video.id, type: 'clip', order: i, fileUrl: `videos/seed_clip_${video.id}_${i}.mp4` },
      })
    }
  }

  return video
}

let seq = 0
function video_seq() {
  seq += 1
  return seq
}

const done = await makeVideo({ title: 'Шкаф в нишу за 30 секунд · вариант B', status: 'completed', withFiles: true })
const failed = await makeVideo({ title: 'Кухня под потолок · вариант A', status: 'failed', failAt: 'clip_generation' })
const running = await makeVideo({ title: 'Гардеробная 4 м² · вариант C', status: 'generating_clips', runningAt: 'clip_generation' })

for (let i = 0; i < 14; i++) {
  await makeVideo({ title: `Тестовый ролик ${i + 1}`, status: 'completed', withFiles: true })
}

console.log(JSON.stringify({ done: done.id, failed: failed.id, running: running.id }))
await prisma.$disconnect()
