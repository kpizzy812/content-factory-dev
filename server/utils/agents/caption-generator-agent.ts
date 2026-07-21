/**
 * Caption Generator Agent — генерирует viral title + hashtags для tiktok/youtube/instagram.
 *
 * Архитектура:
 *   1. Sonnet с подготовленным контекстом (storyPlan, app, frame analyses) → raw captions per platform
 *   2. validateCaption() для каждой платформы → fitsLimits
 *   3. Если хоть одна платформа не уложилась в лимиты → Haiku repair-pass только для них
 *   4. Финальная enrichWithLimits → CaptionGeneratorOutput
 *
 * Контракт mock-режима:
 *   - agentName='caption-generator' → server/__fixtures__/agents/caption-generator-happy.json
 *   - Mock возвращает RawAgentOutput (без limits/fitsLimits) → enrichWithLimits подставит
 *
 * Все AI-prompt'ы на английском (модели лучше обучены), но system-message пишет
 * по-русски для consistency с остальными агентами проекта.
 */

import type {
  CaptionGeneratorOutput,
  PlatformCaption,
  SocialPlatform,
} from '~~/shared/types/caption'
import { PLATFORM_LIMITS, validateCaption } from '../caption-limits'

export interface CaptionAgentInput {
  videoId: number
  scenarioId?: number
  platforms: SocialPlatform[]

  context: {
    // From Scenario (если есть):
    storyPlan?: Record<string, unknown> | null
    hook?: string | null
    body?: string | null
    cta?: string | null
    fullScript?: string | null

    // From App:
    appName?: string | null
    appBrandTone?: string | null
    appCorePain?: string | null
    appTransformationPromise?: string | null
    appForbiddenClaims?: string[] | null

    // From Video:
    targetPlatform?: SocialPlatform | null
    videoDurationSec?: number | null

    // Опционально — для creative-only сценария (без Scenario):
    frameAnalyses?: Array<{
      frameIndex: number
      description: string
      mood: string
      isUI: boolean
    }> | null

    // From FavoritePrompt analysis:
    successfulCaptionPatterns?: Array<{
      camera?: string
      mood?: string
      hooks?: string[]
    }> | null

    // Заголовок, который маркетолог уже придумал в сценарии (ScenarioVariant.title).
    // AI учитывает тон, смысл и ключевые слова, но не копирует дословно.
    marketingTitle?: string | null

    // Желаемый язык output captions. 'auto' = AI определяет сам по контексту.
    language?: 'auto' | 'en' | 'ru' | 'es' | null
  }

  /** Опциональные подсказки оператора (тон, brand voice) */
  styleHints?: string

  /** Для UI: hint каким стилем сгенерить. По умолчанию 'viral'. */
  styleVariant?: 'viral' | 'informative' | 'storytelling'
}

interface RawPlatformCaption {
  title: string
  description?: string | null
  hashtags: string[]
}

interface RawAgentOutput {
  captions: {
    tiktok?: RawPlatformCaption
    youtube?: RawPlatformCaption
    instagram?: RawPlatformCaption
  }
}

const MODEL_VERSION = 'caption-generator-v1'

/**
 * Валидатор raw AI output. Допускает только знакомые ключи и базовые типы.
 */
function validateRawOutput(data: unknown): RawAgentOutput {
  if (!data || typeof data !== 'object') {
    throw new Error('Caption generator: ответ не является объектом')
  }
  const d = data as Record<string, unknown>
  const captionsRaw = d.captions
  if (!captionsRaw || typeof captionsRaw !== 'object') {
    throw new Error('Caption generator: поле captions отсутствует или невалидно')
  }
  const captions: RawAgentOutput['captions'] = {}
  for (const platform of ['tiktok', 'youtube', 'instagram'] as const) {
    const p = (captionsRaw as Record<string, unknown>)[platform]
    if (!p) continue
    if (typeof p !== 'object') {
      throw new Error(`Caption generator: ${platform} не является объектом`)
    }
    const pp = p as Record<string, unknown>
    if (typeof pp.title !== 'string') {
      throw new Error(`Caption generator: ${platform}.title должен быть строкой`)
    }
    if (!Array.isArray(pp.hashtags)) {
      throw new Error(`Caption generator: ${platform}.hashtags должен быть массивом`)
    }
    const hashtags = pp.hashtags
      .filter((h): h is string => typeof h === 'string' && h.trim().length > 0)
      .map((h) => h.replace(/^#+/, '').trim())
      .filter((h) => h.length > 0)
    captions[platform] = {
      title: pp.title.trim(),
      description:
        typeof pp.description === 'string' && pp.description.trim()
          ? pp.description.trim()
          : null,
      hashtags,
    }
  }
  return { captions }
}

/**
 * Превращает RawPlatformCaption в финальный PlatformCaption с лимитами.
 */
function enrichWithLimits(
  platform: SocialPlatform,
  raw: RawPlatformCaption,
): PlatformCaption {
  const limits = PLATFORM_LIMITS[platform]
  const candidate: PlatformCaption = {
    platform,
    title: raw.title,
    description: raw.description ?? undefined,
    hashtags: raw.hashtags,
    limits,
    fitsLimits: false,
  }
  const v = validateCaption(candidate)
  candidate.fitsLimits = v.valid
  if (!v.valid) candidate.validationErrors = v.errors
  return candidate
}

/**
 * Строит system prompt — статическая часть (не зависит от input).
 */
function buildSystemPrompt(): string {
  return `You are a viral content expert for TikTok, YouTube Shorts, and Instagram Reels.
Your job: generate VIRAL title + hashtags for a short-form video so it stops the scroll.

RULES:

1. Title is the HOOK. Viewers decide in the first 3 seconds.
   Use one of: number, contradiction, personal stake, strong emotion, question.

2. Hashtags must mix:
   - 1–2 broad (e.g. #fyp #viral)
   - 2–3 niche-specific (topic of the video)
   - 1 brand or campaign tag (when app name is provided)

3. PLATFORM LIMITS (STRICT — do not exceed):
   - TikTok:    title ≤ 150 chars; EXACTLY 5 hashtags; total hashtag string with "# " prefixes and spaces ≤ 100 chars.
   - YouTube:   title ≤ 100 chars; up to 15 hashtags; total hashtag length ≤ 500 chars.
   - Instagram: title ≤ 125 chars; up to 30 hashtags; total hashtag length ≤ 100 chars (preview-friendly).

4. If an app name is given, it MUST appear in:
   - TikTok: hashtags (as #appName camelCase or lowercased)
   - YouTube: title or description
   - Instagram: caption or hashtags

5. forbiddenClaims must NEVER appear in any output (even if it would be viral).

6. If only frameAnalyses are given (no scenario), extract meaning from the frames:
   - what is happening, emotional tone, is it a real UI or mock UI

7. Output STRICT JSON. No markdown. No comments. Hashtags WITHOUT the # prefix.

OUTPUT SHAPE:
{
  "captions": {
    "tiktok"?:    { "title": "...", "description"?: "...", "hashtags": ["fyp", ...] },
    "youtube"?:   { "title": "...", "description"?: "...", "hashtags": [...] },
    "instagram"?: { "title": "...", "description"?: "...", "hashtags": [...] }
  }
}

Only include platforms requested by the user. Keep it tight, punchy, and viral.`
}

/**
 * Строит user prompt с context-секциями.
 */
function buildUserPrompt(input: CaptionAgentInput): string {
  const ctx = input.context
  const lines: string[] = []
  lines.push(`Generate captions for platforms: ${input.platforms.join(', ')}.`)
  lines.push(`Style preference: ${input.styleVariant ?? 'viral'}.`)
  if (input.styleHints) lines.push(`Operator hints: ${input.styleHints}`)

  if (ctx.appName) {
    lines.push('')
    lines.push('APP CONTEXT:')
    lines.push(`- name: ${ctx.appName}`)
    if (ctx.appBrandTone) lines.push(`- brandTone: ${ctx.appBrandTone}`)
    if (ctx.appCorePain) lines.push(`- corePain: ${ctx.appCorePain}`)
    if (ctx.appTransformationPromise)
      lines.push(`- transformationPromise: ${ctx.appTransformationPromise}`)
    if (ctx.appForbiddenClaims?.length)
      lines.push(`- forbiddenClaims: ${ctx.appForbiddenClaims.join('; ')}`)
  }

  if (ctx.marketingTitle && ctx.marketingTitle.trim().length > 0) {
    lines.push('')
    lines.push('MARKETING TITLE (operator-chosen anchor):')
    lines.push(`"${ctx.marketingTitle.trim().slice(0, 200)}"`)
    lines.push(
      'This is the title the marketer already wrote for this video. Keep the meaning, tone, '
      + 'and key words consistent across all platforms. Do NOT copy verbatim — generate '
      + 'variations that reinforce the same message.',
    )
  }

  if (ctx.hook || ctx.body || ctx.cta) {
    lines.push('')
    lines.push('SCENARIO:')
    if (ctx.hook) lines.push(`- hook: ${ctx.hook}`)
    if (ctx.body) lines.push(`- body: ${ctx.body}`)
    if (ctx.cta) lines.push(`- cta: ${ctx.cta}`)
  } else if (ctx.fullScript) {
    lines.push('')
    lines.push('SCENARIO (full script):')
    lines.push(ctx.fullScript.slice(0, 1500))
  }

  if (ctx.targetPlatform) {
    lines.push('')
    lines.push(`Primary target platform: ${ctx.targetPlatform}.`)
  }
  if (typeof ctx.videoDurationSec === 'number') {
    lines.push(`Video duration: ${ctx.videoDurationSec}s.`)
  }

  if (ctx.frameAnalyses?.length) {
    lines.push('')
    lines.push('FRAME ANALYSES (creative-only context):')
    for (const f of ctx.frameAnalyses.slice(0, 6)) {
      lines.push(
        `- frame ${f.frameIndex} (mood: ${f.mood}, ui: ${f.isUI}): ${f.description.slice(0, 200)}`,
      )
    }
  }

  if (ctx.successfulCaptionPatterns?.length) {
    lines.push('')
    lines.push('SUCCESSFUL PATTERNS (for inspiration only, do not copy):')
    for (const p of ctx.successfulCaptionPatterns.slice(0, 5)) {
      lines.push(
        `- camera: ${p.camera ?? '?'}, mood: ${p.mood ?? '?'}, hooks: ${(p.hooks ?? []).slice(0, 3).join(' | ')}`,
      )
    }
  }

  if (ctx.language && ctx.language !== 'auto') {
    const LANG_LABELS: Record<'en' | 'ru' | 'es', string> = {
      en: 'English',
      ru: 'Russian',
      es: 'Spanish',
    }
    const label = LANG_LABELS[ctx.language] ?? null
    if (label) {
      lines.push('')
      lines.push(
        `OUTPUT LANGUAGE: ${label}. Write all titles and descriptions in ${label}. `
        + 'Hashtags stay latin/lowercase per platform convention.',
      )
    }
  }

  lines.push('')
  lines.push('Reply ONLY with the JSON object described in the system prompt.')
  return lines.join('\n')
}

/**
 * Repair-pass через Haiku для платформ, которые не уложились в лимиты.
 * Получает список fail-платформ и просит сократить hashtags / title.
 */
async function repairFailingPlatforms(
  failing: PlatformCaption[],
  appName: string | null | undefined,
): Promise<Map<SocialPlatform, RawPlatformCaption>> {
  if (failing.length === 0) return new Map()

  const repairBlocks = failing
    .map((c) => {
      const limits = PLATFORM_LIMITS[c.platform]
      return `Platform: ${c.platform}
Limits: title ≤ ${limits.titleMaxChars}, hashtags total budget ${limits.hashtagsMaxBudget} chars (with # and spaces)${
        limits.hashtagsMaxCount ? `, count ≤ ${limits.hashtagsMaxCount}` : ''
      }.
Errors: ${c.validationErrors?.join('; ') ?? 'over limits'}
Current title: ${c.title}
Current description: ${c.description ?? '(none)'}
Current hashtags: ${c.hashtags.join(', ')}`
    })
    .join('\n\n---\n\n')

  const userPrompt = `Below are captions that FAILED platform limits. Rewrite them so they fit.

Rules:
- Keep the meaning and viral hook intact.
- Remove or shorten hashtags first; keep brand/app tag if present.
- Shorten title only if it exceeds the limit.
- Hashtags WITHOUT the # prefix.
${appName ? `- Keep the app tag (related to "${appName}") if present.` : ''}

Reply with the SAME JSON shape as the original output, including ONLY the platforms below:

${repairBlocks}

Reply ONLY with: {"captions": {"<platform>": {"title": "...", "description"?: "...", "hashtags": [...]}, ...}}.`

  const repaired = await callAnthropicAgent<RawAgentOutput>({
    systemPrompt:
      'You repair captions to fit strict character limits. Reply STRICTLY in JSON.',
    userPrompt,
    maxTokens: 1500,
    tier: 'haiku',
    validate: validateRawOutput,
    agentName: 'caption-generator-repair',
  })

  const map = new Map<SocialPlatform, RawPlatformCaption>()
  for (const platform of ['tiktok', 'youtube', 'instagram'] as const) {
    const r = repaired.captions[platform]
    if (r) map.set(platform, r)
  }
  return map
}

/**
 * Public API: запускает агент и возвращает CaptionGeneratorOutput.
 * Бросает на сетевых ошибках Anthropic / невалидном JSON.
 */
export async function runCaptionGenerator(
  input: CaptionAgentInput,
): Promise<CaptionGeneratorOutput> {
  if (input.platforms.length === 0) {
    throw new Error('Caption generator: список платформ пустой')
  }

  const systemPrompt = buildSystemPrompt()
  const userPrompt = buildUserPrompt(input)

  const raw = await callAnthropicAgent<RawAgentOutput>({
    systemPrompt,
    userPrompt,
    maxTokens: 3000,
    validate: validateRawOutput,
    agentName: 'caption-generator',
  })

  // Enrich + validate каждую платформу
  const enriched = new Map<SocialPlatform, PlatformCaption>()
  for (const platform of input.platforms) {
    const r = raw.captions[platform]
    if (!r) {
      // AI пропустил платформу — синтезируем placeholder, сразу fail validation
      enriched.set(platform, enrichWithLimits(platform, { title: '', hashtags: [] }))
      continue
    }
    enriched.set(platform, enrichWithLimits(platform, r))
  }

  // Repair pass для fail'ов
  const failing = [...enriched.values()].filter((c) => !c.fitsLimits && c.title.length > 0)
  if (failing.length > 0) {
    try {
      const repaired = await repairFailingPlatforms(failing, input.context.appName)
      for (const [platform, r] of repaired) {
        enriched.set(platform, enrichWithLimits(platform, r))
      }
    } catch {
      // Haiku упал — оставляем оригинал с fitsLimits=false. Оператор увидит
      // в UI и поправит вручную; либо нажмёт "Сгенерировать заново".
    }
  }

  const captions: CaptionGeneratorOutput['captions'] = {}
  for (const platform of input.platforms) {
    const c = enriched.get(platform)
    if (c) captions[platform] = c
  }

  return {
    videoId: input.videoId,
    scenarioId: input.scenarioId,
    captions,
    contextUsed: {
      storyPlan: !!input.context.storyPlan,
      appContext: !!input.context.appName,
      sceneFrames: !!(input.context.frameAnalyses && input.context.frameAnalyses.length > 0),
      favoritePrompts: !!(
        input.context.successfulCaptionPatterns
        && input.context.successfulCaptionPatterns.length > 0
      ),
    },
    modelVersion: MODEL_VERSION,
    generatedAt: new Date().toISOString(),
  }
}
