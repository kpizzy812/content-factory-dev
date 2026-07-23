import { prisma } from './prisma'
import {
  isFactoryAutomationSyncEnabled,
  syncFactoryPublicationAutomation,
} from './factory-automation'

export async function linkFactoryPublication(input: {
  runId: number
  socialAccountId: number
  videoId: number
  uploadId?: number
}): Promise<void> {
  await prisma.factoryPublication.updateMany({
    where: {
      runId: input.runId,
      socialAccountId: input.socialAccountId,
    },
    data: {
      videoId: input.videoId,
      uploadId: input.uploadId,
      status: 'publishing',
    },
  })
}

function uploadPublicationStatus(status: string): string {
  if (status === 'published') return 'published'
  if (status === 'failed') return 'failed'
  if (status === 'canceled') return 'cancelled'
  if (status === 'blocked_by_env') return 'blocked'
  return 'publishing'
}

export async function syncFactoryPublicationFromUpload(uploadId: number): Promise<void> {
  const upload = await prisma.upload.findUnique({
    where: { id: uploadId },
    select: {
      id: true,
      videoId: true,
      status: true,
      platformPostId: true,
      platformPostUrl: true,
    },
  })
  if (!upload) return
  const status = uploadPublicationStatus(upload.status)
  await prisma.factoryPublication.updateMany({
    where: { uploadId },
    data: {
      videoId: upload.videoId,
      status,
      platformPostId: upload.platformPostId,
      platformPostUrl: upload.platformPostUrl,
      ...(status === 'published' ? { publishedAt: new Date() } : {}),
    },
  })

  if (status === 'published' && isFactoryAutomationSyncEnabled()) {
    const publication = await prisma.factoryPublication.findUnique({
      where: { uploadId },
      select: { id: true },
    })
    if (!publication) return
    try {
      await syncFactoryPublicationAutomation(publication.id)
    } catch {
      const failed = await prisma.factoryPublication.findUnique({
        where: { id: publication.id },
        select: { automationError: true },
      })
      console.error('[factory-automation] publication sync failed', {
        publicationId: publication.id,
        error: failed?.automationError ?? 'Unknown automation error',
      })
    }
  }
}
