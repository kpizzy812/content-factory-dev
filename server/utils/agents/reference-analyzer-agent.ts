/**
 * Reference Analyzer Agent — глубокий структурированный анализ медиа-референса.
 *
 * Вход: метаданные, транскрипт, URL.
 * Выход: ReferenceBreakdown — сцены, narrative mechanics, visual patterns,
 *        subtitle mechanics, abstracted patterns, originality guide.
 *
 * Работает в 2 стадии:
 * 1. Pattern Extraction — извлечение сырых паттернов из данных
 * 2. Originality Transform — преобразование паттернов в safe-to-reuse абстракции
 */

import type {
  ReferenceBreakdown,
  TranscriptData,
  ReferenceScene,
  NarrativeMechanics,
  VisualPatterns,
  SubtitleMechanics,
  AppIntegrationPattern,
  AbstractedPattern,
  OriginalityGuide,
} from '~~/shared/types/reference'

export const REFERENCE_ANALYZER_VERSION = '1.0.0'

export interface ReferenceAnalysisInput {
  sourceUrl: string
  platform: string | null
  mediaType: 'video' | 'image' | 'unknown'
  title: string | null
  description: string | null
  authorName: string | null
  hashtags: string[]
  thumbnailUrl: string | null
  duration: string | null
  transcript: TranscriptData | null
  /** Контекст приложения для анализа паттерна интеграции */
  appContext?: string | null
}

// --- Stage 1: Pattern Extraction ---

function buildPatternExtractionPrompt(input: ReferenceAnalysisInput): string {
  const parts: string[] = []

  parts.push(`## Источник`)
  parts.push(`- URL: ${input.sourceUrl}`)
  if (input.platform) parts.push(`- Платформа: ${input.platform}`)
  if (input.mediaType) parts.push(`- Тип: ${input.mediaType}`)
  if (input.title) parts.push(`- Заголовок: ${input.title}`)
  if (input.description) parts.push(`- Описание: ${input.description}`)
  if (input.authorName) parts.push(`- Автор: ${input.authorName}`)
  if (input.hashtags.length > 0) parts.push(`- Хештеги: ${input.hashtags.map(t => '#' + t).join(' ')}`)
  if (input.duration) parts.push(`- Длительность: ${input.duration}`)

  if (input.transcript?.fullText) {
    const transcriptText = input.transcript.fullText.slice(0, 5000) // Лимит контекста
    parts.push(`\n## Транскрипт/субтитры`)
    parts.push(transcriptText)

    if (input.transcript.segments.length > 0) {
      parts.push(`\n## Таймкоды субтитров (первые 50)`)
      const segs = input.transcript.segments.slice(0, 50)
      parts.push(segs.map(s => `[${s.start.toFixed(1)}s] ${s.text}`).join('\n'))
    }
  }

  if (input.thumbnailUrl) {
    parts.push(`\n## Превью`)
    parts.push(`URL: ${input.thumbnailUrl}`)
  }

  return `Проведи глубокий структурный анализ медиа-референса.

${parts.join('\n')}

## Задача
На основе ВСЕХ доступных данных выше, проведи детальный разбор. Верни JSON-объект:

1. sceneTimeline — массив сцен (3-8 штук), каждая:
   - order: номер
   - startMarker: начало ("0s" или "после хука" если нет таймкодов)
   - duration: длительность
   - action: что происходит
   - purpose: зачем эта сцена
   - onScreenText: текст на экране (из транскрипта) или null
   - visualCues: визуальные характеристики
   - emotionalTone: эмоциональный тон
   - cameraWork: камера/ракурс или null

2. narrativeMechanics — объект:
   - hookType: тип хука (question|shock|story|pain_point|promise|visual|curiosity|transformation)
   - hookDescription: описание хука (что именно цепляет)
   - bodyMechanic: как удерживается внимание
   - ctaMechanic: как закрывается / CTA
   - emotionalArc: массив эмоций по сценам
   - pacing: описание ритма
   - narrativeTemplate: шаблон нарратива (transformation|discovery|challenge|comparison|day_in_life|social_proof)
   - transformationArc: дуга трансформации или null

3. visualPatterns — объект:
   - colorPalette: массив hex-цветов или описаний
   - lighting: стиль освещения
   - cameraStyle: стиль камеры
   - composition: композиция кадра
   - textOverlayStyle: стиль текста на экране или null
   - aesthetic: эстетика (minimal|bright|dark|cinematic|lo-fi|professional|raw)
   - effects: массив эффектов

4. subtitleMechanics — объект:
   - hasSubtitles: boolean
   - style: стиль (bold-caps|lowercase-minimal|animated|standard) или null
   - placement: позиция (top|center|bottom) или null
   - rhythm: ритм (per-word|per-phrase|per-sentence|continuous) или null
   - textSize: размер или null
   - colorScheme: цвет/контраст или null

5. appIntegrationPattern — объект или null:
   - integrationType: тип (organic|demo|before-after|testimonial|tutorial|overlay)
   - timing: когда появляется
   - organicScore: 1-100
   - description: описание

ВАЖНО:
- Анализируй только реальные данные. Если данных мало, сократи детализацию.
- Субтитры/сцены восстанавливай из транскрипта если он доступен.
- Не выдумывай то, чего нет в данных.

Ответь ТОЛЬКО JSON-объектом.`
}

// --- Stage 2: Originality Transform ---

export function buildOriginalityPrompt(
  patterns: {
    sceneTimeline: ReferenceScene[]
    narrativeMechanics: NarrativeMechanics
    visualPatterns: VisualPatterns
    subtitleMechanics: SubtitleMechanics
    appIntegrationPattern: AppIntegrationPattern | null
  },
  input: ReferenceAnalysisInput,
): string {
  return `Ты — Originality Transformer. Твоя задача: преобразовать конкретные паттерны из референса в АБСТРАКТНЫЕ, безопасные для переиспользования креативные принципы.

## Исходный анализ
${JSON.stringify(patterns, null, 2)}

## Контекст
- Платформа: ${input.platform || 'неизвестна'}
- Автор оригинала: ${input.authorName || 'неизвестен'}

## Задача
Верни JSON-объект:

1. abstractedPatterns — массив из 4-8 абстрагированных паттернов, каждый:
   - name: название паттерна
   - category: "hook" | "narrative" | "visual" | "pacing" | "subtitle" | "integration"
   - abstractDescription: описание принципа (БЕЗ конкретных слов/фраз из оригинала)
   - applicationGuide: как применить к новому контенту
   - strength: сила паттерна 1-100

2. originalityGuide — объект:
   - safeToReuse: массив того, что безопасно взять (абстрактные принципы)
   - mustTransform: массив того, что НЕЛЬЗЯ копировать (конкретные элементы)
   - requireOriginal: массив того, что должно быть полностью оригинальным
   - transformationSuggestions: массив рекомендаций по трансформации
   - targetOriginalityScore: рекомендуемый уровень оригинальности (0.0-1.0)

КРИТИЧЕСКИ ВАЖНО:
- Абстрагируй ПРИНЦИПЫ, а не конкретные решения
- Не копируй конкретные фразы, заголовки, субтитры
- Если хук "Ты знал, что 90% людей...", паттерн: "статистический шок-вопрос"
- Если сцена "девушка открывает приложение", паттерн: "POV-демонстрация через действие героя"
- Чем конкретнее оригинал, тем абстрактнее должен быть паттерн

Ответь ТОЛЬКО JSON-объектом.`
}

// --- Main API ---

export async function analyzeReference(input: ReferenceAnalysisInput): Promise<ReferenceBreakdown> {
  // Stage 1: Pattern extraction
  const patternResult = await callAnthropicAgent({
    systemPrompt: `Ты — Reference Pattern Analyst, эксперт по разбору медиа-контента.
Анализируешь видео и изображения по метаданным и транскрипту.
Выделяешь структуру, механики, визуальные паттерны.
Не выдумываешь — работаешь только с предоставленными данными.
Отвечай на русском. СТРОГО JSON.`,
    userPrompt: buildPatternExtractionPrompt(input),
    maxTokens: 4096,
    validate: (data: unknown) => {
      const d = data as Record<string, unknown>
      if (!d.sceneTimeline || !d.narrativeMechanics || !d.visualPatterns) {
        throw new Error('Неполный результат: нужны sceneTimeline, narrativeMechanics, visualPatterns')
      }
      return d as {
        sceneTimeline: ReferenceScene[]
        narrativeMechanics: NarrativeMechanics
        visualPatterns: VisualPatterns
        subtitleMechanics: SubtitleMechanics
        appIntegrationPattern: AppIntegrationPattern | null
      }
    },
  })

  // Stage 2: Originality transformation
  const originalityResult = await callAnthropicAgent({
    systemPrompt: `Ты — Originality Transformer. Преобразуешь конкретные креативные паттерны в абстрактные принципы, безопасные для переиспользования.
Никогда не копируешь конкретные фразы, заголовки, субтитры оригинала.
Всегда абстрагируешь до уровня принципа/механики.
Отвечай на русском. СТРОГО JSON.`,
    userPrompt: buildOriginalityPrompt(patternResult, input),
    maxTokens: 3072,
    validate: (data: unknown) => {
      const d = data as Record<string, unknown>
      if (!Array.isArray(d.abstractedPatterns) || !d.originalityGuide) {
        throw new Error('Нужны abstractedPatterns и originalityGuide')
      }
      return d as {
        abstractedPatterns: AbstractedPattern[]
        originalityGuide: OriginalityGuide
      }
    },
  })

  // Определяем доступность данных
  const hasTranscript = !!input.transcript?.fullText
  const hasTimedSegments = (input.transcript?.segments?.length ?? 0) > 0
  const hasDescription = !!input.description
  const hasThumbnail = !!input.thumbnailUrl
  const metadataRichness: 'rich' | 'moderate' | 'sparse' =
    (hasTranscript && hasDescription && hasThumbnail) ? 'rich'
      : (hasDescription || hasTranscript) ? 'moderate'
        : 'sparse'

  // Confidence based on data availability
  const confidenceFactors = [
    hasTranscript ? 0.3 : 0,
    hasTimedSegments ? 0.15 : 0,
    hasDescription ? 0.2 : 0,
    hasThumbnail ? 0.1 : 0,
    input.title ? 0.1 : 0,
    input.hashtags.length > 0 ? 0.05 : 0,
    input.duration ? 0.1 : 0,
  ]
  const confidence = Math.min(1, confidenceFactors.reduce((a, b) => a + b, 0))

  const breakdown: ReferenceBreakdown = {
    version: REFERENCE_ANALYZER_VERSION,
    mediaType: input.mediaType,
    transcript: input.transcript,
    sceneTimeline: patternResult.sceneTimeline,
    narrativeMechanics: patternResult.narrativeMechanics,
    visualPatterns: patternResult.visualPatterns,
    subtitleMechanics: patternResult.subtitleMechanics || {
      hasSubtitles: false,
      style: null,
      placement: null,
      rhythm: null,
      textSize: null,
      colorScheme: null,
    },
    appIntegrationPattern: patternResult.appIntegrationPattern || null,
    abstractedPatterns: originalityResult.abstractedPatterns,
    originalityGuide: originalityResult.originalityGuide,
    confidence,
    dataAvailability: {
      hasTranscript,
      hasTimedSegments,
      hasThumbnail,
      hasDescription,
      metadataRichness,
    },
  }

  return breakdown
}
