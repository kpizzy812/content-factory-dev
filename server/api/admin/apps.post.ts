/**
 * POST /api/admin/apps
 * Создание нового приложения.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const body = await readBody(event)
  if (!body || typeof body !== "object") {
    throw createError({ statusCode: 400, message: "Тело запроса обязательно" })
  }

  if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
    throw createError({ statusCode: 400, message: "Название приложения обязательно" })
  }

  const str = (v: unknown) => typeof v === 'string' ? v.trim() : undefined
  const strArr = (v: unknown) => Array.isArray(v) ? v.filter((k: unknown) => typeof k === 'string') : []

  // Определяем enrichment статус из preview данных (используем фактический статус, а не хардкод)
  const hasEnrichment = !!body.enrichmentMeta
  const enrichmentData = hasEnrichment
    ? {
        enrichmentStatus: (body.enrichmentMeta as Record<string, unknown>)?.status === 'partial' ? 'partial' : 'completed',
        lastEnrichedAt: new Date(),
      }
    : {}

  const app = await prisma.app.create({
    data: {
      name: body.name.trim(),
      description: str(body.description),
      keywords: strArr(body.keywords),
      geo: str(body.geo),
      language: str(body.language),
      appStoreUrl: str(body.appStoreUrl),
      playStoreUrl: str(body.playStoreUrl),
      storePlatforms: strArr(body.storePlatforms),
      productName: str(body.productName),
      subtitle: str(body.subtitle),
      longDescription: str(body.longDescription),
      developer: str(body.developer),
      categories: strArr(body.categories),
      targetAudience: str(body.targetAudience),
      pricingNotes: str(body.pricingNotes),
      iconUrl: str(body.iconUrl),
      screenshotUrls: strArr(body.screenshotUrls),
      heroImageUrl: str(body.heroImageUrl),
      referenceImageUrls: strArr(body.referenceImageUrls),
      featureBullets: strArr(body.featureBullets),
      asoKeywords: strArr(body.asoKeywords),
      onboardingSummary: str(body.onboardingSummary),
      aiSummary: str(body.aiSummary),
      brandTone: str(body.brandTone),
      visualCues: str(body.visualCues),
      forbiddenClaims: strArr(body.forbiddenClaims),
      riskyClaims: strArr(body.riskyClaims),
      creativeAngles: body.creativeAngles ?? undefined,
      transformationPromise: str(body.transformationPromise),
      corePain: str(body.corePain),
      coreOutcome: str(body.coreOutcome),
      scenarioContext: body.scenarioContext ?? undefined,
      ...enrichmentData,
    },
  })

  // Если при создании были данные из enrich-preview — сохраняем enrichment log
  if (body.enrichmentMeta && typeof body.enrichmentMeta === 'object') {
    const meta = body.enrichmentMeta as Record<string, unknown>
    try {
      await prisma.appEnrichmentLog.create({
        data: {
          appId: app.id,
          sourceUrl: String(meta.storeUrl ?? ''),
          platform: String(meta.platform ?? 'app_store'),
          status: String(meta.status ?? 'success'),
          rawPayload: (meta.rawPayloadMeta as object) ?? undefined,
          parsedData: (meta.parsedData as object) ?? undefined,
          aiContext: (meta.aiContext as object) ?? undefined,
        },
      })
    } catch {
      // Non-critical: лог enrichment не должен ломать создание app
    }
  }

  return { data: app }
})
