/**
 * Store URL validator, fetcher и multi-source parser.
 * Извлекает максимум полей из публичных страниц App Store и Google Play через цепочку источников:
 *   1. JSON-LD schema.org (primary — наиболее стабильный контракт)
 *   2. Embedded structured data (script blocks, App Store DOM hydration)
 *   3. Meta tags (og:*, twitter:*, itemprop)
 *   4. Стабильные DOM-селекторы
 *   5. Regex-фолбэки
 * Каждое значение помечается FieldSource, чтобы downstream понимал, откуда оно пришло.
 */

import type { StoreParsedData, FieldProvenance, FieldSource, StoreExtractionReport } from '~~/shared/types/app'

export type StorePlatform = 'app_store' | 'google_play'

interface StoreUrlInfo {
  platform: StorePlatform
  url: string
  appId: string
  /** Извлечённая из URL локаль (us, ru, gb, ...) — только для App Store */
  locale?: string
}

const APP_STORE_PATTERN = /^https?:\/\/apps\.apple\.com\/([\w-]+)\/app\/[\w-]+\/id(\d+)/
const GOOGLE_PLAY_PATTERN = /^https?:\/\/play\.google\.com\/store\/apps\/details\?id=([\w.]+)/

/** Обязательные product fields для статуса completed. */
const REQUIRED_FIELDS = ['productName', 'longDescription', 'developer', 'iconUrl'] as const

/** Все поля, за которыми следим при extraction. */
const TRACKED_FIELDS = [
  'productName',
  'subtitle',
  'description',
  'developer',
  'categories',
  'rating',
  'ratingsCount',
  'iconUrl',
  'screenshotUrls',
  'heroImageUrl',
  'price',
  'inAppPurchases',
  'contentRating',
  'installs',
  'locale',
  'appLanguage',
] as const

/**
 * Валидирует и определяет платформу store URL.
 */
export function parseStoreUrl(url: string): StoreUrlInfo | null {
  const trimmed = url.trim()

  const appStoreMatch = trimmed.match(APP_STORE_PATTERN)
  if (appStoreMatch) {
    return {
      platform: 'app_store',
      url: trimmed,
      appId: appStoreMatch[2]!,
      locale: appStoreMatch[1]!.toLowerCase(),
    }
  }

  const googlePlayMatch = trimmed.match(GOOGLE_PLAY_PATTERN)
  if (googlePlayMatch) {
    return { platform: 'google_play', url: trimmed, appId: googlePlayMatch[1]! }
  }

  return null
}

/**
 * Безопасно забирает HTML-страницу store.
 */
async function fetchStorePage(url: string): Promise<string> {
  const response = await $fetch<string>(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8',
    },
    timeout: 15_000,
    responseType: 'text',
  })

  if (!response || response.length < 500) {
    throw new Error('Получена пустая или слишком короткая страница')
  }

  return response
}

// =====================================================================
// Общие утилиты
// =====================================================================

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
}

function stripHtml(s: string): string {
  return decodeHtmlEntities(s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
}

function cleanText(s: string | undefined | null): string | undefined {
  if (!s) return undefined
  const cleaned = decodeHtmlEntities(String(s))
    .replace(/\u0026/g, '&')
    .replace(/\\n/g, '\n')
    .replace(/\s{3,}/g, '\n\n')
    .trim()
  return cleaned || undefined
}

/** Resolve Apple artwork template: `https://.../{w}x{h}{c}.{f}` → реальный URL размера size x size. */
function resolveAppleArtwork(template: string, size = 512, crop = 'bb', format = 'png'): string {
  return template
    .replace(/\{w\}/g, String(size))
    .replace(/\{h\}/g, String(size))
    .replace(/\{c\}/g, crop)
    .replace(/\{f\}/g, format)
}

interface ExtractAccumulator {
  data: StoreParsedData
  sources: Record<string, FieldProvenance>
}

function setField<K extends keyof StoreParsedData>(
  acc: ExtractAccumulator,
  key: K,
  value: StoreParsedData[K] | undefined,
  source: FieldSource,
  confidence = 0.9,
): void {
  if (value === undefined || value === null) return
  if (typeof value === 'string' && value.trim() === '') return
  if (Array.isArray(value) && value.length === 0) return
  // Не перезаписываем значение от более высокого priority источника
  const existing = acc.sources[key as string]
  if (existing && priorityOf(existing.source) <= priorityOf(source)) {
    return
  }
  acc.data[key] = value
  acc.sources[key as string] = { source, confidence }
}

/** Чем ниже число, тем выше priority источника. */
function priorityOf(src: FieldSource): number {
  switch (src) {
    case 'parser_jsonld': return 1
    case 'parser_structured': return 2
    case 'parser_meta': return 3
    case 'parser_dom': return 4
    case 'parser_regex': return 5
    case 'user': return 0
    case 'ai_fallback': return 6
    case 'default': return 10
  }
}

// =====================================================================
// JSON-LD extractor (общий для обеих платформ)
// =====================================================================

interface JsonLdNode {
  [key: string]: unknown
}

function extractJsonLdNodes(html: string, expectedType: string): JsonLdNode[] {
  const pattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  const nodes: JsonLdNode[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    const raw = match[1]?.trim()
    if (!raw) continue
    try {
      // JSON может быть объектом или массивом
      const parsed = JSON.parse(raw)
      const flat = Array.isArray(parsed) ? parsed : [parsed]
      for (const node of flat) {
        if (node && typeof node === 'object') {
          const t = (node as JsonLdNode)['@type']
          if (typeof t === 'string' && t.toLowerCase() === expectedType.toLowerCase()) {
            nodes.push(node as JsonLdNode)
          }
          else if (Array.isArray(t) && t.some(x => typeof x === 'string' && x.toLowerCase() === expectedType.toLowerCase())) {
            nodes.push(node as JsonLdNode)
          }
        }
      }
    }
    catch {
      // не валидный JSON — пропускаем
    }
  }
  return nodes
}

function applySoftwareApplicationNode(acc: ExtractAccumulator, node: JsonLdNode, source: FieldSource = 'parser_jsonld'): void {
  if (typeof node.name === 'string') {
    setField(acc, 'productName', cleanText(node.name), source, 0.95)
  }
  if (typeof node.description === 'string') {
    const desc = cleanText(node.description)
    if (desc) setField(acc, 'description', desc, source, 0.95)
  }
  if (typeof node.image === 'string') {
    setField(acc, 'iconUrl', node.image, source, 0.9)
  }
  if (typeof node.applicationCategory === 'string') {
    setField(acc, 'categories', [node.applicationCategory], source, 0.9)
  }
  else if (Array.isArray(node.applicationCategory)) {
    const cats = node.applicationCategory.filter((x): x is string => typeof x === 'string')
    if (cats.length > 0) setField(acc, 'categories', cats, source, 0.9)
  }
  if (typeof node.contentRating === 'string') {
    setField(acc, 'contentRating', node.contentRating, source, 0.9)
  }

  // author → developer
  const author = node.author as JsonLdNode | undefined
  if (author && typeof author === 'object' && typeof author.name === 'string') {
    setField(acc, 'developer', cleanText(author.name), source, 0.95)
  }
  else if (typeof node.author === 'string') {
    setField(acc, 'developer', cleanText(node.author), source, 0.8)
  }

  // aggregateRating → rating / ratingsCount
  const agg = node.aggregateRating as JsonLdNode | undefined
  if (agg && typeof agg === 'object') {
    const rv = Number(agg.ratingValue)
    if (!Number.isNaN(rv) && rv > 0) setField(acc, 'rating', rv, source, 0.9)
    const rc = Number(agg.ratingCount ?? agg.reviewCount)
    if (!Number.isNaN(rc) && rc > 0) setField(acc, 'ratingsCount', rc, source, 0.9)
  }

  // offers → price
  const offers = Array.isArray(node.offers) ? node.offers : node.offers ? [node.offers] : []
  for (const offer of offers) {
    if (!offer || typeof offer !== 'object') continue
    const o = offer as JsonLdNode
    if (typeof o.category === 'string' && o.category.toLowerCase() === 'free') {
      setField(acc, 'price', 'Free', source, 0.9)
      break
    }
    const priceVal = o.price
    if (priceVal !== undefined && priceVal !== null) {
      const num = Number(priceVal)
      if (!Number.isNaN(num) && num === 0) {
        setField(acc, 'price', 'Free', source, 0.9)
      }
      else if (typeof priceVal === 'string' && priceVal.trim()) {
        const curr = typeof o.priceCurrency === 'string' ? ` ${o.priceCurrency}` : ''
        setField(acc, 'price', `${priceVal}${curr}`, source, 0.85)
      }
      else if (typeof num === 'number' && num > 0) {
        const curr = typeof o.priceCurrency === 'string' ? ` ${o.priceCurrency}` : ''
        setField(acc, 'price', `${num}${curr}`, source, 0.85)
      }
      break
    }
  }
}

// =====================================================================
// Meta tags extractor
// =====================================================================

function extractMeta(html: string, selector: string): string | undefined {
  // поддерживаем property="..." content="..." и content="..." property="..."
  const patterns = [
    new RegExp(`<meta\\s+(?:[^>]*\\s)?property=["']${selector}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta\\s+(?:[^>]*\\s)?name=["']${selector}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta\\s+(?:[^>]*\\s)?itemprop=["']${selector}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']${selector}["']`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${selector}["']`, 'i'),
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m && m[1]) return cleanText(m[1])
  }
  return undefined
}

// =====================================================================
// App Store parser
// =====================================================================

interface AppStoreResult {
  parsed: StoreParsedData
  sources: Record<string, FieldProvenance>
}

function parseAppStorePage(html: string, info: StoreUrlInfo): AppStoreResult {
  const acc: ExtractAccumulator = { data: {}, sources: {} }

  // 1. JSON-LD SoftwareApplication / MobileApplication
  const jsonldNodes = [
    ...extractJsonLdNodes(html, 'SoftwareApplication'),
    ...extractJsonLdNodes(html, 'MobileApplication'),
  ]
  for (const node of jsonldNodes) {
    applySoftwareApplicationNode(acc, node, 'parser_jsonld')
  }

  // 2. Meta tags (backfill)
  const ogTitleRaw = extractMeta(html, 'og:title')
  if (ogTitleRaw && !acc.data.productName) {
    // App Store всегда суфиксирует "<Name> App - App Store" / "<Name> - App Store"
    const cleaned = ogTitleRaw
      .replace(/\s*App\s*-\s*App\s*Store\s*$/i, '')
      .replace(/\s*-\s*App\s*Store\s*$/i, '')
      .trim()
    if (cleaned) setField(acc, 'productName', cleaned, 'parser_meta', 0.7)
  }
  const ogDesc = extractMeta(html, 'og:description')
  if (ogDesc && !acc.data.description) {
    setField(acc, 'description', ogDesc, 'parser_meta', 0.5)
  }
  const ogImage = extractMeta(html, 'og:image')
  if (ogImage) {
    // На App Store og:image — это обычно hero/1200x630 placeholder, НЕ чистая иконка.
    // Используем как heroImageUrl; iconUrl оставляем за JSON-LD.
    setField(acc, 'heroImageUrl', ogImage, 'parser_meta', 0.7)
    if (!acc.data.iconUrl) {
      setField(acc, 'iconUrl', ogImage, 'parser_meta', 0.5)
    }
  }
  const ogLocale = extractMeta(html, 'og:locale')
  if (ogLocale) {
    setField(acc, 'locale', ogLocale, 'parser_meta', 0.9)
  }

  // 3. DOM extraction для subtitle — Apple использует class="subtitle ..."
  const subtitleMatch = html.match(/class=["'][^"']*\bsubtitle\b[^"']*["'][^>]*>([^<]{2,200})</i)
  if (subtitleMatch && subtitleMatch[1]) {
    const sub = cleanText(subtitleMatch[1])
    if (sub) setField(acc, 'subtitle', sub, 'parser_dom', 0.85)
  }

  // 4. Screenshots из embedded Artwork templates
  const screenshots = extractAppStoreScreenshots(html)
  if (screenshots.length > 0) {
    setField(acc, 'screenshotUrls', screenshots, 'parser_structured', 0.85)
  }

  // 5. Fallback: productName из H1 если JSON-LD пуст
  if (!acc.data.productName) {
    const h1 = html.match(/<h1[^>]*class=["'][^"']*product-header__title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)
      || html.match(/<h1[^>]*>([\s\S]{2,200}?)<\/h1>/i)
    if (h1 && h1[1]) {
      const cleaned = stripHtml(h1[1]).split('\n')[0]?.trim()
      if (cleaned) setField(acc, 'productName', cleaned, 'parser_regex', 0.5)
    }
  }

  // 6. Fallback description через section class
  if (!acc.data.description) {
    const desc = html.match(/<div[^>]*class=["'][^"']*section__description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
    if (desc && desc[1]) {
      const text = cleanText(stripHtml(desc[1]))
      if (text) setField(acc, 'description', text, 'parser_regex', 0.5)
    }
  }

  // 7. iconUrl refine: если это hero-preview — попробовать найти более точный AppIcon URL
  const appIconMatch = html.match(/(https:\/\/[^"'\s<>]*AppIcon[^"'\s<>]*\.(?:png|jpe?g)[^"'\s<>]*)/i)
  if (appIconMatch && appIconMatch[1]) {
    // Если уже был iconUrl из meta (hero-Placeholder), заменяем на AppIcon
    const existing = acc.data.iconUrl
    if (!existing || /Placeholder\.mill|1200x630wa/.test(existing)) {
      setField(acc, 'iconUrl', appIconMatch[1], 'parser_regex', 0.75)
    }
  }

  // 8. In-app purchases / content rating из embedded data / plain text
  if (/In-App Purchases|In-App Purchase|Встроенные покупки|"offers"[^}]*"type":"subscription"/i.test(html)) {
    acc.data.inAppPurchases = true
    acc.sources.inAppPurchases = { source: 'parser_regex', confidence: 0.6 }
  }

  // 9. locale + appLanguage из URL info (мягкий fallback)
  if (!acc.data.locale && info.locale) {
    setField(acc, 'locale', info.locale, 'parser_meta', 0.8)
  }

  return { parsed: acc.data, sources: acc.sources }
}

/**
 * App Store встраивает screenshot Artwork-объекты в HTML гидрации.
 * Формат блока: `"screenshot":{"$kind":"Artwork",...,"template":"URL","width":W,"height":H,...}`.
 * Блок содержит вложенные объекты (backgroundColor, textColor, variants), поэтому
 * смотрим в «широком окне» до 2000 символов lazy и ищем template + width.
 */
function extractAppStoreScreenshots(html: string, limit = 10): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  const re = /"screenshot":\s*\{[\s\S]{0,2000}?"template":"(https:[^"]+)"[\s\S]{0,400}?"width":(\d+)\s*,\s*"height":(\d+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const tpl = m[1]!.replace(/\\u002F/g, '/').replace(/\\\//g, '/')
    const w = parseInt(m[2]!) || 640
    const h = parseInt(m[3]!) || 1138
    // screenshots отдаём в полноформатном размере (max 1024 wide) в jpg
    const targetW = Math.min(w, 1024)
    const targetH = Math.round((h * targetW) / Math.max(w, 1))
    const resolved = resolveAppleArtwork(tpl, 0, 'bb', 'jpg')
      .replace(/\{w\}/g, String(targetW))
      .replace(/\{h\}/g, String(targetH))
    if (!seen.has(resolved)) {
      seen.add(resolved)
      urls.push(resolved)
    }
    if (urls.length >= limit) break
  }
  return urls
}

// =====================================================================
// Google Play parser
// =====================================================================

function parseGooglePlayPage(html: string): AppStoreResult {
  const acc: ExtractAccumulator = { data: {}, sources: {} }

  // 1. JSON-LD SoftwareApplication
  const jsonldNodes = extractJsonLdNodes(html, 'SoftwareApplication')
  for (const node of jsonldNodes) {
    applySoftwareApplicationNode(acc, node, 'parser_jsonld')
  }

  // 2. Meta tags (для productName/description Google Play иногда полнее)
  const ogTitle = extractMeta(html, 'og:title')
  if (ogTitle) {
    const cleaned = ogTitle
      .replace(/\s*-\s*Apps on Google Play\s*$/i, '')
      .replace(/\s*-\s*Приложения в Google Play\s*$/i, '')
      .trim()
    if (cleaned && (!acc.data.productName || cleaned.length > (acc.data.productName?.length ?? 0))) {
      setField(acc, 'productName', cleaned, 'parser_meta', 0.85)
    }
  }

  // meta[name=description] у Google Play обычно совпадает с short description, но лучше чем ничего
  const metaDesc = extractMeta(html, 'description')
  if (metaDesc && (!acc.data.description || metaDesc.length > (acc.data.description?.length ?? 0))) {
    setField(acc, 'description', metaDesc, 'parser_meta', 0.75)
  }

  const ogImage = extractMeta(html, 'og:image')
  if (ogImage) {
    setField(acc, 'heroImageUrl', ogImage, 'parser_meta', 0.7)
    if (!acc.data.iconUrl) setField(acc, 'iconUrl', ogImage, 'parser_meta', 0.7)
  }
  const ogLocale = extractMeta(html, 'og:locale')
  if (ogLocale) setField(acc, 'locale', ogLocale, 'parser_meta', 0.9)

  // 3. Extended description из DOM (Google Play JSON-LD даёт только tagline — full description живёт в
  //    <div data-g-id="description">). Если нашли что-то длиннее существующего description — принудительно
  //    перезаписываем (игнорируя priority JSON-LD), потому что GP-шный JSON-LD описание заведомо неполное.
  const existingDescLen = acc.data.description?.length ?? 0
  if (existingDescLen < 400) {
    const longDesc = extractGooglePlayLongDescription(html)
    if (longDesc && longDesc.length > existingDescLen) {
      acc.data.description = longDesc
      acc.sources.description = { source: 'parser_dom', confidence: 0.85 }
    }
  }

  // 4. Screenshots из play-lh.googleusercontent — берём только те, что не совпадают с icon
  const screenshots = extractGooglePlayScreenshots(html, acc.data.iconUrl)
  if (screenshots.length > 0) {
    setField(acc, 'screenshotUrls', screenshots, 'parser_dom', 0.75)
  }

  // 5. Category из genre или href pattern
  if (!acc.data.categories || acc.data.categories.length === 0) {
    const genreMatch = html.match(/\/store\/apps\/category\/([A-Z_]+)"[^>]*>([^<]{2,80})</)
    if (genreMatch) {
      setField(acc, 'categories', [cleanText(genreMatch[2]) ?? genreMatch[1]!], 'parser_dom', 0.7)
    }
  }

  // 6. Content rating
  if (!acc.data.contentRating) {
    const crMatch = html.match(/Rated for ([\w\s+]+)/i) || html.match(/Возрастной рейтинг[^<]*<[^>]*>([^<]+)</)
    if (crMatch && crMatch[1]) {
      setField(acc, 'contentRating', cleanText(crMatch[1]), 'parser_regex', 0.6)
    }
  }

  // 7. Installs
  const installsMatch = html.match(/"numDownloads"\s*:\s*"([^"]+)"/)
    || html.match(/>([0-9.,]+[KMB]?\+?)\s*Downloads</)
    || html.match(/>([0-9., ]+[KMB]?\+?)\s*(?:установок|скачиваний)</i)
  if (installsMatch && installsMatch[1]) {
    setField(acc, 'installs', cleanText(installsMatch[1]), 'parser_regex', 0.6)
  }

  // 8. In-app purchases
  if (/In-app purchases|In-App Purchases|Покупки в приложении/i.test(html)) {
    acc.data.inAppPurchases = true
    acc.sources.inAppPurchases = { source: 'parser_regex', confidence: 0.6 }
  }

  return { parsed: acc.data, sources: acc.sources }
}

/**
 * Пытается достать full description Google Play страницы.
 * Google Play часто хранит его в JSON-блоке AF_initDataCallback — но это громоздкая структура.
 * В качестве устойчивого path ищем div[jsname] или блок с длинным текстом после app title.
 */
function extractGooglePlayLongDescription(html: string): string | undefined {
  // data-g-id="description" — стабильный selector, иногда присутствует
  const byGId = html.match(/<div[^>]*data-g-id=["']description["'][^>]*>([\s\S]*?)<\/div>/i)
  if (byGId && byGId[1]) {
    const txt = cleanText(stripHtml(byGId[1]))
    if (txt && txt.length > 150) return txt
  }

  // jsname паттерн
  const byJsname = html.match(/<div[^>]*jsname=["'][^"']+["'][^>]*itemprop=["']description["'][^>]*>([\s\S]*?)<\/div>/i)
  if (byJsname && byJsname[1]) {
    const txt = cleanText(stripHtml(byJsname[1]))
    if (txt && txt.length > 150) return txt
  }

  // AF_initDataCallback — ищем длинные текстовые литералы > 400 символов
  const longLiterals = html.match(/"([^"\\]{400,5000}(?:\\.[^"\\]{0,5000})*)"/g)
  if (longLiterals) {
    for (const lit of longLiterals) {
      const unescaped = lit
        .slice(1, -1)
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '')
        .replace(/\\t/g, ' ')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
        .replace(/\\u0026/g, '&')
        .replace(/\\u003c/g, '<')
        .replace(/\\u003e/g, '>')
      // Откидываем литералы, которые похожи на JS/CSS/URL/скрипт
      if (
        unescaped.length > 300
        && !unescaped.startsWith('http')
        && !unescaped.startsWith('/')
        && !/^[{\[]/.test(unescaped.trim())
        && !/function\s*\(/.test(unescaped)
        && /[.!?]/.test(unescaped)  // похоже на текст
      ) {
        return cleanText(unescaped)
      }
    }
  }

  return undefined
}

function extractGooglePlayScreenshots(html: string, iconUrl?: string, limit = 10): string[] {
  // img с alt="Screenshot image" даёт стабильный selector
  const pattern = /<img[^>]*alt=["'](?:Screenshot image|Скриншот|Screenshot)[^"']*["'][^>]*src=["']([^"']+)["']/gi
  const altFirstPattern = /<img[^>]*src=["']([^"']*play-lh\.googleusercontent\.com[^"']+)["'][^>]*alt=["'](?:Screenshot image|Скриншот|Screenshot)[^"']*["']/gi
  const urls: string[] = []
  const seen = new Set<string>()
  if (iconUrl) seen.add(iconUrl)

  const add = (u: string) => {
    // убираем query-параметры sizing — приведём к полному разрешению
    const normalized = u.split('=')[0]!
    if (!seen.has(normalized)) {
      seen.add(normalized)
      urls.push(normalized)
    }
  }

  let m: RegExpExecArray | null
  while ((m = pattern.exec(html)) !== null && urls.length < limit) add(m[1]!)
  while ((m = altFirstPattern.exec(html)) !== null && urls.length < limit) add(m[1]!)

  return urls
}

// =====================================================================
// Public API
// =====================================================================

export interface FetchAndParseResult {
  platform: StorePlatform
  rawHtml: string
  parsed: StoreParsedData
  sources: Record<string, FieldProvenance>
  /** Сколько tracked полей удалось извлечь (0..1). */
  coverage: number
  /** Полный debug-отчёт. */
  report: StoreExtractionReport
}

/**
 * Основная функция: fetch + parse store page через multi-source стратегию.
 */
export async function fetchAndParseStorePage(url: string): Promise<FetchAndParseResult> {
  const info = parseStoreUrl(url)
  if (!info) {
    throw new Error(`Невалидный store URL: ${url}`)
  }

  const html = await fetchStorePage(info.url)

  const { parsed, sources } = info.platform === 'app_store'
    ? parseAppStorePage(html, info)
    : parseGooglePlayPage(html)

  const report = buildExtractionReport(parsed, sources)
  return { platform: info.platform, rawHtml: html, parsed, sources, coverage: report.overallCoverage, report }
}

/**
 * Строит debug-отчёт о extraction: что нашли, что missing, какие sources.
 */
export function buildExtractionReport(
  parsed: StoreParsedData,
  sources: Record<string, FieldProvenance>,
): StoreExtractionReport {
  const found: string[] = []
  const missing: string[] = []

  for (const f of TRACKED_FIELDS) {
    const v = (parsed as Record<string, unknown>)[f]
    const hasValue = v !== undefined && v !== null && v !== ''
      && (!Array.isArray(v) || v.length > 0)
    if (hasValue) found.push(f)
    else missing.push(f)
  }

  // Маппим StoreParsedData → admin app field names для required check
  const requiredMap: Record<string, unknown> = {
    productName: parsed.productName,
    longDescription: parsed.description,
    developer: parsed.developer,
    iconUrl: parsed.iconUrl,
  }
  const requiredMissing = Object.entries(requiredMap)
    .filter(([_, v]) => !v)
    .map(([k]) => k)

  const requiredCoverage = (REQUIRED_FIELDS.length - requiredMissing.length) / REQUIRED_FIELDS.length
  const overallCoverage = found.length / TRACKED_FIELDS.length

  return {
    found,
    missing,
    requiredMissing,
    requiredCoverage,
    overallCoverage,
    sources,
  }
}
