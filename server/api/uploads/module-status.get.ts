/**
 * GET /api/uploads/module-status
 * Возвращает статус модуля загрузки: включён/выключен, какие платформы доступны.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRead'], moduleSlug: 'social-upload' })

  const enabled = process.env.ENABLE_SOCIAL_POSTING === "true"

  // Platform capability matrix
  const platforms = {
    youtube: {
      available: true,
      directPublish: true,
      draftMode: false,
      schedulingSupport: "app-level",
      asyncProcessing: true,
      statusPolling: false,
      resumableUpload: true,
      maxFileSize: "256GB",
      metadataFields: ["title", "description", "tags", "privacyStatus"],
      limitations: ["Shorts detection by #Shorts tag and aspect ratio", "No native scheduling via API — app scheduler used"],
      oauthConfigured: !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET),
    },
    tiktok: {
      available: true,
      directPublish: true,
      draftMode: true,
      schedulingSupport: "app-level",
      asyncProcessing: true,
      statusPolling: false,
      resumableUpload: true,
      maxFileSize: "4GB",
      metadataFields: ["description", "hashtags"],
      limitations: ["Upload to Inbox flow — user publishes from TikTok app draft", "Title not natively supported — embedded in description", "Description limit: 2200 chars"],
      oauthConfigured: !!(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET),
    },
    instagram: {
      available: false,
      directPublish: false,
      draftMode: false,
      schedulingSupport: "none",
      asyncProcessing: false,
      statusPolling: false,
      resumableUpload: false,
      maxFileSize: "unknown",
      metadataFields: [],
      limitations: ["Requires Business/Creator account", "Requires Facebook App Review", "Not yet implemented — stub only"],
      oauthConfigured: !!(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET),
    },
  }

  // Counts
  const counts = await prisma.upload.groupBy({
    by: ["status"],
    _count: { id: true },
  })

  const statusCounts: Record<string, number> = {}
  for (const c of counts) {
    statusCounts[c.status] = c._count.id
  }

  return {
    data: {
      enabled,
      envFlag: "ENABLE_SOCIAL_POSTING",
      platforms,
      statusCounts,
    },
  }
})
