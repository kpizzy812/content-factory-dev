/**
 * POST /api/ai/suggest/trendwatcher-config
 *
 * Block-level AI-autofill для trendwatcher pipeline node / profile.
 * Генерирует полный конфиг парсинга (actor, keywords, platforms, geo/lang, thresholds, limits)
 * на основе приложения, пользовательского запроса и текущего состояния конфига.
 *
 * Возвращает данные в формате поля -> value + reasoning + auditId для AiAuditLog.
 */

const VALID_PLATFORMS = ["tiktok", "instagram", "youtube"] as const
const VALID_GEO = ["US", "GB", "RU", "DE", "FR", "NL", "ES", "IT", "BR", "IN", "JP", "KR", "TR", "KZ", "UA", "BY"] as const
const VALID_LANG = ["EN", "RU", "ES", "DE", "FR", "PT", "JA", "KO"] as const
// Реально существующие акторы Apify Store. apify/tiktok-scraper и apify/youtube-scraper
// официально не публиковались — в Store community-лидеры: clockworks для TikTok,
// streamers для YouTube. Для Instagram официальный apify/instagram-scraper рабочий.
const KNOWN_ACTORS = [
  "clockworks/tiktok-scraper",
  "apidojo/tiktok-scraper",
  "apify/instagram-scraper",
  "streamers/youtube-scraper",
  "apidojo/youtube-scraper",
]

interface TrendwatcherSuggestion {
  appId?: number
  actorId?: string
  keywords?: string[]
  platforms?: Array<"tiktok" | "instagram" | "youtube">
  geo?: string
  language?: string
  viewCountMin?: number | null
  viewCountMax?: number | null
  maxItems?: number
  name?: string
  preset?: string | null
  reasoning?: string
}

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRunAgent"],
    moduleSlug: "pipeline",
  })

  const body = await readBody<{
    prompt: string
    appId?: number
    currentConfig?: Record<string, unknown>
    pipelineId?: number
    nodeCanvasId?: string
  }>(event)

  if (!body?.prompt?.trim()) {
    throw createError({ statusCode: 400, message: "Промт обязателен" })
  }

  const prompt = body.prompt.trim()

  // Если appId не передан — грузим каталог приложений, чтобы AI мог выбрать его сам
  // по имени из промта пользователя (например "найди тренды для FitnessFun" → appId=4).
  let appsCatalog: Array<{ id: number; name: string; subtitle: string | null; description: string | null }> = []
  let appCatalogLines: string[] = []
  let validAppIds = new Set<number>()
  if (!body.appId) {
    appsCatalog = await prisma.app.findMany({
      select: { id: true, name: true, subtitle: true, description: true },
      orderBy: { name: "asc" },
      take: 100,
    })
    appCatalogLines = appsCatalog.map((a) => {
      const desc = a.subtitle || (a.description ? a.description.slice(0, 100) : "")
      return `- id=${a.id}: "${a.name}"${desc ? ` — ${desc}` : ""}`
    })
    validAppIds = new Set(appsCatalog.map((a) => a.id))
  }

  // Подтягиваем контекст приложения, если appId передан
  let appContext = ""
  if (typeof body.appId === "number" && body.appId > 0) {
    const app = await prisma.app.findUnique({
      where: { id: body.appId },
      select: {
        name: true,
        description: true,
        subtitle: true,
        keywords: true,
        geo: true,
        language: true,
        brandTone: true,
        targetAudience: true,
        featureBullets: true,
        creativeAngles: true,
      },
    })
    if (app) {
      const parts: string[] = [`Название: ${app.name}`]
      if (app.subtitle) parts.push(`Короткое описание: ${app.subtitle}`)
      else if (app.description) parts.push(`Описание: ${app.description.slice(0, 300)}`)
      if (app.keywords?.length) parts.push(`Ключевые слова приложения: ${app.keywords.slice(0, 20).join(", ")}`)
      if (app.geo) parts.push(`Дефолтное гео: ${app.geo}`)
      if (app.language) parts.push(`Дефолтный язык: ${app.language}`)
      if (app.brandTone) parts.push(`Тон бренда: ${app.brandTone}`)
      if (app.targetAudience) parts.push(`Целевая аудитория: ${app.targetAudience}`)
      if (Array.isArray(app.featureBullets) && app.featureBullets.length) {
        parts.push(`Фичи: ${(app.featureBullets as string[]).slice(0, 6).join("; ")}`)
      }
      if (Array.isArray(app.creativeAngles) && app.creativeAngles.length) {
        parts.push(`Углы подачи: ${(app.creativeAngles as string[]).slice(0, 5).join("; ")}`)
      }
      appContext = parts.join("\n")
    }
  }

  // Доступные стратегии поиска (taxonomy items) — AI выбирает одну по контексту
  const strategies = await prisma.taxonomyItem.findMany({
    where: { type: "strategy", isArchived: false },
    select: { slug: true, name: true, shortDescription: true, useCases: true },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    take: 50,
  })
  const strategyLines = strategies.map((s) => {
    const useCases = s.useCases?.length ? ` [подходит: ${s.useCases.slice(0, 3).join("; ")}]` : ""
    return `- ${s.slug}: ${s.name} — ${s.shortDescription}${useCases}`
  })
  const validStrategySlugs = new Set(strategies.map((s) => s.slug))

  // Текущий конфиг — чтобы AI дополнял, а не перетирал
  const currentLines: string[] = []
  const cc = body.currentConfig ?? {}
  if (cc.actorId) currentLines.push(`- actorId: ${cc.actorId}`)
  if (Array.isArray(cc.platforms) && cc.platforms.length) {
    currentLines.push(`- platforms: ${(cc.platforms as string[]).join(", ")}`)
  }
  if (Array.isArray(cc.keywords) && cc.keywords.length) {
    currentLines.push(`- keywords: ${(cc.keywords as string[]).slice(0, 20).join(", ")}`)
  }
  if (cc.geo) currentLines.push(`- geo: ${cc.geo}`)
  if (cc.language) currentLines.push(`- language: ${cc.language}`)
  if (cc.viewCountMin != null) currentLines.push(`- viewCountMin: ${cc.viewCountMin}`)
  if (cc.viewCountMax != null) currentLines.push(`- viewCountMax: ${cc.viewCountMax}`)
  if (cc.maxItems != null) currentLines.push(`- maxItems: ${cc.maxItems}`)
  if (cc.preset) currentLines.push(`- preset (стратегия): ${cc.preset}`)

  const userPrompt = `Запрос пользователя: "${prompt}"

${appContext ? `## Контекст приложения (уже выбрано)\n${appContext}\n` : ""}
${appCatalogLines.length ? `## Доступные приложения (выбери одно по имени из промта)\n${appCatalogLines.join("\n")}\n` : ""}
${currentLines.length ? `## Текущий конфиг ноды\n${currentLines.join("\n")}\n` : ""}
## Задача
Подбери ОПТИМАЛЬНЫЙ конфиг для парсинга трендов Apify под это приложение.
Рассуждай как senior growth-маркетолог, который ищет вирусный контент для референсов.
${appCatalogLines.length ? `Если в промте упомянуто имя приложения — найди ID в каталоге выше и верни appId.` : ""}

## Допустимые значения
${appCatalogLines.length ? `- appId: целое число — id из каталога приложений выше. Верни ТОЛЬКО если в промте чётко указано имя одного из приложений. Иначе опусти.` : ""}
- actorId: ${KNOWN_ACTORS.join(" | ")} (выбирай по доминирующей платформе)
- platforms: любое подмножество из ${VALID_PLATFORMS.join(", ")}
- geo: ${VALID_GEO.join(", ")}
- language: ${VALID_LANG.join(", ")}
- keywords: 6-15 точных фраз на ${"{{язык}}"} (НЕ общие "funny", "viral" — только релевантные теме приложения)
- viewCountMin: разумный порог вирусности (например 50000-500000 в зависимости от ниши), или null
- viewCountMax: обычно null
- maxItems: 10-50, по умолчанию 20
- name: короткое имя профиля (если имеет смысл сохранить)
- preset (стратегия поиска): ${strategyLines.length ? "выбери ОДИН slug из списка ниже, либо null если ни одна не подходит" : "ОТСУТСТВУЕТ — верни null"}
${strategyLines.length ? `\n### Доступные стратегии\n${strategyLines.join("\n")}\n` : ""}
## Формат ответа (строгий JSON, без обёрток)
{
${appCatalogLines.length ? `  "appId": 4,\n` : ""}  "actorId": "...",
  "platforms": ["tiktok", ...],
  "keywords": ["...", "..."],
  "geo": "US",
  "language": "EN",
  "viewCountMin": 100000,
  "viewCountMax": null,
  "maxItems": 20,
  "name": "TikTok — фитнес UGC",
  "preset": "viral-hooks" | null,
  "reasoning": "1-3 предложения: почему эти выборы (включая выбор стратегии)"
}

Правила:
- Возвращай ТОЛЬКО поля, в которых ты уверен. Остальные — опусти.
- keywords на языке контента (если language=RU — русские, EN — английские).
- Не выдумывай actorId вне списка.
- preset — ТОЛЬКО slug из списка выше, иначе null. Не сочиняй новые слаги.
${appCatalogLines.length ? `- appId — ТОЛЬКО id из каталога. Не выдумывай. Если приложение в промте не упомянуто или не найдено в каталоге — опусти поле.\n` : ""}- НЕ генерируй секреты, токены, API-ключи, пароли, URL с параметрами авторизации.
- Ответь СТРОГО JSON-объектом.`

  let capturedUsage: import('~~/server/utils/ai-pricing').AnthropicUsage | null = null
  const result = await callAnthropicAgent<TrendwatcherSuggestion>({
    onUsage: (u) => { capturedUsage = u },
    systemPrompt:
      "Ты — senior growth-маркетолог и специалист по парсингу UGC контента в соцсетях. " +
      "Генерируешь точные, релевантные конфиги для Apify-парсинга трендов под мобильные приложения. " +
      "Отвечаешь на русском, если запрос на русском, но keywords — на языке target-рынка. " +
      "Никогда не генерируешь секреты, токены, API-ключи, пароли. " +
      "Отвечаешь СТРОГО в формате JSON-объекта.",
    userPrompt,
    tier: "haiku",
    maxTokens: 1024,
    validate: (data: unknown): TrendwatcherSuggestion => {
      const d = (data ?? {}) as Record<string, unknown>
      const out: TrendwatcherSuggestion = {}

      // appId принимаем только если он реально есть в каталоге — защита от галлюцинаций
      if (typeof d.appId === "number" && Number.isInteger(d.appId) && validAppIds.has(d.appId)) {
        out.appId = d.appId
      }

      if (typeof d.actorId === "string" && KNOWN_ACTORS.includes(d.actorId)) {
        out.actorId = d.actorId
      }

      if (Array.isArray(d.platforms)) {
        const filtered = d.platforms.filter(
          (p): p is "tiktok" | "instagram" | "youtube" =>
            typeof p === "string" && (VALID_PLATFORMS as readonly string[]).includes(p),
        )
        if (filtered.length) out.platforms = filtered
      }

      if (Array.isArray(d.keywords)) {
        const safe = (d.keywords as unknown[])
          .filter((k): k is string => typeof k === "string")
          .map(k => k.trim())
          .filter(k => k.length > 0 && k.length <= 80 && !looksLikeSecret(k))
          .slice(0, 20)
        if (safe.length) out.keywords = safe
      }

      if (typeof d.geo === "string" && (VALID_GEO as readonly string[]).includes(d.geo)) {
        out.geo = d.geo
      }

      if (typeof d.language === "string" && (VALID_LANG as readonly string[]).includes(d.language)) {
        out.language = d.language
      }

      if (typeof d.viewCountMin === "number" && d.viewCountMin >= 0 && d.viewCountMin <= 1e9) {
        out.viewCountMin = Math.round(d.viewCountMin)
      } else if (d.viewCountMin === null) {
        out.viewCountMin = null
      }

      if (typeof d.viewCountMax === "number" && d.viewCountMax >= 0 && d.viewCountMax <= 1e10) {
        out.viewCountMax = Math.round(d.viewCountMax)
      } else if (d.viewCountMax === null) {
        out.viewCountMax = null
      }

      if (typeof d.maxItems === "number" && d.maxItems >= 1 && d.maxItems <= 100) {
        out.maxItems = Math.round(d.maxItems)
      }

      if (typeof d.name === "string" && d.name.trim().length > 0 && d.name.length <= 100) {
        out.name = d.name.trim()
      }

      if (typeof d.preset === "string" && validStrategySlugs.has(d.preset)) {
        out.preset = d.preset
      } else if (d.preset === null) {
        out.preset = null
      }

      if (typeof d.reasoning === "string" && d.reasoning.length <= 500) {
        out.reasoning = d.reasoning
      }

      if (out.viewCountMin != null && out.viewCountMax != null && out.viewCountMin > out.viewCountMax) {
        out.viewCountMin = null
      }

      return out
    },
  })

  const session = await getUserSession(event)
  const auditUserId = (session?.user as { id?: number } | undefined)?.id ?? 0
  const auditId = await logAiAudit({
    userId: auditUserId,
    action: "field_suggest",
    nodeType: "trendwatcher",
    pipelineId: typeof body.pipelineId === "number" ? body.pipelineId : undefined,
    nodeCanvasId: body.nodeCanvasId,
    model: process.env.ANTHROPIC_HAIKU_MODEL || 'claude-haiku-4-5-20251001',
    prompt,
    suggestions: result,
    usage: capturedUsage,
  })

  return { data: { ...result, auditId } }
})

function looksLikeSecret(value: string): boolean {
  const patterns = [
    /^(sk|pk|api|token|secret|key|bearer|auth)[-_]/i,
    /^eyJ[A-Za-z0-9]/,
    /^ghp_[A-Za-z0-9]/,
    /^xox[bpsar]-/,
    /^AKIA[A-Z0-9]/,
    /password|passwd|pwd/i,
  ]
  return patterns.some(p => p.test(value))
}
