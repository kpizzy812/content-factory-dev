/**
 * Unit-тесты executor'а caption_generator (production hardening 2026-05-14).
 *
 * Стратегия:
 *  - Реальная test-БД (Pipeline → WorkflowRun → Scenario → Video).
 *  - vi.mock на runCaptionGenerator из agents/caption-generator-agent — чтобы
 *    не дёргать настоящий Anthropic API и контролировать output для assertion.
 *
 * Покрытые сценарии:
 *   1. skip когда video.status !== 'completed' (guard #1)
 *   2. skip когда нет scenario variant и нет frameAnalyses (guard #2)
 *   3. marketingTitle (variant.title) пробрасывается в runCaptionGenerator
 *   4. language пробрасывается в runCaptionGenerator (auto / en / ru / es)
 *   5. idempotent reuse при forceRegenerate=false и существующих Caption в run scope
 *   6. forceRegenerate=true обходит idempotency cache и снова дёргает AI
 *   7. failOnNotFitsLimits=true + AI вернул fitsLimits=false → throw
 *   8. config.platforms=[] → throw с понятным сообщением
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { CaptionGeneratorOutput } from '../../../shared/types/caption'
import { PLATFORM_LIMITS } from '../../../server/utils/caption-limits'
import { prisma } from '../../../server/utils/prisma'

// ── Module mocks ────────────────────────────────────────────────────────────
const { runCaptionGeneratorMock } = vi.hoisted(() => ({
  runCaptionGeneratorMock: vi.fn(),
}))

vi.mock('../../../server/utils/agents/caption-generator-agent', () => ({
  runCaptionGenerator: runCaptionGeneratorMock,
}))

import { executeCaptionGeneratorNode } from '../../../server/utils/pipeline-executors-extra'

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeAiOutput(
  videoId: number,
  opts: { fitsLimits?: boolean; title?: string } = {},
): CaptionGeneratorOutput {
  const fits = opts.fitsLimits ?? true
  const title = opts.title ?? 'AI generated title'
  return {
    videoId,
    captions: {
      tiktok: {
        platform: 'tiktok',
        title,
        description: 'desc',
        hashtags: ['fyp', 'viral', 'productivity', 'lifehack', 'app'],
        limits: PLATFORM_LIMITS.tiktok,
        fitsLimits: fits,
        ...(fits ? {} : { validationErrors: ['Too many hashtags'] }),
      },
    },
    contextUsed: { storyPlan: true, appContext: true, sceneFrames: false, favoritePrompts: false },
    modelVersion: 'caption-generator-v1',
    generatedAt: new Date().toISOString(),
  }
}

interface VideoFixtureOpts {
  status?: 'completed' | 'failed' | 'timeout' | 'pending'
  withVariant?: boolean
  variantTitle?: string
  withAnalysisData?: boolean
}

async function createFixture(opts: VideoFixtureOpts = {}): Promise<{
  runId: number
  pipelineId: number
  videoId: number
  scenarioId: number
  appId: number
  variantId: number | null
}> {
  const status = opts.status ?? 'completed'
  const withVariant = opts.withVariant ?? true
  const variantTitle = opts.variantTitle ?? 'default variant title'
  const seed = Math.floor(Math.random() * 1_000_000_000)

  const user = await prisma.zavodUser.create({
    data: {
      externalId: seed,
      email: `caption-test-${seed}@test`,
      rolePreset: 'admin',
      canRead: true,
      canWrite: true,
      canCreate: true,
      canDelete: true,
      canApprove: true,
      canRunAgent: true,
      canApplyChanges: true,
      canAdmin: true,
      moduleAccess: ['pipeline', 'video-generator'],
      isActive: true,
    },
  })
  const app = await prisma.app.create({
    data: {
      name: `app-${seed}`,
      keywords: [],
      forbiddenClaims: [],
      brandTone: 'casual friendly',
    },
  })
  const trend = await prisma.trend.create({
    data: {
      appId: app.id,
      platform: 'tiktok',
      sourceUrl: `https://test.local/${seed}`,
      title: `trend-${seed}`,
      viewCount: 1,
      hashtags: [],
    },
  })
  const scenario = await prisma.scenario.create({
    data: { trendId: trend.id, appId: app.id, status: 'generated' },
  })
  let variantId: number | null = null
  if (withVariant) {
    const variant = await prisma.scenarioVariant.create({
      data: {
        scenario: { connect: { id: scenario.id } },
        variantIndex: 0,
        status: 'accepted',
        title: variantTitle,
        hook: 'h',
        body: 'b',
        cta: 'c',
        fullScript: 'f',
        visualStyleText: 'v',
      },
    })
    variantId = variant.id
    await prisma.scenario.update({
      where: { id: scenario.id },
      data: { selectedVariantId: variant.id },
    })
  }
  const pipeline = await prisma.pipeline.create({
    data: { userId: user.id, name: `caption-${seed}` },
  })
  const run = await prisma.workflowRun.create({
    data: { pipelineId: pipeline.id, status: 'running' },
  })
  const analysisDataValue = opts.withAnalysisData
    ? {
        framePass: 'marketing-v1',
        result: {
          frameDescriptions: [
            {
              sequence: 0,
              description: 'a person at a laptop',
              keyElements: ['laptop', 'desk'],
              onScreenText: null,
            },
          ],
          tags: [{ category: 'emotion', name: 'curious' }],
        },
      }
    : undefined
  const video = await prisma.video.create({
    data: {
      scenarioId: scenario.id,
      applicationId: app.id,
      status,
      runId: run.id,
      pipelineId: pipeline.id,
      ...(analysisDataValue ? { analysisData: analysisDataValue as object } : {}),
    } as never,
  })
  return {
    runId: run.id,
    pipelineId: pipeline.id,
    videoId: video.id,
    scenarioId: scenario.id,
    appId: app.id,
    variantId,
  }
}

beforeEach(() => {
  runCaptionGeneratorMock.mockReset()
})

// ── Tests ───────────────────────────────────────────────────────────────────

describe('caption_generator: guard на video.status', () => {
  it('skip когда video.status="failed"', async () => {
    const fix = await createFixture({ status: 'failed' })

    const out = await executeCaptionGeneratorNode(
      { platforms: ['tiktok'] },
      { videos: [{ id: fix.videoId }], _runId: fix.runId, _pipelineId: fix.pipelineId },
    )

    expect(out.skipped).toBe(true)
    expect(String(out.reason ?? '')).toContain('статусе')
    expect(out._noData).toBe(true)
    expect(out._domainStatus).toBe('no_data')
    expect(runCaptionGeneratorMock).not.toHaveBeenCalled()
  })

  it('skip когда video.status="pending"', async () => {
    const fix = await createFixture({ status: 'pending' })

    const out = await executeCaptionGeneratorNode(
      { platforms: ['tiktok'] },
      { videos: [{ id: fix.videoId }], _runId: fix.runId },
    )

    expect(out.skipped).toBe(true)
    expect(String(out.reason ?? '')).toContain('pending')
    expect(runCaptionGeneratorMock).not.toHaveBeenCalled()
  })
})

describe('caption_generator: guard на отсутствие контекста', () => {
  it('skip когда нет accepted variant и нет frameAnalyses', async () => {
    const fix = await createFixture({ status: 'completed', withVariant: false, withAnalysisData: false })

    const out = await executeCaptionGeneratorNode(
      { platforms: ['tiktok'] },
      { videos: [{ id: fix.videoId }], _runId: fix.runId },
    )

    expect(out.skipped).toBe(true)
    expect(String(out.reason ?? '')).toContain('Недостаточно контекста')
    expect(out._noData).toBe(true)
    expect(runCaptionGeneratorMock).not.toHaveBeenCalled()
  })

  it('НЕ skip когда нет variant, но есть frameAnalyses', async () => {
    const fix = await createFixture({ status: 'completed', withVariant: false, withAnalysisData: true })
    runCaptionGeneratorMock.mockResolvedValueOnce(makeAiOutput(fix.videoId))

    const out = await executeCaptionGeneratorNode(
      { platforms: ['tiktok'] },
      { videos: [{ id: fix.videoId }], _runId: fix.runId, _pipelineId: fix.pipelineId },
    )

    expect(out.skipped).not.toBe(true)
    expect(runCaptionGeneratorMock).toHaveBeenCalledTimes(1)
  })
})

describe('caption_generator: marketingTitle проброс', () => {
  it('передаёт variant.title как context.marketingTitle', async () => {
    const fix = await createFixture({
      status: 'completed',
      withVariant: true,
      variantTitle: 'My Marketing Anchor',
    })
    runCaptionGeneratorMock.mockResolvedValueOnce(makeAiOutput(fix.videoId))

    await executeCaptionGeneratorNode(
      { platforms: ['tiktok'] },
      { videos: [{ id: fix.videoId }], _runId: fix.runId, _pipelineId: fix.pipelineId },
    )

    expect(runCaptionGeneratorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ marketingTitle: 'My Marketing Anchor' }),
      }),
    )
  })

  it('marketingTitle=null когда variant отсутствует (creative-only path)', async () => {
    const fix = await createFixture({
      status: 'completed',
      withVariant: false,
      withAnalysisData: true,
    })
    runCaptionGeneratorMock.mockResolvedValueOnce(makeAiOutput(fix.videoId))

    await executeCaptionGeneratorNode(
      { platforms: ['tiktok'] },
      { videos: [{ id: fix.videoId }], _runId: fix.runId, _pipelineId: fix.pipelineId },
    )

    expect(runCaptionGeneratorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ marketingTitle: null }),
      }),
    )
  })
})

describe('caption_generator: language проброс', () => {
  it('передаёт config.language="ru" в runCaptionGenerator', async () => {
    const fix = await createFixture()
    runCaptionGeneratorMock.mockResolvedValueOnce(makeAiOutput(fix.videoId))

    await executeCaptionGeneratorNode(
      { platforms: ['tiktok'], language: 'ru' },
      { videos: [{ id: fix.videoId }], _runId: fix.runId, _pipelineId: fix.pipelineId },
    )

    expect(runCaptionGeneratorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ language: 'ru' }),
      }),
    )
  })

  it('невалидный language откатывается на "auto"', async () => {
    const fix = await createFixture()
    runCaptionGeneratorMock.mockResolvedValueOnce(makeAiOutput(fix.videoId))

    await executeCaptionGeneratorNode(
      { platforms: ['tiktok'], language: 'klingon' },
      { videos: [{ id: fix.videoId }], _runId: fix.runId, _pipelineId: fix.pipelineId },
    )

    expect(runCaptionGeneratorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ language: 'auto' }),
      }),
    )
  })
})

describe('caption_generator: idempotency и forceRegenerate', () => {
  it('idempotentReuse=true когда captions уже есть в run scope и forceRegenerate=false', async () => {
    const fix = await createFixture()
    // Создаём заранее Caption в том же run scope (createdAt будет >= run.startedAt)
    await prisma.caption.create({
      data: {
        videoId: fix.videoId,
        platform: 'tiktok',
        title: 'Pre-existing title',
        description: 'pre desc',
        hashtags: ['existing'],
        charsTitle: 19,
        charsHashtagsTotal: 9,
        fitsLimits: true,
        modelVersion: 'caption-generator-v1',
        promptVersion: 'v1',
        runId: fix.runId,
        pipelineId: fix.pipelineId,
      },
    })

    const out = await executeCaptionGeneratorNode(
      { platforms: ['tiktok'] },
      { videos: [{ id: fix.videoId }], _runId: fix.runId, _pipelineId: fix.pipelineId },
    )

    expect(out.idempotentReuse).toBe(true)
    expect(out.skippedDuplicates).toBe(1)
    expect(runCaptionGeneratorMock).not.toHaveBeenCalled()
  })

  it('forceRegenerate=true обходит idempotency и снова дёргает AI', async () => {
    const fix = await createFixture()
    await prisma.caption.create({
      data: {
        videoId: fix.videoId,
        platform: 'tiktok',
        title: 'Pre-existing title',
        description: 'pre desc',
        hashtags: ['existing'],
        charsTitle: 19,
        charsHashtagsTotal: 9,
        fitsLimits: true,
        modelVersion: 'caption-generator-v1',
        promptVersion: 'v1',
        runId: fix.runId,
        pipelineId: fix.pipelineId,
      },
    })
    runCaptionGeneratorMock.mockResolvedValueOnce(
      makeAiOutput(fix.videoId, { title: 'Regenerated by AI' }),
    )

    const out = await executeCaptionGeneratorNode(
      { platforms: ['tiktok'], forceRegenerate: true },
      { videos: [{ id: fix.videoId }], _runId: fix.runId, _pipelineId: fix.pipelineId },
    )

    expect(out.idempotentReuse).toBeUndefined()
    expect(runCaptionGeneratorMock).toHaveBeenCalledTimes(1)
    const saved = await prisma.caption.findUnique({
      where: { videoId_platform: { videoId: fix.videoId, platform: 'tiktok' } },
    })
    expect(saved?.title).toBe('Regenerated by AI')
  })
})

describe('caption_generator: failOnNotFitsLimits', () => {
  it('throw когда failOnNotFitsLimits=true и хоть одна платформа не уложилась', async () => {
    const fix = await createFixture()
    runCaptionGeneratorMock.mockResolvedValueOnce(
      makeAiOutput(fix.videoId, { fitsLimits: false }),
    )

    await expect(
      executeCaptionGeneratorNode(
        { platforms: ['tiktok'], failOnNotFitsLimits: true },
        { videos: [{ id: fix.videoId }], _runId: fix.runId, _pipelineId: fix.pipelineId },
      ),
    ).rejects.toThrow(/не уложились в лимиты/i)

    // Caption всё равно сохранён в БД — оператор сможет править вручную и retry'нуть
    const saved = await prisma.caption.findUnique({
      where: { videoId_platform: { videoId: fix.videoId, platform: 'tiktok' } },
    })
    expect(saved).not.toBeNull()
    expect(saved?.fitsLimits).toBe(false)
  })

  it('БЕЗ throw когда failOnNotFitsLimits=false (default) и не fitsLimits — _domainDegraded', async () => {
    const fix = await createFixture()
    runCaptionGeneratorMock.mockResolvedValueOnce(
      makeAiOutput(fix.videoId, { fitsLimits: false }),
    )

    const out = await executeCaptionGeneratorNode(
      { platforms: ['tiktok'] },
      { videos: [{ id: fix.videoId }], _runId: fix.runId, _pipelineId: fix.pipelineId },
    )

    expect(out.fitsAllLimits).toBe(false)
    expect(out._domainDegraded).toBe(true)
    expect(out.generatedCount).toBe(1)
  })
})

describe('caption_generator: валидация platforms', () => {
  it('throw когда config.platforms=[]', async () => {
    const fix = await createFixture()

    await expect(
      executeCaptionGeneratorNode(
        { platforms: [] },
        { videos: [{ id: fix.videoId }], _runId: fix.runId, _pipelineId: fix.pipelineId },
      ),
    ).rejects.toThrow(/Не выбрана ни одна платформа/i)

    expect(runCaptionGeneratorMock).not.toHaveBeenCalled()
  })
})

describe('caption_generator: batch processing (regression: bug 2026-05-15)', () => {
  it('обрабатывает ВСЕ upstream videos с независимым context (а не только первое)', async () => {
    // Регрессия: до фикса 2026-05-15 executor брал .find() из массива видео,
    // т.е. обрабатывал только первое и молча игнорировал остальные.
    const fixA = await createFixture({ status: 'completed', withVariant: true, variantTitle: 'Title A' })
    const fixB = await createFixture({ status: 'completed', withVariant: true, variantTitle: 'Title B' })

    runCaptionGeneratorMock
      .mockResolvedValueOnce(makeAiOutput(fixA.videoId, { title: 'Captions for A' }))
      .mockResolvedValueOnce(makeAiOutput(fixB.videoId, { title: 'Captions for B' }))

    const out = await executeCaptionGeneratorNode(
      { platforms: ['tiktok'] },
      {
        videos: [{ id: fixA.videoId }, { id: fixB.videoId }],
        _runId: fixA.runId,
        _pipelineId: fixA.pipelineId,
      },
    )

    // Главное: AI вызван 2 раза, каждый со СВОИМ marketingTitle
    expect(runCaptionGeneratorMock).toHaveBeenCalledTimes(2)
    expect(runCaptionGeneratorMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      videoId: fixA.videoId,
      context: expect.objectContaining({ marketingTitle: 'Title A' }),
    }))
    expect(runCaptionGeneratorMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      videoId: fixB.videoId,
      context: expect.objectContaining({ marketingTitle: 'Title B' }),
    }))

    // Batch metadata
    expect(out.totalVideos).toBe(2)
    expect(out.totalGenerated).toBe(2) // 2 videos × 1 platform
    expect(out.totalErrored).toBe(0)
    expect(out.totalSkipped).toBe(0)

    // Per-video результаты
    const resultsArr = out.videos as Array<Record<string, unknown>>
    expect(resultsArr).toHaveLength(2)
    expect(resultsArr[0]?.videoId).toBe(fixA.videoId)
    expect(resultsArr[1]?.videoId).toBe(fixB.videoId)

    // Captions сохранены в БД для обоих
    const savedA = await prisma.caption.findUnique({
      where: { videoId_platform: { videoId: fixA.videoId, platform: 'tiktok' } },
    })
    const savedB = await prisma.caption.findUnique({
      where: { videoId_platform: { videoId: fixB.videoId, platform: 'tiktok' } },
    })
    expect(savedA?.title).toBe('Captions for A')
    expect(savedB?.title).toBe('Captions for B')
  })

  it('продолжает обрабатывать оставшиеся видео если одно упало', async () => {
    const fixA = await createFixture({ status: 'completed', withVariant: true, variantTitle: 'A' })
    const fixB = await createFixture({ status: 'completed', withVariant: true, variantTitle: 'B' })

    runCaptionGeneratorMock
      .mockRejectedValueOnce(new Error('AI API timeout'))
      .mockResolvedValueOnce(makeAiOutput(fixB.videoId, { title: 'B succeeded' }))

    const out = await executeCaptionGeneratorNode(
      { platforms: ['tiktok'] },
      {
        videos: [{ id: fixA.videoId }, { id: fixB.videoId }],
        _runId: fixA.runId,
        _pipelineId: fixA.pipelineId,
      },
    )

    expect(out.totalVideos).toBe(2)
    expect(out.totalGenerated).toBe(1) // только B
    expect(out.totalErrored).toBe(1) // A failed
    expect(out._domainStatus).toBe('domain_degraded')

    const resultsArr = out.videos as Array<Record<string, unknown>>
    expect(resultsArr[0]?.error).toBe('AI API timeout')
    expect(resultsArr[1]?.videoId).toBe(fixB.videoId)
    expect(resultsArr[1]?.generatedCount).toBe(1)

    // B сохранён, A — нет
    const savedB = await prisma.caption.findUnique({
      where: { videoId_platform: { videoId: fixB.videoId, platform: 'tiktok' } },
    })
    expect(savedB?.title).toBe('B succeeded')
  })

  it('частичный skip: одно видео failed-status пропущено, второе обработано', async () => {
    const fixA = await createFixture({ status: 'failed' })
    const fixB = await createFixture({ status: 'completed', withVariant: true, variantTitle: 'B works' })

    runCaptionGeneratorMock.mockResolvedValueOnce(makeAiOutput(fixB.videoId, { title: 'B captions' }))

    const out = await executeCaptionGeneratorNode(
      { platforms: ['tiktok'] },
      {
        videos: [{ id: fixA.videoId }, { id: fixB.videoId }],
        _runId: fixA.runId,
        _pipelineId: fixA.pipelineId,
      },
    )

    expect(runCaptionGeneratorMock).toHaveBeenCalledTimes(1) // только B
    expect(out.totalVideos).toBe(2)
    expect(out.totalSkipped).toBe(1)
    expect(out.totalGenerated).toBe(1)
    expect(out.totalErrored).toBe(0)

    const resultsArr = out.videos as Array<Record<string, unknown>>
    expect(resultsArr[0]?.skipped).toBe(true)
    expect(resultsArr[1]?.videoId).toBe(fixB.videoId)
  })

  it('failOnNotFitsLimits=true бросает ПОСЛЕ обработки всех видео (captions уже в БД)', async () => {
    const fixA = await createFixture({ status: 'completed', withVariant: true, variantTitle: 'A' })
    const fixB = await createFixture({ status: 'completed', withVariant: true, variantTitle: 'B' })

    runCaptionGeneratorMock
      .mockResolvedValueOnce(makeAiOutput(fixA.videoId, { fitsLimits: false, title: 'A bad' }))
      .mockResolvedValueOnce(makeAiOutput(fixB.videoId, { fitsLimits: true, title: 'B ok' }))

    await expect(
      executeCaptionGeneratorNode(
        { platforms: ['tiktok'], failOnNotFitsLimits: true },
        {
          videos: [{ id: fixA.videoId }, { id: fixB.videoId }],
          _runId: fixA.runId,
          _pipelineId: fixA.pipelineId,
        },
      ),
    ).rejects.toThrow(/не уложились в лимиты/i)

    // Оба видео processed → оба caption сохранены в БД
    expect(runCaptionGeneratorMock).toHaveBeenCalledTimes(2)
    const savedA = await prisma.caption.findUnique({
      where: { videoId_platform: { videoId: fixA.videoId, platform: 'tiktok' } },
    })
    const savedB = await prisma.caption.findUnique({
      where: { videoId_platform: { videoId: fixB.videoId, platform: 'tiktok' } },
    })
    expect(savedA?.title).toBe('A bad')
    expect(savedB?.title).toBe('B ok')
  })
})
