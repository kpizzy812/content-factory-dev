/**
 * Scenario Marketing Validator — финальная проверка сценария ПЕРЕД сохранением в БД.
 *
 * Цель: ни одно видео не должно дойти до Kling-генерации без явного присутствия
 * имени приложения в субтитрах/озвучке/CTA. Сценарий, где AI забыл про бренд —
 * бесполезен как marketing.
 *
 * Алгоритм:
 *   1. Проверить storyPlan на marketing checks (CTA с app.name, mid-scene mention,
 *      final scene CTA-shape, ссылка на скриншот, длина субтитров)
 *   2. Если фейл — Haiku-вызов автофиксит финальную и одну центральную сцены
 *   3. Повторно проверить — если всё ещё фейл, возвращаем passed: false с issues
 *
 * Используется в scenario-pipeline.ts ПЕРЕД assemble StoryPlan.
 *
 * Этот файл — единственный канонический источник marketing-checks. Не дублируй
 * логику в других местах — лучше вызови validateScenarioMarketing.
 */

import type { StoryPlan, SceneCard } from '~~/shared/types/story'

const CTA_VERBS = [
  'try', 'download', 'get', 'use', 'open', 'install', 'tap', 'start', 'join', 'discover',
  'попробуй', 'попробуйте', 'скачай', 'скачайте', 'открой', 'откройте', 'получи', 'получите',
  'используй', 'используйте', 'установи', 'установите', 'начни', 'начните', 'напиши', 'напишите',
]

function contentLanguageLabel(raw: string | null | undefined): string {
  const value = raw?.trim().toLowerCase()
  if (value === 'ru' || value?.startsWith('ru-') || value === 'russian' || value === 'русский') return 'Russian'
  if (!value || value === 'en' || value.startsWith('en-') || value === 'english') return 'English'
  return raw!.trim()
}

/**
 * Облегчённая проекция App, нужная валидатору.
 */
export interface MarketingValidatorApp {
  name: string
  /** Язык viewer-facing текста, например ru/en. */
  language?: string | null
  /** Если у приложения есть analyzed reference images — валидатор требует, чтобы хотя бы одна сцена использовала appScreenRef. */
  hasAnalyzedReferenceImages?: boolean
  /** Опционально: corePain для построения CTA в repair'е. */
  corePain?: string | null
  /** Опционально: scenario integration strategy для контекста repair'а. */
  appIntegrationStrategy?: string | null
}

export interface MarketingValidatorIssue {
  /** Машиночитаемый код проблемы. */
  code:
    | 'cta_missing_app_name'
    | 'no_mid_scene_app_mention'
    | 'final_scene_not_cta_shaped'
    | 'no_app_screen_used'
    | 'subtitle_too_short'
  /** Чел.чит. описание. */
  message: string
  /** Order сцены, к которой относится. */
  sceneOrder?: number
}

export interface MarketingValidatorResult {
  passed: boolean
  issues: MarketingValidatorIssue[]
  /** Если был applied auto-fix — список изменённых сцен с before/after. */
  fixesApplied?: Array<{
    sceneOrder: number
    field: 'subtitleCopy' | 'voiceoverLine' | 'spokenLine'
    before: string | null
    after: string | null
  }>
}

// ─── Pure checks (без AI) ──────────────────────────────────────

function lowerIncludes(haystack: string | null | undefined, needle: string): boolean {
  if (typeof haystack !== 'string') return false
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

function sceneMentionsApp(scene: SceneCard, appName: string): boolean {
  return (
    lowerIncludes(scene.subtitleCopy, appName)
    || lowerIncludes(scene.voiceoverLine, appName)
    || lowerIncludes(scene.spokenLine, appName)
  )
}

function finalSceneIsCta(scene: SceneCard, appName: string): boolean {
  if (!sceneMentionsApp(scene, appName)) return false
  const text = [scene.subtitleCopy, scene.voiceoverLine, scene.spokenLine]
    .filter((t): t is string => typeof t === 'string')
    .join(' ')
    .toLocaleLowerCase()
  return CTA_VERBS.some(verb => text.includes(verb))
}

function ctaTextHasApp(cta: string | null | undefined, appName: string): boolean {
  return lowerIncludes(cta, appName)
}

/**
 * Прогон всех проверок без AI. Возвращает массив issues (пустой если всё ок).
 */
function runChecks(
  storyPlan: StoryPlan,
  cta: string | null | undefined,
  app: MarketingValidatorApp,
): MarketingValidatorIssue[] {
  const issues: MarketingValidatorIssue[] = []
  const scenes = storyPlan.scenes ?? []
  const appName = app.name.trim()

  // 1. CTA-поле сценария содержит app.name
  if (!ctaTextHasApp(cta, appName)) {
    issues.push({
      code: 'cta_missing_app_name',
      message: `Поле scenario.cta не содержит "${appName}". Без этого CTA-блок не доносит бренд.`,
    })
  }

  // 2. Хотя бы одна сцена упоминает app.name в subtitleCopy/voiceoverLine/spokenLine
  const mentioned = scenes.some(s => sceneMentionsApp(s, appName))
  if (!mentioned) {
    issues.push({
      code: 'no_mid_scene_app_mention',
      message: `Ни одна сцена не упоминает "${appName}" в subtitleCopy/voiceoverLine/spokenLine. Зритель не узнает имя приложения.`,
    })
  }

  // 3. Финальная сцена — CTA с app.name + CTA verb
  const finalScene = scenes[scenes.length - 1]
  if (finalScene && !finalSceneIsCta(finalScene, appName)) {
    issues.push({
      code: 'final_scene_not_cta_shaped',
      message: `Финальная сцена (order=${finalScene.order}) не CTA-формы — нужно "${appName}" + один из глаголов: ${CTA_VERBS.join(', ')}.`,
      sceneOrder: finalScene.order,
    })
  }

  // 4. Если у приложения есть analyzed reference images — хотя бы одна сцена должна использовать appScreenRef
  if (app.hasAnalyzedReferenceImages) {
    const usesScreenRef = scenes.some(s => s.appScreenRef && s.appScreenRef.imageId)
    if (!usesScreenRef) {
      issues.push({
        code: 'no_app_screen_used',
        message: `Приложение имеет проанализированные reference-скриншоты, но ни одна сцена не использует appScreenRef. CTA-сцена выиграет от показа интерфейса.`,
      })
    }
  }

  // 5. Слишком короткие субтитры (warning-level — не блокирует)
  for (const s of scenes) {
    if (typeof s.subtitleCopy === 'string' && s.subtitleCopy.trim().length > 0 && s.subtitleCopy.length < 12) {
      issues.push({
        code: 'subtitle_too_short',
        message: `Сцена ${s.order}: subtitleCopy="${s.subtitleCopy}" короче 12 символов — вероятно, мало контекста.`,
        sceneOrder: s.order,
      })
    }
  }

  return issues
}

// ─── Auto-fix через Haiku ──────────────────────────────────────

interface RepairTarget {
  scene: SceneCard
  reason: 'final_cta' | 'mid_mention'
}

interface HaikuRepairResponse {
  scenes: Array<{
    order: number
    subtitleCopy?: string
    voiceoverLine?: string | null
    spokenLine?: string | null
  }>
}

async function repairWithHaiku(
  targets: RepairTarget[],
  storyPlan: StoryPlan,
  app: MarketingValidatorApp,
): Promise<HaikuRepairResponse> {
  const contentLanguage = contentLanguageLabel(app.language)
  const sceneSummaries = targets.map(t => ({
    order: t.scene.order,
    role: t.reason,
    action: t.scene.action,
    emotionalState: t.scene.emotionalState,
    subtitleCopy: t.scene.subtitleCopy,
    voiceoverLine: t.scene.voiceoverLine,
    spokenLine: t.scene.spokenLine,
  }))

  const repairPrompt = `App name: ${app.name}.
Story arc resolution: ${storyPlan.storyArc?.resolution ?? '(no resolution)'}.
${app.corePain ? `Core pain solved: ${app.corePain}.\n` : ''}${app.appIntegrationStrategy ? `App integration strategy: ${app.appIntegrationStrategy}.\n` : ''}
Below are scenes that FAILED marketing checks. Rewrite ONLY their subtitleCopy, voiceoverLine and (if not null) spokenLine so:

For each scene with role="final_cta":
  - subtitleCopy AND voiceoverLine MUST contain "${app.name}" + a CTA verb (try, download, get, open, use, install, tap, start, join, discover)
  - use natural CTA verbs in ${contentLanguage}

For each scene with role="mid_mention":
  - subtitleCopy OR voiceoverLine OR spokenLine MUST naturally include "${app.name}" once
  - keep the emotional moment intact, just weave the name into the existing line

Constraints:
- ${contentLanguage} only. No emojis.
- subtitleCopy ≤ 60 chars (max 2 lines).
- voiceoverLine ≤ 240 chars.
- spokenLine ≤ 80 chars (or null if originally null and no person on-camera).
- Keep the same emotional state.

Scenes:
${JSON.stringify(sceneSummaries, null, 2)}

Reply ONLY with JSON: {"scenes": [{"order": <number>, "subtitleCopy": <string>, "voiceoverLine": <string|null>, "spokenLine": <string|null>}, ...]}.`

  return callAnthropicAgent<HaikuRepairResponse>({
    systemPrompt: 'You repair video subtitle/voiceover/spoken lines for app marketing integration. Reply STRICTLY in JSON.',
    userPrompt: repairPrompt,
    maxTokens: 1024,
    tier: 'haiku',
    validate: (data) => {
      const d = data as { scenes?: unknown }
      if (!Array.isArray(d.scenes)) throw new Error('repair: scenes is not array')
      return d as HaikuRepairResponse
    },
  })
}

function clamp(s: string | null | undefined, max: number): string | null {
  if (typeof s !== 'string') return null
  const t = s.trim()
  if (!t) return null
  return t.length > max ? t.slice(0, max) : t
}

function applyRepair(
  scenes: SceneCard[],
  repair: HaikuRepairResponse,
): MarketingValidatorResult['fixesApplied'] {
  const byOrder = new Map<number, HaikuRepairResponse['scenes'][number]>()
  for (const r of repair.scenes) {
    if (typeof r.order === 'number') byOrder.set(r.order, r)
  }
  const fixesApplied: MarketingValidatorResult['fixesApplied'] = []
  for (const scene of scenes) {
    const fix = byOrder.get(scene.order)
    if (!fix) continue
    if (typeof fix.subtitleCopy === 'string' && fix.subtitleCopy.trim()) {
      const after = clamp(fix.subtitleCopy, 200)
      if (after && after !== scene.subtitleCopy) {
        fixesApplied!.push({ sceneOrder: scene.order, field: 'subtitleCopy', before: scene.subtitleCopy, after })
        scene.subtitleCopy = after
      }
    }
    if (typeof fix.voiceoverLine === 'string' && fix.voiceoverLine.trim()) {
      const after = clamp(fix.voiceoverLine, 240)
      if (after && after !== scene.voiceoverLine) {
        fixesApplied!.push({ sceneOrder: scene.order, field: 'voiceoverLine', before: scene.voiceoverLine, after })
        scene.voiceoverLine = after
      }
    }
    if (typeof fix.spokenLine === 'string' && fix.spokenLine.trim()) {
      const after = clamp(fix.spokenLine, 120)
      if (after && after !== scene.spokenLine) {
        fixesApplied!.push({ sceneOrder: scene.order, field: 'spokenLine', before: scene.spokenLine, after })
        scene.spokenLine = after
      }
    }
  }
  return fixesApplied && fixesApplied.length > 0 ? fixesApplied : undefined
}

// ─── Public API ────────────────────────────────────────────────

export interface ValidateScenarioMarketingInput {
  storyPlan: StoryPlan
  /** scenarioVariant.cta — финальный текст CTA из скрипт-билдера. Проверяется отдельно от scene-level CTA. */
  cta?: string | null
  app: MarketingValidatorApp
  /** Если true — попытаться repair через Haiku при фейле. По умолчанию true. */
  autoFix?: boolean
}

/**
 * Прогоняет marketing checks. Если autoFix=true — модифицирует storyPlan.scenes
 * (in-place) через Haiku при фейле и повторно проверяет.
 *
 * Возвращает passed: false если после repair всё ещё есть blocking issues
 * (cta_missing_app_name, no_mid_scene_app_mention, final_scene_not_cta_shaped).
 * subtitle_too_short и no_app_screen_used — warning-level, не блокируют.
 */
export async function validateScenarioMarketing(
  input: ValidateScenarioMarketingInput,
): Promise<MarketingValidatorResult> {
  const { storyPlan, cta, app, autoFix = true } = input

  // Skip полностью если у приложения нет имени — не для чего проверять.
  if (!app.name || !app.name.trim()) {
    return { passed: true, issues: [] }
  }

  const initialIssues = runChecks(storyPlan, cta, app)
  const blockingCodes: MarketingValidatorIssue['code'][] = [
    'cta_missing_app_name',
    'no_mid_scene_app_mention',
    'final_scene_not_cta_shaped',
  ]
  const initialBlocking = initialIssues.filter(i => blockingCodes.includes(i.code))

  if (initialBlocking.length === 0) {
    return { passed: true, issues: initialIssues }
  }

  if (!autoFix) {
    return { passed: false, issues: initialIssues }
  }

  // Auto-fix: финальная сцена для final_scene_not_cta_shaped, центральная — для no_mid_scene_app_mention
  const scenes = storyPlan.scenes ?? []
  const finalScene = scenes[scenes.length - 1]
  const middleIdx = Math.max(0, Math.floor(scenes.length / 2))
  const middleScene = scenes[middleIdx]

  const targets: RepairTarget[] = []
  if (finalScene) targets.push({ scene: finalScene, reason: 'final_cta' })
  const needsMid = initialIssues.some(i => i.code === 'no_mid_scene_app_mention')
  if (needsMid && middleScene && middleScene !== finalScene) {
    targets.push({ scene: middleScene, reason: 'mid_mention' })
  }

  let fixesApplied: MarketingValidatorResult['fixesApplied']
  try {
    const repair = await repairWithHaiku(targets, storyPlan, app)
    fixesApplied = applyRepair(scenes, repair)
  }
  catch (e) {
    // Haiku отвалился — возвращаем initial issues
    return {
      passed: false,
      issues: initialIssues.concat([{
        code: 'cta_missing_app_name',
        message: `Auto-fix через Haiku упал: ${e instanceof Error ? e.message : 'unknown'}. Сценарий не прошёл marketing-проверку.`,
      }]),
    }
  }

  // Re-check after repair
  const finalIssues = runChecks(storyPlan, cta, app)
  const finalBlocking = finalIssues.filter(i => blockingCodes.includes(i.code))

  return {
    passed: finalBlocking.length === 0,
    issues: finalIssues,
    fixesApplied,
  }
}
