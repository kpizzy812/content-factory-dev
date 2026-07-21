import { mapIdeaToExportPayload } from "../../../utils/idea-sync"

export default defineEventHandler(async (event) => {
  requireZavodAuth(event)

  const id = Number(getRouterParam(event, "id"))
  if (!id || Number.isNaN(id)) {
    throw createError({ statusCode: 400, message: "Некорректный ID идеи" })
  }

  const idea = await prisma.idea.findUnique({
    where: { id },
    include: {
      app: { select: { id: true, externalId: true, name: true } },
      analysis: true,
    },
  })

  if (!idea || idea.isDeleted) {
    throw createError({ statusCode: 404, message: "Идея не найдена" })
  }

  const payload = mapIdeaToExportPayload(idea)

  return {
    data: {
      ...payload,
      id: idea.id,
      appExternalId: idea.app?.externalId ?? null,
      status: idea.status,
      createdAt: idea.createdAt.toISOString(),
      updatedAt: idea.updatedAt.toISOString(),
      analysis: idea.analysis ?? null,
    },
  }
})
