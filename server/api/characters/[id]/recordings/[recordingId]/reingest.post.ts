/**
 * POST /api/characters/:id/recordings/:recordingId/reingest
 *
 * Перенарезать уже сохранённую запись по текущим правилам без повторной
 * заливки (§6.1), либо поднять ingest, упавший на середине.
 */
import { RecordingIngestRunningError, reingestRecording } from "~~/server/utils/presenter/recording-store"

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

  // Запись обязана принадлежать персонажу из пути — иначе по чужому
  // recordingId можно перенарезать чужую запись.
  const recording = await prisma.presenterRecording.findUnique({
    where: { id: recordingId },
    select: { id: true, characterId: true, ingestStatus: true },
  })
  if (!recording || recording.characterId !== characterId) {
    throw createError({ statusCode: 404, message: "Запись не найдена" })
  }

  if (recording.ingestStatus === "running") {
    throw createError({ statusCode: 409, message: "Нарезка уже идёт" })
  }

  try {
    const result = await reingestRecording(recordingId)
    return { data: result }
  }
  catch (error) {
    // Гонка: статус успел смениться на "running" между проверкой выше и
    // атомарным захватом внутри reingestRecording — тоже 409, а не 500.
    if (error instanceof RecordingIngestRunningError) {
      throw createError({ statusCode: 409, message: "Нарезка уже идёт" })
    }
    throw error
  }
})
