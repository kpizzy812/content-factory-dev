/**
 * Story Architect Agent -- формирует high-level драматургию для story-driven сценария.
 * Строит StoryArc + ProtagonistProfile: трансформация, конфликт, встреча с приложением, разрешение.
 */
import type { StoryArc, StoryArcTemplate, ProtagonistProfile } from '~~/shared/types/story'
import { DEVICE_RULES_NOTE_FOR_AGENTS } from '~~/shared/utils/video-prompt-helpers'

// --- Input / Output ---

export interface StoryArchitectInput {
  trendTitle: string
  trendDescription?: string | null
  platform: string
  brief: {
    hookAnalysis: any
    sceneStructure: any
    visualStyle: any
    viralityReasons: any
    summary: string
  } | null
  appName: string
  appDescription?: string | null
  appContext?: {
    transformationPromise?: string
    corePain?: string
    coreOutcome?: string
    creativeAngles?: any
    scenarioContext?: any
    referenceImageUrls?: string[]
  } | null
  optimizationMemory?: {
    requirements: Array<{ text: string; category: string }>
    recommendations: Array<{ text: string; category: string }>
    antiPatterns: Array<{ text: string; category: string }>
  } | null
  profileSettings?: {
    storytellingMode?: string
    protagonistMode?: string
    appIntegrationStyle?: string
  } | null
}

export interface StoryArchitectResult {
  storyArc: StoryArc
  protagonist: ProtagonistProfile
  appIntegrationStrategy: string
  negativeConstraints: string[]
}

// --- System Prompt ---

const SYSTEM_PROMPT = `Ты -- Story Architect, сценарный архитектор для коротких вирусных видео (15-60 секунд). Ты не пишешь сценарии -- ты строишь их драматургический скелет.

Твоя задача -- создать StoryArc (дугу истории) и ProtagonistProfile (профиль героя), которые превращают рекламный ролик в микро-историю с эмоциональным воздействием.

## Твои принципы

1. КОНФЛИКТ ПРЕЖДЕ ВСЕГО. Без конфликта нет истории. Даже в 15-секундном ролике должен быть дефицит, боль, сомнение или барьер.

2. ТРАНСФОРМАЦИЯ, А НЕ ДЕМОНСТРАЦИЯ. Герой не "использует приложение" -- герой проходит через изменение. Приложение -- это catalyst, а не предмет показа.

3. СПЕЦИФИЧНОСТЬ УБИВАЕТ ШАБЛОН. Не "девушка с проблемой", а "фрилансер-иллюстратор, которая теряет заказ из-за сорванного дедлайна". Детали создают узнаваемость.

4. EMOTIONAL JOURNEY -- ЭТО КАРТА. Каждая сцена несёт конкретную эмоцию. Путь эмоций должен быть контрастным: frustration -> curiosity -> wow -> confidence.

5. ПРИЛОЖЕНИЕ ВХОДИТ ЕСТЕСТВЕННО. Не "а вот наше приложение!", а момент, когда герой находит решение. Timing встречи с приложением определяет, будет ли это реклама или история.

6. АНТИБАНАЛЬНОСТЬ. Запрещены: "мне знакомо", generic утренние рутины, "раньше я не знал", фальшивые wow-реакции, прямое обращение к камере с продажей. Каждая история должна иметь неожиданный элемент.

## [APP INTEGRATION HINTS FOR DOWNSTREAM AGENTS]

When designing the story arc:

1. The **turningPoint** should be a moment that maps to the app's core function.
   Examples:
   - SonGo (music creation through touch) → turning point should involve "touch creates music" / "tap unlocks song" / "fingers on the screen birth a melody"
   - Vitafy (calorie tracking) → turning point = "stops counting, starts seeing macros instantly"
   - Tinder (dating) → turning point = "right swipe sparks the connection"

   This makes it natural for Scene Planner to weave the app name into scenes 4-5 (the revelation moment) without forcing.

2. The **resolution** should set up a clean CTA for the final scene.
   Examples:
   - Bad resolution: "He learned to make music" (closes story but leaves no CTA hook)
   - Good resolution: "Anyone with a phone can now turn a tap into a song" (sets up "Try ${'<appName>'}, tap to make music")

3. **appIntegrationStrategy** should explicitly mention WHEN in the arc the app name surfaces:
   - "App name first appears in scene 2 voiceover when protagonist discovers the catalyst, repeats in CTA scene with download verb"
   - "App acts as the magical artifact in scenes 4-6, named explicitly in CTA"

   Vague strategies like "app appears organically" lead Scene Planner to skip the app name entirely.

## Шаблоны арок

- transformation: слабый/проблемный -> кризисный момент -> приложение как catalyst -> новый уровень
- discovery: не знал о решении -> случайная находка -> результат, который меняет привычку
- challenge: конкретный вызов с дедлайном -> провал первой попытки -> приложение спасает в последний момент
- comparison: конкретная ситуация "до" vs "после", с точкой перелома посередине
- day_in_life: один день через призму трансформации, приложение вплетено в рутину
- social_proof: герой видит, как другие уже живут иначе -> FOMO -> присоединяется
- curiosity: загадка/необычная ситуация -> раскрытие -> приложение оказывается ключом
- custom: своя драматургия, когда ни один шаблон не подходит

## Формат ответа

Строго JSON с полями: storyArc, protagonist, appIntegrationStrategy, negativeConstraints.

## Правила для negativeConstraints (СТРОГО)

negativeConstraints уходят как negative_prompt в Kling video model. Поэтому:

1. ВСЕ элементы — на АНГЛИЙСКОМ (en-US). Русский Kling игнорирует.
2. Каждый элемент — 2-5 слов, конкретный визуальный объект/паттерн, который НЕ должен попасть в кадр.
3. ЗАПРЕЩЕНО формулировать через «отсутствие/missing/lack of/no/without». Negative prompt — это то, что запрещено показать. Двойное отрицание инвертирует смысл.

Хорошо:
- "neon artificial colors"
- "studio recording equipment"
- "stock-photo poses"
- "fake wow reactions"
- "direct camera selling"

Плохо (НЕ ДЕЛАЙ):
- "отсутствие крупных планов телефона"   (РУССКИЙ + двойное отрицание)
- "missing close-ups of phone"            (двойное отрицание)
- "no nature contact"                     (двойное отрицание)
- "lack of authentic emotion"             (двойное отрицание)
${DEVICE_RULES_NOTE_FOR_AGENTS}`

// --- User Prompt Builder ---

function buildPrompt(input: StoryArchitectInput): string {
  const sections: string[] = []

  // Тренд
  sections.push(`## Тренд
- Название: ${input.trendTitle}${input.trendDescription ? `\n- Описание: ${input.trendDescription}` : ''}
- Платформа: ${input.platform}`)

  // Brief
  if (input.brief) {
    const briefParts: string[] = ['## Creative Brief']
    briefParts.push(`Саммари: ${input.brief.summary}`)

    if (input.brief.hookAnalysis) {
      briefParts.push(`Hook-анализ: ${JSON.stringify(input.brief.hookAnalysis)}`)
    }
    if (input.brief.sceneStructure) {
      briefParts.push(`Структура сцен: ${JSON.stringify(input.brief.sceneStructure)}`)
    }
    if (input.brief.visualStyle) {
      briefParts.push(`Визуальный стиль: ${JSON.stringify(input.brief.visualStyle)}`)
    }
    if (input.brief.viralityReasons) {
      briefParts.push(`Причины виральности: ${JSON.stringify(input.brief.viralityReasons)}`)
    }

    sections.push(briefParts.join('\n'))
  }

  // App context
  sections.push(`## Приложение
- Название: ${input.appName}${input.appDescription ? `\n- Описание: ${input.appDescription}` : ''}`)

  if (input.appContext) {
    const ctxParts: string[] = ['## Контекст приложения']

    if (input.appContext.transformationPromise) {
      ctxParts.push(`Обещание трансформации: ${input.appContext.transformationPromise}`)
    }
    if (input.appContext.corePain) {
      ctxParts.push(`Ключевая боль: ${input.appContext.corePain}`)
    }
    if (input.appContext.coreOutcome) {
      ctxParts.push(`Целевой результат: ${input.appContext.coreOutcome}`)
    }
    if (input.appContext.creativeAngles) {
      ctxParts.push(`Креативные углы: ${JSON.stringify(input.appContext.creativeAngles)}`)
    }
    if (input.appContext.scenarioContext) {
      ctxParts.push(`Сценарный контекст: ${JSON.stringify(input.appContext.scenarioContext)}`)
    }
    if (input.appContext.referenceImageUrls && input.appContext.referenceImageUrls.length > 0) {
      ctxParts.push(`Reference-изображения (визуальные эталоны приложения — используй для стиля, героев, объектов):`)
      for (const url of input.appContext.referenceImageUrls) {
        ctxParts.push(`  • ${url}`)
      }
    }

    sections.push(ctxParts.join('\n'))
  }

  // Optimization memory
  if (input.optimizationMemory) {
    const memParts: string[] = ['## Память оптимизации (учитывай обязательно)']

    if (input.optimizationMemory.requirements.length > 0) {
      memParts.push('### Требования (обязательные)')
      for (const r of input.optimizationMemory.requirements) {
        memParts.push(`- [${r.category}] ${r.text}`)
      }
    }
    if (input.optimizationMemory.recommendations.length > 0) {
      memParts.push('### Рекомендации')
      for (const r of input.optimizationMemory.recommendations) {
        memParts.push(`- [${r.category}] ${r.text}`)
      }
    }
    if (input.optimizationMemory.antiPatterns.length > 0) {
      memParts.push('### Антипаттерны (избегай)')
      for (const a of input.optimizationMemory.antiPatterns) {
        memParts.push(`- [${a.category}] ${a.text}`)
      }
    }

    sections.push(memParts.join('\n'))
  }

  // Profile settings
  if (input.profileSettings) {
    const prefParts: string[] = ['## Настройки профиля генерации']

    if (input.profileSettings.storytellingMode) {
      prefParts.push(`Режим повествования: ${input.profileSettings.storytellingMode}`)
    }
    if (input.profileSettings.protagonistMode) {
      prefParts.push(`Тип героя: ${input.profileSettings.protagonistMode}`)
    }
    if (input.profileSettings.appIntegrationStyle) {
      prefParts.push(`Стиль интеграции приложения: ${input.profileSettings.appIntegrationStyle}`)
    }

    sections.push(prefParts.join('\n'))
  }

  // Task
  sections.push(`## Задача

Построй драматургический скелет для короткого видео. Верни JSON-объект:

{
  "storyArc": {
    "template": "<один из: transformation, discovery, challenge, comparison, day_in_life, social_proof, curiosity, custom>",
    "premise": "<исходная ситуация героя, 1-2 предложения, конкретная и узнаваемая>",
    "conflict": "<дефицит / сомнение / проблема / барьер, который создаёт напряжение>",
    "turningPoint": "<момент встречи с приложением -- как именно герой находит решение>",
    "resolution": "<трансформация / результат -- что изменилось в жизни героя>",
    "emotionalJourney": ["<эмоция сцены 1>", "<эмоция сцены 2>", "<эмоция сцены 3>", "<эмоция сцены 4>"]
  },
  "protagonist": {
    "type": "<person | object | abstract>",
    "description": "<конкретное описание героя с деталями, создающими узнаваемость>",
    "initialState": "<состояние в начале истории>",
    "finalState": "<состояние в конце истории>",
    "visualIdentifiers": ["<визуальный маркер 1>", "<визуальный маркер 2>", "<визуальный маркер 3>"]
  },
  "appIntegrationStrategy": "<описание, как приложение вплетено в повествование: когда появляется, как показывается, почему это выглядит естественно>",
  "negativeConstraints": ["<что запрещено в этом конкретном сценарии>", "<банальность, которую надо избежать>"]
}

Ответь ТОЛЬКО JSON-объектом.`)

  return sections.join('\n\n')
}

// --- Validation ---

const VALID_TEMPLATES: StoryArcTemplate[] = [
  'transformation', 'discovery', 'challenge', 'comparison',
  'day_in_life', 'social_proof', 'curiosity', 'custom',
]

const VALID_PROTAGONIST_TYPES = ['person', 'object', 'abstract'] as const

function validate(data: unknown): StoryArchitectResult {
  const d = data as Record<string, unknown>

  // storyArc
  if (!d.storyArc || typeof d.storyArc !== 'object') {
    throw new Error('StoryArchitect: отсутствует или некорректен storyArc')
  }

  const arc = d.storyArc as Record<string, unknown>

  if (typeof arc.template !== 'string' || !VALID_TEMPLATES.includes(arc.template as StoryArcTemplate)) {
    throw new Error(`StoryArchitect: некорректный template "${arc.template}", ожидается один из: ${VALID_TEMPLATES.join(', ')}`)
  }
  if (typeof arc.premise !== 'string' || !arc.premise.trim()) {
    throw new Error('StoryArchitect: отсутствует premise')
  }
  if (typeof arc.conflict !== 'string' || !arc.conflict.trim()) {
    throw new Error('StoryArchitect: отсутствует conflict')
  }
  if (typeof arc.turningPoint !== 'string' || !arc.turningPoint.trim()) {
    throw new Error('StoryArchitect: отсутствует turningPoint')
  }
  if (typeof arc.resolution !== 'string' || !arc.resolution.trim()) {
    throw new Error('StoryArchitect: отсутствует resolution')
  }
  if (!Array.isArray(arc.emotionalJourney) || arc.emotionalJourney.length < 2) {
    throw new Error('StoryArchitect: emotionalJourney должен содержать минимум 2 эмоции')
  }
  for (let i = 0; i < arc.emotionalJourney.length; i++) {
    if (typeof arc.emotionalJourney[i] !== 'string') {
      throw new Error(`StoryArchitect: emotionalJourney[${i}] должен быть строкой`)
    }
  }

  // protagonist
  if (!d.protagonist || typeof d.protagonist !== 'object') {
    throw new Error('StoryArchitect: отсутствует или некорректен protagonist')
  }

  const prot = d.protagonist as Record<string, unknown>

  if (typeof prot.type !== 'string' || !VALID_PROTAGONIST_TYPES.includes(prot.type as typeof VALID_PROTAGONIST_TYPES[number])) {
    throw new Error(`StoryArchitect: некорректный protagonist.type "${prot.type}", ожидается один из: ${VALID_PROTAGONIST_TYPES.join(', ')}`)
  }
  if (typeof prot.description !== 'string' || !prot.description.trim()) {
    throw new Error('StoryArchitect: отсутствует protagonist.description')
  }
  if (typeof prot.initialState !== 'string' || !prot.initialState.trim()) {
    throw new Error('StoryArchitect: отсутствует protagonist.initialState')
  }
  if (typeof prot.finalState !== 'string' || !prot.finalState.trim()) {
    throw new Error('StoryArchitect: отсутствует protagonist.finalState')
  }
  if (!Array.isArray(prot.visualIdentifiers) || prot.visualIdentifiers.length === 0) {
    throw new Error('StoryArchitect: visualIdentifiers должен содержать хотя бы 1 элемент')
  }
  for (let i = 0; i < prot.visualIdentifiers.length; i++) {
    if (typeof prot.visualIdentifiers[i] !== 'string') {
      throw new Error(`StoryArchitect: visualIdentifiers[${i}] должен быть строкой`)
    }
  }

  // appIntegrationStrategy
  if (typeof d.appIntegrationStrategy !== 'string' || !(d.appIntegrationStrategy as string).trim()) {
    throw new Error('StoryArchitect: отсутствует appIntegrationStrategy')
  }

  // negativeConstraints
  if (!Array.isArray(d.negativeConstraints) || d.negativeConstraints.length === 0) {
    throw new Error('StoryArchitect: negativeConstraints должен содержать хотя бы 1 элемент')
  }
  for (let i = 0; i < d.negativeConstraints.length; i++) {
    if (typeof d.negativeConstraints[i] !== 'string') {
      throw new Error(`StoryArchitect: negativeConstraints[${i}] должен быть строкой`)
    }
  }
  d.negativeConstraints = sanitizeNegativeConstraints(d.negativeConstraints as string[])
  if ((d.negativeConstraints as string[]).length === 0) {
    throw new Error('StoryArchitect: после санитайзинга negativeConstraints пуст. Claude вернул только некорректные формулировки.')
  }

  return d as unknown as StoryArchitectResult
}

/**
 * Чистит negativeConstraints для Kling negative_prompt:
 * - выкидывает русские строки (Kling работает с английскими промптами)
 * - выкидывает формулировки через «отсутствие/missing/no X/without/lack of» —
 *   negative_prompt + double negation = инверсия смысла, модель начнёт ИЗБЕГАТЬ
 *   нужного.
 * - триммит, дедуплицирует, лимитирует длину одного элемента 80 символами.
 */
export function sanitizeNegativeConstraints(items: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  // Кириллица в строке → русский, выкидываем (Kling negative_prompt — EN-only).
  const hasCyrillic = (s: string) => /[Ѐ-ӿ]/.test(s)

  // Двойное отрицание в начале фразы. Negative prompt уже отрицателен.
  const isDoubleNegation = (s: string) => {
    const lower = s.toLowerCase().trim()
    return /^(no\s+\w|without\s+\w|missing\s+\w|lack of\s+\w|absence of\s+\w|don['']?t\s+\w|never\s+\w)/.test(lower)
  }

  for (const raw of items) {
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (!trimmed) continue
    if (hasCyrillic(trimmed)) continue
    if (isDoubleNegation(trimmed)) continue
    const clipped = trimmed.length > 80 ? trimmed.slice(0, 80) : trimmed
    const key = clipped.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(clipped)
  }

  return result
}

// --- Public API ---

export async function runStoryArchitectAgent(input: StoryArchitectInput): Promise<StoryArchitectResult> {
  // Модель: anthropicModel (Sonnet) — не указываем tier, чтобы использовалась основная модель.
  return callAnthropicAgent({
    agentName: 'story-architect',
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildPrompt(input),
    maxTokens: 4096,
    validate,
  })
}
