/**
 * GET /api/characters/:id/recordings
 *
 * Список длинных записей ведущего с числом клипов, порезанных из каждой, и
 * суммарным объёмом всех записей персонажа — §6.1 требует, чтобы в UI было
 * видно, сколько места они занимают (записи весят гигабайты, а очистка ручная).
 */
export default defineEventHandler(async (event) => {
  const characterId = getRouterParam(event, "id")
  if (!characterId) throw createError({ statusCode: 400, message: "id обязателен" })

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { id: true, appId: true },
  })
  if (!character) throw createError({ statusCode: 404, message: "Персонаж не найден" })

  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "script-generator",
    appId: character.appId,
  })

  const recordings = await prisma.presenterRecording.findMany({
    where: { characterId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      originalName: true,
      durationSec: true,
      bytes: true,
      retention: true,
      ingestStatus: true,
      ingestError: true,
      createdAt: true,
      _count: { select: { clips: true } },
    },
  })

  const totalBytes = recordings.reduce((sum, recording) => sum + (recording.bytes ?? 0), 0)

  return {
    data: {
      recordings: recordings.map(recording => ({
        id: recording.id,
        originalName: recording.originalName,
        durationSec: recording.durationSec,
        bytes: recording.bytes,
        retention: recording.retention,
        ingestStatus: recording.ingestStatus,
        ingestError: recording.ingestError,
        createdAt: recording.createdAt,
        clipCount: recording._count.clips,
      })),
      totalBytes,
    },
  }
})
