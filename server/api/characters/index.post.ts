/**
 * POST /api/characters
 * Создание персонажа. После создания UI отдельным POST загружает референс-изображения.
 */
import type { CharacterCreatePayload, CharacterRole } from "~~/shared/types/character"

const ROLES: CharacterRole[] = ["protagonist", "support", "extra"]

export default defineEventHandler(async (event) => {
  const body = await readBody<CharacterCreatePayload>(event)
  const appId = Number(body?.appId)
  if (!appId || Number.isNaN(appId)) {
    throw createError({ statusCode: 400, message: "appId обязателен" })
  }
  const name = typeof body?.name === "string" ? body.name.trim() : ""
  if (!name) {
    throw createError({ statusCode: 400, message: "Имя персонажа обязательно" })
  }

  const user = await requireScopedAccess(event, {
    permissions: ["canCreate"],
    moduleSlug: "script-generator",
    appId,
  })

  const role: CharacterRole = ROLES.includes(body?.role as CharacterRole) ? (body.role as CharacterRole) : "protagonist"

  const character = await prisma.character.create({
    data: {
      appId,
      name,
      description: cleanString(body?.description),
      role,
      visualPrompt: cleanString(body?.visualPrompt),
      tags: Array.isArray(body?.tags) ? body.tags.filter(t => typeof t === "string" && t.trim()).slice(0, 32) : [],
      emotionDefault: cleanString(body?.emotionDefault),
      ageRange: cleanString(body?.ageRange),
      createdById: user.id,
    },
    include: {
      referenceImages: true,
    },
  })

  return { data: character }
})

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  return t || null
}
