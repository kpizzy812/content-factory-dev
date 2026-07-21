/**
 * PUT /api/admin/apps/:id
 * Обновление приложения.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const id = Number(getRouterParam(event, "id"))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: "Некорректный ID приложения" })
  }

  const existing = await prisma.app.findUnique({ where: { id } })
  if (!existing) {
    throw createError({ statusCode: 404, message: "Приложение не найдено" })
  }

  const body = await readBody(event)
  if (!body || typeof body !== "object") {
    throw createError({ statusCode: 400, message: "Тело запроса обязательно" })
  }

  const updateData: Record<string, unknown> = {}

  const setStr = (key: string, val: unknown) => {
    if (typeof val === 'string') updateData[key] = val.trim()
  }
  const setStrArr = (key: string, val: unknown) => {
    if (Array.isArray(val)) updateData[key] = val.filter((k: unknown) => typeof k === 'string')
  }
  const setJson = (key: string, val: unknown) => {
    if (val !== undefined) updateData[key] = val
  }

  if (typeof body.name === "string" && body.name.trim().length > 0) {
    updateData.name = body.name.trim()
  }
  setStr('description', body.description)
  setStrArr('keywords', body.keywords)
  setStr('geo', body.geo)
  setStr('language', body.language)
  setStr('appStoreUrl', body.appStoreUrl)
  setStr('playStoreUrl', body.playStoreUrl)
  setStrArr('storePlatforms', body.storePlatforms)
  setStr('productName', body.productName)
  setStr('subtitle', body.subtitle)
  setStr('longDescription', body.longDescription)
  setStr('developer', body.developer)
  setStrArr('categories', body.categories)
  setStr('targetAudience', body.targetAudience)
  setStr('pricingNotes', body.pricingNotes)
  setStr('iconUrl', body.iconUrl)
  setStrArr('screenshotUrls', body.screenshotUrls)
  setStr('heroImageUrl', body.heroImageUrl)
  setStrArr('referenceImageUrls', body.referenceImageUrls)
  setStrArr('featureBullets', body.featureBullets)
  setStrArr('asoKeywords', body.asoKeywords)
  setStr('onboardingSummary', body.onboardingSummary)
  setStr('aiSummary', body.aiSummary)
  setStr('brandTone', body.brandTone)
  setStr('visualCues', body.visualCues)
  setStrArr('forbiddenClaims', body.forbiddenClaims)
  setStrArr('riskyClaims', body.riskyClaims)
  setJson('creativeAngles', body.creativeAngles)
  setStr('transformationPromise', body.transformationPromise)
  setStr('corePain', body.corePain)
  setStr('coreOutcome', body.coreOutcome)
  setJson('scenarioContext', body.scenarioContext)

  const app = await prisma.app.update({
    where: { id },
    data: updateData,
  })

  return { data: app }
})
