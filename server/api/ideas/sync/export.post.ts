/**
 * POST /api/ideas/sync/export
 * Экспортирует выбранные идеи в MarketingCamp.
 * Body: { ideaIds: number[] }
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canWrite'],
    moduleSlug: 'script-generator',
  })

  const body = await readBody<{ ideaIds: number[] }>(event)

  if (!body?.ideaIds?.length) {
    throw createError({
      statusCode: 400,
      message: 'ideaIds обязателен и не должен быть пустым',
    })
  }

  if (body.ideaIds.length > 50) {
    throw createError({
      statusCode: 400,
      message: 'Максимум 50 идей за один экспорт',
    })
  }

  const ideas = await prisma.idea.findMany({
    where: {
      id: { in: body.ideaIds },
      isDeleted: false,
    },
    include: {
      app: { select: { id: true, name: true } },
    },
  })

  let exported = 0
  let skipped = 0
  const errors: Array<{ id: number; error: string }> = []

  for (const idea of ideas) {
    try {
      const payload = mapIdeaToExportPayload(idea)

      // Если у идеи уже есть externalId — обновляем, иначе создаём
      if (idea.externalId) {
        const result = await updateRemoteCreative(idea.externalId, payload)
        if (!result.ok) {
          errors.push({ id: idea.id, error: result.error })
          await prisma.idea.update({
            where: { id: idea.id },
            data: { syncStatus: 'error', lastSyncError: result.error },
          })
          continue
        }
      } else {
        const result = await pushCreativeToRemote(payload)
        if (!result.ok) {
          errors.push({ id: idea.id, error: result.error })
          await prisma.idea.update({
            where: { id: idea.id },
            data: { syncStatus: 'error', lastSyncError: result.error },
          })
          continue
        }

        // Сохраняем remote ID
        await prisma.idea.update({
          where: { id: idea.id },
          data: {
            externalId: result.remoteId,
            syncStatus: 'synced',
            syncDirection: idea.syncDirection === 'imported' ? 'bidirectional' : 'exported',
            lastSyncedAt: new Date(),
            lastSyncError: null,
            localDirty: false,
          },
        })
        exported++
        continue
      }

      // Обновление успешно
      await prisma.idea.update({
        where: { id: idea.id },
        data: {
          syncStatus: 'synced',
          syncDirection: idea.syncDirection === 'imported' ? 'bidirectional' : 'exported',
          lastSyncedAt: new Date(),
          lastSyncError: null,
          localDirty: false,
        },
      })
      exported++
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      errors.push({ id: idea.id, error: message })
    }
  }

  return {
    data: { exported, skipped: body.ideaIds.length - ideas.length, errors: errors.length > 0 ? errors : null },
    meta: { total: body.ideaIds.length },
  }
})
