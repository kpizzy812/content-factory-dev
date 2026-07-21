/**
 * Cancel a running pipeline execution.
 *
 * Hard cancel implementation:
 * 1. Sets cancelRequestedAt flag in DB
 * 2. Fires AbortController signal — immediately interrupts all in-flight operations
 * 3. Cascades cancel to child video pipelines (cancels fal.ai remote jobs)
 * 4. Cascades cancel to child sub-pipeline runs
 */
export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canRunAgent'],
    moduleSlug: 'pipeline',
  })

  const id = Number(getRouterParam(event, 'id'))
  const runId = Number(getRouterParam(event, 'runId'))

  if (Number.isNaN(id) || Number.isNaN(runId)) {
    throw createError({ statusCode: 400, message: 'Некорректные параметры' })
  }

  const run = await prisma.workflowRun.findFirst({
    where: { id: runId, pipelineId: id },
    include: { pipeline: { select: { userId: true, sharedWith: true } } },
  })

  if (!run) {
    throw createError({ statusCode: 404, message: 'Запуск не найден' })
  }

  // Access check
  const isOwner = run.pipeline.userId === user.id
  const isShared = run.pipeline.sharedWith.includes(user.id)
  if (!isOwner && !isShared && !user.canAdmin) {
    throw createError({ statusCode: 403, message: 'Нет доступа' })
  }

  if (!['running', 'pending'].includes(run.status)) {
    throw createError({
      statusCode: 400,
      message: `Невозможно отменить запуск в статусе "${run.status}"`,
    })
  }

  const { abortRun } = await import('~~/server/utils/pipeline-cancel-registry')

  // For pending runs, cancel immediately
  if (run.status === 'pending') {
    await prisma.workflowRun.update({
      where: { id: runId },
      data: {
        status: 'cancelled',
        cancelRequestedAt: new Date(),
        cancelRequestedBy: user.id,
        finishedAt: new Date(),
        errorMessage: 'Отменено пользователем до начала выполнения',
        errorCategory: 'cancellation',
      },
    })
  } else {
    // For running: set DB flag + fire AbortController signal
    await prisma.workflowRun.update({
      where: { id: runId },
      data: {
        cancelRequestedAt: new Date(),
        cancelRequestedBy: user.id,
      },
    })

    // Fire AbortController — immediately interrupts all in-flight operations
    abortRun(runId)

    // Cascade: cancel active video pipelines spawned by this run
    const videoSteps = await prisma.workflowStep.findMany({
      where: { runId, nodeType: 'video', status: { in: ['running'] } },
      select: { output: true },
    })
    for (const step of videoSteps) {
      const output = step.output as Record<string, unknown> | null
      const videos = (output?.videos ?? []) as Array<{ id?: number; status?: string }>
      for (const v of videos) {
        if (v.id && (v.status === 'generating_images' || v.status === 'generating_clips' || v.status === 'generating_music' || v.status === 'assembling' || v.status === 'generating_prompts')) {
          const { cancelVideoPipeline } = await import('~~/server/utils/video-pipeline')
          await cancelVideoPipeline(v.id).catch(() => {})
        }
      }
    }

    // Cascade: find any in-progress video records created by running workflow steps
    const runningStepNodeIds = await prisma.workflowStep.findMany({
      where: { runId, status: 'running', nodeType: 'video' },
      select: { id: true },
    })
    if (runningStepNodeIds.length > 0) {
      // Find videos in active generation states
      const activeVideos = await prisma.video.findMany({
        where: {
          status: { in: ['generating_prompts', 'generating_images', 'generating_clips', 'generating_music', 'assembling', 'pending'] as never[] },
          isLocked: true,
        },
        select: { id: true },
        take: 20,
      })
      for (const v of activeVideos) {
        const { cancelVideoPipeline } = await import('~~/server/utils/video-pipeline')
        await cancelVideoPipeline(v.id).catch(() => {})
      }
    }

    // Cascade: cancel child sub-pipeline runs
    const childRuns = await prisma.workflowRun.findMany({
      where: { parentRunId: runId, status: { in: ['running', 'pending'] } },
      select: { id: true },
    })
    for (const child of childRuns) {
      abortRun(child.id)
      await prisma.workflowRun.update({
        where: { id: child.id },
        data: {
          cancelRequestedAt: new Date(),
          cancelRequestedBy: user.id,
        },
      }).catch(() => {})
    }
  }

  await logAgent('pipeline-cancel', 'info',
    `Отмена запуска #${runId} конвейера #${id} пользователем #${user.id}`,
    { runId, pipelineId: id, userId: user.id, previousStatus: run.status },
  )

  return { data: { cancelled: true, runId } }
})
