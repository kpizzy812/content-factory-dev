/**
 * Integration-тест `analyzeCreativeVideo` — full pipeline на mock-Anthropic
 * + реальный ffmpeg на 3-секундном фикстуре `server/__fixtures__/drive-mock.mp4`.
 *
 * Покрывает:
 *  1. happy path: filePath → 6 кадров → marketing JSON → DB backfill
 *  2. TTL skip: повторный вызов без force → skipped:true
 *  3. force re-analyze: повторный вызов с force:true → новый run
 *  4. missing filePath/driveFile → throw
 *  5. idempotent VideoFrame: при force старые VideoFrame удалены, новые созданы
 *
 * Вызов идёт через test-only endpoint /api/_test/analyze-creative-video,
 * чтобы попасть в Nitro context (useRuntimeConfig работает только там).
 *
 * Каждый `it` создаёт свой bundle через createBundle() — afterEach TRUNCATE
 * между тестами сбрасывает БД, поэтому beforeAll/общий state не работают.
 *
 * @vitest-environment node
 */
import { describe, it, expect, afterAll } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'
import { resolve } from 'node:path'
import { rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { prisma } from '../../server/utils/prisma'
import { nuxtTestEnv } from '../helpers/nuxt-env'
import { getFrameDir } from '../../server/utils/video-tools/frame-storage'

await setup({
  dev: true,
  server: true,
  browser: false,
  env: nuxtTestEnv,
})

const MOCK_VIDEO_PATH = resolve(
  process.cwd(),
  'server',
  '__fixtures__',
  'drive-mock.mp4',
)

interface AnalyzeResult {
  videoId: number
  framesExtracted: number
  framesSentToAi: number
  framesSkipped: number[]
  framePassVersion: string
  framePassRunAt: string
  durationSec: number
  fitScore: number | null
  skipped: boolean
  reason?: string
}

interface AnalyzeResponse {
  ok: boolean
  result?: AnalyzeResult
  error?: string
}

async function callAnalyze(body: {
  videoId: number
  force?: boolean
}): Promise<AnalyzeResponse> {
  return $fetch<AnalyzeResponse>('/api/_test/analyze-creative-video', {
    method: 'POST',
    headers: {
      'x-test-auth-token': process.env.TEST_AUTH_TOKEN ?? '',
    },
    body,
  })
}

interface TestBundle {
  appId: number
  scenarioId: number
  videoId: number
}

async function createBundle(opts: { withFilePath?: boolean } = {}): Promise<TestBundle> {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  const app = await prisma.app.create({
    data: {
      name: `MockApp ${seed}`,
      description: 'productivity app',
      keywords: ['productivity', 'calendar'],
      targetAudience: 'millennial office workers',
      geo: 'RU',
    },
  })
  const trend = await prisma.trend.create({
    data: {
      appId: app.id,
      platform: 'tiktok',
      sourceUrl: `https://tiktok.com/@t/video/${seed}`,
      title: `Test trend ${seed}`,
      description: '',
      hashtags: [],
    },
  })
  const scenario = await prisma.scenario.create({
    data: {
      trendId: trend.id,
      appId: app.id,
      status: 'generated',
    },
  })
  const video = await prisma.video.create({
    data: {
      scenarioId: scenario.id,
      applicationId: app.id,
      status: 'completed',
      format: 'portrait',
      filePath: opts.withFilePath === false ? null : MOCK_VIDEO_PATH,
      duration: 3,
      targetPlatform: 'tiktok',
    },
  })
  return { appId: app.id, scenarioId: scenario.id, videoId: video.id }
}

// Cleanup всех frame-директорий созданных в этом suite — чтобы не засорять storage/frames.
const createdVideoIds = new Set<number>()
async function track(bundle: TestBundle): Promise<TestBundle> {
  createdVideoIds.add(bundle.videoId)
  return bundle
}

afterAll(async () => {
  for (const id of createdVideoIds) {
    await rm(getFrameDir(id), { recursive: true, force: true }).catch(() => {})
  }
})

describe('analyzeCreativeVideo — happy path', () => {
  it('извлекает кадры и заполняет analysisData/VideoFrame', async () => {
    const bundle = await track(await createBundle())
    const res = await callAnalyze({ videoId: bundle.videoId })
    expect(res.ok).toBe(true)
    expect(res.error).toBeUndefined()
    const result = res.result!

    expect(result.skipped).toBe(false)
    expect(result.framesExtracted).toBeGreaterThanOrEqual(1)
    expect(result.framesExtracted).toBeLessThanOrEqual(6)
    expect(result.framesSentToAi).toBe(result.framesExtracted)
    expect(result.framePassVersion).toBe('frames-v1')
    expect(result.fitScore).not.toBeNull()
    expect(result.fitScore!).toBeGreaterThanOrEqual(0)
    expect(result.fitScore!).toBeLessThanOrEqual(1)
    expect(result.durationSec).toBeGreaterThan(0)

    const video = await prisma.video.findUnique({ where: { id: bundle.videoId } })
    expect(video).not.toBeNull()
    expect(video!.framePassVersion).toBe('frames-v1')
    expect(video!.framePassRunAt).not.toBeNull()
    expect(video!.fitScore).not.toBeNull()
    expect(video!.fitRationale).toBeTruthy()
    expect(video!.analysisDurationSec).toBeGreaterThan(0)

    const data = video!.analysisData as Record<string, unknown>
    expect(data).toBeTruthy()
    expect(data.modeVersion).toBe('frames-v1')
    expect(data.mode).toBe('marketing')
    expect(typeof data.runAt).toBe('string')
    expect(typeof data.durationSec).toBe('number')
    expect(typeof data.framesExtracted).toBe('number')
    expect(Array.isArray(data.framesSkipped)).toBe(true)
    const marketing = data.result as Record<string, unknown>
    expect(typeof marketing.summary).toBe('string')
    expect(Array.isArray(marketing.frameDescriptions)).toBe(true)

    const frames = await prisma.videoFrame.findMany({
      where: { videoId: bundle.videoId },
      orderBy: { sequence: 'asc' },
    })
    expect(frames).toHaveLength(result.framesExtracted)
    for (const f of frames) {
      expect(f.filePath).toMatch(/\.jpg$/)
      expect(existsSync(f.filePath)).toBe(true)
      expect(f.description).not.toBeNull()
      expect(f.description!.length).toBeGreaterThan(0)
      expect(f.keyElements).not.toBeNull()
    }
  }, 90_000)
})

describe('analyzeCreativeVideo — TTL skip', () => {
  it('повторный вызов без force → skipped:true', async () => {
    const bundle = await track(await createBundle())
    // первый прогон чтобы заполнить framePass
    const first = await callAnalyze({ videoId: bundle.videoId })
    expect(first.ok).toBe(true)
    expect(first.result!.skipped).toBe(false)

    const second = await callAnalyze({ videoId: bundle.videoId })
    expect(second.ok).toBe(true)
    expect(second.result!.skipped).toBe(true)
    expect(second.result!.reason).toMatch(/TTL/)
    expect(second.result!.framesExtracted).toBe(0)
  }, 120_000)

  it('повторный вызов с force:true → новый прогон, не skipped', async () => {
    const bundle = await track(await createBundle())
    await callAnalyze({ videoId: bundle.videoId })
    const res = await callAnalyze({ videoId: bundle.videoId, force: true })
    expect(res.ok).toBe(true)
    expect(res.result!.skipped).toBe(false)
    expect(res.result!.framesExtracted).toBeGreaterThan(0)
  }, 120_000)
})

describe('analyzeCreativeVideo — missing source', () => {
  it('Video без filePath и без driveFile → ok:false с error', async () => {
    const bundle = await track(await createBundle({ withFilePath: false }))
    const res = await callAnalyze({ videoId: bundle.videoId })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/локального файла|filePath/)
  }, 30_000)

  it('несуществующий videoId → ok:false с "не найдено"', async () => {
    const res = await callAnalyze({ videoId: 999_999_999 })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/не найдено/)
  })
})

describe('analyzeCreativeVideo — idempotent VideoFrame', () => {
  it('force-перезапуск удаляет старые VideoFrame и создаёт новые', async () => {
    const bundle = await track(await createBundle())
    await callAnalyze({ videoId: bundle.videoId })
    const framesFirst = await prisma.videoFrame.findMany({
      where: { videoId: bundle.videoId },
      orderBy: { sequence: 'asc' },
    })
    expect(framesFirst.length).toBeGreaterThan(0)
    const firstIds = framesFirst.map(f => f.id)

    await callAnalyze({ videoId: bundle.videoId, force: true })
    const framesSecond = await prisma.videoFrame.findMany({
      where: { videoId: bundle.videoId },
      orderBy: { sequence: 'asc' },
    })
    expect(framesSecond.length).toBe(framesFirst.length)
    const secondIds = framesSecond.map(f => f.id)
    expect(secondIds.some(id => firstIds.includes(id))).toBe(false)
  }, 120_000)
})
