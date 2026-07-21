import { rm } from "node:fs/promises"

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canDelete'], moduleSlug: 'video-generator' })

  const id = Number(getRouterParam(event, "id"))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      message: "Некорректный ID видео",
    })
  }

  const video = await prisma.video.findUnique({
    where: { id },
    include: { assets: true },
  })

  if (!video) {
    throw createError({
      statusCode: 404,
      message: "Видео не найдено",
    })
  }

  // Удалить физические файлы
  const filesToDelete: string[] = []

  if (video.filePath) {
    filesToDelete.push(video.filePath)
  }

  for (const asset of video.assets) {
    if (asset.filePath) {
      filesToDelete.push(asset.filePath)
    }
  }

  // Удалить файлы (не ронять если файлов нет)
  for (const filePath of filesToDelete) {
    try {
      await safeUnlink(filePath)
    } catch {
      // Игнорируем ошибки удаления файлов
    }
  }

  // Удалить директорию ассетов видео
  const assetsDir = getAssetsDir(id)
  try {
    await rm(assetsDir, { recursive: true, force: true })
  } catch {
    // Игнорируем если директория не существует
  }

  // Удалить из БД (каскад на assets)
  await prisma.video.delete({ where: { id } })

  return { data: { id, deleted: true } }
})
