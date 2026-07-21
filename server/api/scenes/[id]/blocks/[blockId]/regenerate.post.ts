/**
 * POST /api/scenes/:id/blocks/:blockId/regenerate
 *
 * Перегенерирует ОДИН блок сцены через AI (Anthropic Sonnet) на основе текущего
 * контекста + опционального reason. Поддерживает только kind ∈ {action, style, environment}.
 *
 * Body: { reason?: string }
 * Response: { data: { updatedBlock: SceneBlock, sceneCompiledPrompt: string|null } }
 *
 * Логика:
 *  1. Загружаем Scene + App (для контекста AI).
 *  2. Ищем блок по blockId в scene.blocks.
 *  3. Валидируем kind ∈ {action, style, environment}.
 *  4. Вызываем regenerateSceneBlockAI (Sonnet, max_tokens 1500).
 *  5. Заменяем блок в массиве (preserve порядок и id), save.
 *  6. Опционально пересобираем compiledPrompt через composeScene для UI-предпросмотра.
 */
import { regenerateSceneBlockAI } from '~~/server/utils/agents/scene-block-regenerator'
import { composeScene, normalizeBlocks } from '~~/server/utils/scene-compose'
import type { SceneBlock } from '~~/shared/types/scene'
import type { Character, CharacterReferenceImage, AppReferenceImage } from '../../../../../../app/generated/prisma/client'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const blockId = getRouterParam(event, 'blockId')
  if (!id) throw createError({ statusCode: 400, message: 'id обязателен' })
  if (!blockId) throw createError({ statusCode: 400, message: 'blockId обязателен' })

  const scene = await prisma.scene.findUnique({ where: { id } })
  if (!scene) throw createError({ statusCode: 404, message: 'Сцена не найдена' })

  await requireScopedAccess(event, {
    permissions: ['canRunAgent'],
    moduleSlug: 'script-generator',
    appId: scene.appId,
  })

  if (scene.archived) {
    throw createError({ statusCode: 400, message: 'Сцена в архиве — регенерация недоступна' })
  }

  const body = await readBody<{ reason?: string }>(event).catch(() => ({} as { reason?: string }))
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 1000) : ''

  const blocks = normalizeBlocks(scene.blocks)
  const blockIndex = blocks.findIndex(b => b.id === blockId)
  if (blockIndex < 0) {
    throw createError({ statusCode: 404, message: 'Блок не найден в сцене' })
  }

  const targetBlock = blocks[blockIndex]!
  if (targetBlock.kind !== 'action' && targetBlock.kind !== 'style' && targetBlock.kind !== 'environment') {
    throw createError({
      statusCode: 400,
      message: `Регенерация недоступна для блока kind=${targetBlock.kind} (только action/style/environment)`,
    })
  }

  const app = await prisma.app.findUnique({ where: { id: scene.appId } })
  if (!app) throw createError({ statusCode: 404, message: 'Приложение сцены не найдено' })

  // Регенерация (один Sonnet-вызов).
  let updatedBlock: SceneBlock
  try {
    updatedBlock = await regenerateSceneBlockAI({
      block: targetBlock,
      scene: {
        name: scene.name,
        description: scene.description,
        tags: scene.tags ?? [],
      },
      app: {
        name: app.name,
        description: app.description,
      },
      reason: reason || null,
      otherBlocks: blocks.filter((_, i) => i !== blockIndex),
    })
  }
  catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Не удалось перегенерировать блок'
    throw createError({ statusCode: 500, message: msg })
  }

  // Сохраняем — обновляем blocks массив с новым блоком на том же месте.
  const nextBlocks: SceneBlock[] = [...blocks]
  nextBlocks[blockIndex] = updatedBlock

  await prisma.scene.update({
    where: { id },
    data: { blocks: nextBlocks as unknown as object },
  })

  // Для UI отдадим свежий compiledPrompt — чтобы превью обновился сразу без refetch'а сцены.
  // Загружаем character/app_screen из новых блоков, как в GET /api/scenes/:id.
  const characterIds = nextBlocks.filter(b => b.kind === 'character').map(b => b.characterId)
  const appScreenIds = nextBlocks.filter(b => b.kind === 'app_screen').map(b => b.referenceImageId)
  const charactersList = characterIds.length
    ? await prisma.character.findMany({
        where: { id: { in: characterIds } },
        include: { referenceImages: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } },
      })
    : []
  const appScreensList = appScreenIds.length
    ? await prisma.appReferenceImage.findMany({ where: { id: { in: appScreenIds } } })
    : []
  const sceneRefsList = await prisma.sceneReferenceImage.findMany({
    where: { sceneId: scene.id },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })

  const charactersMap = new Map<string, Character & { referenceImages: CharacterReferenceImage[] }>()
  for (const c of charactersList) charactersMap.set(c.id, c)
  const appScreensMap = new Map<string, AppReferenceImage>()
  for (const s of appScreensList) appScreensMap.set(s.id, s)

  let sceneCompiledPrompt: string | null = null
  try {
    const compiled = composeScene(nextBlocks, {
      characters: charactersMap,
      appScreens: appScreensMap,
      sceneRefs: sceneRefsList.map(r => ({
        id: r.id,
        fileUrl: r.fileUrl,
        kind: r.kind,
        aiVisualDescription: r.aiVisualDescription,
        aiCaption: r.aiCaption,
      })),
    })
    sceneCompiledPrompt = compiled.prompt
  }
  catch {
    // compose может упасть на неполных блоках — для UI это не критично.
    sceneCompiledPrompt = null
  }

  return { data: { updatedBlock, sceneCompiledPrompt } }
})
