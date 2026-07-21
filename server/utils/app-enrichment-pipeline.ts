/**
 * App Enrichment Pipeline — оркестрирует полный процесс обогащения приложения:
 *   1. Валидация URL
 *   2. Fetch + multi-source parse store page (JSON-LD > structured > meta > DOM > regex)
 *   3. AI-нормализация для креативного контекста и backfill обязательных полей
 *   4. Сохранение в БД + лог с field-level provenance
 * Статус completed выставляется только когда все обязательные product fields
 * (productName, longDescription, developer, iconUrl) реально заполнены.
 */

import type { AppEnrichResult, StoreExtractionReport } from '~~/shared/types/app'
import { parseStoreUrl, fetchAndParseStorePage } from './app-store-parser'
import { runAppEnrichmentAgent } from './agents/app-enrichment-agent'
import { buildAppScenarioContext } from './app-context'

interface EnrichmentOptions {
  appId: number
  storeUrl: string
}

const REQUIRED_FIELDS = ['productName', 'longDescription', 'developer', 'iconUrl'] as const

export async function runAppEnrichmentPipeline(options: EnrichmentOptions): Promise<AppEnrichResult> {
  const { appId, storeUrl } = options
  const errors: string[] = []
  const filledFields: string[] = []

  // 0. Загружаем текущее приложение
  const app = await prisma.app.findUnique({ where: { id: appId } })
  if (!app) {
    throw createError({ statusCode: 404, message: 'Приложение не найдено' })
  }

  // 1. Валидация URL
  const urlInfo = parseStoreUrl(storeUrl)
  if (!urlInfo) {
    await prisma.app.update({
      where: { id: appId },
      data: { enrichmentStatus: 'failed', enrichmentError: 'Невалидный store URL' },
    })
    return { success: false, status: 'failed', message: 'Невалидный store URL. Поддерживаются App Store и Google Play.', errors: ['Невалидный URL'] }
  }

  // Устанавливаем статус running
  await prisma.app.update({
    where: { id: appId },
    data: { enrichmentStatus: 'running', enrichmentError: null },
  })

  // 2. Fetch + Parse
  let fetchResult
  try {
    fetchResult = await fetchAndParseStorePage(storeUrl)
    filledFields.push('rawPayload', 'parsedData')

    await logAgent('app-enrichment', 'info', `Store page fetched: ${storeUrl}`, {
      appId,
      platform: fetchResult.platform,
      coverage: fetchResult.coverage,
      foundFields: fetchResult.report.found,
      missingRequired: fetchResult.report.requiredMissing,
    })
  }
  catch (err: any) {
    const errorMsg = `Не удалось загрузить страницу: ${err.message}`
    errors.push(errorMsg)

    await prisma.app.update({
      where: { id: appId },
      data: { enrichmentStatus: 'failed', enrichmentError: errorMsg },
    })

    // Сохраняем лог даже при ошибке
    await prisma.appEnrichmentLog.create({
      data: {
        appId,
        sourceUrl: storeUrl,
        platform: urlInfo.platform,
        status: 'failed',
        errorMessage: errorMsg,
      },
    })

    return { success: false, status: 'failed', message: errorMsg, errors }
  }

  // Обновляем базовые поля из парсинга
  const storeUrlField = urlInfo.platform === 'app_store' ? 'appStoreUrl' : 'playStoreUrl'
  const parseUpdate: Record<string, unknown> = {
    [storeUrlField]: storeUrl,
  }

  if (!app.storePlatforms?.includes(urlInfo.platform === 'app_store' ? 'ios' : 'android')) {
    const platforms = [...(app.storePlatforms || []), urlInfo.platform === 'app_store' ? 'ios' : 'android']
    parseUpdate.storePlatforms = platforms
  }

  const pd = fetchResult.parsed
  if (pd.productName) { parseUpdate.productName = pd.productName; filledFields.push('productName') }
  if (pd.subtitle) { parseUpdate.subtitle = pd.subtitle; filledFields.push('subtitle') }
  if (pd.description) { parseUpdate.longDescription = pd.description; filledFields.push('longDescription') }
  if (pd.developer) { parseUpdate.developer = pd.developer; filledFields.push('developer') }
  if (pd.categories?.length) { parseUpdate.categories = pd.categories; filledFields.push('categories') }
  if (pd.iconUrl) { parseUpdate.iconUrl = pd.iconUrl; filledFields.push('iconUrl') }
  if (pd.screenshotUrls?.length) { parseUpdate.screenshotUrls = pd.screenshotUrls; filledFields.push('screenshotUrls') }
  if (pd.heroImageUrl) { parseUpdate.heroImageUrl = pd.heroImageUrl; filledFields.push('heroImageUrl') }

  await prisma.app.update({
    where: { id: appId },
    data: parseUpdate,
  })

  // 3. AI-нормализация
  let aiResult
  try {
    aiResult = await runAppEnrichmentAgent({
      appName: app.name,
      storeUrl,
      platform: urlInfo.platform,
      parsedData: pd,
      existingDescription: app.description || undefined,
      existingKeywords: app.keywords || undefined,
      geo: app.geo || undefined,
      language: app.language || undefined,
    })

    filledFields.push('aiSummary', 'scenarioContext', 'creativeAngles', 'featureBullets')

    await logAgent('app-enrichment', 'info', `AI enrichment completed for app #${appId}`, {
      appId,
      fieldsCount: Object.keys(aiResult).length,
    })
  }
  catch (err: any) {
    const errorMsg = `AI-нормализация не удалась: ${err.message}`
    errors.push(errorMsg)

    await logAgent('app-enrichment', 'warn', errorMsg, { appId })

    // Partial success: парсинг удался, AI — нет
    await prisma.app.update({
      where: { id: appId },
      data: {
        enrichmentStatus: 'partial',
        enrichmentError: errorMsg,
        lastEnrichedAt: new Date(),
      },
    })

    await prisma.appEnrichmentLog.create({
      data: {
        appId,
        sourceUrl: storeUrl,
        platform: urlInfo.platform,
        status: 'partial',
        rawPayload: {
          htmlLength: fetchResult.rawHtml.length,
          coverage: fetchResult.coverage,
          extractionReport: fetchResult.report as unknown as object,
        },
        parsedData: pd as any,
        errorMessage: errorMsg,
      },
    })

    return {
      success: true,
      status: 'partial',
      message: `Данные из store загружены, но AI-анализ не удался: ${err.message}`,
      parsedData: pd,
      filledFields,
      errors,
      extractionReport: fetchResult.report,
    }
  }

  // 4. Сохраняем AI-результат + AI backfill для required полей, которые parser миссал
  const aiBackfilled: string[] = []
  const aiUpdate: Record<string, unknown> = {
    enrichmentError: null,
    lastEnrichedAt: new Date(),
  }

  if (aiResult.targetAudience) aiUpdate.targetAudience = aiResult.targetAudience
  if (aiResult.pricingNotes) aiUpdate.pricingNotes = aiResult.pricingNotes
  if (aiResult.featureBullets?.length) aiUpdate.featureBullets = aiResult.featureBullets
  if (aiResult.asoKeywords?.length) aiUpdate.asoKeywords = aiResult.asoKeywords
  if (aiResult.onboardingSummary) aiUpdate.onboardingSummary = aiResult.onboardingSummary
  if (aiResult.aiSummary) aiUpdate.aiSummary = aiResult.aiSummary
  if (aiResult.brandTone) aiUpdate.brandTone = aiResult.brandTone
  if (aiResult.visualCues) aiUpdate.visualCues = aiResult.visualCues
  if (aiResult.forbiddenClaims?.length) aiUpdate.forbiddenClaims = aiResult.forbiddenClaims
  if (aiResult.riskyClaims?.length) aiUpdate.riskyClaims = aiResult.riskyClaims
  if (aiResult.creativeAngles) aiUpdate.creativeAngles = aiResult.creativeAngles
  if (aiResult.transformationPromise) aiUpdate.transformationPromise = aiResult.transformationPromise
  if (aiResult.corePain) aiUpdate.corePain = aiResult.corePain
  if (aiResult.coreOutcome) aiUpdate.coreOutcome = aiResult.coreOutcome
  if (aiResult.scenarioContext) aiUpdate.scenarioContext = aiResult.scenarioContext
  // shortDescription → внутреннее description (1-2 предложения о сути); fallback для subtitle
  if (aiResult.shortDescription) {
    if (!app.description) aiUpdate.description = aiResult.shortDescription
    if (!parseUpdate.subtitle && !app.subtitle) aiUpdate.subtitle = aiResult.shortDescription
  }

  // AI backfill для required store fields, которые parser не нашёл
  if (aiResult.productName && !parseUpdate.productName && !app.productName) {
    aiUpdate.productName = aiResult.productName
    aiBackfilled.push('productName')
  }
  if (aiResult.longDescription && !parseUpdate.longDescription && !app.longDescription) {
    aiUpdate.longDescription = aiResult.longDescription
    aiBackfilled.push('longDescription')
  }
  if (aiResult.developer && !parseUpdate.developer && !app.developer) {
    aiUpdate.developer = aiResult.developer
    aiBackfilled.push('developer')
  }

  // Geo/language deterministic fallback (если app ещё не имеет)
  if (!app.geo) aiUpdate.geo = 'US'
  if (!app.language) aiUpdate.language = 'EN'

  // Валидация обязательного минимума для completed (с учётом AI backfill)
  const requiredCheck = {
    productName: aiUpdate.productName ?? parseUpdate.productName ?? app.productName,
    longDescription: aiUpdate.longDescription ?? parseUpdate.longDescription ?? app.longDescription,
    developer: aiUpdate.developer ?? parseUpdate.developer ?? app.developer,
    iconUrl: parseUpdate.iconUrl ?? app.iconUrl, // iconUrl нельзя достоверно back-fill'ить AI-ем
  }
  const missingRequired = Object.entries(requiredCheck).filter(([_, v]) => !v).map(([k]) => k)
  aiUpdate.enrichmentStatus = missingRequired.length > 0 ? 'partial' : 'completed'

  // Дополним extractionReport aiBackfilled-ами для лога и ответа
  const report: StoreExtractionReport = {
    ...fetchResult.report,
    aiBackfilled,
    sources: {
      ...fetchResult.report.sources,
      ...Object.fromEntries(aiBackfilled.map(f => [
        f === 'longDescription' ? 'description' : f,
        { source: 'ai_fallback' as const, confidence: 0.5 },
      ])),
    },
    requiredMissing: missingRequired,
    requiredCoverage: (REQUIRED_FIELDS.length - missingRequired.length) / REQUIRED_FIELDS.length,
  }

  await prisma.app.update({
    where: { id: appId },
    data: aiUpdate,
  })

  // 5. Сохраняем лог
  await prisma.appEnrichmentLog.create({
    data: {
      appId,
      sourceUrl: storeUrl,
      platform: urlInfo.platform,
      status: 'success',
      rawPayload: {
        htmlLength: fetchResult.rawHtml.length,
        coverage: fetchResult.coverage,
        extractionReport: report as unknown as object,
      },
      parsedData: pd as any,
      aiContext: aiResult.scenarioContext as any,
    },
  })

  // Читаем обновлённое приложение для контекста
  const updatedApp = await prisma.app.findUnique({ where: { id: appId } })
  const scenarioCtx = updatedApp
    ? buildAppScenarioContext(updatedApp as any)
    : aiResult.scenarioContext

  const finalStatus = (aiUpdate.enrichmentStatus as string) === 'completed' ? 'completed' : 'partial'
  const finalMessage = finalStatus === 'completed'
    ? aiBackfilled.length > 0
      ? `Приложение обогащено: parser + AI backfill для ${aiBackfilled.join(', ')}`
      : 'Приложение успешно обогащено данными из store и AI-анализом'
    : `Обогащение частичное — не хватает полей: ${missingRequired.join(', ')}`

  return {
    success: true,
    status: finalStatus as 'completed' | 'partial',
    message: finalMessage,
    parsedData: pd,
    aiContext: scenarioCtx,
    filledFields,
    extractionReport: report,
  }
}
