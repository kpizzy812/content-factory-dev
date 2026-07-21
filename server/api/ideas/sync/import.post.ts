/**
 * POST /api/ideas/sync/import
 * Импортирует креативы из MarketingCamp в библиотеку Ideas.
 * Body: { appId?: number, limit?: number }
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canCreate'],
    moduleSlug: 'script-generator',
  })

  const body = await readBody<{ appId?: number; limit?: number }>(event)

  const result = await fetchRemoteCreatives({
    appId: body?.appId,
    limit: body?.limit ?? 50,
  })

  if (!result.ok) {
    throw createError({
      statusCode: 502,
      message: result.error,
    })
  }

  let imported = 0
  let skipped = 0
  const errors: Array<{ id?: number; error: string }> = []

  for (const creative of result.creatives) {
    try {
      // Проверяем, есть ли уже импортированная идея с этим externalId
      const existing = await prisma.idea.findUnique({
        where: { externalId: creative.id },
      })

      if (existing) {
        // Если soft-deleted — не воскрешаем
        if (existing.isDeleted) {
          skipped++
          continue
        }

        // Обновляем snapshot и sync status, не трогая локальные поля если localDirty
        if (existing.localDirty) {
          await prisma.idea.update({
            where: { id: existing.id },
            data: {
              remoteSnapshot: JSON.parse(JSON.stringify(creative)),
              syncStatus: 'conflict',
              lastSyncedAt: new Date(),
            },
          })
          skipped++
          continue
        }

        // Обновляем данные из remote
        const mapped = mapMcCreativeToIdea(creative)
        await prisma.idea.update({
          where: { id: existing.id },
          data: mapped as any,
        })
        imported++
        continue
      }

      // Upsert App if appId/appName provided
      let appId: number | null = null
      if (creative.appId && creative.appName) {
        const app = await prisma.app.upsert({
          where: { externalId: creative.appId },
          create: { externalId: creative.appId, name: creative.appName },
          update: { name: creative.appName },
        })
        appId = app.id
      }

      // Создаём новую идею
      const mapped = mapMcCreativeToIdea(creative)
      await prisma.idea.create({
        data: {
          ...mapped,
          appId,
          status: 'ready',
        } as any,
      })
      imported++
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      errors.push({ id: creative.id, error: message })
    }
  }

  return {
    data: { imported, skipped, errors: errors.length > 0 ? errors : null },
    meta: { total: result.creatives.length },
  }
})
