/**
 * Multi-step Story-Driven Scenario Generation Pipeline v3.0.
 *
 * Flow:
 * 0. Load optimization memory (requirements/recommendations from feedback & analytics)
 * 1. Story Architect → story arc + protagonist + app integration strategy
 * 2. Scene Planner → detailed scene cards (3-6 scenes)
 * 3. Continuity Director → validated scenes + continuity bible
 * 4. Subtitle Director → subtitle style profile + validated subtitles
 * 5. Visual Style → structured visual style + master prompt
 * 6. Humanization Pass → polished fullScript
 * 7. Assemble StoryPlan + GeneratedVariant
 *
 * Backward-compatible: old callers get GeneratedVariant[], new callers get storyPlan inside.
 */

import type { TrendAnalysisResult } from '~~/shared/types/agents'
import type { SceneCountStrategy, VisualStyleStructured } from '~~/shared/types/scenario'
import type {
  StoryPlan,
  StoryArc,
  ProtagonistProfile,
  SceneCard,
  ContinuityBible,
  SubtitleStyleProfile,
  VoiceoverPlan,
  ScenarioGenerationProfileData,
  OptimizationMemoryData,
} from '~~/shared/types/story'
import { SUBTITLE_WORDS_PER_LINE_DEFAULT } from '~~/shared/types/story'
import type { AccountStyleProfileData } from '~~/shared/types/account-style'
import type { LoadedFavoritePrompt } from './favorite-prompts-loader'
import { loadFavoritePromptsForScenario, bumpFavoritePromptsUsage } from './favorite-prompts-loader'
import { validateScenarioMarketing, type MarketingValidatorApp } from './scenario-marketing-validator'

const PIPELINE_VERSION = '3.0.0'

// Высокий потолок max_tokens для всех агентов сценарного пайплайна. Anthropic
// тарифит только реально потреблённые output-токены, поэтому большое значение
// не увеличивает стоимость, но защищает от обрезания JSON посередине ответа,
// что приводило к SyntaxError в JSON.parse и молчаливому падению вариантов.
// 20000 — с запасом под детальные scene cards с 6 сценами + continuity bible.
const SCENARIO_MAX_TOKENS = 20000

// Параллельность генерации вариантов сценария. count > VARIANT_CONCURRENCY
// разбивается на чанки и обрабатывается последовательно — снижает шанс
// 429 rate-limit при 3+ вариантах × 7 шагов внутри.
const VARIANT_CONCURRENCY = 2

// --- Input / Output Types ---

interface BriefData {
  hookAnalysis: TrendAnalysisResult['hookAnalysis']
  sceneStructure: TrendAnalysisResult['sceneStructure']
  visualStyle: TrendAnalysisResult['visualStyle']
  viralityReasons: TrendAnalysisResult['viralityReasons']
  summary: string
}

interface InsightFallback {
  whyViral: string
  patterns: string[]
  hooks: string[]
  audience?: string | null
}

/**
 * Длительность ролика. Воронка с лид-магнитом требует места под пользу: за
 * 15-25 секунд «auto» помещается один тезис, и зрителю не за что отдавать
 * кодовое слово. По ТЗ ролик идёт 70-90 секунд — это стратегия longform.
 * Явный выбор оператора всегда важнее умолчания.
 */
export function resolveSceneCountStrategy(
  profileSettings: { sceneCountStrategy?: SceneCountStrategy } | null | undefined,
  funnel: { keyword: string } | null | undefined,
): SceneCountStrategy {
  if (profileSettings?.sceneCountStrategy) return profileSettings.sceneCountStrategy
  return funnel?.keyword ? 'longform' : 'auto'
}

/** Воронка юнита в объёме, нужном генератору сценария. */
export interface ScenarioFunnel {
  /** Кодовое слово, которое зритель отправляет в директ. */
  keyword: string
  /** Что он получает в ответ — помогает агенту сформулировать обещание. */
  leadMagnetTitle?: string | null
}

export interface ScenarioInput {
  trendTitle: string
  trendDescription?: string | null
  platform: string
  hashtags: string[]
  viewCount: number
  brief: BriefData | null
  insights: InsightFallback[]
  appName: string
  appDescription?: string | null
  language?: string | null
  appKeywords: string[]
  /**
   * Воронка юнита. Если задана — конверсия идёт через кодовое слово в Direct,
   * а не через установку приложения: меняются и промпты, и marketing-проверки.
   */
  funnel?: ScenarioFunnel | null
  variantsCount?: number
  // v3 extensions
  appContext?: {
    transformationPromise?: string | null
    corePain?: string | null
    coreOutcome?: string | null
    creativeAngles?: unknown
    scenarioContext?: unknown
    referenceImageUrls?: string[]
  } | null
  /**
   * Богатые AppReferenceImage с AI-разметкой. Передаётся в scene planner: если AI
   * считает, что сцена показывает UI приложения, она должна выбрать конкретный
   * imageId из этого списка → попадёт в scene.appScreenRef и Kling возьмёт картинку
   * как image-to-video input. Если массив пуст — appScreenRef всегда null.
   */
  appReferenceScreens?: Array<{
    id: string
    fileUrl: string
    tags: string[]
    caption: string | null
    primaryAction: string | null
    hasUI: boolean | null
    analyzedAt: string | null
  }>

  /**
   * Библиотека живых исходников ведущего, если она наполнена. Когда поле задано,
   * планировщик обязан отметить сцены с ведущей в кадре полем spokenLine — по ним
   * пойдёт lip-sync вместо генерации клипа. Пусто — сценарий полностью B-roll'овый.
   */
  presenter?: {
    name: string
    clipCount: number
    minClipSec: number
    maxClipSec: number
  } | null

  profileSettings?: Partial<ScenarioGenerationProfileData> | null
  appId?: number | null
  // Reference-driven generation (v3.1)
  referenceBreakdown?: Record<string, unknown> | null
  // Account style identity (v3.2)
  accountStyle?: AccountStyleProfileData | null
  // Favorite prompts as inspiration (v3.3).
  // manualIds — явно выбранные пользователем в ScenarioConfig.
  // autoSelect — AI сам подберёт топ-5 по пересечению тегов и usageCount.
  favoritePromptIds?: number[]
  favoritePromptsAutoSelect?: boolean
}

export interface GeneratedVariant {
  title: string
  hook: string
  body: string
  cta: string
  fullScript: string
  visualStyleText: string
  visualStyleStructured: VisualStyleStructured | null
  toneProfile: string
  rationale: string
  storyPlan: StoryPlan | null
}

function contentLanguageLabel(raw: string | null | undefined): string {
  const value = raw?.trim().toLowerCase()
  if (!value || value === 'en' || value.startsWith('en-') || value === 'english') return 'English'
  if (value === 'ru' || value.startsWith('ru-') || value === 'russian' || value === 'русский') return 'Russian'
  if (value === 'es' || value.startsWith('es-') || value === 'spanish') return 'Spanish'
  if (value === 'de' || value.startsWith('de-') || value === 'german') return 'German'
  return raw!.trim()
}

// --- Presenter (live footage) Context Builder ---

/**
 * Блок про ведущую в кадре. Без него планировщик оставляет spokenLine пустым,
 * lip-sync шаг пропускает все сцены, и живая ведущая в ролик не попадает вовсе.
 */
function buildPresenterPromptBlock(
  presenter: ScenarioInput['presenter'],
  contentLanguage: string,
): string {
  if (!presenter || presenter.clipCount <= 0) {
    return `## Ведущий в кадре
Библиотека живых исходников пуста, поэтому НИ ОДНА сцена не может показать говорящего ведущего.
Поле spokenLine у всех сцен = null. Речь идёт только закадровым голосом (voiceoverLine).`
  }

  const minSec = Math.ceil(presenter.minClipSec)
  const maxSec = Math.floor(presenter.maxClipSec)

  return `## Ведущий в кадре (spokenLine) — ОБЯЗАТЕЛЬНЫЙ БЛОК
В системе есть библиотека живых фрагментов ведущей (${presenter.name}, ${presenter.clipCount} фрагментов по ${minSec}-${maxSec} секунд).
Сцена, у которой заполнен spokenLine, снимается НЕ нейросетью: берётся реальный фрагмент ведущей и её губы синхронизируются с этой репликой.

Правила распределения:
1. Ведущая ведёт ОПОРНЫЕ точки ролика, а не весь хронометраж: хук (сцена 1), один-два ключевых тезиса в середине и финальный CTA.
2. Всего сцен со spokenLine — от 3 до 4. Остальные сцены иллюстративные: spokenLine = null.
3. Если у сцены заполнен spokenLine, её voiceoverLine ОБЯЗАН быть null. Иначе на одном отрезке звучат два голоса одновременно.
4. Если spokenLine = null, речь этой сцены идёт закадром через voiceoverLine, как обычно.
5. Длительность сцены со spokenLine — строго от ${minSec} до ${maxSec} секунд: фрагмент ведущей длиннее не бывает.
6. spokenLine — живая устная фраза на языке ${contentLanguage}, от 60 до 120 символов, без эмодзи и спецсимволов. Это то, что человек реально успевает сказать за длительность сцены.
7. subtitleCopy сцены со spokenLine передаёт ту же мысль — это субтитры к словам ведущей, а не отдельный текст.
8. setting и action такой сцены описывают живую съёмку ведущей (говорит на камеру), а не сгенерированный визуал.`
}

// --- Account Style Context Builder ---

function buildAccountStyleContextForPrompt(style: AccountStyleProfileData | null | undefined): string {
  if (!style) return ''

  const lines: string[] = ['## Account Style Identity (обязательно соблюдать)']

  if (style.tone.voice) {
    lines.push(`### Tone of Voice`)
    lines.push(`- Голос: ${style.tone.voice}`)
    if (style.tone.narratorPersona) lines.push(`- Персона нарратора: ${style.tone.narratorPersona}`)
    lines.push(`- Формальность: ${style.tone.formality}`)
    if (style.tone.emotionalRange.length > 0) lines.push(`- Эмоциональный диапазон: ${style.tone.emotionalRange.join(', ')}`)
    if (style.tone.forbiddenPhrases.length > 0) lines.push(`- ЗАПРЕЩЁННЫЕ фразы: ${style.tone.forbiddenPhrases.join('; ')}`)
  }

  if (style.visual.aesthetic || style.visual.colorPalette.length > 0) {
    lines.push(`### Visual Language`)
    if (style.visual.colorPalette.length > 0) lines.push(`- Палитра аккаунта: ${style.visual.colorPalette.join(', ')}`)
    if (style.visual.aesthetic) lines.push(`- Эстетика: ${style.visual.aesthetic}`)
    if (style.visual.lighting) lines.push(`- Освещение: ${style.visual.lighting}`)
    if (style.visual.cameraStyle) lines.push(`- Камера: ${style.visual.cameraStyle}`)
    if (style.visual.forbiddenVisuals.length > 0) lines.push(`- Запрещённые визуалы: ${style.visual.forbiddenVisuals.join('; ')}`)
  }

  if (style.protagonist.preferredType !== 'any' || style.protagonist.visualStyle) {
    lines.push(`### Protagonist Style`)
    lines.push(`- Предпочтительный тип: ${style.protagonist.preferredType}`)
    if (style.protagonist.visualStyle) lines.push(`- Визуальный стиль: ${style.protagonist.visualStyle}`)
    if (style.protagonist.recurringMarkers.length > 0) lines.push(`- Маркеры: ${style.protagonist.recurringMarkers.join(', ')}`)
    if (style.protagonist.restrictions.length > 0) lines.push(`- Ограничения: ${style.protagonist.restrictions.join('; ')}`)
  }

  if (style.cta.examples.length > 0 || style.cta.forbidden.length > 0) {
    lines.push(`### CTA Style`)
    lines.push(`- Стиль CTA: ${style.cta.style}`)
    if (style.cta.examples.length > 0) lines.push(`- Хорошие примеры: ${style.cta.examples.join('; ')}`)
    if (style.cta.forbidden.length > 0) lines.push(`- Запрещённые CTA: ${style.cta.forbidden.join('; ')}`)
  }

  lines.push(`### Constraints`)
  lines.push(`- Темп: ${style.editing.pacing}, ~${style.editing.preferredDuration}с, ~${style.editing.preferredSceneCount} сцен`)
  lines.push(`- Допустимость эксперимента: ${style.experimentationDegree}/100`)
  lines.push(`- Строгость стиля: ${style.consistencyStrictness}/100`)

  if (lines.length <= 1) return ''
  return lines.join('\n')
}

// --- Reference Context Builder ---

function buildReferenceContextForPrompt(ref: Record<string, unknown>): string {
  const parts: string[] = ['## Анализ референса (абстрагированные паттерны)']

  // Narrative mechanics
  const nm = ref.narrativeMechanics as Record<string, unknown> | undefined
  if (nm) {
    parts.push(`### Нарративные механики`)
    if (nm.hookType) parts.push(`- Тип хука: ${nm.hookType}`)
    if (nm.narrativeTemplate) parts.push(`- Нарративный шаблон: ${nm.narrativeTemplate}`)
    if (nm.pacing) parts.push(`- Ритм: ${nm.pacing}`)
    if (nm.bodyMechanic) parts.push(`- Механика удержания: ${nm.bodyMechanic}`)
    if (Array.isArray(nm.emotionalArc)) parts.push(`- Эмоциональная дуга: ${(nm.emotionalArc as string[]).join(' → ')}`)
    if (nm.transformationArc) parts.push(`- Дуга трансформации: ${nm.transformationArc}`)
  }

  // Abstracted patterns
  const patterns = ref.abstractedPatterns as Array<Record<string, unknown>> | undefined
  if (Array.isArray(patterns) && patterns.length > 0) {
    parts.push(`### Абстрагированные креативные паттерны`)
    for (const p of patterns.slice(0, 6)) {
      parts.push(`- [${p.category}] ${p.name}: ${p.abstractDescription}`)
      if (p.applicationGuide) parts.push(`  → Применение: ${p.applicationGuide}`)
    }
  }

  // Visual patterns (abstract level)
  const vp = ref.visualPatterns as Record<string, unknown> | undefined
  if (vp) {
    parts.push(`### Визуальные принципы (абстрактные)`)
    if (vp.aesthetic) parts.push(`- Эстетика: ${vp.aesthetic}`)
    if (vp.lighting) parts.push(`- Освещение: ${vp.lighting}`)
    if (vp.cameraStyle) parts.push(`- Стиль камеры: ${vp.cameraStyle}`)
  }

  // Originality constraints
  const og = ref.originalityGuide as Record<string, unknown> | undefined
  if (og) {
    parts.push(`### Ограничения оригинальности`)
    if (Array.isArray(og.mustTransform)) {
      parts.push(`НЕЛЬЗЯ копировать: ${(og.mustTransform as string[]).join('; ')}`)
    }
    if (Array.isArray(og.requireOriginal)) {
      parts.push(`Должно быть оригинальным: ${(og.requireOriginal as string[]).join('; ')}`)
    }
    if (Array.isArray(og.transformationSuggestions)) {
      parts.push(`Рекомендации: ${(og.transformationSuggestions as string[]).slice(0, 3).join('; ')}`)
    }
  }

  // Subtitle mechanics
  const sm = ref.subtitleMechanics as Record<string, unknown> | undefined
  if (sm?.hasSubtitles) {
    parts.push(`### Стиль субтитров референса`)
    if (sm.style) parts.push(`- Стиль: ${sm.style}`)
    if (sm.placement) parts.push(`- Позиция: ${sm.placement}`)
    if (sm.rhythm) parts.push(`- Ритм: ${sm.rhythm}`)
  }

  return parts.join('\n')
}

// --- Favorite Prompts Context Builder ---

function buildFavoritePromptsContext(prompts: LoadedFavoritePrompt[]): string {
  if (!prompts || prompts.length === 0) return ''
  const body = prompts.map((p) => {
    const lines: string[] = []
    lines.push(`### Эталон #${p.id}${p.appName ? ` (${p.appName})` : ' (универсальный)'}`)

    // Если есть структурный AI-анализ — рендерим structured-блок (приоритетный
    // источник для AI). Иначе fallback на raw promptText целиком.
    if (p.aiPatternAnalysis) {
      lines.push(`- Camera: ${p.aiPatternAnalysis.camera}`)
      lines.push(`- Lighting: ${p.aiPatternAnalysis.lighting}`)
      lines.push(`- Action structure: ${p.aiPatternAnalysis.actionStructure}`)
      lines.push(`- Mood: ${p.aiPatternAnalysis.mood}`)
      lines.push(`- Motion intensity: ${p.aiPatternAnalysis.motionIntensity}`)
      if (p.tags.length > 0) lines.push(`- Tags: ${p.tags.join(', ')}`)
      if (p.notes) lines.push(`- Notes: ${p.notes}`)
      // Sample как опорный контекст — не для копирования. 400 chars достаточно
      // чтобы AI понял язык промпта, но мало для копирования формулировок.
      const sample = p.promptText.length > 400 ? `${p.promptText.slice(0, 400)}…` : p.promptText
      lines.push(`- Sample (для контекста, НЕ копировать): ${sample}`)
    }
    else {
      // Fallback для промтов без AI-анализа (только что созданы / Haiku ещё не отработал).
      if (p.tags.length > 0) lines.push(`Теги: ${p.tags.join(', ')}`)
      if (p.notes) lines.push(`Почему хорош: ${p.notes}`)
      lines.push('Промт:')
      lines.push(p.promptText)
    }
    return lines.join('\n')
  }).join('\n\n')

  return `## Эталонные промты — STYLE COMPASS (паттерны лучших практик)
Это структурные паттерны из успешных Kling-промптов. Используй их как ОРИЕНТИР по камере, свету, ритму действий, эмоциональному регистру. НЕ КОПИРУЙ формулировки — извлекай абстрактные паттерны.

${body}

ОБЯЗАТЕЛЬНО: в выходном JSON для каждой сцены, на которую повлиял эталон, заполни поле scene.appliedReferences = [{ "favoritePromptId": <id>, "aspects": ["camera"|"lighting"|"actionStructure"|"mood"|"pacing"|"composition"] }]. Используй id ТОЛЬКО из списка выше. Без этого мы не сможем ретроспективно понять, какой эталон сработал.`
}

// --- Step 1: Story Architect ---

function buildStoryArchitectPrompt(
  input: ScenarioInput,
  memory: OptimizationMemoryData | null,
  favoritePrompts: LoadedFavoritePrompt[] = [],
): string {
  const briefContext = input.brief
    ? `## Анализ тренда (CreativeBrief)
- Тип хука: ${input.brief.hookAnalysis.type} (сила: ${input.brief.hookAnalysis.strength}/100)
- Нарратив: ${input.brief.sceneStructure.narrativeArc}
- Сцены: ${input.brief.sceneStructure.scenes.map((s: { order: number; name: string; purpose: string }) => `${s.order}. ${s.name} — ${s.purpose}`).join('; ')}
- Вирусность: ${input.brief.viralityReasons.primaryReason}
- Аудитория: ${input.brief.viralityReasons.targetAudience}`
    : ''

  const appContext = input.appContext
    ? `## App Context
${input.appContext.transformationPromise ? `- Обещание трансформации: ${input.appContext.transformationPromise}` : ''}
${input.appContext.corePain ? `- Ключевая боль: ${input.appContext.corePain}` : ''}
${input.appContext.coreOutcome ? `- Ключевой результат: ${input.appContext.coreOutcome}` : ''}
${input.appContext.creativeAngles ? `- Креативные углы: ${JSON.stringify(input.appContext.creativeAngles)}` : ''}
${input.appContext.referenceImageUrls && input.appContext.referenceImageUrls.length > 0
  ? `- Reference-изображения приложения (визуальные эталоны — используй как ориентир для стиля, героев, объектов в сценах):\n${input.appContext.referenceImageUrls.map(u => `  • ${u}`).join('\n')}`
  : ''}`
    : ''

  const memoryContext = memory
    ? `## Память оптимизации (из прошлых генераций и обратной связи)
${memory.requirements.length > 0 ? `### Обязательные требования:\n${memory.requirements.slice(0, 10).map(r => `- [${r.category}] ${r.text}`).join('\n')}` : ''}
${memory.recommendations.length > 0 ? `### Рекомендации:\n${memory.recommendations.slice(0, 10).map(r => `- [${r.category}] ${r.text}`).join('\n')}` : ''}
${memory.antiPatterns.length > 0 ? `### Анти-паттерны (избегать):\n${memory.antiPatterns.slice(0, 10).map(r => `- [${r.category}] ${r.text}`).join('\n')}` : ''}`
    : ''

  const profileContext = input.profileSettings
    ? `## Настройки профиля генерации (от пользователя — ВЫСШИЙ ПРИОРИТЕТ)
${input.profileSettings.storytellingMode ? `- Режим: ${input.profileSettings.storytellingMode}` : ''}
${input.profileSettings.protagonistMode ? `- Герой: ${input.profileSettings.protagonistMode}` : ''}
${input.profileSettings.appIntegrationStyle ? `- Интеграция приложения: ${input.profileSettings.appIntegrationStyle}` : ''}
${input.profileSettings.visualPaletteCues && input.profileSettings.visualPaletteCues.length > 0
  ? `- ОБЯЗАТЕЛЬНАЯ палитра / визуальное настроение: ${input.profileSettings.visualPaletteCues.join('; ')}\n  → continuityBible.visualCode.colorPalette ДОЛЖЕН отражать это, никаких посторонних оттенков`
  : ''}
${input.profileSettings.transformationArcTemplate
  ? `- Шаблон трансформации (storyArc должен следовать ему): ${input.profileSettings.transformationArcTemplate}`
  : ''}
${input.profileSettings.negativeRules && input.profileSettings.negativeRules.length > 0
  ? `- НИКОГДА не используй: ${input.profileSettings.negativeRules.join('; ')}\n  → внеси это в negativeConstraints`
  : ''}
${input.profileSettings.continuityStrictness
  ? `- Строгость continuity: ${input.profileSettings.continuityStrictness}`
  : ''}
${input.profileSettings.sceneDiversity
  ? `- Разнообразие сцен: ${input.profileSettings.sceneDiversity}`
  : ''}
${input.profileSettings.pacing
  ? `- Темп: ${input.profileSettings.pacing}`
  : ''}`
    : ''

  // Reference-driven context
  const ref = input.referenceBreakdown as Record<string, unknown> | null
  const referenceContext = ref
    ? buildReferenceContextForPrompt(ref)
    : ''

  // Favorite prompts context (must come AFTER referenceContext per spec)
  const favoritePromptsContext = buildFavoritePromptsContext(favoritePrompts)

  // Account style identity
  const accountStyleContext = buildAccountStyleContextForPrompt(input.accountStyle)

  return `Построй драматургию для вертикального видео. Точная длительность и количество сцен задаются sceneCountStrategy на следующем этапе.

## Тренд
- Название: ${input.trendTitle}
${input.trendDescription ? `- Описание: ${input.trendDescription}` : ''}
- Платформа: ${input.platform}
- Просмотры: ${input.viewCount.toLocaleString('ru')}

${briefContext}
${appContext}
${memoryContext}
${profileContext}
${referenceContext}
${favoritePromptsContext}
${accountStyleContext}

${input.funnel?.keyword ? `## Воронка
- Кодовое слово: ${input.funnel.keyword} (зритель отправляет его в директ или комментарии)
${input.funnel.leadMagnetTitle ? `- Что он получает: ${input.funnel.leadMagnetTitle}` : ''}
- Тема эксперта: ${input.appName}${input.appDescription ? ` — ${input.appDescription}` : ''}
- Ключевые слова: ${input.appKeywords.join(', ') || 'нет'}
- Продукт зрителю не устанавливают и не продают в кадре` : `## Приложение
- Название: ${input.appName}
${input.appDescription ? `- Описание: ${input.appDescription}` : ''}
- Ключевые слова: ${input.appKeywords.join(', ') || 'нет'}`}

## Задача
Создай JSON-объект с полной драматургией:

1. storyArc — объект:
   - template: один из "transformation"|"discovery"|"challenge"|"comparison"|"day_in_life"|"social_proof"|"curiosity"|"custom"
   - premise: исходная ситуация (1-2 предложения)
   - conflict: дефицит / проблема / сомнение
   - turningPoint: ${input.funnel?.keyword
     ? 'ключевой факт, цифра или механизм, который переворачивает понимание темы. НЕ появление продукта'
     : 'момент встречи с приложением'}
   - resolution: ${input.funnel?.keyword
     ? 'конкретный шаг, который зритель может сделать сегодня же'
     : 'трансформация / результат'}
   - emotionalJourney: массив эмоций по сценам (3-6 штук)

2. protagonist — объект:
   - type: "person"|"object"|"abstract"
   - description: кто/что это (2-3 предложения)
   - initialState: состояние в начале
   - finalState: состояние в конце
   - visualIdentifiers: массив визуальных маркеров (что отличает героя на экране)

3. appIntegrationStrategy: ${input.funnel?.keyword
  ? 'как подаётся польза — какие конкретные факты, цифры и ошибки раскрываются по ходу ролика и почему в конце логично попросить лид-магнит (2-3 предложения)'
  : 'как приложение органично встраивается в сюжет (2-3 предложения)'}

4. negativeConstraints: массив строк — что ЗАПРЕЩЕНО в этом сценарии (шаблоны, банальности, повторы)
${input.funnel?.keyword ? `
5. valueBeats: массив из 4-6 строк — конкретные полезные тезисы ролика. Каждый
   с фактурой: цифра, норма, единица измерения, типичная ошибка или проверяемый
   признак. Общие советы уровня «питайтесь сбалансированно» не считаются.
` : ''}
Правила:
${input.funnel?.keyword ? `- Ролик — экспертный разбор, а не история про продукт. Зритель должен унести
  пользу, даже если не напишет кодовое слово: 3-4 применимых тезиса минимум
- Продукт НЕ является точкой перелома и НЕ решает проблему героя. Перелом — это
  знание: неочевидный факт, цифра, механизм
- Лид-магнит упоминается один раз, в самом конце, как продолжение темы
- Конкретика важнее эмоций: «двести восемьдесят калорий в ложке соуса» сильнее,
  чем «я была в шоке»
- Герой — эксперт, который делится разбором, а не пользователь продукта` : `- Не строй банальную историю "было плохо — нашёл приложение — стало хорошо"
- Герой должен быть конкретным, визуально узнаваемым
- Конфликт должен быть эмоционально резонансным
- Приложение появляется органично, а не как рекламный баннер
- Трансформация должна быть видимой, а не абстрактной`}
${ref ? `
ANTI-COPY (обязательно при работе с референсом):
- Используй АБСТРАКТНЫЕ паттерны из референса, НЕ конкретные фразы/сцены
- Создай НОВЫЙ сюжет, вдохновлённый механиками референса, а не копию
- Герой, обстановка, диалоги — полностью оригинальные
- Если паттерн хука — "статистический шок", создай ДРУГОЙ хук того же типа
- Субтитры и текст на экране должны быть полностью оригинальными` : ''}

Ответь ТОЛЬКО JSON-объектом.`
}

// --- Step 2: Scene Planner ---

function buildScenePlannerPrompt(
  storyArc: StoryArc,
  protagonist: ProtagonistProfile,
  input: ScenarioInput,
  appIntegrationStrategy: string,
  favoritePromptIds: number[] = [],
): string {
  const contentLanguage = contentLanguageLabel(input.language)
  const ref = input.referenceBreakdown as Record<string, unknown> | null
  const refSceneHint = ref?.sceneTimeline
    ? `\n## Паттерн сцен референса (для вдохновения, НЕ для копирования)
${(ref.sceneTimeline as Array<Record<string, unknown>>).slice(0, 4).map((s, i) => `${i + 1}. [${s.purpose}] ${s.duration} — тон: ${s.emotionalTone}`).join('\n')}
ВАЖНО: Создай ОРИГИНАЛЬНЫЕ сцены, вдохновлённые ритмом и структурой выше.`
    : ''

  // Список доступных скриншотов приложения (image-to-video input для Kling).
  // Показываем только те, где AI-анализ подтвердил наличие UI и есть caption.
  const screens = (input.appReferenceScreens ?? [])
    .filter(s => s.hasUI !== false && s.caption && s.analyzedAt)
    .slice(0, 8)
  const screensBlock = screens.length > 0
    ? `\n## [APP SCREEN REFERENCE — STRONG PLACEMENT RULES]
You have ${screens.length} analyzed app screenshot(s) available for image-to-video pipeline.

PLACE scene.appScreenRef when ANY of these is true:
1. Scene depicts the protagonist "creating something" related to the app's function
2. Scene shows the transformation result (before → after the app)
3. Scene is metaphorical for app interaction (touch, swipe, tap, voice command, gesture)
4. Scene IS the FINAL CTA scene (showing the app interface as visual anchor of the CTA)

App: ${input.appName}${input.appDescription ? ` — ${input.appDescription}` : ''}

Available screens (use these EXACT ids in appScreenRef.imageId):
${screens.map(s => `- id="${s.id}" | tags=[${s.tags.join(', ') || '—'}] | caption=${s.caption}${s.primaryAction ? ` | action=${s.primaryAction}` : ''}`).join('\n')}

Поле scene.appScreenRef:
{
  "imageId": "<id из списка выше>",
  "intent": "show_interface" | "reaction_to_interface" | "background_glance"
}

intent guide:
- show_interface — экран приложения главный фокус кадра (CTA-сцены, ключевые моменты использования)
- reaction_to_interface — герой реагирует на UI (восторг/удивление от экрана)
- background_glance — экран мельком на фоне (не для CTA)

Не описывай UI словами в visualPromptGuidance — Kling возьмёт пиксели из image_url.

Если сцена НУЖДАЕТСЯ в показе UI, но ни один из ${screens.length} скринов не подходит:
оставь appScreenRef.imageId пустой строкой ИЛИ опусти imageId — но проставь
appScreenRef.intent = "show_interface" как сигнал downstream'у. Pipeline в этом
случае gracefully сделает fallback на text-to-video с описанием UI.`
    : `\n## [APP SCREEN REFERENCE — STRONG PLACEMENT RULES]
Для приложения "${input.appName}" нет проанализированных скриншотов в базе. ВСЕГДА проставляй scene.appScreenRef = null. Не выдумывай imageId. Pipeline сделает fallback на чисто text-to-video режим — твоя задача описать UI словами через visualPromptGuidance ТОЛЬКО для CTA-сцены и сцен где UI есть в action/setting.`

  return `Разбей драматургию на детальные сцены (scene cards) для короткого видео.${refSceneHint}${screensBlock}

## Драматургия
- Шаблон: ${storyArc.template}
- Исходная ситуация: ${storyArc.premise}
- Конфликт: ${storyArc.conflict}
- Поворотный момент: ${storyArc.turningPoint}
- Разрешение: ${storyArc.resolution}
- Эмоциональная дуга: ${storyArc.emotionalJourney.join(' → ')}

## Герой
- Тип: ${protagonist.type}
- Описание: ${protagonist.description}
- Начальное состояние: ${protagonist.initialState}
- Финальное состояние: ${protagonist.finalState}
- Визуальные маркеры: ${protagonist.visualIdentifiers.join(', ')}

## Контекст
- Платформа: ${input.platform}
- Приложение: ${input.appName}
- Стратегия интеграции: ${appIntegrationStrategy}
- Язык финального текста ролика: ${contentLanguage}

${input.funnel?.keyword ? `## [FUNNEL CTA — MANDATORY RULES]
Конверсия идёт через кодовое слово, а не через установку продукта. Зритель
ничего не скачивает: он отправляет слово и получает материал в ответ. До
зрителя доходят только scene-level subtitleCopy / voiceoverLine / spokenLine.

1. **THE FINAL SCENE's subtitleCopy AND voiceoverLine MUST ask to send the code word "${input.funnel.keyword}"**
   — слово пишется ровно так: ${input.funnel.keyword} (заглавными, без склонения и перевода)
   — рядом обязателен глагол отправки на языке ${contentLanguage}: напиши / отправь / write / send
   — куда отправить: в директ или в комментарии
${input.funnel.leadMagnetTitle ? `   — что зритель получит взамен: ${input.funnel.leadMagnetTitle}\n` : ''}
2. **Промежуточные сцены НЕ рекламируют продукт.** Они дают пользу по теме:
   конкретику, цифры, разбор частой ошибки. Имя продукта в них не нужно.

3. Финальная сцена звучит как предложение друга поделиться полезным файлом,
   а не как рекламный баннер.

EXAMPLES:
❌ FINAL Scene "Подписывайся, чтобы не потерять"  (нет кодового слова — лид не дойдёт до воронки)
✅ FINAL Scene "Напиши ${input.funnel.keyword} в директ — пришлю разбор"

❌ Mid Scene "Скачай приложение и считай калории"  (продукт не устанавливают)
✅ Mid Scene "Двести восемьдесят калорий пряталось в одной ложке соуса"` : `## [APP INTEGRATION — MANDATORY RULES]
This is content marketing for **${input.appName}**. The scenario's hook/body/CTA already explicitly reference the app — but those fields don't reach the final video. ONLY scene-level subtitleCopy / voiceoverLine / spokenLine reach the viewer.

ТЫ ОБЯЗАН органично пропечатать "${input.appName}" в нескольких сценах:

1. **AT LEAST ONE scene's subtitleCopy OR voiceoverLine OR spokenLine MUST contain "${input.appName}"** naturally
   — preferred: scene 1-2 (establishing) OR the scene where the revelation/transformation happens
   — NOT a forced ad banner — woven into the story moment

2. **THE FINAL SCENE's subtitleCopy AND voiceoverLine MUST be a CTA mentioning "${input.appName}"**
   — direct verb forms: "Try ${input.appName}", "Download ${input.appName}", "Get ${input.appName}", "Open ${input.appName}", "Install ${input.appName}"
   — use natural equivalents in ${contentLanguage} and connect to the resolution

3. If the scenario has a moment of "transformation through touch / click / discovery / sound", THAT scene is the perfect natural integration point.

VIOLATION OF THIS RULE = SCENARIO IS USELESS AS MARKETING. The most beautiful storytelling fails if the audience never hears the app name.

EXAMPLES:
❌ FINAL Scene "Now he knew his gift: to turn dreams into melodies"  (closes story, but no app — useless)
✅ FINAL Scene "Try ${input.appName} — turn your dreams into songs"

❌ Mid Scene "With just one touch... music came alive"
✅ Mid Scene "With ${input.appName}, one touch makes music come alive"

В промежуточных сценах после первого упоминания допустимо "the app" / "it" / "оно" — но первое упоминание ОБЯЗАНО быть полным именем "${input.appName}".`}

${(() => {
  const strategy = resolveSceneCountStrategy(input.profileSettings, input.funnel)
  const budgetMap: Record<string, { min: number; max: number; minSec: number; maxSec: number; cost: string }> = {
    minimal:   { min: 3, max: 3, minSec: 3, maxSec: 4, cost: '~\$1 (минимум денег, короткое видео 9-12с)' },
    auto:      { min: 3, max: 5, minSec: 3, maxSec: 6, cost: '~\$2 (стандарт, 15-25с)' },
    detailed:  { min: 4, max: 5, minSec: 4, maxSec: 7, cost: '~\$2.5-3.5 (проработано, 20-35с)' },
    cinematic: { min: 5, max: 6, minSec: 6, maxSec: 9, cost: '~\$4-5 (максимум, 30-55с)' },
    longform:  { min: 9, max: 9, minSec: 8, maxSec: 10, cost: 'длинный формат 72-90с' },
  }
  const b = budgetMap[strategy] ?? budgetMap.auto!
  return `## БЮДЖЕТНОЕ ОГРАНИЧЕНИЕ (sceneCountStrategy: ${strategy}) — ОБЯЗАТЕЛЬНО
Каждая сцена = отдельный платный AI-вызов. Стратегия "${strategy}" задаёт жёсткие рамки:
- Количество сцен: ОТ ${b.min} ДО ${b.max} (НЕ больше, НЕ меньше)
- Длительность КАЖДОЙ сцены: ОТ ${b.minSec} ДО ${b.maxSec} секунд (формат "Ns")
- Ожидаемая стоимость видео: ${b.cost}
Если генеришь больше сцен или длиннее — бюджет превышен. Лучше меньше, чем больше.`
})()}

## Задача
ВАЖНО: диапазон из БЮДЖЕТНОГО ОГРАНИЧЕНИЯ выше имеет приоритет над любым общим количеством сцен. Для longform создай ровно 9 сцен.
Сгенерируй JSON-массив со строгим количеством сцен из бюджетного ограничения выше. Каждая сцена — объект:
- order: номер (1-10)
- purpose: зачем эта сцена в драматургии
- setting: место действия (конкретно)
- action: что происходит (конкретно, визуально)
- whatChanges: что меняется в этой сцене
- emotionalState: эмоция героя/зрителя
- appIntegrationBeat: как приложение появляется (null если не появляется в этой сцене)
- visualPromptGuidance: guidance для генерации визуала НА АНГЛИЙСКОМ, для FLUX/Runway
- appScreenRef: объект { imageId, intent } или null. Заполняй ТОЛЬКО когда сцена показывает экран приложения и imageId взят из списка "ДОСТУПНЫЕ СКРИНШОТЫ" выше. Если списка нет или сцена не про UI — null.
- subtitleCopy: текст субтитров на языке ${contentLanguage} (1-2 строки максимум, без эмодзи и спецсимволов)
- subtitlePlacement: { position: "top"|"center"|"bottom", alignment: "left"|"center"|"right", avoidZones: [] }
- voiceoverLine: строка закадровой озвучки на языке ${contentLanguage} или null
- spokenLine: реплика, которую ведущая произносит В КАДРЕ, или null (правила ниже)
- continuityNotes: заметки по непрерывности с предыдущей сценой
- duration: длительность ("3s"-"10s")
- cameraAngle: ракурс камеры
- props: массив реквизита
- appliedReferences: массив объектов { favoritePromptId, aspects } или []. Заполняй ТОЛЬКО если применил паттерн из STYLE COMPASS блока (если он был передан). favoritePromptId должен быть из списка [${favoritePromptIds.join(', ') || '—нет эталонов—'}], не выдумывай. aspects — подмножество ["camera","lighting","actionStructure","mood","pacing","composition"].

${buildPresenterPromptBlock(input.presenter, contentLanguage)}

Правила:
- Каждая сцена УНИКАЛЬНА по содержанию и функции
- Ни одна сцена не повторяет другую по смыслу
- Субтитры различаются по содержанию
- Герой визуально узнаваем во всех сценах
- Общая длительность должна получиться из суммы duration всех сцен по выбранному бюджетному ограничению

Ответь ТОЛЬКО JSON-массивом.`
}

// --- Step 3: Continuity Director ---

function buildContinuityPrompt(
  scenes: SceneCard[],
  protagonist: ProtagonistProfile,
  storyArc: StoryArc,
): string {
  return `Проверь набор сцен на continuity и непротиворечивость.

## Герой
- Тип: ${protagonist.type}
- Описание: ${protagonist.description}
- Визуальные маркеры: ${protagonist.visualIdentifiers.join(', ')}

## Драматургия
- Шаблон: ${storyArc.template}
- Эмоциональная дуга: ${storyArc.emotionalJourney.join(' → ')}

## Сцены
${JSON.stringify(scenes, null, 2)}

## Задача
Проверь и верни JSON-объект:

1. validatedScenes: массив сцен с обновлёнными continuityNotes (если нашёл проблемы — исправь в самих сценах)
2. continuityBible: объект:
   - protagonist: { type, description, initialState, finalState, visualIdentifiers }
   - visualCode: { colorPalette: hex[], lightingConsistency, environmentStyle }
   - antiLoopRules: массив правил против повторов
   - sceneTransitions: массив допустимых переходов между сценами
   - forbiddenElements: что запрещено
3. issues: массив обнаруженных проблем (пустой если всё ок)
4. fixes: массив что было исправлено (пустой если ничего)

Проверяй:
- Герой одинаково выглядит во всех сценах
- Окружение не противоречит между сценами
- Нет "телепортации" — переходы логичны
- Нет повторяющихся по смыслу сцен (anti-loop)
- Эмоциональная дуга не ломается

Ответь ТОЛЬКО JSON-объектом.`
}

// --- Step 4: Visual Style ---

function buildVisualStylePrompt(input: ScenarioInput, scenes: SceneCard[], protagonist: ProtagonistProfile, continuityBible: ContinuityBible): string {
  const briefVisual = input.brief?.visualStyle
    ? `## Визуальный стиль оригинала
- Цветовой тон: ${input.brief.visualStyle.colorTone}
- Освещение: ${input.brief.visualStyle.lighting}
- Работа камеры: ${input.brief.visualStyle.cameraWork}
- Эстетика: ${input.brief.visualStyle.aesthetic}`
    : ''

  const accountVisual = input.accountStyle?.visual
  const accountVisualContext = accountVisual && (accountVisual.aesthetic || accountVisual.colorPalette.length > 0)
    ? `## Account Visual Identity (ПРИОРИТЕТ)
${accountVisual.colorPalette.length > 0 ? `- Палитра аккаунта: ${accountVisual.colorPalette.join(', ')}` : ''}
${accountVisual.aesthetic ? `- Эстетика аккаунта: ${accountVisual.aesthetic}` : ''}
${accountVisual.lighting ? `- Освещение аккаунта: ${accountVisual.lighting}` : ''}
${accountVisual.cameraStyle ? `- Камера аккаунта: ${accountVisual.cameraStyle}` : ''}
${accountVisual.forbiddenVisuals.length > 0 ? `- ЗАПРЕЩЁННЫЕ визуалы: ${accountVisual.forbiddenVisuals.join('; ')}` : ''}
ВАЖНО: Визуальный стиль ДОЛЖЕН соответствовать identity аккаунта. Допустимы вариации в рамках палитры и эстетики.`
    : ''

  // User-defined constraints из scenario node config (storytelling section).
  // Это ВЫСШИЙ ПРИОРИТЕТ — пользователь явно задал эти параметры в UI.
  const ps = input.profileSettings
  const userPaletteCues = ps?.visualPaletteCues && ps.visualPaletteCues.length > 0
    ? ps.visualPaletteCues.join('; ')
    : null
  const userNegatives = ps?.negativeRules && ps.negativeRules.length > 0
    ? ps.negativeRules.join('; ')
    : null
  const userTransformation = ps?.transformationArcTemplate ?? null
  const userVariation = ps?.variationRules && ps.variationRules.length > 0
    ? ps.variationRules.join('; ')
    : null
  const hasUserConstraints = !!(userPaletteCues || userNegatives || userTransformation || userVariation)
  const userConstraintsBlock = hasUserConstraints
    ? `## ПОЛЬЗОВАТЕЛЬСКИЕ ОГРАНИЧЕНИЯ (НАИВЫСШИЙ ПРИОРИТЕТ — задано вручную в настройках сценария)
${userPaletteCues ? `- ОБЯЗАТЕЛЬНАЯ палитра / настроение: ${userPaletteCues}\n  → colors массив должен быть СТРОГО в этой палитре, никаких посторонних оттенков` : ''}
${userTransformation ? `- Шаблон трансформации: ${userTransformation}` : ''}
${userVariation ? `- Правила вариаций: ${userVariation}` : ''}
${userNegatives ? `- НИКОГДА не используй: ${userNegatives}` : ''}
Эти требования НЕ опциональны. Если они конфликтуют с continuityBible/account/brief — пользователь приоритетнее.`
    : ''

  return `Опиши визуальный стиль для story-driven короткого видео.

${userConstraintsBlock}

## Герой
${protagonist.description}
Визуальные маркеры: ${protagonist.visualIdentifiers.join(', ')}

## Сцены (краткое содержание)
${scenes.map(s => `${s.order}. ${s.setting}: ${s.action} (${s.duration})`).join('\n')}

## Continuity Bible
- Палитра: ${continuityBible.visualCode.colorPalette.join(', ')}
- Стиль окружения: ${continuityBible.visualCode.environmentStyle}
- Запреты: ${continuityBible.forbiddenElements.join(', ')}

${briefVisual}

${accountVisualContext}

## Платформа: ${input.platform}
## Приложение: ${input.appName}

## Задача
Сгенерируй JSON-объект:
- colors: массив из 3-5 hex-цветов (единая палитра для ВСЕХ сцен)
- atmosphere: атмосфера и настроение (2-3 предложения)
- character: описание персонажа — внешность, стиль, манера (должен совпадать с protagonist)
- stylePrompt: master-промпт для генерации визуала (английский, для FLUX/Midjourney)
- lighting: описание освещения (единое для всех сцен)
- cameraWork: камера
- effects: массив эффектов
- textSummary: краткое текстовое описание стиля (русский)
- mood: одно слово — настроение

Стиль должен обеспечивать ВИЗУАЛЬНОЕ ЕДИНСТВО всех сцен при разном содержании.

Ответь ТОЛЬКО JSON-объектом.`
}

// --- Step 5: Build fullScript + humanization ---

/**
 * Правила про продукт в тексте. Воронка с кодовым словом и продвижение
 * приложения требуют разного: в первом случае зритель ничего не устанавливает,
 * он отправляет слово в директ, и навязчивое имя бренда только мешает.
 */
function buildFunnelBrief(appName: string, funnel?: ScenarioFunnel | null) {
  const keyword = funnel?.keyword?.trim()

  if (!keyword) {
    return {
      hookRule: `MUST mention "${appName}" or its benefit — otherwise viewer won't understand what the video is about.`,
      bodyRule: `Mention "${appName}" at least once in the context of solving a problem.`,
      ctaRule: `The name "${appName}" + an explicit action verb (download, try, open, get) are MANDATORY.`,
      styleRule: 'CTA — friend\'s advice, not an ad banner, but the app name must be spoken',
      spellingRule: `Write "${appName}" as-is, no translation or transliteration`,
    }
  }

  const magnet = funnel?.leadMagnetTitle?.trim()
  const magnetPart = magnet ? ` The viewer receives "${magnet}" in return.` : ''

  return {
    hookRule: 'MUST open with the viewer\'s problem or a surprising fact — no product name needed.',
    bodyRule: 'Deliver real value on the topic. Do NOT push a product: the viewer is not installing anything.',
    ctaRule: `MANDATORY: ask the viewer to send the code word "${keyword}" in a direct message or comment, `
      + `written exactly as "${keyword}", plus an explicit verb (напиши / отправь / write / send).${magnetPart}`,
    styleRule: 'CTA — friend\'s offer to share a useful file, not an ad banner',
    spellingRule: `Write the code word "${keyword}" as-is, in capitals, no translation or declension`,
  }
}

function buildFullScriptPrompt(
  scenes: SceneCard[],
  storyArc: StoryArc,
  appName: string,
  language?: string | null,
  accountStyle?: AccountStyleProfileData | null,
  funnel?: ScenarioFunnel | null,
): string {
  const contentLanguage = contentLanguageLabel(language)
  const funnelBrief = buildFunnelBrief(appName, funnel)
  const toneConstraint = accountStyle?.tone.voice
    ? `\n## Account Tone Identity\n- Голос: ${accountStyle.tone.voice}\n- Формальность: ${accountStyle.tone.formality}\n${accountStyle.tone.forbiddenPhrases.length > 0 ? `- ЗАПРЕЩЁННЫЕ фразы: ${accountStyle.tone.forbiddenPhrases.join('; ')}` : ''}\nПиши в стиле этого аккаунта.`
    : ''

  const ctaConstraint = accountStyle?.cta
    ? `\n## Account CTA Style\n- Стиль: ${accountStyle.cta.style}\n${accountStyle.cta.examples.length > 0 ? `- Примеры: ${accountStyle.cta.examples.join('; ')}` : ''}\n${accountStyle.cta.forbidden.length > 0 ? `- Запрещённые CTA: ${accountStyle.cta.forbidden.join('; ')}` : ''}`
    : ''

  return `Собери полный скрипт для озвучки на основе сцен.${toneConstraint}${ctaConstraint}

## Драматургия
- Начало: ${storyArc.premise}
- Конфликт: ${storyArc.conflict}
- Поворот: ${storyArc.turningPoint}
- Финал: ${storyArc.resolution}

## Сцены
${scenes.map(s => `${s.order}. [${s.emotionalState}] ${s.subtitleCopy}${s.voiceoverLine ? ` | VO: ${s.voiceoverLine}` : ''}`).join('\n')}

## App: ${appName}

## Task
Generate a JSON object with these fields. All viewer-facing text must be in ${contentLanguage}:
- hook: first 1-3 seconds opener (max 15 words). ${funnelBrief.hookRule}
- body: middle development (3-6 sentences). ${funnelBrief.bodyRule}
- cta: call to action (1-2 sentences). ${funnelBrief.ctaRule}
- fullScript: full script from hook to CTA (single text for voiceover)
- title: scenario title (up to 80 characters)
- toneProfile: tone description (1 sentence)

Rules:
- Write like a real human, not a marketing bot
- Conversational rhythm: short sentences, pauses, questions
- Don't start with "Imagine", "Did you know", "Don't miss out"
- ${funnelBrief.styleRule}
- NO EMOJIS OR SPECIAL CHARACTERS (😀, 🚀, ★, ✓ etc.) — only letters, digits, basic punctuation
- ${funnelBrief.spellingRule}
- ${contentLanguage.toUpperCase()} ONLY for hook/body/cta/fullScript/title

Respond with ONLY a JSON object.`
}

// --- Step 6: Humanization ---

function buildHumanizationPrompt(fullScript: string, language?: string | null): string {
  const contentLanguage = contentLanguageLabel(language)
  return `Проверь и улучши текст сценария, чтобы он звучал максимально естественно и по-человечески.

## Текст (язык: ${contentLanguage})
${fullScript}

## Задача
Сгенерируй JSON-объект:
- improvedScript: улучшенный текст (если требуется) — строго на языке ${contentLanguage}. Не переводи на другой язык.
- changes: массив изменений (каждый: { original, improved, reason }). Поля original и improved — на языке ${contentLanguage}.
- toneProfile: описание итогового тона текста (1 предложение, на русском — это для UI)
- humanScore: число 1-100

Правила:
- Не добавляй маркетинговый jargon
- Убери повторы и штампы
- Сохрани смысл и структуру
- Если текст уже хороший — верни его без изменений с пустым массивом changes
- БЕЗ эмодзи и спецсимволов в improvedScript

Ответь ТОЛЬКО JSON-объектом.`
}

// --- Voiceover Plan Builder ---

function buildVoiceoverPlan(scenes: SceneCard[], profileSettings?: Partial<ScenarioGenerationProfileData> | null): VoiceoverPlan {
  const hasVoiceover = profileSettings?.voiceoverStrategy !== 'none'
  const hasAnyLines = scenes.some(s => s.voiceoverLine)

  if (!hasVoiceover || !hasAnyLines) {
    return {
      enabled: false,
      narratorPersona: null,
      pacing: 'moderate',
      emotionalContour: [],
      lines: [],
      syncGuidance: '',
    }
  }

  return {
    enabled: true,
    narratorPersona: null, // будет заполнено TTS provider в будущем
    pacing: profileSettings?.pacing || 'moderate',
    emotionalContour: scenes.map(s => s.emotionalState),
    lines: scenes
      .filter(s => s.voiceoverLine)
      .map(s => ({
        sceneOrder: s.order,
        text: s.voiceoverLine!,
        emotion: s.emotionalState,
        pauseAfter: s.order === scenes.length ? 'none' as const : 'short' as const,
      })),
    syncGuidance: 'Синхронизация: каждая строка озвучки соответствует своей сцене по order. Пауза между сценами — 0.3-0.5 секунд.',
  }
}

// --- Main Pipeline ---

export async function generateScenarioVariants(input: ScenarioInput): Promise<GeneratedVariant[]> {
  requirePaidApisEnabled('Anthropic Claude API')

  const count = input.variantsCount || 3

  // Step 0: Load optimization memory
  let memory: OptimizationMemoryData | null = null
  try {
    const memoryRecord = await prisma.scenarioMemory.findFirst({
      where: input.appId
        ? { appId: input.appId, scope: 'app' }
        : { scope: 'global', appId: null },
    })
    if (memoryRecord) {
      memory = memoryRecord.data as unknown as OptimizationMemoryData
    }
  }
  catch {
    // memory is optional, continue without it
  }

  // Step 0.5: Load favorite prompts (best-practice library).
  // Два режима: manualIds (пользователь явно выбрал) или autoSelect (AI подбирает топ-5).
  // Hard limit внутри loader'а = 5, чтобы не раздуть контекст Sonnet.
  let favoritePrompts: LoadedFavoritePrompt[] = []
  try {
    const trendTags: string[] = []
    if (input.brief?.hookAnalysis && typeof (input.brief.hookAnalysis as { type?: unknown }).type === 'string') {
      trendTags.push((input.brief.hookAnalysis as { type: string }).type)
    }
    if (Array.isArray(input.hashtags)) {
      trendTags.push(...input.hashtags.slice(0, 5))
    }
    if (input.profileSettings?.storytellingMode) {
      trendTags.push(String(input.profileSettings.storytellingMode))
    }

    favoritePrompts = await loadFavoritePromptsForScenario({
      appId: input.appId ?? null,
      manualIds: input.favoritePromptIds,
      autoSelect: input.favoritePromptsAutoSelect,
      trendTags,
      limit: 5,
    })
  }
  catch {
    // favorite prompts are optional, continue without them
  }

  // Generate N story variants. Чанкинг по VARIANT_CONCURRENCY: внутри одного
  // варианта 7 sequential AI-вызовов, поэтому при count=3 без чанкинга получаем
  // 3 параллельных HTTP-потока × 7 запросов на вариант = всплеск нагрузки на
  // Anthropic API → 429/timeout. Чанк по 2 балансирует throughput и
  // стабильность.
  const variantFactory = (index: number) => async (): Promise<GeneratedVariant> => {
    // Step 1: Story Architect
    // Модель: anthropicModel (Sonnet) — не указываем tier, чтобы использовалась основная модель.
    const storyResult = await callAnthropicAgent({
      systemPrompt: `Ты — Story Architect, сценарный архитектор для AI-генерации коротких видео (15-60 сек).
Строишь драматургию: герой, конфликт, поворот, трансформация. Каждая история уникальна.
Не используешь шаблоны и банальности. Приложение встроено в сюжет органично.

[APP INTEGRATION HINTS FOR DOWNSTREAM AGENTS]
1. turningPoint должен описывать момент, который маппится на core function приложения (например, для music-app: "касание превращается в мелодию"; для calorie-tracker: "счёт калорий заканчивается, видны макросы"). Это даёт Scene Planner естественную точку, куда вписать имя приложения.
2. resolution должна готовить почву для CTA с явным глаголом (download/try/get) — не "герой научился", а "теперь любой может через приложение".
3. appIntegrationStrategy ОБЯЗАН явно указать, в каких сценах появляется имя приложения (например: "Имя SonGo впервые звучит в scene 2 как название найденного источника, повторяется в CTA-сцене с глаголом try"). Расплывчатое "органично появляется" приводит к тому, что Scene Planner забывает имя совсем.

Отвечай на русском. СТРОГО JSON.`,
      userPrompt: buildStoryArchitectPrompt(input, memory, favoritePrompts),
      maxTokens: SCENARIO_MAX_TOKENS,
      agentName: 'story-architect',
      validate: (data: unknown) => {
        const d = data as Record<string, unknown>
        if (!d.storyArc || !d.protagonist) throw new Error('Нет storyArc или protagonist')
        return d as {
          storyArc: StoryArc
          protagonist: ProtagonistProfile
          appIntegrationStrategy: string
          negativeConstraints: string[]
        }
      },
    })

    // Step 2: Scene Planner
    // Модель: anthropicModel (Sonnet) — не указываем tier, чтобы использовалась основная модель.
    const hasPresenterLibrary = (input.presenter?.clipCount ?? 0) > 0
    const scenes = await callAnthropicAgent({
      systemPrompt: `Ты — Scene Planner, режиссёр-раскадровщик коротких видео.
Каждая сцена — уникальная карточка с целью, декорацией, действием, эмоцией, камерой, субтитрами.
Количество сцен строго берётся из budget в user prompt. Ни одна сцена не повторяет другую. Anti-loop: каждая сцена двигает сюжет.
Отвечай на русском. СТРОГО JSON.`,
      userPrompt: buildScenePlannerPrompt(storyResult.storyArc, storyResult.protagonist, input, storyResult.appIntegrationStrategy, favoritePrompts.map(p => p.id)),
      maxTokens: SCENARIO_MAX_TOKENS,
      agentName: 'scene-planner',
      validate: (data: unknown) => {
        if (!Array.isArray(data)) throw new Error('Ожидался массив сцен')
        let scenes = data as SceneCard[]
        if (scenes.length < 2) throw new Error('Минимум 2 сцены')

        // Map доступных скриншотов: при validate приклеиваем snapshot fileUrl,
        // отбрасываем appScreenRef, чьи imageId не в списке (AI мог придумать).
        const screenById = new Map<string, { id: string; fileUrl: string }>()
        for (const s of input.appReferenceScreens ?? []) {
          screenById.set(s.id, { id: s.id, fileUrl: s.fileUrl })
        }
        const VALID_SCREEN_INTENTS = new Set(['show_interface', 'reaction_to_interface', 'background_glance'])

        for (const s of scenes) {
          if (!s.order || !s.purpose || !s.action || !s.subtitleCopy) {
            throw new Error('Неполная сцена: нужны order, purpose, action, subtitleCopy')
          }
          if (!s.subtitlePlacement) {
            s.subtitlePlacement = { position: 'bottom', alignment: 'center', avoidZones: [] }
          }
          // spokenLine опционально. Clamp длины если пришло длиннее 120 символов.
          if (typeof s.spokenLine === 'string') {
            const trimmed = s.spokenLine.trim()
            s.spokenLine = trimmed.length === 0
              ? null
              : (trimmed.length > 120 ? trimmed.slice(0, 120) : trimmed)
          } else {
            s.spokenLine = null
          }

          // Без библиотеки исходников играть в кадре некому: lip-sync такую сцену
          // всё равно пропустит, а речь должна остаться — отдаём её закадру.
          if (s.spokenLine && !hasPresenterLibrary) {
            if (!s.voiceoverLine) s.voiceoverLine = s.spokenLine
            s.spokenLine = null
          }
          // Ведущая в кадре и закадровый голос на одном отрезке — это два голоса
          // одновременно. Реплика в кадре важнее: закадровую строку убираем.
          if (s.spokenLine && s.voiceoverLine) {
            s.voiceoverLine = null
          }

          // appliedReferences: трассировка применённых FavoritePrompt-эталонов.
          // Фильтруем галлюцинации (id не из списка загруженных) и неизвестные aspects.
          const validFpIds = new Set(favoritePrompts.map(p => p.id))
          const VALID_ASPECTS = new Set(['camera', 'lighting', 'actionStructure', 'mood', 'pacing', 'composition'])
          const rawApplied = (s as unknown as Record<string, unknown>).appliedReferences
          if (Array.isArray(rawApplied)) {
            const cleaned: Array<{ favoritePromptId: number; aspects: string[] }> = []
            for (const ref of rawApplied) {
              if (!ref || typeof ref !== 'object') continue
              const r = ref as Record<string, unknown>
              const fpId = Number(r.favoritePromptId)
              if (!Number.isFinite(fpId) || !validFpIds.has(fpId)) continue
              const aspectsRaw = Array.isArray(r.aspects) ? r.aspects : []
              const aspects = aspectsRaw.filter((a: unknown): a is string =>
                typeof a === 'string' && VALID_ASPECTS.has(a),
              )
              if (aspects.length === 0) continue
              cleaned.push({ favoritePromptId: fpId, aspects })
            }
            if (cleaned.length !== rawApplied.length) {
              console.warn(`[scene-planner] appliedReferences: отфильтровано ${rawApplied.length - cleaned.length} невалидных записей в сцене ${s.order}`)
            }
            ;(s as unknown as Record<string, unknown>).appliedReferences = cleaned
          }
          else {
            ;(s as unknown as Record<string, unknown>).appliedReferences = []
          }

          // appScreenRef: либо null, либо объект с валидным imageId из списка.
          // fileUrl приклеиваем сами (snapshot), чтобы при удалении исходника сцена не падала.
          const rawRef = (s as unknown as Record<string, unknown>).appScreenRef
          if (rawRef && typeof rawRef === 'object') {
            const r = rawRef as Record<string, unknown>
            const imageId = typeof r.imageId === 'string' ? r.imageId.trim() : ''
            const screen = imageId ? screenById.get(imageId) : undefined
            const intent = typeof r.intent === 'string' && VALID_SCREEN_INTENTS.has(r.intent)
              ? r.intent as 'show_interface' | 'reaction_to_interface' | 'background_glance'
              : 'show_interface'
            s.appScreenRef = screen
              ? { imageId: screen.id, fileUrl: screen.fileUrl, intent }
              : null
          } else {
            s.appScreenRef = null
          }
        }

        // Применяем budget из sceneCountStrategy: обрезаем хвост если сцен больше,
        // clamp длительности под диапазон. Это реальная защита расхода — если AI
        // проигнорировал инструкцию и выдал 6 сцен при minimal (лимит 3), лишние
        // отбрасываем вместо отказа.
        const strategy = resolveSceneCountStrategy(input.profileSettings, input.funnel)
        const budgetMap: Record<string, { min: number; max: number; minSec: number; maxSec: number }> = {
          minimal:   { min: 3, max: 3, minSec: 3, maxSec: 4 },
          auto:      { min: 3, max: 5, minSec: 3, maxSec: 6 },
          detailed:  { min: 4, max: 5, minSec: 4, maxSec: 7 },
          cinematic: { min: 5, max: 6, minSec: 6, maxSec: 9 },
          longform:  { min: 9, max: 9, minSec: 8, maxSec: 10 },
        }
        const b = budgetMap[strategy] ?? budgetMap.auto!
        if (scenes.length < b.min) {
          throw new Error(`Минимум ${b.min} сцен для стратегии ${strategy}, получено ${scenes.length}`)
        }
        if (scenes.length > b.max) {
          scenes = scenes.slice(0, b.max)
        }
        for (const s of scenes) {
          const m = (s.duration || '').match(/^(\d+(?:\.\d+)?)s?$/)
          if (m) {
            const raw = Number(m[1])
            const clamped = Math.min(b.maxSec, Math.max(b.minSec, raw))
            if (clamped !== raw) s.duration = `${clamped}s`
          } else {
            s.duration = `${b.minSec}s`
          }
        }
        return scenes
      },
    })

    // Step 3: Continuity Director
    // Модель: anthropicModel (Sonnet) — не указываем tier, чтобы использовалась основная модель.
    const continuityResult = await callAnthropicAgent({
      systemPrompt: `Ты — Continuity Director для AI-генерации коротких видео.
Следишь за единством героя, визуального кода, непротиворечивостью окружения.
Выявляешь anti-loop нарушения. Формируешь continuity bible.
Отвечай на русском. СТРОГО JSON.`,
      userPrompt: buildContinuityPrompt(scenes, storyResult.protagonist, storyResult.storyArc),
      maxTokens: SCENARIO_MAX_TOKENS,
      agentName: 'continuity-director',
      validate: (data: unknown) => {
        const d = data as Record<string, unknown>
        if (!Array.isArray(d.validatedScenes)) throw new Error('Нет validatedScenes')
        if (!d.continuityBible) throw new Error('Нет continuityBible')
        const bible = d.continuityBible as Record<string, unknown>
        if (!bible.visualCode || !bible.antiLoopRules) throw new Error('Неполный continuityBible')

        // Восстанавливаем spokenLine, appScreenRef и appliedReferences — continuity
        // director может их не вернуть. Все три поля критичны (lip-sync, image-to-video,
        // трассировка эталонов). Маппим по order.
        const byOrder = new Map<number, SceneCard>()
        for (const s of scenes) byOrder.set(s.order, s)
        for (const vs of d.validatedScenes as SceneCard[]) {
          const orig = byOrder.get(vs.order)
          if (vs.spokenLine === undefined && orig?.spokenLine !== undefined) {
            vs.spokenLine = orig.spokenLine
          }
          if ((vs.appScreenRef === undefined || vs.appScreenRef === null) && orig?.appScreenRef) {
            vs.appScreenRef = orig.appScreenRef
          }
          if (
            (vs.appliedReferences === undefined || vs.appliedReferences === null)
            && orig?.appliedReferences
            && orig.appliedReferences.length > 0
          ) {
            vs.appliedReferences = orig.appliedReferences
          }
        }

        return d as {
          validatedScenes: SceneCard[]
          continuityBible: ContinuityBible
          issues: string[]
          fixes: string[]
        }
      },
    })

    // Step 4: Visual Style (enhanced with continuity bible)
    // Модель: anthropicModel (Sonnet) — не указываем tier, чтобы использовалась основная модель.
    const visualResult = await callAnthropicAgent({
      systemPrompt: 'Ты — арт-директор AI-видеопродакшена. Описываешь визуальные стили для FLUX/Midjourney. Обеспечиваешь ВИЗУАЛЬНОЕ ЕДИНСТВО всех сцен. Отвечай на русском. СТРОГО JSON.',
      userPrompt: buildVisualStylePrompt(input, continuityResult.validatedScenes, storyResult.protagonist, continuityResult.continuityBible),
      maxTokens: SCENARIO_MAX_TOKENS,
      agentName: 'visual-director',
      validate: (data: unknown) => {
        const d = data as Record<string, unknown>
        if (!Array.isArray(d.colors) || typeof d.atmosphere !== 'string' || typeof d.character !== 'string') {
          throw new Error('Некорректный формат visual style')
        }
        return d as {
          colors: string[]
          atmosphere: string
          character: string
          stylePrompt: string
          lighting: string
          cameraWork: string
          effects: string[]
          textSummary: string
          mood: string
        }
      },
    })

    // Step 5: Subtitle Director (inline — lightweight validation)
    // Subtitles already generated in scene planner, we build the style profile
    // Account style overrides defaults if set
    const acctSub = input.accountStyle?.subtitles
    const subtitleStyle: SubtitleStyleProfile = {
      typography: {
        fontIntent: acctSub?.fontIntent || 'bold sans-serif',
        casing: acctSub?.casing || 'sentence',
        maxLineLength: 40,
        wordsPerLine: SUBTITLE_WORDS_PER_LINE_DEFAULT,
        maxLines: 2,
      },
      visual: {
        primaryColor: acctSub?.primaryColor || visualResult.colors[0] || '#FFFFFF',
        outlineColor: acctSub?.outlineColor ?? '#000000',
        shadowEnabled: true,
        backgroundColor: null,
      },
      animation: {
        entrance: acctSub?.entrance || 'fade',
        exit: 'fade',
        emphasis: 'none',
      },
      consistency: {
        maintainStyleAcrossScenes: true,
        sceneOverrideAllowed: false,
      },
    }

    // Step 6: Full script + humanization
    // Модель: anthropicModel (Sonnet) — не указываем tier, чтобы использовалась основная модель.
    const scriptResult = await callAnthropicAgent({
      systemPrompt: 'Ты — сценарист коротких вирусных видео. Пишешь тексты, которые звучат как живая речь. Отвечай на русском. СТРОГО JSON.',
      userPrompt: buildFullScriptPrompt(continuityResult.validatedScenes, storyResult.storyArc, input.appName, input.language, input.accountStyle, input.funnel),
      maxTokens: SCENARIO_MAX_TOKENS,
      agentName: 'scripter',
      validate: (data: unknown) => {
        const d = data as Record<string, unknown>
        if (typeof d.fullScript !== 'string' || typeof d.hook !== 'string') {
          throw new Error('Нет fullScript или hook')
        }
        return d as { hook: string; body: string; cta: string; fullScript: string; title: string; toneProfile: string }
      },
    })

    // Step 7: Humanization
    // Модель: anthropicModel (Sonnet) — не указываем tier, чтобы использовалась основная модель.
    const humanResult = await callAnthropicAgent({
      systemPrompt: 'Ты — редактор, который делает AI-тексты живыми и человечными. Отвечай на русском. СТРОГО JSON.',
      userPrompt: buildHumanizationPrompt(scriptResult.fullScript, input.language),
      maxTokens: SCENARIO_MAX_TOKENS,
      agentName: 'humanizer',
      validate: (data: unknown) => {
        const d = data as Record<string, unknown>
        if (typeof d.improvedScript !== 'string' || typeof d.toneProfile !== 'string') {
          throw new Error('Некорректный формат humanization')
        }
        return d as { improvedScript: string; toneProfile: string; humanScore: number; changes: unknown[] }
      },
    })

    // Build voiceover plan
    const voiceoverPlan = buildVoiceoverPlan(continuityResult.validatedScenes, input.profileSettings)

    // Assemble StoryPlan
    const storyPlan: StoryPlan = {
      version: PIPELINE_VERSION,
      storyArc: storyResult.storyArc,
      protagonist: storyResult.protagonist,
      scenes: continuityResult.validatedScenes,
      continuityBible: continuityResult.continuityBible,
      subtitleStyle,
      voiceoverPlan,
      globalVisualSystem: {
        stylePrompt: visualResult.stylePrompt,
        colorPalette: visualResult.colors,
        mood: visualResult.mood || visualResult.atmosphere,
        lighting: visualResult.lighting,
      },
      appIntegrationStrategy: storyResult.appIntegrationStrategy,
      negativeConstraints: storyResult.negativeConstraints || [],
      fullScript: humanResult.changes.length > 0 ? humanResult.improvedScript : scriptResult.fullScript,
    }

    // Step 7.5: Marketing Validator — финальная проверка перед сохранением.
    // Гарантирует, что бренд (app.name) присутствует в субтитрах/озвучке/CTA.
    // Делает auto-repair через Haiku при фейле; БЛОКИРУЕТ генерацию варианта,
    // если auto-repair не помог — лучше пропустить вариант, чем выпустить
    // marketing-bricked сценарий.
    if (input.appName && input.appName.trim()) {
      const validatorApp: MarketingValidatorApp = {
        name: input.appName,
        language: input.language,
        hasAnalyzedReferenceImages: (input.appReferenceScreens ?? [])
          .some(s => s.hasUI !== false && s.caption && s.analyzedAt),
        corePain: input.appContext?.corePain ?? null,
        appIntegrationStrategy: storyResult.appIntegrationStrategy,
        // С воронкой проверки идут по кодовому слову, а не по имени продукта.
        funnel: input.funnel ? { keyword: input.funnel.keyword } : null,
      }
      const validation = await validateScenarioMarketing({
        storyPlan,
        cta: scriptResult.cta,
        app: validatorApp,
        autoFix: true,
      })
      if (validation.fixesApplied && validation.fixesApplied.length > 0) {
        console.warn('[scenario-pipeline] marketing validator applied auto-fix:', validation.fixesApplied.length, 'fields')
      }
      if (!validation.passed) {
        const blockingMessages = validation.issues
          .filter(i => i.blocking)
          .map(i => i.message)
          .join('; ')
        throw new Error(`Marketing validator REJECTED variant: ${blockingMessages}`)
      }
      // После auto-fix scriptResult.cta может быть устаревшим — приклеиваем имя
      // приложения к scenario.cta если его там нет (защита от UI-показа без бренда).
      // С воронкой этого делать нельзя: цель CTA — кодовое слово, а приклеенное
      // «Попробуйте <продукт>» превращает призыв в рекламу того, что не продают.
      if (!input.funnel?.keyword && !scriptResult.cta.toLowerCase().includes(input.appName.toLowerCase())) {
        const fallbackCta = contentLanguageLabel(input.language) === 'Russian'
          ? `Попробуйте ${input.appName}`
          : `Try ${input.appName}`
        scriptResult.cta = `${scriptResult.cta.replace(/[.!?]\s*$/, '')}. ${fallbackCta}.`
      }
    }

    const variant: GeneratedVariant = {
      title: scriptResult.title || `Вариант ${index + 1}`,
      hook: scriptResult.hook,
      body: scriptResult.body,
      cta: scriptResult.cta,
      fullScript: storyPlan.fullScript,
      visualStyleText: visualResult.textSummary || `${visualResult.atmosphere}. ${visualResult.character}`,
      visualStyleStructured: {
        colors: visualResult.colors,
        atmosphere: visualResult.atmosphere,
        character: visualResult.character,
        stylePrompt: visualResult.stylePrompt,
        lighting: visualResult.lighting,
        cameraWork: visualResult.cameraWork,
        effects: visualResult.effects,
      },
      toneProfile: humanResult.toneProfile,
      rationale: `Story arc: ${storyResult.storyArc.template}. ${storyResult.storyArc.premise}`,
      storyPlan,
    }

    return variant
  }

  const variants: GeneratedVariant[] = []
  const failures: Array<{ index: number; message: string }> = []

  for (let chunkStart = 0; chunkStart < count; chunkStart += VARIANT_CONCURRENCY) {
    const chunkEnd = Math.min(chunkStart + VARIANT_CONCURRENCY, count)
    const chunk: Array<Promise<GeneratedVariant>> = []
    for (let i = chunkStart; i < chunkEnd; i++) {
      chunk.push(variantFactory(i)())
    }

    const results = await Promise.allSettled(chunk)
    results.forEach((result, offset) => {
      const variantIndex = chunkStart + offset
      if (result.status === 'fulfilled') {
        variants.push(result.value)
        return
      }
      const reason = result.reason as { message?: string; stack?: string } | undefined
      const message = reason?.message ?? String(result.reason)
      console.error(
        `[scenario-pipeline] variant ${variantIndex + 1}/${count} failed: ${message}${reason?.stack ? `\n${reason.stack}` : ''}`,
      )
      failures.push({ index: variantIndex, message })
    })
  }

  if (variants.length === 0) {
    const reasons = failures
      .map(f => `вариант ${f.index + 1}: ${f.message}`)
      .join('; ')
    throw new Error(
      `Не удалось сгенерировать ни одного варианта сценария${reasons ? ` (${reasons})` : ''}`,
    )
  }

  // Fire-and-forget: инкрементируем usageCount и обновляем lastUsedAt для
  // использованных эталонных промтов. Не блокирует возврат результата —
  // ошибки проглатываются, чтобы не ломать генерацию из-за аналитики.
  if (favoritePrompts.length > 0) {
    void bumpFavoritePromptsUsage(favoritePrompts.map(p => p.id))
  }

  return variants
}

// --- Regeneration of individual blocks ---

export async function regenerateBlock(
  blockType: 'hook' | 'body' | 'cta' | 'visualStyle' | 'fullScript',
  currentVariant: { hook: string; body: string; cta: string; fullScript: string; visualStyleText: string; storyPlan?: unknown },
  input: ScenarioInput,
  reason?: string,
): Promise<{ value: string; structuredVisualStyle?: VisualStyleStructured }> {
  requirePaidApisEnabled('Anthropic Claude API')

  const reasonContext = reason ? `\n\nПричина перегенерации от оператора: ${reason}` : ''

  // Include story context if available
  const storyContext = currentVariant.storyPlan
    ? `\n\nStory plan доступен — учитывай continuity и драматургию при перегенерации.`
    : ''

  if (blockType === 'hook') {
    // Модель: anthropicModel (Sonnet) — не указываем tier, чтобы использовалась основная модель.
    const result = await callAnthropicAgent({
      systemPrompt: 'Ты — мастер создания хуков. Отвечай на русском. СТРОГО JSON.',
      userPrompt: `Перегенерируй хук для видео. Текущий хук: "${currentVariant.hook}"
Текущий сценарий: ${currentVariant.body}
Платформа: ${input.platform}
Приложение: ${input.appName}${reasonContext}${storyContext}

Сгенерируй JSON: { "hook": "новый хук", "rationale": "почему этот лучше" }`,
      maxTokens: SCENARIO_MAX_TOKENS,
      agentName: 'regen-hook',
      validate: (d: unknown) => {
        const data = d as Record<string, unknown>
        if (typeof data.hook !== 'string') throw new Error('Нет поля hook')
        return data as { hook: string; rationale: string }
      },
    })
    return { value: result.hook }
  }

  if (blockType === 'visualStyle') {
    const briefVisual = input.brief?.visualStyle
      ? `\nОригинальный стиль: ${input.brief.visualStyle.colorTone}, ${input.brief.visualStyle.aesthetic}`
      : ''

    // Модель: anthropicModel (Sonnet) — не указываем tier, чтобы использовалась основная модель.
    const result = await callAnthropicAgent({
      systemPrompt: 'Ты — арт-директор AI-видеопродакшена. Отвечай на русском. СТРОГО JSON.',
      userPrompt: `Перегенерируй визуальный стиль для видео.
Хук: ${currentVariant.hook}
Сценарий: ${currentVariant.body}
Платформа: ${input.platform}
Приложение: ${input.appName}${briefVisual}${reasonContext}${storyContext}

Сгенерируй JSON:
- colors: массив hex-цветов
- atmosphere: атмосфера
- character: персонаж
- stylePrompt: промпт для FLUX/Midjourney (английский)
- lighting: освещение
- cameraWork: камера
- effects: эффекты
- textSummary: краткое описание стиля (русский)`,
      maxTokens: SCENARIO_MAX_TOKENS,
      agentName: 'regen-visual-style',
      validate: (d: unknown) => {
        const data = d as Record<string, unknown>
        if (!Array.isArray(data.colors)) throw new Error('Нет colors')
        return data as {
          colors: string[]; atmosphere: string; character: string
          stylePrompt: string; lighting: string; cameraWork: string
          effects: string[]; textSummary: string
        }
      },
    })
    return {
      value: result.textSummary || `${result.atmosphere}. ${result.character}`,
      structuredVisualStyle: {
        colors: result.colors,
        atmosphere: result.atmosphere,
        character: result.character,
        stylePrompt: result.stylePrompt,
        lighting: result.lighting,
        cameraWork: result.cameraWork,
        effects: result.effects,
      },
    }
  }

  if (blockType === 'body' || blockType === 'cta' || blockType === 'fullScript') {
    // Модель: anthropicModel (Sonnet) — не указываем tier, чтобы использовалась основная модель.
    const result = await callAnthropicAgent({
      systemPrompt: 'Ты — сценарист коротких видео. Отвечай на русском. СТРОГО JSON.',
      userPrompt: `Перегенерируй ${blockType === 'body' ? 'основную часть' : blockType === 'cta' ? 'призыв к действию' : 'полный текст'} сценария.

Текущий хук: ${currentVariant.hook}
Текущий body: ${currentVariant.body}
Текущий CTA: ${currentVariant.cta}
Платформа: ${input.platform}
Приложение: ${input.appName}${reasonContext}${storyContext}

Сгенерируй JSON: { "value": "новый текст" }
Текст должен звучать естественно, без штампов.`,
      maxTokens: SCENARIO_MAX_TOKENS,
      agentName: 'regen-block',
      validate: (d: unknown) => {
        const data = d as Record<string, unknown>
        if (typeof data.value !== 'string') throw new Error('Нет поля value')
        return data as { value: string }
      },
    })
    return { value: result.value }
  }

  throw new Error(`Неизвестный тип блока: ${blockType}`)
}

// --- Improve visual style prompt ---

export async function improveVisualStylePrompt(
  currentStyle: VisualStyleStructured,
  context: { hook: string; body: string; platform: string; appName: string },
): Promise<{ improvedPrompt: string; improvedStyle: VisualStyleStructured }> {
  requirePaidApisEnabled('Anthropic Claude API')

  // Модель: anthropicModel (Sonnet) — не указываем tier, чтобы использовалась основная модель.
  const result = await callAnthropicAgent({
    systemPrompt: 'Ты — арт-директор с экспертизой в AI-генерации изображений (FLUX, Midjourney, Runway). Отвечай на русском. СТРОГО JSON.',
    userPrompt: `Улучши визуальный стиль и промпт для AI-генерации.

## Текущий стиль
- Цвета: ${currentStyle.colors.join(', ')}
- Атмосфера: ${currentStyle.atmosphere}
- Персонаж: ${currentStyle.character}
- Текущий промпт: ${currentStyle.stylePrompt}
${currentStyle.lighting ? `- Освещение: ${currentStyle.lighting}` : ''}

## Контекст
- Хук: ${context.hook}
- Сценарий: ${context.body}
- Платформа: ${context.platform}
- Приложение: ${context.appName}

## Задача
Улучши промпт так, чтобы он давал более качественную и целостную генерацию. Верни JSON:
- improvedPrompt: улучшенный промпт (английский, для FLUX/Midjourney)
- colors: уточнённый массив hex-цветов
- atmosphere: уточнённая атмосфера
- character: уточнённое описание персонажа
- stylePrompt: полный улучшенный промпт
- lighting: освещение
- cameraWork: камера
- effects: эффекты`,
    maxTokens: SCENARIO_MAX_TOKENS,
    agentName: 'improve-visual-style',
    validate: (d: unknown) => {
      const data = d as Record<string, unknown>
      if (typeof data.improvedPrompt !== 'string') throw new Error('Нет improvedPrompt')
      return data as {
        improvedPrompt: string; colors: string[]; atmosphere: string
        character: string; stylePrompt: string; lighting: string
        cameraWork: string; effects: string[]
      }
    },
  })

  return {
    improvedPrompt: result.improvedPrompt,
    improvedStyle: {
      colors: result.colors || currentStyle.colors,
      atmosphere: result.atmosphere || currentStyle.atmosphere,
      character: result.character || currentStyle.character,
      stylePrompt: result.stylePrompt || currentStyle.stylePrompt,
      improvedPrompt: result.improvedPrompt,
      lighting: result.lighting,
      cameraWork: result.cameraWork,
      effects: result.effects,
    },
  }
}

export { PIPELINE_VERSION }
