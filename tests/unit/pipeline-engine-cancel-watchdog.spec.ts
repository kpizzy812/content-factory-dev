/**
 * Unit-тест detectStuckRuns — cancel watchdog (этап B2).
 *
 * Контекст бага B (stuck "Останавливается"):
 *   running run + cancelRequestedAt — worker может зависнуть в глубоком fal
 *   polling без AbortSignal propagation. Раньше watchdog ждал 60 минут
 *   (MAX_RUN_DURATION_MS * 2) → пользователь видел спиннер до часа.
 *
 * После B2:
 *   - Ветка 1 (cancel watchdog, 2 мин): running + cancelRequestedAt > 2 мин → cancelled
 *   - Ветка 2 (classic stuck, 60 мин): running без cancel > 60 мин → failed
 *
 * Тесты через реальную test-БД (singleThread + afterEach TRUNCATE из setup.ts).
 */
import { describe, expect, it } from 'vitest'
import { prisma } from '../../server/utils/prisma'
import { detectStuckRuns } from '../../server/utils/pipeline-engine'

async function createPipeline(): Promise<number> {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  const user = await prisma.zavodUser.create({
    data: {
      externalId: seed,
      email: `watchdog-${seed}@test`,
      rolePreset: 'admin',
      canRead: true,
      canWrite: true,
      canCreate: true,
      canDelete: true,
      canApprove: true,
      canRunAgent: true,
      canApplyChanges: true,
      canAdmin: true,
      moduleAccess: ['pipeline'],
      isActive: true,
    },
  })
  const pipeline = await prisma.pipeline.create({
    data: { userId: user.id, name: `pipe-${seed}` },
  })
  return pipeline.id
}

describe('detectStuckRuns — cancel watchdog (этап B2)', () => {
  it('финализирует running+cancelRequestedAt старше 2 мин как cancelled с category=cancellation', async () => {
    const pipelineId = await createPipeline()
    // cancelRequestedAt = 3 минуты назад → старше порога 2 мин
    const threeMinAgo = new Date(Date.now() - 3 * 60 * 1000)
    const run = await prisma.workflowRun.create({
      data: {
        pipelineId,
        status: 'running',
        // startedAt свежий — НЕ попадает под classic 60-мин ветку
        startedAt: new Date(Date.now() - 5 * 60 * 1000),
        cancelRequestedAt: threeMinAgo,
      },
    })

    const count = await detectStuckRuns()
    expect(count).toBeGreaterThanOrEqual(1)

    const updated = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(updated.status).toBe('cancelled')
    expect(updated.errorCategory).toBe('cancellation')
    expect(updated.finishedAt).not.toBeNull()
    expect(updated.errorMessage).toContain('cancel watchdog')
    expect(updated.errorMessage).toContain('2 минуты')
  })

  it('финализирует дочерние WorkflowStep (running/pending) под cancel watchdog как cancelled', async () => {
    const pipelineId = await createPipeline()
    const run = await prisma.workflowRun.create({
      data: {
        pipelineId,
        status: 'running',
        startedAt: new Date(Date.now() - 5 * 60 * 1000),
        cancelRequestedAt: new Date(Date.now() - 3 * 60 * 1000),
      },
    })
    const stepPending = await prisma.workflowStep.create({
      data: {
        runId: run.id,
        nodeId: 'node-1',
        nodeName: 'Step 1',
        nodeType: 'trend',
        status: 'pending',
      },
    })
    const stepRunning = await prisma.workflowStep.create({
      data: {
        runId: run.id,
        nodeId: 'node-2',
        nodeName: 'Step 2',
        nodeType: 'video',
        status: 'running',
        startedAt: new Date(),
      },
    })
    const stepSuccess = await prisma.workflowStep.create({
      data: {
        runId: run.id,
        nodeId: 'node-3',
        nodeName: 'Step 3',
        nodeType: 'trendwatcher',
        status: 'success',
        startedAt: new Date(),
        finishedAt: new Date(),
        duration: 100,
      },
    })

    await detectStuckRuns()

    const p = await prisma.workflowStep.findUniqueOrThrow({ where: { id: stepPending.id } })
    const r = await prisma.workflowStep.findUniqueOrThrow({ where: { id: stepRunning.id } })
    const s = await prisma.workflowStep.findUniqueOrThrow({ where: { id: stepSuccess.id } })
    expect(p.status).toBe('cancelled')
    expect(p.errorCategory).toBe('cancellation')
    expect(p.finishedAt).not.toBeNull()
    expect(r.status).toBe('cancelled')
    expect(r.errorCategory).toBe('cancellation')
    expect(r.finishedAt).not.toBeNull()
    // success НЕ должен быть переписан
    expect(s.status).toBe('success')
  })

  it('НЕ трогает running+cancelRequestedAt свежее 2 мин (worker ещё может сам успеть)', async () => {
    const pipelineId = await createPipeline()
    // cancelRequestedAt = 30 секунд назад → НЕ должен попасть под watchdog
    const thirtySecAgo = new Date(Date.now() - 30 * 1000)
    const run = await prisma.workflowRun.create({
      data: {
        pipelineId,
        status: 'running',
        startedAt: new Date(Date.now() - 60 * 1000),
        cancelRequestedAt: thirtySecAgo,
      },
    })

    await detectStuckRuns()

    const updated = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(updated.status).toBe('running')
    expect(updated.finishedAt).toBeNull()
    expect(updated.errorCategory).toBeNull()
  })

  it('classic stuck (60 мин без cancel) → failed с category=timeout (regression)', async () => {
    const pipelineId = await createPipeline()
    // startedAt = 61 минута назад → > MAX_RUN_DURATION_MS*2 (60 мин)
    const sixtyOneMinAgo = new Date(Date.now() - 61 * 60 * 1000)
    const run = await prisma.workflowRun.create({
      data: {
        pipelineId,
        status: 'running',
        startedAt: sixtyOneMinAgo,
        cancelRequestedAt: null,
      },
    })

    const count = await detectStuckRuns()
    expect(count).toBeGreaterThanOrEqual(1)

    const updated = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(updated.status).toBe('failed')
    expect(updated.errorCategory).toBe('timeout')
    expect(updated.finishedAt).not.toBeNull()
    expect(updated.errorMessage).toContain('watchdog')
  })

  it('cancel watchdog имеет приоритет: running+cancel >60 мин не попадает в обе ветки дважды', async () => {
    const pipelineId = await createPipeline()
    // Одновременно: и startedAt >60 мин, и cancelRequestedAt >2 мин.
    // Должен попасть ТОЛЬКО в cancel-ветку (cancelled, не failed).
    const run = await prisma.workflowRun.create({
      data: {
        pipelineId,
        status: 'running',
        startedAt: new Date(Date.now() - 61 * 60 * 1000),
        cancelRequestedAt: new Date(Date.now() - 5 * 60 * 1000),
      },
    })

    await detectStuckRuns()

    const updated = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(updated.status).toBe('cancelled')
    expect(updated.errorCategory).toBe('cancellation')
    expect(updated.errorMessage).toContain('cancel watchdog')
  })

  it('идемпотентность: второй вызов на уже cancelled не пишет ничего лишнего', async () => {
    const pipelineId = await createPipeline()
    const run = await prisma.workflowRun.create({
      data: {
        pipelineId,
        status: 'running',
        startedAt: new Date(Date.now() - 5 * 60 * 1000),
        cancelRequestedAt: new Date(Date.now() - 3 * 60 * 1000),
      },
    })

    await detectStuckRuns()
    const first = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } })
    const firstFinished = first.finishedAt
    expect(first.status).toBe('cancelled')

    await new Promise((r) => setTimeout(r, 10))
    await detectStuckRuns()
    const second = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(second.status).toBe('cancelled')
    expect(second.finishedAt?.getTime()).toBe(firstFinished?.getTime())
  })

  it('НЕ трогает pending+cancelRequestedAt (это ответственность B1 sweeper)', async () => {
    const pipelineId = await createPipeline()
    const run = await prisma.workflowRun.create({
      data: {
        pipelineId,
        status: 'pending',
        cancelRequestedAt: new Date(Date.now() - 5 * 60 * 1000),
      },
    })

    await detectStuckRuns()

    const updated = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(updated.status).toBe('pending')
    expect(updated.finishedAt).toBeNull()
  })
})
