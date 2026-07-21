/**
 * Scene Scripter Agent — короткий сценарист (15-30 сек) для scene-driven path.
 *
 * Принимает на вход compiledPrompt от scene-composer'а, контекст приложения и
 * (опционально) контекст персонажа + AI-описания реф-фото, и собирает текстовый
 * сценарий с минимум 2 scene cards (hook scene + main scene), которые позже
 * становятся storyPlan для video-pipeline (detectRuntimeMode → story_driven).
 *
 * Отдельный путь от generateScenarioVariants (trend-driven). Здесь нет тренда,
 * нет insights, нет critic — только композитор сцены даёт визуальный prompt и
 * приложение даёт контекст. Один вариант, один Sonnet-вызов.
 */
import type { VisualStyleStructured } from '~~/shared/types/scenario'
import type { StoryArcTemplate, ProtagonistProfile, SceneCard, ContinuityBible, SubtitlePlacement } from '~~/shared/types/story'
import { callAnthropicAgent } from './call-anthropic'

const SCRIPTER_MAX_TOKENS = 8000

export interface SceneScripterInput {
  compiledPrompt: string
  negativePrompt?: string | null
  app: {
    name: string
    description?: string | null
    transformationPromise?: string | null
    corePain?: string | null
    coreOutcome?: string | null
    keywords?: string[]
  }
  character?: {
    name: string
    description?: string | null
    visualPrompt?: string | null
    role?: string | null
    aiVisualDescriptions?: string[]
  } | null
  sceneName?: string | null
  /** AI vision visualDescription'ы из реф-фото сцены/персонажа. */
  referenceImageDescriptions?: string[]
  platform?: string
  reworkReason?: string | null
}

export interface SceneScripterOutput {
  title: string
  hook: string
  body: string
  cta: string
  fullScript: string
  visualStyleText: string
  visualStyleStructured: VisualStyleStructured | null
  toneProfile: string
  storyArc: {
    template: StoryArcTemplate
    premise: string
    conflict: string
    turningPoint: string
    resolution: string
    emotionalJourney: string[]
  }
  protagonist: ProtagonistProfile
  scenes: SceneCard[]
  appIntegrationStrategy: string
  continuityBible: ContinuityBible
}

const VALID_ARC_TEMPLATES: StoryArcTemplate[] = [
  'transformation', 'discovery', 'challenge', 'comparison',
  'day_in_life', 'social_proof', 'curiosity', 'custom',
]

function normalizeArcTemplate(value: unknown): StoryArcTemplate {
  if (typeof value === 'string' && (VALID_ARC_TEMPLATES as string[]).includes(value)) {
    return value as StoryArcTemplate
  }
  return 'discovery'
}

function normalizeSubtitlePlacement(raw: unknown): SubtitlePlacement {
  const r = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {}
  const pos = r.position
  const align = r.alignment
  return {
    position: (pos === 'top' || pos === 'center' || pos === 'bottom') ? pos : 'bottom',
    alignment: (align === 'left' || align === 'right' || align === 'center') ? align : 'center',
    avoidZones: Array.isArray(r.avoidZones) ? (r.avoidZones as unknown[]).filter(z => typeof z === 'string') as string[] : [],
  }
}

function normalizeScene(raw: unknown, fallbackOrder: number, fallbackVisual: string): SceneCard {
  const r = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {}
  return {
    order: typeof r.order === 'number' ? r.order : fallbackOrder,
    purpose: typeof r.purpose === 'string' ? r.purpose : '',
    setting: typeof r.setting === 'string' ? r.setting : '',
    action: typeof r.action === 'string' ? r.action : '',
    whatChanges: typeof r.whatChanges === 'string' ? r.whatChanges : '',
    emotionalState: typeof r.emotionalState === 'string' ? r.emotionalState : 'neutral',
    appIntegrationBeat: typeof r.appIntegrationBeat === 'string' ? r.appIntegrationBeat : null,
    visualPromptGuidance: typeof r.visualPromptGuidance === 'string' && r.visualPromptGuidance.trim()
      ? r.visualPromptGuidance
      : fallbackVisual,
    appScreenRef: null,
    subtitleCopy: typeof r.subtitleCopy === 'string' ? r.subtitleCopy : '',
    subtitlePlacement: normalizeSubtitlePlacement(r.subtitlePlacement),
    voiceoverLine: typeof r.voiceoverLine === 'string' ? r.voiceoverLine : null,
    spokenLine: typeof r.spokenLine === 'string' ? r.spokenLine : null,
    continuityNotes: typeof r.continuityNotes === 'string' ? r.continuityNotes : '',
    duration: typeof r.duration === 'string' ? r.duration : '5s',
    cameraAngle: typeof r.cameraAngle === 'string' ? r.cameraAngle : 'medium shot',
    props: Array.isArray(r.props) ? (r.props as unknown[]).filter(p => typeof p === 'string') as string[] : [],
    appliedReferences: [],
  }
}

export async function runSceneScripter(input: SceneScripterInput): Promise<SceneScripterOutput> {
  const characterBlock = input.character
    ? `\n## Персонаж
- Имя: ${input.character.name}
- Роль: ${input.character.role ?? 'protagonist'}
${input.character.description ? `- Описание: ${input.character.description}` : ''}
${input.character.visualPrompt ? `- Visual prompt: ${input.character.visualPrompt}` : ''}
${input.character.aiVisualDescriptions?.length ? `- AI-описания реф-фото: ${input.character.aiVisualDescriptions.slice(0, 3).join(' | ')}` : ''}`
    : ''

  const refImagesBlock = input.referenceImageDescriptions?.length
    ? `\n## Описания реф-изображений (AI vision)\n${input.referenceImageDescriptions.slice(0, 5).map(d => `- ${d}`).join('\n')}`
    : ''

  const reworkBlock = input.reworkReason
    ? `\n## Причина переработки (от оператора)\n${input.reworkReason}\n\nУчитывай это при переработке и предлагай конкретные изменения.`
    : ''

  const platform = input.platform ?? 'tiktok'

  const systemPrompt = `Ты — сценарист коротких видео (15-30 сек) для AI-генерации (TikTok/Reels/Shorts).
На основе визуального prompt из композитора сцены, контекста приложения и (опционально) реф-фото персонажа,
собери текстовый сценарий с МИНИМУМ 2 scene cards.

Жёсткие требования:
1. Hook ОБЯЗАТЕЛЬНО упоминает имя приложения и цепляет за 1-3 секунды (≤15 слов).
2. CTA — глагол + имя приложения (1-2 предложения).
3. Никаких эмодзи. Никаких хештегов в тексте.
4. Текстовые поля video (hook/body/cta/fullScript) на русском, если запрос на русском — иначе сохраняй язык.
5. visualPromptGuidance в каждой сцене на английском (для FLUX/Kling).
6. visualStyleText — краткое RU описание стиля; visualStyleStructured — null или валидный объект.
7. toneProfile — короткая характеристика тона (русский).
8. voiceoverLine в КАЖДОЙ сцене — короткая фраза для TTS-озвучки (≤12 слов), 1-2 предложения, тот же язык что hook/body. Это критично — без voiceoverLine видео будет немое. Распредели fullScript по сценам: scene[0].voiceoverLine ≈ hook, последняя scene ≈ CTA, middle scenes — фрагменты body.
9. subtitleCopy в каждой сцене ≈ voiceoverLine (или его сокращение). Не оставляй пустым.

Отвечай СТРОГО валидным JSON.`

  const userPrompt = `## Визуальный prompt сцены (от композитора)
${input.compiledPrompt}
${input.negativePrompt ? `\n## Negative prompt\n${input.negativePrompt}` : ''}

## Приложение
- Название: ${input.app.name}
${input.app.description ? `- Описание: ${input.app.description.slice(0, 400)}` : ''}
${input.app.transformationPromise ? `- Обещание трансформации: ${input.app.transformationPromise}` : ''}
${input.app.corePain ? `- Боль клиента: ${input.app.corePain}` : ''}
${input.app.coreOutcome ? `- Результат: ${input.app.coreOutcome}` : ''}
${input.app.keywords?.length ? `- Ключи: ${input.app.keywords.slice(0, 8).join(', ')}` : ''}
${characterBlock}
${input.sceneName ? `\n## Имя сцены\n${input.sceneName}` : ''}
${refImagesBlock}
${reworkBlock}

## Платформа
${platform}

## Формат ответа (JSON)
{
  "title": "Название варианта (1 предложение)",
  "hook": "Хук — упоминает приложение, ≤15 слов",
  "body": "Основная часть — 3-6 предложений",
  "cta": "Призыв к действию — глагол + имя приложения",
  "fullScript": "Полный скрипт для озвучки",
  "visualStyleText": "Краткое RU описание визуального стиля",
  "visualStyleStructured": null,
  "toneProfile": "Описание тона (например: дружелюбный энтузиазм)",
  "storyArc": {
    "template": "discovery|transformation|challenge|comparison|day_in_life|social_proof|curiosity|custom",
    "premise": "Исходная ситуация",
    "conflict": "Дефицит / проблема",
    "turningPoint": "Встреча с приложением",
    "resolution": "Результат",
    "emotionalJourney": ["curiosity", "excitement", "satisfaction"]
  },
  "protagonist": {
    "type": "person",
    "description": "Описание героя",
    "initialState": "Начальное состояние",
    "finalState": "Финальное состояние",
    "visualIdentifiers": ["уникальные маркеры"]
  },
  "scenes": [
    {
      "order": 1,
      "purpose": "зацепить зрителя",
      "setting": "место действия",
      "action": "что происходит",
      "whatChanges": "что меняется в этой сцене",
      "emotionalState": "curiosity",
      "appIntegrationBeat": "как появляется приложение или null",
      "visualPromptGuidance": "english prompt for FLUX/Kling, 1-3 sentences, includes character markers if any",
      "subtitleCopy": "текст субтитров",
      "subtitlePlacement": { "position": "bottom", "alignment": "center", "avoidZones": [] },
      "voiceoverLine": "Короткая фраза для TTS на языке hook/body (≤12 слов), не оставляй null",
      "spokenLine": null,
      "continuityNotes": "заметки для continuity",
      "duration": "5s",
      "cameraAngle": "close-up",
      "props": []
    },
    {
      "order": 2,
      "purpose": "раскрыть результат",
      "setting": "...",
      "action": "...",
      "whatChanges": "...",
      "emotionalState": "satisfaction",
      "appIntegrationBeat": "...",
      "visualPromptGuidance": "english prompt for FLUX/Kling",
      "subtitleCopy": "...",
      "subtitlePlacement": { "position": "bottom", "alignment": "center", "avoidZones": [] },
      "voiceoverLine": "Короткая фраза для TTS на языке hook/body (≤12 слов), не оставляй null",
      "spokenLine": null,
      "continuityNotes": "...",
      "duration": "5s",
      "cameraAngle": "...",
      "props": []
    }
  ],
  "appIntegrationStrategy": "общая стратегия как приложение встроено в повествование",
  "continuityBible": {
    "protagonist": { "type": "person", "description": "...", "initialState": "...", "finalState": "...", "visualIdentifiers": [] },
    "visualCode": {
      "colorPalette": ["#aabbcc"],
      "lightingConsistency": "soft daylight",
      "environmentStyle": "natural urban"
    },
    "antiLoopRules": [],
    "sceneTransitions": [],
    "forbiddenElements": []
  }
}`

  const result = await callAnthropicAgent({
    systemPrompt,
    userPrompt,
    maxTokens: SCRIPTER_MAX_TOKENS,
    agentName: 'scene-scripter',
    validate: (data: unknown) => {
      const d = data as Record<string, unknown>
      if (typeof d.title !== 'string' || !d.title.trim()) throw new Error('Нет поля title')
      if (typeof d.hook !== 'string' || !d.hook.trim()) throw new Error('Нет поля hook')
      if (typeof d.body !== 'string' || !d.body.trim()) throw new Error('Нет поля body')
      if (typeof d.cta !== 'string' || !d.cta.trim()) throw new Error('Нет поля cta')
      if (typeof d.fullScript !== 'string' || !d.fullScript.trim()) throw new Error('Нет поля fullScript')
      if (!Array.isArray(d.scenes) || d.scenes.length < 2) {
        throw new Error('Нужно минимум 2 scene cards')
      }
      // Каждая сцена — visualPromptGuidance обязателен (для detectRuntimeMode → story_driven)
      for (const [i, s] of (d.scenes as unknown[]).entries()) {
        const sObj = s as Record<string, unknown>
        if (typeof sObj.visualPromptGuidance !== 'string' || !sObj.visualPromptGuidance.trim()) {
          throw new Error(`scenes[${i}].visualPromptGuidance обязателен`)
        }
      }
      return d
    },
  })

  // Нормализация на post-validate уровне (валидатор уже проверил критичное).
  const rawScenes = (result.scenes as unknown[])
  const scenes: SceneCard[] = rawScenes.map((s, i) => normalizeScene(s, i + 1, input.compiledPrompt))

  const rawProtagonist = (result.protagonist && typeof result.protagonist === 'object')
    ? result.protagonist as Record<string, unknown>
    : {}
  const protagonist: ProtagonistProfile = {
    type: rawProtagonist.type === 'object' || rawProtagonist.type === 'abstract' ? rawProtagonist.type : 'person',
    description: typeof rawProtagonist.description === 'string'
      ? rawProtagonist.description
      : (input.character?.description ?? input.character?.name ?? 'main character'),
    initialState: typeof rawProtagonist.initialState === 'string' ? rawProtagonist.initialState : 'baseline',
    finalState: typeof rawProtagonist.finalState === 'string' ? rawProtagonist.finalState : 'transformed',
    visualIdentifiers: Array.isArray(rawProtagonist.visualIdentifiers)
      ? (rawProtagonist.visualIdentifiers as unknown[]).filter(v => typeof v === 'string') as string[]
      : (input.character?.visualPrompt ? [input.character.visualPrompt] : []),
  }

  const rawArc = (result.storyArc && typeof result.storyArc === 'object')
    ? result.storyArc as Record<string, unknown>
    : {}
  const storyArc = {
    template: normalizeArcTemplate(rawArc.template),
    premise: typeof rawArc.premise === 'string' ? rawArc.premise : '',
    conflict: typeof rawArc.conflict === 'string' ? rawArc.conflict : '',
    turningPoint: typeof rawArc.turningPoint === 'string' ? rawArc.turningPoint : '',
    resolution: typeof rawArc.resolution === 'string' ? rawArc.resolution : '',
    emotionalJourney: Array.isArray(rawArc.emotionalJourney)
      ? (rawArc.emotionalJourney as unknown[]).filter(s => typeof s === 'string') as string[]
      : [],
  }

  const rawBible = (result.continuityBible && typeof result.continuityBible === 'object')
    ? result.continuityBible as Record<string, unknown>
    : {}
  const rawVisualCode = (rawBible.visualCode && typeof rawBible.visualCode === 'object')
    ? rawBible.visualCode as Record<string, unknown>
    : {}
  const continuityBible: ContinuityBible = {
    protagonist,
    visualCode: {
      colorPalette: Array.isArray(rawVisualCode.colorPalette)
        ? (rawVisualCode.colorPalette as unknown[]).filter(c => typeof c === 'string') as string[]
        : [],
      lightingConsistency: typeof rawVisualCode.lightingConsistency === 'string' ? rawVisualCode.lightingConsistency : '',
      environmentStyle: typeof rawVisualCode.environmentStyle === 'string' ? rawVisualCode.environmentStyle : '',
    },
    antiLoopRules: Array.isArray(rawBible.antiLoopRules)
      ? (rawBible.antiLoopRules as unknown[]).filter(s => typeof s === 'string') as string[]
      : [],
    sceneTransitions: Array.isArray(rawBible.sceneTransitions)
      ? (rawBible.sceneTransitions as unknown[]).filter(s => typeof s === 'string') as string[]
      : [],
    forbiddenElements: Array.isArray(rawBible.forbiddenElements)
      ? (rawBible.forbiddenElements as unknown[]).filter(s => typeof s === 'string') as string[]
      : [],
  }

  const rawVss = (result.visualStyleStructured && typeof result.visualStyleStructured === 'object')
    ? result.visualStyleStructured as Record<string, unknown>
    : null
  const visualStyleStructured: VisualStyleStructured | null = rawVss && Array.isArray(rawVss.colors)
    ? {
        colors: (rawVss.colors as unknown[]).filter(c => typeof c === 'string') as string[],
        atmosphere: typeof rawVss.atmosphere === 'string' ? rawVss.atmosphere : '',
        character: typeof rawVss.character === 'string' ? rawVss.character : '',
        stylePrompt: typeof rawVss.stylePrompt === 'string' ? rawVss.stylePrompt : '',
        lighting: typeof rawVss.lighting === 'string' ? rawVss.lighting : undefined,
        cameraWork: typeof rawVss.cameraWork === 'string' ? rawVss.cameraWork : undefined,
        effects: Array.isArray(rawVss.effects) ? (rawVss.effects as unknown[]).filter(e => typeof e === 'string') as string[] : undefined,
      }
    : null

  return {
    title: result.title as string,
    hook: result.hook as string,
    body: result.body as string,
    cta: result.cta as string,
    fullScript: result.fullScript as string,
    visualStyleText: typeof result.visualStyleText === 'string'
      ? result.visualStyleText
      : input.compiledPrompt,
    visualStyleStructured,
    toneProfile: typeof result.toneProfile === 'string' ? result.toneProfile : 'нейтральный',
    storyArc,
    protagonist,
    scenes,
    appIntegrationStrategy: typeof result.appIntegrationStrategy === 'string' ? result.appIntegrationStrategy : '',
    continuityBible,
  }
}
