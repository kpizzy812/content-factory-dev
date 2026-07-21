/**
 * PUT /api/characters/:id — обновление полей персонажа.
 */
import type { CharacterUpdatePayload, CharacterRole } from "~~/shared/types/character"

const ROLES: CharacterRole[] = ["protagonist", "support", "extra"]

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, message: "id обязателен" })

  const existing = await prisma.character.findUnique({ where: { id }, select: { appId: true } })
  if (!existing) throw createError({ statusCode: 404, message: "Персонаж не найден" })

  await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "script-generator",
    appId: existing.appId,
  })

  const body = await readBody<CharacterUpdatePayload>(event)
  const data: Record<string, unknown> = {}

  if (typeof body?.name === "string" && body.name.trim()) data.name = body.name.trim()
  if (body?.description !== undefined) data.description = body.description?.trim() || null
  if (typeof body?.role === "string" && ROLES.includes(body.role)) data.role = body.role
  if (body?.visualPrompt !== undefined) data.visualPrompt = body.visualPrompt?.trim() || null
  if (Array.isArray(body?.tags)) {
    data.tags = body.tags.filter((t: unknown) => typeof t === "string" && t.trim()).slice(0, 32)
  }
  if (body?.emotionDefault !== undefined) data.emotionDefault = body.emotionDefault?.trim() || null
  if (body?.ageRange !== undefined) data.ageRange = body.ageRange?.trim() || null
  if (typeof body?.archived === "boolean") data.archived = body.archived

  const character = await prisma.character.update({
    where: { id },
    data,
    include: {
      referenceImages: {
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      },
    },
  })

  return { data: character }
})
