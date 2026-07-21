/**
 * POST /api/ideas/:id/sync
 * Ресинхронизация одной идеи с MarketingCamp.
 * Если imported — пулит свежие данные с MC.
 * Если exported — пушит в MC.
 * Если conflict — force режим через body.mode = 'force_remote' | 'force_local'.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canWrite'],
    moduleSlug: 'script-generator',
  })

  const id = Number(getRouterParam(event, 'id'))
  if (!id || Number.isNaN(id)) {
    throw createError({ statusCode: 400, message: 'Некорректный ID идеи' })
  }

  const body = await readBody<{ mode?: 'force_remote' | 'force_local' }>(event)

  const idea = await prisma.idea.findUnique({
    where: { id },
    include: { app: { select: { id: true, name: true } } },
  })

  if (!idea || idea.isDeleted) {
    throw createError({ statusCode: 404, message: 'Идея не найдена' })
  }

  // Если нет externalId и нет sync — это чисто локальная идея, ничего синкать
  if (!idea.externalId && idea.syncDirection === 'local') {
    throw createError({
      statusCode: 400,
      message: 'Идея не связана с MarketingCamp. Используйте экспорт.',
    })
  }

  try {
    // Imported / bidirectional → пулим обновления из MC
    if (idea.externalId && (idea.syncDirection === 'imported' || idea.syncDirection === 'bidirectional')) {
      const result = await fetchRemoteCreatives({ limit: 1 })
      if (!result.ok) {
        await prisma.idea.update({
          where: { id },
          data: { syncStatus: 'error', lastSyncError: result.error },
        })
        throw createError({ statusCode: 502, message: result.error })
      }

      const remote = result.creatives.find(c => c.id === idea.externalId)

      if (!remote) {
        await prisma.idea.update({
          where: { id },
          data: {
            syncStatus: 'error',
            lastSyncError: 'Креатив не найден в MarketingCamp',
          },
        })
        return { data: { status: 'not_found_remote' } }
      }

      // Conflict resolution
      if (idea.localDirty && body?.mode !== 'force_remote') {
        await prisma.idea.update({
          where: { id },
          data: {
            syncStatus: 'conflict',
            remoteSnapshot: JSON.parse(JSON.stringify(remote)),
            lastSyncedAt: new Date(),
          },
        })
        return { data: { status: 'conflict', message: 'Есть локальные изменения. Укажите mode=force_remote для перезаписи.' } }
      }

      // Применяем remote
      const mapped = mapMcCreativeToIdea(remote)
      await prisma.idea.update({
        where: { id },
        data: {
          ...mapped,
          appId: idea.appId, // сохраняем локальную привязку к app
        } as any,
      })
      return { data: { status: 'synced_from_remote' } }
    }

    // Exported → пушим в MC
    if (idea.externalId && idea.syncDirection === 'exported') {
      const payload = mapIdeaToExportPayload(idea)
      const result = await updateRemoteCreative(idea.externalId, payload)
      if (!result.ok) {
        await prisma.idea.update({
          where: { id },
          data: { syncStatus: 'error', lastSyncError: result.error },
        })
        throw createError({ statusCode: 502, message: result.error })
      }

      await prisma.idea.update({
        where: { id },
        data: {
          syncStatus: 'synced',
          lastSyncedAt: new Date(),
          lastSyncError: null,
          localDirty: false,
        },
      })
      return { data: { status: 'synced_to_remote' } }
    }

    return { data: { status: 'no_action' } }
  } catch (err) {
    if ((err as any)?.statusCode) throw err
    const message = err instanceof Error ? err.message : 'Ошибка синхронизации'
    throw createError({ statusCode: 500, message })
  }
})
