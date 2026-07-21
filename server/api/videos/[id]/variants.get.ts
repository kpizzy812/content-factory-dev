/**
 * GET /api/videos/[id]/variants
 *
 * Track F — список уникализированных variant'ов для конкретного видео.
 */

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "video-generator",
  })

  const id = Number(getRouterParam(event, "id"))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, message: "Некорректный ID видео" })
  }

  const variants = await prisma.videoUniqueVariant.findMany({
    where: { videoId: id },
    orderBy: { createdAt: "desc" },
  })

  return {
    data: variants.map(v => ({
      id: v.id,
      platform: v.platform,
      paramsHash: v.paramsHash,
      paramsJson: v.paramsJson,
      filePath: v.filePath,
      fileUrl: v.fileUrl,
      fileHash: v.fileHash,
      durationSec: v.durationSec,
      fileSize: v.fileSize,
      createdAt: v.createdAt,
    })),
  }
})
