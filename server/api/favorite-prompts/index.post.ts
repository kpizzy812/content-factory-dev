/**
 * POST /api/favorite-prompts — создание избранного промта.
 * Дедуп по (userId, sourceVideoAssetId) → 409 Conflict.
 */
import type { FavoritePromptCreateInput } from '../../../shared/types/favorite-prompt'

const MAX_PROMPT_TEXT = 5000
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
    permissions: ['canCreate'],
    moduleSlug: 'script-generator',
  })

  const body = await readBody<FavoritePromptCreateInput>(event)

  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, message: 'Тело запроса обязательно' })
  }

  const promptText = typeof body.promptText === 'string' ? body.promptText.trim() : ''
  if (!promptText) {
    throw createError({ statusCode: 400, message: "Поле 'promptText' обязательно" })
  }
  if (promptText.length > MAX_PROMPT_TEXT) {
    throw createError({ statusCode: 400, message: `promptText не должен превышать ${MAX_PROMPT_TEXT} символов` })
  }

  // appId: число > 0 или null
  let appId: number | null = null
  if (body.appId !== undefined && body.appId !== null) {
    const n = Number(body.appId)
    if (!Number.isFinite(n) || n <= 0) {
      throw createError({ statusCode: 400, message: "Поле 'appId' должно быть числом > 0 или null" })
    }
    appId = n
  }

  if (appId !== null) {
    const app = await prisma.app.findUnique({ where: { id: appId }, select: { id: true } })
    if (!app) {
      throw createError({ statusCode: 404, message: 'Приложение не найдено' })
    }
    // RBAC: не-admin должен иметь UserAppAssignment с accessLevel != 'none' для этого app.
    if (!user.canAdmin) {
      const assignment = user.appAssignments.find((a) => a.appId === appId)
      if (!assignment || assignment.accessLevel === "none") {
        throw createError({ statusCode: 403, message: 'Нет доступа к этому приложению' })
      }
    }
  }

  // sourceVideoAssetId: число > 0 или null
  let sourceVideoAssetId: number | null = null
  if (body.sourceVideoAssetId !== undefined && body.sourceVideoAssetId !== null) {
    const n = Number(body.sourceVideoAssetId)
    if (!Number.isFinite(n) || n <= 0) {
      throw createError({ statusCode: 400, message: "Поле 'sourceVideoAssetId' должно быть числом > 0 или null" })
    }
    sourceVideoAssetId = n
  }

  if (sourceVideoAssetId !== null) {
    const asset = await prisma.videoAsset.findUnique({ where: { id: sourceVideoAssetId }, select: { id: true } })
    if (!asset) {
      throw createError({ statusCode: 404, message: 'Исходный ассет не найден' })
    }

    // Дедуп: у этого пользователя уже есть запись с таким же sourceVideoAssetId
    const existing = await prisma.favoritePrompt.findFirst({
      where: { userId: user.id, sourceVideoAssetId },
      select: { id: true },
    })
    if (existing) {
      throw createError({
        statusCode: 409,
        message: `У вас уже есть избранный промт для этого ассета (ID: ${existing.id})`,
      })
    }
  }

  const tags = sanitizeTags(body.tags)

  let notes: string | null = null
  if (typeof body.notes === 'string') {
    const trimmed = body.notes.trim()
    if (trimmed.length > MAX_NOTES) {
      throw createError({ statusCode: 400, message: `notes не должен превышать ${MAX_NOTES} символов` })
    }
    notes = trimmed || null
  }

  const isPublic = typeof body.isPublic === 'boolean' ? body.isPublic : true

  const created = await prisma.favoritePrompt.create({
    data: {
      userId: user.id,
      appId,
      promptText,
      sourceVideoAssetId,
      tags,
      notes,
      isPublic,
    },
    include: {
      app: { select: { id: true, name: true } },
    },
  })

  // Fire-and-forget: запускаем background-извлечение паттерна сразу после create.
  // UI в библиотеке покажет "Анализируется…", через ~5-10с polling/refresh подтянет result.
  // Защита от перегрузки Anthropic — hard cap aiAnalysisAttempts >= 3 в самой обёртке.
  void maybeExtractPromptPatternBackground(created.id, created.promptText, 0)

  return { data: created }
})
