/**
 * POST /api/admin/apps/enrich-preview
 * Предварительное обогащение по store URL БЕЗ сохранения в БД.
 * Используется при создании нового приложения — возвращает parsed + AI данные,
 * которые форма может применить в memory до первого save.
 *
 * Цепочка источников для каждого поля (в порядке приоритета):
 *   parser_jsonld > parser_structured > parser_meta > parser_dom > parser_regex > ai_fallback
 * Если parser не нашёл обязательное поле, делается AI backfill с пометкой source=ai_fallback.
 * Enrichment log создаётся позже при POST /api/admin/apps (если передан enrichmentPreview).
 */
import type { AppEnrichResult, StoreExtractionReport } from '~~/shared/types/app'

/** Обязательные store-поля для статуса completed. */
const REQUIRED_FIELDS = ['productName', 'longDescription', 'developer', 'iconUrl'] as const

/**
 * Извлекает locale из App Store URL (apps.apple.com/{locale}/app/...).
 * Для Google Play locale в URL отсутствует — возвращает пустой объект.
 */
function extractLocaleFromUrl(url: string, platform: string): { geo?: string; language?: string } {
  if (platform === 'app_store') {
    const match = url.match(/apps\.apple\.com\/(\w{2})\/app\//)
    if (match) {
      const locale = match[1]!.toUpperCase()
      return { geo: locale, language: locale === 'RU' ? 'RU' : locale === 'US' ? 'EN' : locale }
    }
  }
  return {}
}

/**
 * Собирает formFields из parsed данных (store parser) + опционально AI-результата.
 * Гарантирует storePlatforms и geo/language fallback.
 */
function buildFormFields(
  pd: Record<string, unknown>,
  urlInfo: { platform: string },
  storeUrl: string,
  localeHints: { geo?: string; language?: string },
  aiResult?: Record<string, unknown> | null,
): Record<string, unknown> {
  const formFields: Record<string, unknown> = {}
  const storeUrlField = urlInfo.platform === 'app_store' ? 'appStoreUrl' : 'playStoreUrl'
  formFields[storeUrlField] = storeUrl

  // storePlatforms — всегда заполняем из platform
  formFields.storePlatforms = [urlInfo.platform === 'app_store' ? 'ios' : 'android']

  // Parsed fields
  if (pd.productName) formFields.productName = pd.productName
  if (pd.subtitle) formFields.subtitle = pd.subtitle
  if (pd.description) formFields.longDescription = pd.description
  if (pd.developer) formFields.developer = pd.developer
  if ((pd.categories as string[] | undefined)?.length) formFields.categories = pd.categories
  if (pd.iconUrl) formFields.iconUrl = pd.iconUrl
  if ((pd.screenshotUrls as string[] | undefined)?.length) formFields.screenshotUrls = pd.screenshotUrls
  if (pd.heroImageUrl) formFields.heroImageUrl = pd.heroImageUrl

  // Geo / language: user-provided > deterministic US/EN fallback
  formFields.geo = localeHints.geo || 'US'
  formFields.language = localeHints.language || 'EN'

  // AI fields (only when aiResult is available)
  if (aiResult) {
    if (aiResult.targetAudience) formFields.targetAudience = aiResult.targetAudience
    if (aiResult.pricingNotes) formFields.pricingNotes = aiResult.pricingNotes
    if ((aiResult.featureBullets as string[] | undefined)?.length) formFields.featureBullets = aiResult.featureBullets
    if ((aiResult.asoKeywords as string[] | undefined)?.length) formFields.asoKeywords = aiResult.asoKeywords
    if (aiResult.onboardingSummary) formFields.onboardingSummary = aiResult.onboardingSummary
    if (aiResult.aiSummary) formFields.aiSummary = aiResult.aiSummary
    if (aiResult.brandTone) formFields.brandTone = aiResult.brandTone
    if (aiResult.visualCues) formFields.visualCues = aiResult.visualCues
    if ((aiResult.forbiddenClaims as string[] | undefined)?.length) formFields.forbiddenClaims = aiResult.forbiddenClaims
    if ((aiResult.riskyClaims as string[] | undefined)?.length) formFields.riskyClaims = aiResult.riskyClaims
    if (aiResult.creativeAngles) formFields.creativeAngles = aiResult.creativeAngles
    if (aiResult.transformationPromise) formFields.transformationPromise = aiResult.transformationPromise
    if (aiResult.corePain) formFields.corePain = aiResult.corePain
    if (aiResult.coreOutcome) formFields.coreOutcome = aiResult.coreOutcome
    if (aiResult.scenarioContext) formFields.scenarioContext = aiResult.scenarioContext
    // AI backfill для required полей, когда parser их не нашёл
    if (aiResult.productName && !formFields.productName) formFields.productName = aiResult.productName
    if (aiResult.longDescription && !formFields.longDescription) formFields.longDescription = aiResult.longDescription
    if (aiResult.developer && !formFields.developer) formFields.developer = aiResult.developer
    // shortDescription (1-2 предложения о сути) → внутреннее description поле всегда;
    // и → subtitle только как fallback, если store-subtitle пуст
    if (aiResult.shortDescription) {
      formFields.description = aiResult.shortDescription
      if (!formFields.subtitle) formFields.subtitle = aiResult.shortDescription
    }
  }

  return formFields
}

/**
 * Применяет AI-backfill к extractionReport:
 *   - для полей, которые пришли ТОЛЬКО от AI (parser миссал), проставляет source=ai_fallback
 *   - возвращает список полей, восстановленных AI
 */
function applyAiBackfillReport(
  report: StoreExtractionReport,
  formFields: Record<string, unknown>,
  aiResult: Record<string, unknown> | null | undefined,
): StoreExtractionReport {
  const aiBackfilled: string[] = []
  if (!aiResult) return { ...report, aiBackfilled }

  const parserFieldMap: Record<string, string> = {
    productName: 'productName',
    longDescription: 'description',
    developer: 'developer',
    iconUrl: 'iconUrl',
    subtitle: 'subtitle',
  }

  for (const [formKey, parsedKey] of Object.entries(parserFieldMap)) {
    const existingSource = report.sources[parsedKey]
    const valueInForm = formFields[formKey]
    if (valueInForm && (!existingSource || existingSource.source === 'ai_fallback')) {
      // Это значение пришло из AI (parser его не имел)
      if (!existingSource) {
        report.sources[parsedKey] = { source: 'ai_fallback', confidence: 0.5 }
        aiBackfilled.push(formKey)
      }
    }
  }

  return { ...report, aiBackfilled }
}

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'canAdmin')

  const { storeUrl, appName, description, keywords, geo, language, useUrlLocale } = await readBody(event)

  if (!storeUrl || typeof storeUrl !== 'string') {
    throw createError({ statusCode: 400, message: 'storeUrl обязателен' })
  }

  const trimmedUrl = storeUrl.trim()
  const urlInfo = parseStoreUrl(trimmedUrl)
  if (!urlInfo) {
    return {
      data: {
        success: false,
        status: 'failed' as const,
        message: 'Невалидный store URL. Поддерживаются App Store и Google Play.',
      } satisfies AppEnrichResult,
    }
  }

  // Locale hints: user-provided > URL locale (если useUrlLocale) > дефолт US/EN в buildFormFields.
  const urlLocale = useUrlLocale !== false ? extractLocaleFromUrl(trimmedUrl, urlInfo.platform) : {}
  const localeHints = {
    geo: (geo as string)?.trim() || urlLocale.geo,
    language: (language as string)?.trim() || urlLocale.language,
  }

  // 1. Fetch + Parse store page
  let fetchResult
  try {
    fetchResult = await fetchAndParseStorePage(trimmedUrl)
  }
  catch (err: any) {
    await logAgent('app-enrichment', 'warn', `Pre-save enrichment fetch failed: ${err.message}`, { storeUrl: trimmedUrl })
    return {
      data: {
        success: false,
        status: 'failed' as const,
        message: `Не удалось загрузить страницу: ${err.message}`,
        errors: [err.message],
      } satisfies AppEnrichResult,
    }
  }

  const pd = fetchResult.parsed
  const baseReport = fetchResult.report

  await logAgent('app-enrichment', 'info', `Store page parsed: ${trimmedUrl}`, {
    platform: urlInfo.platform,
    foundFields: baseReport.found.length,
    missingRequired: baseReport.requiredMissing,
    requiredCoverage: baseReport.requiredCoverage,
  })

  // 2. AI-нормализация
  let aiResult
  try {
    aiResult = await runAppEnrichmentAgent({
      appName: appName || pd.productName || 'Unknown App',
      storeUrl: trimmedUrl,
      platform: urlInfo.platform,
      parsedData: pd,
      existingDescription: description || undefined,
      existingKeywords: keywords || undefined,
      geo: localeHints.geo || 'US',
      language: localeHints.language || 'EN',
    })

    await logAgent('app-enrichment', 'info', `Pre-save enrichment completed for "${appName || pd.productName}"`, {
      storeUrl: trimmedUrl,
      platform: urlInfo.platform,
    })
  }
  catch (err: any) {
    await logAgent('app-enrichment', 'warn', `Pre-save AI enrichment failed: ${err.message}`, { storeUrl: trimmedUrl })

    // Partial: парсинг ок, AI нет — но formFields всё равно строим из parsed данных
    const formFields = buildFormFields(pd as Record<string, unknown>, urlInfo, trimmedUrl, localeHints, null)
    const filledFields = Object.keys(formFields)

    return {
      data: {
        success: true,
        status: 'partial' as const,
        message: `Данные из store загружены, но AI-анализ не удался: ${err.message}`,
        parsedData: pd,
        filledFields,
        errors: [err.message],
        extractionReport: baseReport,
      } satisfies AppEnrichResult,
      formFields,
      enrichmentMeta: {
        storeUrl: trimmedUrl,
        platform: urlInfo.platform,
        status: 'partial',
        rawPayloadMeta: { htmlLength: fetchResult.rawHtml.length, coverage: fetchResult.coverage },
        parsedData: pd,
        aiContext: null,
        extractionReport: baseReport,
      },
    }
  }

  // 3. Собираем полный результат для предзаполнения формы (parser + AI)
  const formFields = buildFormFields(pd as Record<string, unknown>, urlInfo, trimmedUrl, localeHints, aiResult as unknown as Record<string, unknown>)
  const filledFields = Object.keys(formFields)

  // 4. AI backfill tracking — какие поля parser не имел, но AI дал
  const reportWithAi = applyAiBackfillReport(baseReport, formFields, aiResult as unknown as Record<string, unknown>)

  // 5. Итоговая проверка обязательных полей после parser + AI
  const missingRequired = REQUIRED_FIELDS.filter(f => !formFields[f])
  const actualStatus: 'completed' | 'partial' = missingRequired.length > 0 ? 'partial' : 'completed'

  // Detail message: сколько полей из parser, сколько из AI fallback
  const parserCount = Object.values(reportWithAi.sources).filter(s => s.source !== 'ai_fallback' && s.source !== 'user' && s.source !== 'default').length
  const aiBackfillCount = reportWithAi.aiBackfilled?.length ?? 0
  let statusMessage: string
  if (actualStatus === 'completed') {
    statusMessage = aiBackfillCount > 0
      ? `Данные загружены: ${parserCount} полей из магазина, ${aiBackfillCount} восстановлено AI`
      : `Данные из магазина полностью получены (${parserCount} полей)`
  }
  else {
    statusMessage = `Не хватает обязательных полей: ${missingRequired.join(', ')}`
  }

  return {
    data: {
      success: true,
      status: actualStatus,
      message: statusMessage,
      parsedData: pd,
      aiContext: aiResult.scenarioContext,
      filledFields,
      extractionReport: reportWithAi,
    } satisfies AppEnrichResult,
    formFields,
    enrichmentMeta: {
      storeUrl: trimmedUrl,
      platform: urlInfo.platform,
      status: actualStatus,
      rawPayloadMeta: { htmlLength: fetchResult.rawHtml.length, coverage: fetchResult.coverage },
      parsedData: pd,
      aiContext: aiResult.scenarioContext,
      extractionReport: reportWithAi,
    },
  }
})
