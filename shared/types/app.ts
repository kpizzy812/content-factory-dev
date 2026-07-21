// --- App entity types ---

/** Контролируемый словарь AI-тегов скриншотов приложения. AI может добавить свои, но controlled-список служит якорем. */
export const APP_REFERENCE_AI_TAGS = [
  'onboarding', 'login', 'signup', 'home_dashboard', 'feed', 'search',
  'profile', 'settings', 'checkout', 'payment', 'notifications', 'chat',
  'video_player', 'camera', 'upload_form', 'calendar', 'list_view',
  'detail_view', 'modal', 'empty_state', 'error_state', 'success_state',
  'loading_state',
] as const

export type AppReferenceAiTag = typeof APP_REFERENCE_AI_TAGS[number] | string

/** Богатая запись reference-картинки приложения: метаданные + AI-разметка для image-to-video. */
export interface AppReferenceImage {
  id: string
  appId: number
  fileUrl: string
  sha1: string
  mimeType?: string | null
  bytes?: number | null
  width?: number | null
  height?: number | null
  aiTags: string[]
  aiCaption?: string | null
  aiHasUI?: boolean | null
  aiPrimaryAction?: string | null
  aiAnalyzedAt?: string | null
  aiError?: string | null
  aiAttempts: number
  createdAt: string
  updatedAt: string
}

export interface AppStoreUrls {
  appStoreUrl?: string | null
  playStoreUrl?: string | null
}

export interface AppCreativeContext {
  /** Рекомендованные креативные углы */
  angles: AppCreativeAngle[]
  /** Нативные способы встраивания в сюжет */
  integrationHooks: string[]
  /** Эмоциональные триггеры */
  emotionalTriggers: string[]
}

export interface AppCreativeAngle {
  angle: string
  description: string
  bestFor: string // тип контента, для которого лучше подходит
}

export interface AppScenarioContext {
  /** Что это за приложение (1-2 предложения) */
  whatItIs: string
  /** Какую проблему решает */
  problemSolved: string
  /** Образ трансформации — до/после */
  transformationImage: string
  /** Как нативно встроить в сюжет */
  nativeIntegration: string
  /** Лучшие креативные углы */
  creativeAngles: AppCreativeAngle[]
  /** Формулировки и обещания, которых избегать */
  avoidClaims: string[]
  /** Рискованные утверждения (можно, но осторожно) */
  riskyClaims: string[]
  /** Тон бренда */
  brandTone: string
  /** Визуальные подсказки для видео */
  visualCues: string
  /** Ключевые фичи для упоминания */
  featureBullets: string[]
  /** ASO/SEO ключевые слова */
  keywords: string[]
  /** URL-ы reference-картинок приложения (для image-to-video, визуального контекста) */
  referenceImageUrls: string[]
}

/** Источник, из которого вытащено значение поля. Упорядочены по убыванию достоверности. */
export type FieldSource =
  | 'parser_jsonld'       // schema.org JSON-LD (software-application, SoftwareApplication)
  | 'parser_structured'   // embedded structured data (shoebox, AF_initDataCallback и т.п.)
  | 'parser_meta'         // meta tags (og:*, twitter:*, itemprop)
  | 'parser_dom'          // стабильные DOM-селекторы (class*="subtitle")
  | 'parser_regex'        // regex fallback по HTML
  | 'ai_fallback'         // достроено AI из raw content, когда парсер не нашёл
  | 'user'                // введено пользователем вручную
  | 'default'             // статический fallback (geo/language default)

/** Provenance одного извлечённого поля. */
export interface FieldProvenance {
  source: FieldSource
  /** 0..1, субъективная уверенность парсера в значении */
  confidence?: number
  /** Причина отсутствия — если поле не извлечено */
  missingReason?: string
}

/** Debug-отчёт о попытке извлечения store данных. */
export interface StoreExtractionReport {
  /** Поля, для которых удалось извлечь значение */
  found: string[]
  /** Поля, которые пытались извлечь, но не нашли */
  missing: string[]
  /** Обязательные поля, отсутствующие в parsed результате */
  requiredMissing: string[]
  /** Покрытие обязательных полей: 0..1 */
  requiredCoverage: number
  /** Покрытие всех опрошенных полей: 0..1 */
  overallCoverage: number
  /** Per-field provenance */
  sources: Record<string, FieldProvenance>
  /** Поля, которые восстановлены AI fallback-ом */
  aiBackfilled?: string[]
}

/** Данные, извлечённые из store page парсером */
export interface StoreParsedData {
  productName?: string
  subtitle?: string
  description?: string
  developer?: string
  categories?: string[]
  rating?: number
  ratingsCount?: number
  iconUrl?: string
  screenshotUrls?: string[]
  heroImageUrl?: string
  price?: string
  inAppPurchases?: boolean
  contentRating?: string
  lastUpdated?: string
  version?: string
  size?: string
  installs?: string
  whatsNew?: string
  /** Локаль/страница storefront, извлечённая из URL или структуры страницы */
  locale?: string
  /** Язык приложения, если явно указан */
  appLanguage?: string
}

/** Полный App для админского CRUD */
export interface AdminApp {
  id: number
  externalId?: number | null
  name: string
  description?: string | null
  keywords: string[]
  geo?: string | null
  language?: string | null

  appStoreUrl?: string | null
  playStoreUrl?: string | null
  storePlatforms: string[]

  productName?: string | null
  subtitle?: string | null
  longDescription?: string | null
  developer?: string | null
  categories: string[]
  targetAudience?: string | null
  pricingNotes?: string | null
  iconUrl?: string | null
  screenshotUrls: string[]
  heroImageUrl?: string | null
  referenceImageUrls: string[]

  featureBullets: string[]
  asoKeywords: string[]
  onboardingSummary?: string | null
  aiSummary?: string | null
  brandTone?: string | null
  visualCues?: string | null
  forbiddenClaims: string[]
  riskyClaims: string[]
  creativeAngles?: AppCreativeContext | null
  transformationPromise?: string | null
  corePain?: string | null
  coreOutcome?: string | null
  scenarioContext?: AppScenarioContext | null

  enrichmentStatus?: string | null
  lastEnrichedAt?: string | null
  enrichmentError?: string | null

  createdAt: string
  updatedAt: string
  _count?: {
    trends: number
    socialAccounts: number
    cycles: number
  }
}

/** Данные для создания/обновления App */
export interface AppFormData {
  name: string
  description?: string
  keywords?: string[]
  geo?: string
  language?: string
  appStoreUrl?: string
  playStoreUrl?: string
  storePlatforms?: string[]
  productName?: string
  subtitle?: string
  longDescription?: string
  developer?: string
  categories?: string[]
  targetAudience?: string
  pricingNotes?: string
  iconUrl?: string
  screenshotUrls?: string[]
  heroImageUrl?: string
  featureBullets?: string[]
  asoKeywords?: string[]
  onboardingSummary?: string
  aiSummary?: string
  brandTone?: string
  visualCues?: string
  forbiddenClaims?: string[]
  riskyClaims?: string[]
  creativeAngles?: AppCreativeContext
  transformationPromise?: string
  corePain?: string
  coreOutcome?: string
  scenarioContext?: AppScenarioContext
}

/** Результат обогащения */
export interface AppEnrichResult {
  success: boolean
  status: 'completed' | 'partial' | 'failed'
  message: string
  parsedData?: StoreParsedData
  aiContext?: AppScenarioContext
  /** Поля, успешно заполненные */
  filledFields?: string[]
  /** Ошибки по этапам */
  errors?: string[]
  /** Debug-отчёт об extraction (что нашли, что missing, какие источники) */
  extractionReport?: StoreExtractionReport
}

/** Лог обогащения */
export interface AppEnrichmentLogEntry {
  id: number
  appId: number
  sourceUrl: string
  platform: string
  status: string
  rawPayload?: unknown
  parsedData?: StoreParsedData
  aiContext?: AppScenarioContext
  errorMessage?: string | null
  createdAt: string
}
