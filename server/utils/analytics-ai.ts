/**
 * AI-анализ поста: почему залетело / не залетело.
 * Создаёт Reference, если метрики превышают пороги.
 * ТРЕБУЕТ requirePaidApisEnabled — использует Anthropic API.
 */

const SYSTEM_PROMPT = `Ты — аналитик коротких видео для TikTok, Instagram Reels и YouTube Shorts. Анализируешь метрики и объясняешь, почему ролик набрал или не набрал просмотры. Отвечай ТОЛЬКО на русском языке. Отвечай СТРОГО в формате JSON.`

/**
 * Доля 0…1 → «70.3%» для промпта.
 *
 * `watchThrough` и `ctr` хранятся долей (см. `server/utils/social/types.ts` и
 * `app/components/analytics/AnalyticsFormat.ts`), а модели нужны проценты:
 * без перевода в промпт уезжало «0.703%» вместо «70.3%», и выводы делались по
 * заведомо неверным числам. Перевод держим на границе с LLM, чтобы по коду
 * ходила одна шкала.
 */
function formatSharePercent(share: number): string {
  if (!Number.isFinite(share)) return "0%"
  return `${(share * 100).toFixed(1)}%`
}

function buildAnalysisPrompt(data: {
  title: string
  platform: string
  hashtags: string[]
  views: number
  likes: number
  comments: number
  shares: number
  /** Доля досмотра, 0…1. */
  watchThrough: number
  /** Доля переходов, 0…1. */
  ctr: number
  followerGain: number
}): string {
  return `Проанализируй метрики ролика и объясни результаты.

## Ролик
- Название: ${data.title}
- Платформа: ${data.platform}
- Хэштеги: ${data.hashtags.join(", ") || "нет"}

## Метрики
- Просмотры: ${data.views}
- Лайки: ${data.likes}
- Комментарии: ${data.comments}
- Шеры: ${data.shares}
- Досматриваемость: ${formatSharePercent(data.watchThrough)}
- CTR: ${formatSharePercent(data.ctr)}
- Прирост подписчиков: ${data.followerGain}

## Задача
Ответь JSON-объектом:
- reason: краткое объяснение результата (1-2 предложения)
- analysis: развёрнутый анализ (3-5 пунктов, почему залетело или нет)
- recommendations: массив из 3 рекомендаций для улучшения
- isSuccessful: boolean — считается ли ролик успешным

Ответь ТОЛЬКО JSON-объектом, без обёрток и пояснений.`
}

interface AnalysisResponse {
  reason: string
  analysis: string
  recommendations: string[]
  isSuccessful: boolean
}

function parseAnalysisResponse(text: string): AnalysisResponse {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = codeBlockMatch?.[1] ? codeBlockMatch[1].trim() : text.trim()

  const parsed = JSON.parse(raw)

  if (
    typeof parsed.reason !== "string"
    || typeof parsed.analysis !== "string"
    || !Array.isArray(parsed.recommendations)
    || typeof parsed.isSuccessful !== "boolean"
  ) {
    throw new Error("Некорректный формат ответа AI-анализа")
  }

  return parsed as AnalysisResponse
}

export async function analyzePost(uploadId: number): Promise<{
  analysis: AnalysisResponse
  referenceCreated: boolean
}> {
  requirePaidApisEnabled("Anthropic Claude API (аналитика)")

  const upload = await prisma.upload.findUnique({
    where: { id: uploadId },
    include: {
      socialAccount: { select: { platform: true } },
      metrics: { orderBy: { collectedAt: "desc" }, take: 1 },
    },
  })

  if (!upload) {
    throw createError({ statusCode: 404, message: "Загрузка не найдена" })
  }

  if (upload.status !== "published") {
    throw createError({
      statusCode: 400,
      message: "AI-анализ доступен только для опубликованных постов",
    })
  }

  const latestMetrics = upload.metrics[0]
  if (!latestMetrics) {
    throw createError({
      statusCode: 400,
      message: "Нет собранных метрик для анализа. Сначала запустите сбор метрик.",
    })
  }

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || ""
  if (!anthropicApiKey) {
    throw createError({
      statusCode: 500,
      message: "API-ключ Anthropic не настроен",
    })
  }

  const response = await $fetch<{
    content: Array<{ type: string; text?: string }>
  }>("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    timeout: 60_000,
    body: {
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: buildAnalysisPrompt({
          title: upload.title,
          platform: upload.socialAccount.platform,
          hashtags: upload.hashtags,
          views: latestMetrics.views,
          likes: latestMetrics.likes,
          comments: latestMetrics.comments,
          shares: latestMetrics.shares,
          watchThrough: latestMetrics.watchThrough,
          ctr: latestMetrics.ctr,
          followerGain: latestMetrics.followerGain,
        }),
      }],
    },
  })

  const textBlock = response.content.find((c) => c.type === "text")
  if (!textBlock?.text) {
    throw createError({ statusCode: 502, message: "AI-сервис вернул пустой ответ" })
  }

  const analysis = parseAnalysisResponse(textBlock.text)

  // Проверяем пороги для создания референса
  const thresholdViews = Number(process.env.REFERENCE_THRESHOLD_VIEWS) || 10000
  // Оператор задаёт порог досмотра в процентах (50 = 50 %) — так он записан в
  // `.env.example` и так его читают люди. Сама метрика хранится долей 0…1
  // (`server/utils/social/types.ts`), поэтому переводим порог в её шкалу здесь.
  // Раньше сравнивали процент с долей: условие «0.7 >= 50» не выполнялось
  // никогда, и в базу референсов ролик мог попасть только по числу просмотров.
  const thresholdWatchThroughPercent = Number(process.env.REFERENCE_THRESHOLD_WATCH_THROUGH) || 50
  const thresholdWatchThrough = thresholdWatchThroughPercent / 100

  let referenceCreated = false

  const meetsThreshold = latestMetrics.views >= thresholdViews
    || latestMetrics.watchThrough >= thresholdWatchThrough

  if (meetsThreshold && analysis.isSuccessful) {
    await prisma.reference.upsert({
      where: { uploadId },
      create: {
        uploadId,
        reason: analysis.reason,
        aiAnalysis: analysis.analysis,
      },
      update: {
        reason: analysis.reason,
        aiAnalysis: analysis.analysis,
      },
    })
    referenceCreated = true

    // Feedback loop: пропагация инсайтов в TrendwatcherProfile
    propagateInsightsToProfiles(uploadId).catch(() => {})
  }

  // Propagate AI recommendations to scenario optimization memory
  propagateAnalyticsToMemory(upload, analysis).catch(() => {})

  // Propagate style recommendations to account style profile
  propagateAnalyticsToAccountStyle(upload.socialAccountId, upload.id, analysis).catch(() => {})

  return { analysis, referenceCreated }
}

/**
 * Propagates analytics-derived style insights into AccountStyleProfile as pending revisions.
 * Не мутирует профиль напрямую — создаёт revision с changeType 'analytics_derived'
 * для ручного одобрения пользователем.
 */
async function propagateAnalyticsToAccountStyle(
  socialAccountId: number,
  uploadId: number,
  analysis: AnalysisResponse,
): Promise<void> {
  if (!analysis.isSuccessful || analysis.recommendations.length === 0) return

  const profile = await prisma.accountStyleProfile.findUnique({
    where: { socialAccountId },
  })

  if (!profile) return

  // Создаём pending revision с рекомендациями от аналитики
  const styleRelevantRecs = analysis.recommendations
    .filter(r =>
      r.toLowerCase().includes('стиль')
      || r.toLowerCase().includes('визуал')
      || r.toLowerCase().includes('тон')
      || r.toLowerCase().includes('субтитр')
      || r.toLowerCase().includes('хук')
      || r.toLowerCase().includes('палитр')
      || r.toLowerCase().includes('cta')
      || r.toLowerCase().includes('ритм'),
    )

  if (styleRelevantRecs.length === 0) return

  await prisma.accountStyleRevision.create({
    data: {
      profileId: profile.id,
      version: profile.version,
      changeType: 'analytics_derived',
      changeSummary: `Рекомендации из аналитики поста #${uploadId}: ${styleRelevantRecs.join('; ')}`,
      changedSections: ['tone', 'visual'],
      previousData: {} as never,
      newData: { analyticsRecommendations: styleRelevantRecs } as never,
      accepted: false,
      appliedById: null,
    },
  })
}

/**
 * Propagates analytics recommendations into ScenarioMemory for future generations.
 */
async function propagateAnalyticsToMemory(
  upload: { videoId: number; applicationId: number | null },
  analysis: AnalysisResponse,
): Promise<void> {
  // Find appId through video → scenario → appId chain
  const video = await prisma.video.findUnique({
    where: { id: upload.videoId },
    select: { scenario: { select: { appId: true } } },
  })
  const appId = video?.scenario?.appId ?? upload.applicationId ?? null

  const now = new Date().toISOString()
  const source = 'analytics' as const

  for (const rec of analysis.recommendations) {
    const requirement = {
      type: (analysis.isSuccessful ? 'recommendation' : 'requirement') as 'recommendation' | 'requirement',
      category: 'general' as const,
      text: rec,
      source,
      sourceId: upload.videoId,
      weight: analysis.isSuccessful ? 60 : 80,
      createdAt: now,
    }
    await updateOptimizationMemory(requirement, appId).catch(() => {})
  }
}
