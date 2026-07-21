/**
 * Unit-тест finalizeCancelledPending — sweeper для pending+cancelRequestedAt.
 *
 * Контекст бага B (stuck "Останавливается"):
 *   processQueue фильтрует pending по `cancelRequestedAt: null`. Если cancel
 *   эндпоинт записал cancelRequestedAt, но не перевёл status (race / падение),
 *   то pending run застревает навечно — никто не финализирует его в cancelled
 *   до рестарта сервера.
 *
 * Sweeper находит такие записи и переводит их в cancelled с errorCategory='cancellation',
 * а также финализирует дочерние WorkflowStep с pending/running в cancelled.
 *
 * Тесты идут через реальную test-БД (singleThread + afterEach TRUNCATE из setup.ts).
 */
import { describe, expect, it } from 'vitest'
import { prisma } from '../../server/utils/prisma'
import { finalizeCancelledPending } from '../../server/utils/pipeline-runtime'

async function createPipeline(): Promise<number> {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  const user = await prisma.zavodUser.create({
    data: {
      externalId: seed,
      email: `sweep-${seed}@test`,
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

describe('finalizeCancelledPending — queue sweeper', () => {
  it('переводит pending+cancelRequestedAt в cancelled с errorCategory=cancellation', async () => {
    const pipelineId = await createPipeline()
    const run = await prisma.workflowRun.create({
      data: {
        pipelineId,
        status: 'pending',
        cancelRequestedAt: new Date(),
      },
    })

    await finalizeCancelledPending()

    const updated = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(updated.status).toBe('cancelled')
    expect(updated.errorCategory).toBe('cancellation')
    expect(updated.finishedAt).not.toBeNull()
    expect(updated.errorMessage).toContain('Отменён до начала выполнения')
    expect(updated.errorMessage).toContain('queue sweeper')
  })

  it('финализирует дочерние WorkflowStep (pending/running) как cancelled', async () => {
    const pipelineId = await createPipeline()
    const run = await prisma.workflowRun.create({
      data: {
        pipelineId,
        status: 'pending',
        cancelRequestedAt: new Date(),
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
        nodeType: 'scenario',
        status: 'running',
        startedAt: new Date(),
      },
    })

    await finalizeCancelledPending()

    const p = await prisma.workflowStep.findUniqueOrThrow({ where: { id: stepPending.id } })
    const r = await prisma.workflowStep.findUniqueOrThrow({ where: { id: stepRunning.id } })
    expect(p.status).toBe('cancelled')
    expect(p.errorCategory).toBe('cancellation')
    expect(p.finishedAt).not.toBeNull()
    expect(r.status).toBe('cancelled')
    expect(r.errorCategory).toBe('cancellation')
    expect(r.finishedAt).not.toBeNull()
  })

  it('не трогает pending с cancelRequestedAt=null (нормальные ожидающие)', async () => {
    const pipelineId = await createPipeline()
    const run = await prisma.workflowRun.create({
      data: {
        pipelineId,
        status: 'pending',
        cancelRequestedAt: null,
      },
    })

    await finalizeCancelledPending()

    const updated = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(updated.status).toBe('pending')
    expect(updated.errorCategory).toBeNull()
    expect(updated.finishedAt).toBeNull()
  })

  it('не трогает running с cancelRequestedAt (это ответственность B2 watchdog)', async () => {
    const pipelineId = await createPipeline()
    const run = await prisma.workflowRun.create({
      data: {
        pipelineId,
        status: 'running',
        cancelRequestedAt: new Date(),
        startedAt: new Date(),
      },
    })

    await finalizeCancelledPending()

    const updated = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(updated.status).toBe('running')
    expect(updated.errorCategory).toBeNull()
    expect(updated.finishedAt).toBeNull()
  })

  it('идемпотентность: второй вызов на уже cancelled не пишет ничего лишнего', async () => {
    const pipelineId = await createPipeline()
    const run = await prisma.workflowRun.create({
      data: {
        pipelineId,
        status: 'pending',
        cancelRequestedAt: new Date(),
      },
    })

    await finalizeCancelledPending()
    const first = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } })
    const firstFinished = first.finishedAt
    expect(first.status).toBe('cancelled')

    // Через паузу — повторный вызов не должен ни обновить finishedAt, ни упасть
    await new Promise((r) => setTimeout(r, 10))
    await finalizeCancelledPending()
    const second = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(second.status).toBe('cancelled')
    expect(second.finishedAt?.getTime()).toBe(firstFinished?.getTime())
  })

  it('обрабатывает несколько pending+cancelled одновременно', async () => {
    const pipelineId = await createPipeline()
    const runs = await Promise.all(
      [0, 1, 2].map(() =>
        prisma.workflowRun.create({
          data: {
            pipelineId,
            status: 'pending',
            cancelRequestedAt: new Date(),
          },
        }),
      ),
    )

    await finalizeCancelledPending()

    for (const run of runs) {
      const u = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } })
      expect(u.status).toBe('cancelled')
      expect(u.errorCategory).toBe('cancellation')
    }
  })
})
