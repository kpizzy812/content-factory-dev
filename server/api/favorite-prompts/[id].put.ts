/**
 * PUT /api/favorite-prompts/:id — редактирование избранного промта.
 * Разрешённые поля: tags, notes, appId, isPublic. promptText — immutable.
 * Только автор или admin.
 */
import type { FavoritePromptUpdateInput } from '../../../shared/types/favorite-prompt'

const MAX_NOTES = 1000
const MAX_TAGS = 10
const MAX_TAG_LEN = 40

function sanitizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of raw) {
    if (typeof t !== 'string') continue
    const trimmed = t.trim().slice(0, MAX_TAG_LEN)
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
    if (out.length >= MAX_TAGS) break
  }
  return out
}

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canWrite'],
    moduleSlug: 'script-generator',
  })

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID' })
  }

  const existing = await prisma.favoritePrompt.findUnique({ where: { id } })
  if (!existing) {
    throw createError({ statusCode: 404, message: 'Промт не найден' })
  }

  if (existing.userId !== user.id && !user.canAdmin) {
    throw createError({ statusCode: 403, message: 'Редактировать может только автор или администратор' })
  }

  const body = await readBody<FavoritePromptUpdateInput>(event)
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, message: 'Тело запроса обязательно' })
  }

  const data: Record<string, unknown> = {}

  if ('tags' in body) {
    data.tags = sanitizeTags(body.tags)
  }

  if ('notes' in body) {
    if (body.notes === null) {
      data.notes = null
    } else if (typeof body.notes === 'string') {
      const trimmed = body.notes.trim()
      if (trimmed.length > MAX_NOTES) {
        throw createError({ statusCode: 400, message: `notes не должен превышать ${MAX_NOTES} символов` })
      }
      data.notes = trimmed || null
    } else {
      throw createError({ statusCode: 400, message: "Поле 'notes' должно быть строкой или null" })
    }
  }

  if ('appId' in body) {
    if (body.appId === null) {
      data.appId = null
    } else {
      const n = Number(body.appId)
      if (!Number.isFinite(n) || n <= 0) {
        throw createError({ statusCode: 400, message: "Поле 'appId' должно быть числом > 0 или null" })
      }
      const app = await prisma.app.findUnique({ where: { id: n }, select: { id: true } })
      if (!app) {
        throw createError({ statusCode: 404, message: 'Приложение не найдено' })
      }
      if (!user.canAdmin) {
        const assignment = user.appAssignments.find((a) => a.appId === n)
        if (!assignment || assignment.accessLevel === "none") {
          throw createError({ statusCode: 403, message: 'Нет доступа к этому приложению' })
        }
      }
      data.appId = n
    }
  }

  if ('isPublic' in body && typeof body.isPublic === 'boolean') {
    data.isPublic = body.isPublic
  }

  if (Object.keys(data).length === 0) {
    throw createError({ statusCode: 400, message: 'Нужно указать хотя бы одно поле: tags, notes, appId, isPublic' })
  }

  const updated = await prisma.favoritePrompt.update({
    where: { id },
    data,
    include: {
      app: { select: { id: true, name: true } },
    },
  })

  return { data: updated }
})
