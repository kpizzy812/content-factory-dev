/**
 * POST /api/characters/:id/regenerate
 *
 * Перегенерирует одно поле персонажа через AI: либо description (русский), либо
 * visualPrompt (английский 1-line). Reason от оператора учитывается агентом.
 *
 * Body: { blockType: 'description' | 'visualPrompt', reason?: string }
 * Response: { data: { newValue: string, oldValue: string, blockType: string } }
 */
import { regenerateCharacterBlock } from '~~/server/utils/agents/character-block-regenerator'
import type { CharacterBlockType } from '~~/server/utils/agents/character-block-regenerator'

const ALLOWED_BLOCK_TYPES: CharacterBlockType[] = ['description', 'visualPrompt']

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'id обязателен' })

  const character = await prisma.character.findUnique({
    where: { id },
    include: {
      referenceImages: {
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        take: 8,
      },
    },
  })
  if (!character) throw createError({ statusCode: 404, message: 'Персонаж не найден' })

  await requireScopedAccess(event, {
    permissions: ['canRunAgent'],
    moduleSlug: 'script-generator',
    appId: character.appId,
  })

  if (character.archived) {
    throw createError({ statusCode: 400, message: 'Персонаж в архиве — регенерация недоступна' })
  }

  const body = await readBody<{ blockType?: string; reason?: string }>(event).catch(() => ({} as { blockType?: string; reason?: string }))
  const blockType = body?.blockType as CharacterBlockType | undefined
  if (!blockType || !ALLOWED_BLOCK_TYPES.includes(blockType)) {
    throw createError({
      statusCode: 400,
      message: `blockType должен быть одним из: ${ALLOWED_BLOCK_TYPES.join(', ')}`,
    })
  }
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 1000) : ''

  const app = await prisma.app.findUnique({ where: { id: character.appId } })
  if (!app) throw createError({ statusCode: 404, message: 'Приложение персонажа не найдено' })

  const referenceDescriptions = character.referenceImages
    .map(r => r.aiVisualDescription)
    .filter((d): d is string => typeof d === 'string' && d.trim().length > 0)

  const oldValue = (blockType === 'description'
    ? character.description
    : character.visualPrompt) ?? ''

  let newValue: string
  try {
    newValue = await regenerateCharacterBlock({
      character: {
        name: character.name,
        description: character.description,
        visualPrompt: character.visualPrompt,
        role: character.role,
        ageRange: character.ageRange,
        emotionDefault: character.emotionDefault,
        tags: character.tags ?? [],
      },
      app: { name: app.name, description: app.description },
      blockType,
      reason: reason || null,
      referenceDescriptions,
    })
  }
  catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Не удалось перегенерировать блок'
    throw createError({ statusCode: 500, message: msg })
  }

  // Сохраняем — пишем именно то поле, что регенерировали.
  await prisma.character.update({
    where: { id },
    data: blockType === 'description'
      ? { description: newValue }
      : { visualPrompt: newValue },
  })

  return { data: { newValue, oldValue, blockType } }
})
