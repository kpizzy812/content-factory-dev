/**
 * Trend Analyzer Agent — комплексный AI-анализ найденного креатива.
 * 4 аналитических блока: hook, scene structure, visual style, virality reasons.
 * Результат сохраняется как CreativeBrief.
 */
import type { TrendAnalysisInput, TrendAnalysisResult } from '~~/shared/types/agents'
// Явный импорт вместо nitro-автоимпорта: тем же путём агент вызывается из
// трендвотчера, а он должен запускаться и в чистых юнит-тестах без Nitro.
import { callAnthropicAgent } from './call-anthropic'

const PROMPT_VERSION = '1.0.0'

const SYSTEM_PROMPT = `Ты — эксперт по анализу вирусного видеоконтента в социальных сетях (TikTok, Instagram Reels, YouTube Shorts).

Твоя задача — провести глубокий структурированный анализ видеоконтента по 4 направлениям:
1. Hook (зацеп) — как видео удерживает внимание в первые 1-3 секунды
2. Scene Structure (структура сцен) — как построен нарратив и монтаж
3. Visual Style (визуальный стиль) — цветовая палитра, ракурсы, эффекты
4. Virality Reasons (причины вирусности) — почему контент стал популярным

Анализируй на основе предоставленных данных: заголовок, описание, хештеги, метрики, платформу, автора.
Если видео недоступно напрямую, анализируй по метаданным и описанию — это допустимо и полезно.

Отвечай на русском. Отвечай СТРОГО в формате JSON.`

function buildPrompt(input: TrendAnalysisInput): string {
  const metrics = [
    input.viewCount != null ? `Просмотры: ${input.viewCount.toLocaleString('ru')}` : null,
    input.likeCount != null ? `Лайки: ${input.likeCount.toLocaleString('ru')}` : null,
    input.commentCount != null ? `Комментарии: ${input.commentCount.toLocaleString('ru')}` : null,
    input.shareCount != null ? `Репосты: ${input.shareCount.toLocaleString('ru')}` : null,
  ].filter(Boolean).join(', ')

  const engagementRate = input.viewCount && input.viewCount > 0
    ? (((input.likeCount || 0) + (input.commentCount || 0)) / input.viewCount * 100).toFixed(2)
    : null

  return `Проанализируй этот вирусный креатив.

## Данные креатива
- Платформа: ${input.platform}
- Заголовок: ${input.title}
${input.description ? `- Описание: ${input.description}` : ''}
${input.authorName ? `- Автор: ${input.authorName}` : ''}
${input.hashtags?.length ? `- Хештеги: ${input.hashtags.map(t => '#' + t).join(' ')}` : ''}
${metrics ? `- Метрики: ${metrics}` : ''}
${engagementRate ? `- Engagement Rate: ${engagementRate}%` : ''}
${input.publishedAt ? `- Дата публикации: ${input.publishedAt}` : ''}
${input.language ? `- Язык: ${input.language}` : ''}
${input.geo ? `- Гео: ${input.geo}` : ''}
${input.thumbnailUrl ? `- Thumbnail: ${input.thumbnailUrl}` : ''}
${input.sourceUrl ? `- URL: ${input.sourceUrl}` : ''}

## Задача
Верни JSON-объект со следующей структурой:

{
  "hookAnalysis": {
    "type": "question|shock|story|controversy|pain_point|promise|visual|sound|text_overlay",
    "description": "описание хука — что именно цепляет в первые секунды",
    "strength": число 1-100,
    "textOnScreen": "текст на экране в хуке, если применимо",
    "emotionalTrigger": "основной эмоциональный триггер"
  },
  "sceneStructure": {
    "estimatedDuration": "оценка длительности (напр. 15s, 30s, 60s)",
    "scenes": [
      {
        "order": 1,
        "name": "название сцены",
        "description": "что происходит",
        "estimatedDuration": "примерная длительность",
        "purpose": "зачем эта сцена нужна"
      }
    ],
    "narrativeArc": "тип нарратива: tutorial|transformation|storytime|reaction|challenge|comparison|day_in_life",
    "pacingNotes": "заметки по темпу монтажа"
  },
  "visualStyle": {
    "colorTone": "описание цветовой гаммы",
    "lighting": "описание освещения",
    "cameraWork": "описание работы камеры",
    "textOverlays": true/false,
    "effects": ["список эффектов/переходов"],
    "aesthetic": "общий визуальный стиль (minimal|bright|dark|cinematic|lo-fi|professional)"
  },
  "viralityReasons": {
    "primaryReason": "главная причина вирусности",
    "factors": [
      {
        "factor": "название фактора",
        "description": "описание",
        "impact": "high|medium|low"
      }
    ],
    "targetAudience": "описание целевой аудитории",
    "replicability": число 1-100,
    "replicabilityNotes": "что нужно для воспроизведения успеха"
  },
  "summary": "краткое резюме анализа в 2-3 предложениях",
  "confidence": число 0.0-1.0
}

Ответь ТОЛЬКО JSON-объектом, без markdown-обёрток.`
}

function validate(data: unknown): TrendAnalysisResult {
  const d = data as Record<string, unknown>

  if (!d.hookAnalysis || typeof d.hookAnalysis !== 'object') {
    throw new Error('Отсутствует или некорректный hookAnalysis')
  }
  if (!d.sceneStructure || typeof d.sceneStructure !== 'object') {
    throw new Error('Отсутствует или некорректный sceneStructure')
  }
  if (!d.visualStyle || typeof d.visualStyle !== 'object') {
    throw new Error('Отсутствует или некорректный visualStyle')
  }
  if (!d.viralityReasons || typeof d.viralityReasons !== 'object') {
    throw new Error('Отсутствует или некорректный viralityReasons')
  }
  if (typeof d.summary !== 'string' || d.summary.length === 0) {
    throw new Error('Отсутствует summary')
  }

  return d as unknown as TrendAnalysisResult
}

export async function runTrendAnalyzer(input: TrendAnalysisInput): Promise<TrendAnalysisResult> {
  return callAnthropicAgent({
    agentName: 'trend-analyzer',
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildPrompt(input),
    maxTokens: 4096,
    validate,
  })
}

// ─────────────────────── автоматический разбор трендов ───────────────────────
//
// По ТЗ (docs/SPEC.md, Модуль 1) выход трендвотчера — не сырые ролики, а бриф
// в базе креативов: именно его потребляет Модуль 2. Раньше анализ запускался
// только руками из UI (POST /api/trends/[id]/analyze), поэтому импортированные
// тренды оставались без брифа. Логика записи брифа живёт здесь, чтобы у ручного
// и автоматического запуска был один путь: тот же агент, те же CreativeBrief /
// TrendInsight, те же значения analysisStatus.

/**
 * Сколько трендов разбираем автоматически за один прогон трендвотчера.
 * Один прогон Apify привозит десятки-сотни роликов, а разбор каждого — платный
 * LLM-вызов. Без потолка автозапуск превращается в лавину запросов и счёт,
 * поэтому берём ограниченную пачку самых виральных.
 */
export const TREND_AUTO_ANALYSIS_LIMIT = 5

/** Режим автоматического разбора: фикстуры / реальный вызов / выключено. */
export type TrendAnalysisMode = 'mock' | 'live' | 'disabled'

/**
 * Решает, можно ли сейчас разбирать тренды автоматически.
 *
 * mock — ANTHROPIC_MOCK_MODE=true: ответы берутся из фикстур, сети и денег нет.
 * live — платные API явно разрешены оператором.
 * disabled — платные API выключены: молчим совсем, а не бомбардируем
 *   paid-guard'а 403-ми на каждый импортированный ролик.
 */
export function resolveTrendAnalysisMode(env: NodeJS.ProcessEnv = process.env): TrendAnalysisMode {
  if (env.ANTHROPIC_MOCK_MODE === 'true') return 'mock'
  return env.ENABLE_PAID_APIS === 'true' ? 'live' : 'disabled'
}

/** Статусы, при которых тренд ещё имеет смысл отправлять на разбор. */
const ANALYZABLE_STATUSES = ['none', 'pending', 'failed'] as const

/**
 * Идемпотентный отбор трендов на разбор.
 * Уже разобранный (`completed`) и разбираемый прямо сейчас (`running`) тренд
 * не переанализируется — повторный прогон профиля не должен платить дважды.
 * Порядок — по виральности: если пачка меньше числа кандидатов, разбираем
 * самое интересное, а не случайное.
 */
export async function selectTrendsForAnalysis(
  trendIds: number[],
  limit: number = TREND_AUTO_ANALYSIS_LIMIT,
): Promise<number[]> {
  if (trendIds.length === 0 || limit <= 0) return []

  const rows = await prisma.trend.findMany({
    where: {
      id: { in: trendIds },
      isDeleted: false,
      analysisStatus: { in: [...ANALYZABLE_STATUSES] },
    },
    orderBy: [
      { viralityScore: { sort: 'desc', nulls: 'last' } },
      { viewCount: 'desc' },
    ],
    take: limit,
    select: { id: true },
  })

  return rows.map((row: { id: number }) => row.id)
}

export interface TrendAnalysisOutcome {
  trendId: number
  status: 'analyzed' | 'failed' | 'skipped'
  /** Причина пропуска или текст ошибки — для лога прогона. */
  reason?: string
}

/**
 * Разбирает один тренд и кладёт бриф в базу.
 * Повторяет путь ручной кнопки: analysisStatus running → агент → CreativeBrief
 * + TrendInsight → completed. Ошибку не бросает: в пачке один битый ролик не
 * должен ронять разбор остальных.
 */
export async function analyzeTrendIntoBrief(trendId: number): Promise<TrendAnalysisOutcome> {
  const trend = await prisma.trend.findUnique({ where: { id: trendId } })

  if (!trend || trend.isDeleted) {
    return { trendId, status: 'skipped', reason: 'тренд не найден или удалён' }
  }
  // Гонка с ручной кнопкой или с параллельным прогоном профиля.
  if (trend.analysisStatus === 'running' || trend.analysisStatus === 'completed') {
    return { trendId, status: 'skipped', reason: `analysisStatus=${trend.analysisStatus}` }
  }

  const modelVersion = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'

  await prisma.trend.update({ where: { id: trendId }, data: { analysisStatus: 'running' } })

  try {
    const input: TrendAnalysisInput = {
      platform: trend.platform,
      title: trend.title,
      description: trend.description,
      authorName: trend.authorName,
      hashtags: trend.hashtags,
      viewCount: trend.viewCount,
      likeCount: trend.likeCount,
      commentCount: trend.commentCount,
      shareCount: trend.shareCount,
      publishedAt: trend.publishedAt?.toISOString() ?? null,
      language: trend.language,
      geo: trend.geo,
      thumbnailUrl: trend.thumbnailUrl,
      sourceUrl: trend.sourceUrl,
    }

    const analysis = await runTrendAnalyzer(input)

    const briefData = {
      hookAnalysis: analysis.hookAnalysis as object,
      sceneStructure: analysis.sceneStructure as object,
      visualStyle: analysis.visualStyle as object,
      viralityReasons: analysis.viralityReasons as object,
      summary: analysis.summary,
      confidence: analysis.confidence ?? null,
      modelVersion,
      promptVersion: PROMPT_VERSION,
    }

    await prisma.creativeBrief.upsert({
      where: { trendId },
      create: { trendId, ...briefData },
      update: { ...briefData, errorMessage: null },
    })

    // TrendInsight — обратная совместимость со старым экраном трендов.
    const insightData = {
      whyViral: analysis.viralityReasons.primaryReason,
      patterns: analysis.viralityReasons.factors.map(f => f.factor),
      hooks: [analysis.hookAnalysis.description],
      audience: analysis.viralityReasons.targetAudience,
      confidence: analysis.confidence ?? null,
    }
    await prisma.trendInsight.upsert({
      where: { trendId },
      create: { trendId, ...insightData },
      update: insightData,
    })

    await prisma.trend.update({ where: { id: trendId }, data: { analysisStatus: 'completed' } })

    return { trendId, status: 'analyzed' }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown analysis error'

    await prisma.trend.update({
      where: { id: trendId },
      data: { analysisStatus: 'failed' },
    }).catch(() => {})

    await prisma.creativeBrief.upsert({
      where: { trendId },
      create: {
        trendId,
        hookAnalysis: {},
        sceneStructure: {},
        visualStyle: {},
        viralityReasons: {},
        summary: '',
        modelVersion,
        promptVersion: PROMPT_VERSION,
        errorMessage,
      },
      update: { errorMessage },
    }).catch(() => {})

    return { trendId, status: 'failed', reason: errorMessage }
  }
}

export interface TrendAutoAnalysisReport {
  mode: TrendAnalysisMode
  /** Сколько трендов отобрано на разбор (после лимита и идемпотентности). */
  selected: number
  analyzed: number
  failed: number
  skipped: number
  trendIds: number[]
}

/**
 * Автоматический разбор пачки только что импортированных трендов.
 * Последовательно, чтобы не открывать N параллельных платных запросов.
 */
export async function runTrendAutoAnalysis(options: {
  trendIds: number[]
  limit?: number
  /** Куда писать прогресс (лог прогона трендвотчера). */
  onLog?: (level: 'info' | 'warn', message: string, payload?: Record<string, unknown>) => void | Promise<void>
}): Promise<TrendAutoAnalysisReport> {
  const mode = resolveTrendAnalysisMode()
  const log = options.onLog ?? (() => {})

  if (mode === 'disabled') {
    await log('info', 'AI-анализ трендов пропущен: ENABLE_PAID_APIS != "true"', {
      candidates: options.trendIds.length,
    })
    return { mode, selected: 0, analyzed: 0, failed: 0, skipped: options.trendIds.length, trendIds: [] }
  }

  const selectedIds = await selectTrendsForAnalysis(options.trendIds, options.limit ?? TREND_AUTO_ANALYSIS_LIMIT)

  if (selectedIds.length === 0) {
    await log('info', 'AI-анализ трендов: нечего разбирать (все уже с брифом)', {
      candidates: options.trendIds.length,
    })
    return { mode, selected: 0, analyzed: 0, failed: 0, skipped: options.trendIds.length, trendIds: [] }
  }

  let analyzed = 0
  let failed = 0

  for (const trendId of selectedIds) {
    const outcome = await analyzeTrendIntoBrief(trendId)
    if (outcome.status === 'analyzed') analyzed++
    else if (outcome.status === 'failed') {
      failed++
      await log('warn', `AI-анализ тренда #${trendId} не удался: ${outcome.reason}`, { trendId })
    }
  }

  return {
    mode,
    selected: selectedIds.length,
    analyzed,
    failed,
    skipped: options.trendIds.length - selectedIds.length,
    trendIds: selectedIds,
  }
}

export { PROMPT_VERSION }
