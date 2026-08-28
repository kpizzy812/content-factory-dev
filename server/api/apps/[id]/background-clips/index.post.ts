/**
 * POST /api/apps/:id/background-clips
 *
 * Заливает один фон в библиотеку монтажа приложения (§9 «Библиотека фонов»).
 * Разбор файла, sha1-дедуп, перцептивный хэш и запись в БД — в
 * `server/utils/edit-plan/background-store.ts`: этот файл только принимает
 * multipart-запрос и делегирует (AGENTS.md — без inline-pipeline в server/api).
 */
import { withBackgroundPreviewUrls } from "~~/server/utils/edit-plan/background-preview"
import { saveBackgroundClip } from "~~/server/utils/edit-plan/background-store"

function readTextField(parts: Awaited<ReturnType<typeof readMultipartFormData>>, name: string): string | null {
  const part = parts?.find(item => item.name === name && item.data)
  return part?.data?.toString("utf-8").trim() || null
}

export default defineEventHandler(async (event) => {
  const appId = Number(getRouterParam(event, "id"))
  if (!Number.isInteger(appId) || appId <= 0) {
    throw createError({ statusCode: 400, message: "Некорректный id приложения" })
  }

  // Авторизация ПО `appId` ИЗ URL — до любого ветвления по существованию
  // приложения И до разбора multipart-тела (Important 4 финального ревью):
  // иначе разница 404 и 401/403 работает неавторизованным оракулом
  // существования `App.id`, а посторонний вдобавок заставляет сервер прочитать
  // и разобрать присланный им файл. Тот же порядок, что у соседнего DELETE.
  const user = await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "video-generator",
    appId,
  })

  const app = await prisma.app.findUnique({ where: { id: appId }, select: { id: true } })
  if (!app) throw createError({ statusCode: 404, message: "Приложение не найдено" })

  const parts = await readMultipartFormData(event)
  const filePart = parts?.find(part => part.name === "file" && part.filename && part.data)
  if (!filePart) throw createError({ statusCode: 400, message: "Поле `file` обязательно" })

  const name = readTextField(parts, "name")
  const kind = readTextField(parts, "kind")
  const tags = (readTextField(parts, "tags") || "")
    .split(/[\n,]/)
    .map(tag => tag.trim())
    .filter(Boolean)

  const result = await saveBackgroundClip({
    appId,
    data: filePart.data,
    filename: filePart.filename || "background",
    mime: (filePart.type || "").toLowerCase(),
    name,
    tags,
    kind,
    uploadedById: user.id,
  })

  // Клип возвращается той же формы, что в списке — со ссылкой на файл: карточка
  // только что загруженного фона обязана показать сам фон, а не ждать
  // перечитывания списка.
  const [clip] = await withBackgroundPreviewUrls([result.clip])

  return {
    data: {
      clip,
      deduped: result.deduped,
      similarClipIds: result.similarClipIds,
    },
  }
})
