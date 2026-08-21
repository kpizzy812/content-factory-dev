/**
 * PUT /api/characters/:id/recordings/:recordingId/retention
 *
 * `keep` защищает запись от автоочистки, `auto` возвращает её под общий режим.
 */
const VALID_RETENTION = ["keep", "auto"] as const

export default defineEventHandler(async (event) => {
  const characterId = getRouterParam(event, "id")
  const recordingId = getRouterParam(event, "recordingId")
  if (!characterId || !recordingId) {
    throw createError({ statusCode: 400, message: "id и recordingId обязательны" })
  }

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { id: true, appId: true },
  })
  if (!character) throw createError({ statusCode: 404, message: "Персонаж не найден" })

  await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "script-generator",
    appId: character.appId,
  })

  const recording = await prisma.presenterRecording.findUnique({
    where: { id: recordingId },
    select: { id: true, characterId: true },
  })
  if (!recording || recording.characterId !== characterId) {
    throw createError({ statusCode: 404, message: "Запись не найдена" })
  }

  const body = await readBody<{ retention?: string }>(event)
  if (!body?.retention || !VALID_RETENTION.includes(body.retention as typeof VALID_RETENTION[number])) {
    throw createError({
      statusCode: 400,
      message: `Поле retention обязано быть одним из: ${VALID_RETENTION.join(", ")}`,
    })
  }

  // Тот же набор полей, что отдаёт GET-список — не вся строка целиком:
  // storageKey/sha1/cooledAt наружу утекать не должны. activeClipCount
  // считается фильтром isActive: true — тем же смыслом, что использует
  // правило автоочистки (Мелочь 7 из ревью, фикс-раунд 1; см. комментарий в
  // index.get.ts).
  const updated = await prisma.presenterRecording.update({
    where: { id: recordingId },
    data: { retention: body.retention },
    select: {
      id: true,
      originalName: true,
      durationSec: true,
      bytes: true,
      retention: true,
      ingestStatus: true,
      ingestError: true,
      createdAt: true,
      _count: { select: { clips: { where: { isActive: true } } } },
    },
  })

  return {
    data: {
      id: updated.id,
      originalName: updated.originalName,
      durationSec: updated.durationSec,
      bytes: updated.bytes,
      retention: updated.retention,
      ingestStatus: updated.ingestStatus,
      ingestError: updated.ingestError,
      createdAt: updated.createdAt,
      activeClipCount: updated._count.clips,
    },
  }
})
