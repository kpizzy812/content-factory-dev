/**
 * Scene Planner Agent — создает детальные scene cards для каждой сцены видео.
 * Количество сцен задаётся sceneCountStrategy; каждая сцена имеет цель, декорацию, действие и эмоцию,
 * камерой, субтитрами, voiceover-линией и continuity notes.
 * Anti-loop: ни одна сцена не дублирует другую по смыслу.
 *
 * ВНИМАНИЕ: runScenePlannerAgent НЕ используется в основном пайплайне
 * (scenario-pipeline.ts строит scene-planner inline через buildScenePlannerPrompt
 * и собственный validate-блок). appliedReferences-логика и фильтрация
 * галлюцинированных favoritePromptId реализованы только inline в pipeline.
 * Если будете переключать pipeline на этот standalone-агент — синхронизируйте
 * appliedReferences (см. .claude/agent-memory/architect/favorite_prompts_finalization.md).
 */
import type { SceneCard, SubtitlePlacement, SubtitlePosition, SubtitleAlignment } from '~~/shared/types/story'
import { DEVICE_TYPES, sanitizeDevicesInScene } from '~~/shared/utils/video-prompt-helpers'
import { SCENE_BUDGET_LIMITS } from '~~/shared/utils/scene-budget'

export interface ScenePlannerInput {
  storyArc: {
    template: string
    premise: string
    conflict: string
    turningPoint: string
    resolution: string
    emotionalJourney: string[]
  }
  protagonist: {
    type: string
    description: string
    initialState: string
    finalState: string
    visualIdentifiers: string[]
  }
  platform: string
  appName: string
  appIntegrationStrategy: string
  pacing?: 'slow' | 'moderate' | 'fast'
  sceneDiversity?: 'high' | 'medium' | 'low'
  /** Budget-ориентированный лимит сцен — минимум денег / сбалансированно / максимум проработки */
  sceneCountStrategy?: 'auto' | 'minimal' | 'detailed' | 'cinematic' | 'longform'
}

/**
 * Budget-таблица и helper'ы вынесены в `shared/utils/scene-budget.ts` — это
 * pure-логика, нужная и server'у (валидация), и UI (estimate, синхронизация
 * video-блока). Импортируй оттуда напрямую: `import { SCENE_BUDGET_LIMITS, getExpectedScenePlan } from '~~/shared/utils/scene-budget'`.
 */

const SYSTEM_PROMPT = `Ты — профессиональный сцен-планировщик для коротких вирусных видео (TikTok, Reels, Shorts). Твоя задача — создать детальные scene cards, где каждая сцена является строительным блоком истории.

## Принципы

1. **Каждая сцена двигает сюжет** — нет декоративных или повторяющихся сцен. У каждой сцены своя уникальная драматургическая цель.
2. **Anti-loop правило (КРИТИЧНО)** — ни одна сцена не должна дублировать другую. Различия ОБЯЗАНЫ быть в КАЖДОМ из этих измерений ОДНОВРЕМЕННО:
   - **setting** — конкретно разные локации (не "офис" и "офис, другой ракурс", а "кухня дома" → "автобусная остановка" → "офис у окна")
   - **action** — конкретно разные действия (не "сидит" и "сидит и пьёт", а "наливает кофе" → "бежит по лестнице" → "печатает на ноутбуке")
   - **cameraAngle** — чередуй: close-up → wide shot → POV → over-the-shoulder
   - **emotionalState** — эмоции прогрессируют по дуге, не повторяются
   - **visualPromptGuidance** — должен описывать ВИЗУАЛЬНО различимый кадр, не парафраз предыдущего
3. **Continuity** — каждая сцена содержит заметки для связности с предыдущей и следующей сценами.
4. **Субтитры** — текст субтитров не повторяет voiceover дословно, а дополняет его. Placement учитывает визуальный контент сцены. **БЕЗ ЭМОДЗИ И СПЕЦСИМВОЛОВ** — только буквы, цифры, базовая пунктуация (.,!?-).
5. **App integration (MANDATORY — НАРУШЕНИЕ ДЕЛАЕТ СЦЕНАРИЙ БЕСПОЛЕЗНЫМ)** — это контент-маркетинг для конкретного приложения. Hook/body/CTA сценария уже явно ссылаются на приложение. ТЫ ОБЯЗАН органично пропечатать его в spokenLine/subtitleCopy/voiceoverLine как минимум двух сцен (см. подробные правила в user prompt).

   Даже самый красивый storytelling провалится, если зритель не узнал название приложения. Это не реклама — это chord, вплетённый в историю.
6. **Количество и длительность сцен** — строго по БЮДЖЕТНОМУ ОГРАНИЧЕНИЮ из запроса.

## Формат ответа
Ответь СТРОГО JSON-массивом объектов SceneCard. Без обертки, без комментариев — только массив.`

function buildPrompt(input: ScenePlannerInput): string {
  const pacing = input.pacing || 'moderate'
  const diversity = input.sceneDiversity || 'high'
  const strategy = input.sceneCountStrategy || 'auto'
  const budget = SCENE_BUDGET_LIMITS[strategy] ?? SCENE_BUDGET_LIMITS.auto!

  const pacingGuide: Record<string, string> = {
    slow: '4-6 секунд на сцену, плавные переходы, акцент на атмосфере',
    moderate: '3-5 секунд на сцену, сбалансированный ритм',
    fast: '2-4 секунды на сцену, динамичные переходы, высокая энергия',
  }

  const diversityGuide: Record<string, string> = {
    high: 'Максимальное разнообразие: каждая сцена в уникальной локации с уникальным действием и ракурсом',
    medium: 'Умеренное разнообразие: допустимы связанные локации, но действия и эмоции не повторяются',
    low: 'Минимальное разнообразие: фокус на одной локации, разнообразие через действия и эмоции',
  }

  return `Создай детальные scene cards для короткого видео.

## Story Arc
- Шаблон: ${input.storyArc.template}
- Завязка: ${input.storyArc.premise}
- Конфликт: ${input.storyArc.conflict}
- Переломный момент: ${input.storyArc.turningPoint}
- Развязка: ${input.storyArc.resolution}
- Эмоциональное путешествие: ${input.storyArc.emotionalJourney.join(' -> ')}

## Герой
- Тип: ${input.protagonist.type}
- Описание: ${input.protagonist.description}
- Начальное состояние: ${input.protagonist.initialState}
- Финальное состояние: ${input.protagonist.finalState}
- Визуальные маркеры: ${input.protagonist.visualIdentifiers.join(', ')}

## Платформа: ${input.platform}
## Приложение: ${input.appName}
## Стратегия интеграции приложения: ${input.appIntegrationStrategy}

## Настройки
- Темп: ${pacing} — ${pacingGuide[pacing]}
- Разнообразие сцен: ${diversity} — ${diversityGuide[diversity]}

## БЮДЖЕТНОЕ ОГРАНИЧЕНИЕ (sceneCountStrategy: ${strategy}) — ОБЯЗАТЕЛЬНО
Каждая сцена = отдельный вызов AI видео-генерации = реальные деньги. Стратегия "${strategy}" задаёт жёсткие рамки:
- Количество сцен: ОТ ${budget.minScenes} ДО ${budget.maxScenes} (НЕ больше, НЕ меньше)
- Длительность КАЖДОЙ сцены: ОТ ${budget.minSec} ДО ${budget.maxSec} секунд
- Ожидаемая общая длина: ${budget.totalSec}
Поле duration каждой сцены ОБЯЗАНО попадать в диапазон ${budget.minSec}-${budget.maxSec}с (формат "Ns"). Если строишь больше сцен — бюджет превышен, это ошибка. Если строишь меньше — недостаточно для сюжета, но это всё равно лучше чем превышение.

## Требования к каждой SceneCard
Каждый объект массива:
- order: number — порядковый номер сцены (начиная с 1)
- purpose: string — драматургическая цель сцены (зачем она нужна)
- setting: string — место действия (конкретное, визуализируемое)
- action: string — что происходит в сцене (конкретное действие)
- whatChanges: string — что меняется в этой сцене по сравнению с предыдущей
- emotionalState: string — эмоция героя/зрителя
- appIntegrationBeat: string | null — как приложение появляется (null если не появляется)
- visualPromptGuidance: string — детальный промпт для AI-генерации визуала (для FLUX/Runway)
- subtitleCopy: string — текст субтитров (фон, может быть про приложение)
- subtitlePlacement: { position: "top"|"center"|"bottom", alignment: "left"|"center"|"right", avoidZones: string[] }
- voiceoverLine: string | null — текст off-screen narrator TTS (null если нет)
- spokenLine: string | null — что персонаж ПРОИЗНОСИТ в кадре (для Kling lip-sync). null если нет персонажа-человека или сцена без диалога
- continuityNotes: string — связь с предыдущей/следующей сценой
- duration: string — длительность ("3s", "4s", "5s")
- cameraAngle: string — ракурс камеры (POV, close-up, wide shot, etc.)
- props: string[] — реквизит в кадре
- devicesInScene: string[] | undefined — устройства, реально присутствующие в кадре. Допустимые значения: ${DEVICE_TYPES.join(', ')}. Заполняй ТОЛЬКО когда устройство реально в кадре (герой держит телефон, экран ноутбука виден, монитор в офисе и т.п.). Если устройств нет — опускай поле или верни []. Точные строки, без перевода.

## Devices in scene (КРИТИЧНО для фикса бага "экран на задней крышке")
Если в action / setting / props упоминается ЛЮБОЕ устройство (телефон, планшет, ноутбук, монитор, телевизор, smartwatch) — ОБЯЗАТЕЛЬНО заполни devicesInScene массивом строк из допустимого списка (${DEVICE_TYPES.join(', ')}).
Примеры:
- "девушка достаёт телефон и листает Tinder" → devicesInScene: ["phone"]
- "парень за кафе работает с ноутбуком, видит уведомление" → devicesInScene: ["laptop"]
- "кадр квартиры, на стене телевизор играет ролик" → devicesInScene: ["tv"]
- "руки на клавиатуре, на мониторе открыт код" → devicesInScene: ["desktop_monitor"]
- сцена-переход с пейзажем без устройств → не заполняй или []
Это поле ТРИГГЕРИТ автоматическую инъекцию правил ориентации экрана в downstream prompt'ы — пропуск приведёт к рендеру UI на back cover телефона.

## Anti-loop checklist (ПРОВЕРЬ КАЖДУЮ СЦЕНУ)
- Все settings уникальны (или обоснованно связаны при low diversity)
- Все actions разные — глаголы не повторяются
- emotionalState прогрессирует, не повторяется
- cameraAngle чередуется (минимум 3 разных типа из close-up/wide/POV/over-the-shoulder/medium)
- visualPromptGuidance каждой сцены описывает ВИЗУАЛЬНО различимый кадр
- props хотя бы в половине сцен разные

## [APP INTEGRATION — MANDATORY RULES]
This is content marketing for a specific app: **${input.appName}**.
The scenario's hook/body/CTA explicitly references the app. YOU MUST integrate the app organically across scenes:

1. **AT LEAST ONE scene's spokenLine OR subtitleCopy OR voiceoverLine MUST contain "${input.appName}"** naturally
   — preferred placement: scene 1-2 (establishing) OR scene where revelation happens
   — NOT forced advertisement, woven into the story

2. **THE FINAL SCENE's spokenLine AND subtitleCopy AND voiceoverLine MUST be a CTA mentioning "${input.appName}"**
   — direct: "Try ${input.appName}", "Download ${input.appName}", "Get ${input.appName}", "Open ${input.appName}"
   — connect to transformation: "Stop ${'<corePain>'} — try ${input.appName}"

3. If the scenario has a moment of "transformation through touch/click/discovery", THAT scene is the perfect natural integration point — use it. Weave the app name into the moment of revelation.

VIOLATION OF THIS RULE = SCENARIO IS USELESS AS MARKETING. Even the most beautiful storytelling fails if the audience doesn't learn the app name.

EXAMPLES OF CORRECT INTEGRATION:
❌ Scene 6: "Now he knew his gift: to turn dreams into melodies"
   (closes story but no app — useless for marketing)
✅ Scene 6: "Try ${input.appName} — turn your dreams into songs"

❌ Scene 5: "With just one touch... music came alive"
✅ Scene 5: "With ${input.appName}, one touch makes music come alive"

В промежуточных сценах "${input.appName}" может быть заменён на "the app"/"it" если он уже представлен ранее. Но первое появление — обязательно полное имя.

## Запрещено в subtitleCopy и voiceoverLine
- Эмодзи (😀, 💪, 🚀, 🫶 и т.п.) — рендерятся квадратами в субтитрах
- Специальные символы (★, ✓, ►) — то же самое
- Только латиница (английские буквы), цифры, базовая пунктуация (.,!?-:)

## Язык вывода (ВАЖНО)
- subtitleCopy, voiceoverLine и spokenLine — ТОЛЬКО на АНГЛИЙСКОМ языке. Это финальный текст видео для англоязычной аудитории.
- purpose, setting, action, emotionalState, whatChanges, continuityNotes, visualPromptGuidance, cameraAngle, props — на АНГЛИЙСКОМ (это уходит в визуал-агенты для AI генерации картинок/видео).
- appIntegrationBeat — на АНГЛИЙСКОМ.
- Даже если описание тренда, имя приложения, контекст — на русском, всё генеришь на английском.

## spokenLine — речь персонажа в кадре (lip-sync через Kling) — ОБЯЗАТЕЛЬНОЕ ПОЛЕ
- Если protagonist.type === "person", БОЛЬШИНСТВО сцен ОБЯЗАНЫ содержать spokenLine. Это короткая фраза (5-15 слов, ≤ 80 символов), которую персонаж РЕАЛЬНО ПРОИЗНОСИТ перед камерой для lip-sync.
- spokenLine = null ДОПУСКАЕТСЯ ТОЛЬКО если в сцене:
  • герой не в кадре (overhead shot пейзажа, close-up продукта без человека, сцена-переход без людей);
  • герой стоит спиной/сильно не в фокусе и его лица не видно;
  • это финальный логотип-кадр без актёров.
  Во всех остальных случаях, где у нас person-протагонист в кадре, ОТСУТСТВИЕ spokenLine — ОШИБКА. Минимум 60% сцен в видео с person-героем должны иметь spokenLine.
- spokenLine НЕЗАВИСИМ от subtitleCopy. Они рассказывают разные истории одновременно:
  - spokenLine: ЖИВАЯ реплика персонажа от первого лица — эмоция, рассказ из жизни, признание, восклицание. Разговорный английский. Никакого jargon.
  - subtitleCopy: маркетинговый слоган, ключ к приложению, call-to-action.
  Пример: subtitleCopy="Try Vitafy", spokenLine="I finally stopped counting calories at every meal"
- Если protagonist.type !== "person" (object/abstract) — spokenLine=null во всех сценах.
- БЕЗ эмодзи и спецсимволов.

Ответь ТОЛЬКО JSON-массивом SceneCard[]. Без обертки, без markdown.`
}

const VALID_POSITIONS: SubtitlePosition[] = ['top', 'center', 'bottom']
const VALID_ALIGNMENTS: SubtitleAlignment[] = ['left', 'center', 'right']

function validateSubtitlePlacement(raw: unknown, sceneIndex: number): SubtitlePlacement {
  const p = raw as Record<string, unknown>

  if (!p || typeof p !== 'object') {
    throw new Error(`Сцена ${sceneIndex + 1}: subtitlePlacement должен быть объектом`)
  }

  if (!VALID_POSITIONS.includes(p.position as SubtitlePosition)) {
    throw new Error(`Сцена ${sceneIndex + 1}: subtitlePlacement.position должен быть одним из: ${VALID_POSITIONS.join(', ')}`)
  }

  if (!VALID_ALIGNMENTS.includes(p.alignment as SubtitleAlignment)) {
    throw new Error(`Сцена ${sceneIndex + 1}: subtitlePlacement.alignment должен быть одним из: ${VALID_ALIGNMENTS.join(', ')}`)
  }

  return {
    position: p.position as SubtitlePosition,
    alignment: p.alignment as SubtitleAlignment,
    avoidZones: Array.isArray(p.avoidZones) ? (p.avoidZones as string[]) : [],
  }
}

function validate(data: unknown, budget?: { minScenes: number; maxScenes: number; minSec: number; maxSec: number }): SceneCard[] {
  if (!Array.isArray(data)) {
    const d = data as Record<string, unknown>
    if (d.scenes && Array.isArray(d.scenes)) {
      return validate(d.scenes, budget)
    }
    throw new Error('Некорректный формат ответа ScenePlannerAgent: ожидался массив SceneCard[]')
  }

  const limitMin = budget?.minScenes ?? 3
  const limitMax = budget?.maxScenes ?? 6
  if (data.length < limitMin || data.length > limitMax) {
    throw new Error(`ScenePlannerAgent: ожидалось ${limitMin}-${limitMax} сцен (бюджет), получено ${data.length}`)
  }

  const scenes: SceneCard[] = []

  for (let i = 0; i < data.length; i++) {
    const raw = data[i] as Record<string, unknown>

    if (typeof raw.order !== 'number') {
      throw new Error(`Сцена ${i + 1}: отсутствует или некорректное поле order`)
    }
    if (typeof raw.purpose !== 'string' || !raw.purpose) {
      throw new Error(`Сцена ${i + 1}: отсутствует или пустое поле purpose`)
    }
    if (typeof raw.setting !== 'string' || !raw.setting) {
      throw new Error(`Сцена ${i + 1}: отсутствует или пустое поле setting`)
    }
    if (typeof raw.action !== 'string' || !raw.action) {
      throw new Error(`Сцена ${i + 1}: отсутствует или пустое поле action`)
    }
    if (typeof raw.subtitleCopy !== 'string' || !raw.subtitleCopy) {
      throw new Error(`Сцена ${i + 1}: отсутствует или пустое поле subtitleCopy`)
    }

    const subtitlePlacement = validateSubtitlePlacement(raw.subtitlePlacement, i)

    // Clamp длительности под бюджетные рамки. Если AI выдал "9s" при бюджете
    // minimal (3-4с) — обрезаем до 4с вместо отказа, чтобы scenario не падал.
    let duration = typeof raw.duration === 'string' ? raw.duration : '4s'
    if (budget) {
      const match = duration.match(/^(\d+(?:\.\d+)?)s?$/)
      if (match) {
        const raw = Number(match[1])
        const clamped = Math.min(budget.maxSec, Math.max(budget.minSec, raw))
        if (clamped !== raw) {
          duration = `${clamped}s`
        }
      }
    }

    // spokenLine: опциональная реплика персонажа для kling lip-sync.
    // Ограничиваем длину 120 символов — длиннее не поместится в отдельный клип.
    let spokenLine: string | null = null
    if (typeof raw.spokenLine === 'string' && raw.spokenLine.trim().length > 0) {
      const trimmed = raw.spokenLine.trim()
      spokenLine = trimmed.length > 120 ? trimmed.slice(0, 120) : trimmed
    }

    const devices = sanitizeDevicesInScene(raw.devicesInScene)

    scenes.push({
      order: raw.order as number,
      purpose: raw.purpose as string,
      setting: raw.setting as string,
      action: raw.action as string,
      whatChanges: typeof raw.whatChanges === 'string' ? raw.whatChanges : '',
      emotionalState: typeof raw.emotionalState === 'string' ? raw.emotionalState : '',
      appIntegrationBeat: typeof raw.appIntegrationBeat === 'string' ? raw.appIntegrationBeat : null,
      visualPromptGuidance: typeof raw.visualPromptGuidance === 'string' ? raw.visualPromptGuidance : '',
      subtitleCopy: raw.subtitleCopy as string,
      subtitlePlacement,
      voiceoverLine: typeof raw.voiceoverLine === 'string' ? raw.voiceoverLine : null,
      spokenLine,
      continuityNotes: typeof raw.continuityNotes === 'string' ? raw.continuityNotes : '',
      duration,
      cameraAngle: typeof raw.cameraAngle === 'string' ? raw.cameraAngle : 'medium shot',
      props: Array.isArray(raw.props) ? (raw.props as string[]) : [],
      devicesInScene: devices.length > 0 ? devices : undefined,
    })
  }

  return scenes
}

export async function runScenePlannerAgent(input: ScenePlannerInput): Promise<SceneCard[]> {
  const strategy = input.sceneCountStrategy || 'auto'
  const budget = SCENE_BUDGET_LIMITS[strategy] ?? SCENE_BUDGET_LIMITS.auto!
  // Модель: anthropicModel (Sonnet) — не указываем tier, чтобы использовалась основная модель.
  const scenes = await callAnthropicAgent({
    agentName: 'scene-planner',
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildPrompt(input),
    maxTokens: strategy === 'longform' ? 8192 : 4096,
    validate: (data) => validate(data, budget),
  })

  // Repair-pass: если у нас person-протагонист, но scene-planner вернул
  // null spokenLine у большинства сцен — это срывает lip-sync (kling-lip-sync
  // нечего синхронизировать). Подкрашиваем недостающие spokenLine отдельным
  // дешёвым вызовом haiku — это даёт разговорные реплики на основе action /
  // emotion / subtitleCopy.
  if (input.protagonist.type === 'person') {
    const withSpoken = scenes.filter(s => s.spokenLine && s.spokenLine.trim().length > 0).length
    const ratio = withSpoken / scenes.length
    if (ratio < 0.5) {
      try {
        await fillMissingSpokenLines(scenes, input)
      } catch {
        // Repair fail не блокирует пайплайн — просто едем дальше с тем что есть.
      }
    }
  }

  // Mandatory app-integration repair: если AI забыл вписать appName хотя бы в
  // одну сцену (subtitleCopy/voiceoverLine/spokenLine) ИЛИ финальная сцена не
  // CTA-формы — Haiku переписывает финальную и одну центральную сцены.
  // Это последний рубеж перед marketing validator'ом в pipeline.
  if (input.appName && input.appName.trim().length > 0) {
    try {
      await repairAppIntegration(scenes, input)
    } catch {
      // не блокируем — validator в pipeline дополнительно проверит
    }
  }

  return scenes
}

/**
 * Возвращает true если хотя бы одно текстовое поле сцены упоминает app.name.
 */
function sceneMentionsApp(scene: SceneCard, appName: string): boolean {
  const lower = appName.toLowerCase()
  const fields = [scene.subtitleCopy, scene.voiceoverLine, scene.spokenLine]
  return fields.some(f => typeof f === 'string' && f.toLowerCase().includes(lower))
}

const CTA_VERBS = ['try', 'download', 'get', 'use', 'open', 'install', 'tap', 'start', 'join', 'discover']

/**
 * Финальная сцена должна быть CTA-формы: содержать app.name + один из CTA-глаголов.
 */
function finalSceneIsCta(scene: SceneCard, appName: string): boolean {
  if (!sceneMentionsApp(scene, appName)) return false
  const text = [scene.subtitleCopy, scene.voiceoverLine, scene.spokenLine]
    .filter((t): t is string => typeof t === 'string')
    .join(' ')
    .toLowerCase()
  return CTA_VERBS.some(v => new RegExp(`\\b${v}\\b`, 'i').test(text))
}

/**
 * Repair-pass: переписывает финальную сцену в CTA с appName и (если нужно) одну
 * центральную сцену с упоминанием appName. Haiku-вызов — дешевле Sonnet'а.
 */
async function repairAppIntegration(scenes: SceneCard[], input: ScenePlannerInput): Promise<void> {
  const anyMention = scenes.some(s => sceneMentionsApp(s, input.appName))
  const finalScene = scenes[scenes.length - 1]
  if (!finalScene) return
  const finalIsCta = finalSceneIsCta(finalScene, input.appName)
  if (anyMention && finalIsCta) return // всё ок

  const middleIdx = Math.max(0, Math.floor(scenes.length / 2))
  const middleScene = scenes[middleIdx]
  const targets = [finalScene]
  if (!anyMention && middleScene && middleScene !== finalScene) targets.push(middleScene)

  const repairPrompt = `App name: ${input.appName}.
Story arc resolution: ${input.storyArc.resolution}.
App integration strategy: ${input.appIntegrationStrategy}.

Below are video scenes that FAILED app-integration check. Rewrite ONLY their subtitleCopy, voiceoverLine and (if not null) spokenLine so:
${!anyMention ? `- The middle scene (order=${middleScene?.order}) naturally mentions "${input.appName}" once (not forced, woven into the story).\n` : ''}- The final scene (order=${finalScene.order}) is a clear CTA with "${input.appName}" + a CTA verb (try, download, get, open, use, install, start). Connect to the resolution naturally.

Keep the same emotional state, length and language (English). No emojis. spokenLine ≤ 80 chars. subtitleCopy ≤ 60 chars (2 lines max).

Scenes to rewrite:
${JSON.stringify(targets.map(t => ({ order: t.order, action: t.action, emotionalState: t.emotionalState, subtitleCopy: t.subtitleCopy, voiceoverLine: t.voiceoverLine, spokenLine: t.spokenLine })), null, 2)}

Reply ONLY with JSON: {"scenes": [{"order": <number>, "subtitleCopy": <string>, "voiceoverLine": <string|null>, "spokenLine": <string|null>}, ...]}.`

  const repaired = await callAnthropicAgent<{ scenes: Array<{ order: number; subtitleCopy?: string; voiceoverLine?: string | null; spokenLine?: string | null }> }>({
    systemPrompt: 'You repair video subtitle/voiceover/spoken lines for app marketing integration. Reply STRICTLY in JSON.',
    userPrompt: repairPrompt,
    maxTokens: 1024,
    tier: 'haiku',
    validate: (data) => {
      const d = data as { scenes?: unknown }
      if (!Array.isArray(d.scenes)) throw new Error('repair: scenes is not array')
      return d as { scenes: Array<{ order: number; subtitleCopy?: string; voiceoverLine?: string | null; spokenLine?: string | null }> }
    },
  })

  const byOrder = new Map<number, { subtitleCopy?: string; voiceoverLine?: string | null; spokenLine?: string | null }>()
  for (const r of repaired.scenes) {
    if (typeof r.order === 'number') byOrder.set(r.order, r)
  }
  for (const scene of targets) {
    const fix = byOrder.get(scene.order)
    if (!fix) continue
    if (typeof fix.subtitleCopy === 'string' && fix.subtitleCopy.trim()) {
      scene.subtitleCopy = fix.subtitleCopy.trim().slice(0, 200)
    }
    if (typeof fix.voiceoverLine === 'string' && fix.voiceoverLine.trim()) {
      scene.voiceoverLine = fix.voiceoverLine.trim().slice(0, 240)
    }
    if (typeof fix.spokenLine === 'string' && fix.spokenLine.trim()) {
      scene.spokenLine = fix.spokenLine.trim().slice(0, 120)
    }
  }
}

/**
 * Repair-pass: дозаполняет spokenLine для сцен с person-протагонистом.
 * Мутирует входной массив. Вызывается только когда ratio < 50%.
 */
async function fillMissingSpokenLines(scenes: SceneCard[], input: ScenePlannerInput): Promise<void> {
  const sceneSummaries = scenes.map(s => ({
    order: s.order,
    action: s.action,
    emotionalState: s.emotionalState,
    subtitleCopy: s.subtitleCopy,
    currentSpokenLine: s.spokenLine,
  }))

  const repairPrompt = `Story arc: ${input.storyArc.template}. Premise: ${input.storyArc.premise}. Resolution: ${input.storyArc.resolution}.
Protagonist: ${input.protagonist.description}.
App: ${input.appName}.

For EACH scene below, return a spokenLine — a short conversational English phrase (5-15 words, ≤80 chars) the on-camera person says for lip-sync. First-person, natural, no marketing jargon. spokenLine MUST be different from subtitleCopy. If the scene clearly has no person on-camera (overhead, product close-up, transition), return null.

Scenes:
${JSON.stringify(sceneSummaries, null, 2)}

Reply ONLY with JSON: {"lines": [{"order": <number>, "spokenLine": <string|null>}, ...]} for ALL ${scenes.length} scenes.`

  const repaired = await callAnthropicAgent<{ lines: Array<{ order: number; spokenLine: string | null }> }>({
    systemPrompt: 'You repair video scene dialogue for lip-sync. Reply STRICTLY in JSON.',
    userPrompt: repairPrompt,
    maxTokens: 1024,
    tier: 'haiku',
    validate: (data) => {
      const d = data as { lines?: unknown }
      if (!Array.isArray(d.lines)) throw new Error('repair: lines is not array')
      return d as { lines: Array<{ order: number; spokenLine: string | null }> }
    },
  })

  const byOrder = new Map<number, string | null>()
  for (const l of repaired.lines) {
    if (typeof l.order === 'number') {
      byOrder.set(l.order, typeof l.spokenLine === 'string' && l.spokenLine.trim().length > 0
        ? (l.spokenLine.trim().length > 120 ? l.spokenLine.trim().slice(0, 120) : l.spokenLine.trim())
        : null)
    }
  }

  for (const scene of scenes) {
    if (scene.spokenLine && scene.spokenLine.trim().length > 0) continue
    const filled = byOrder.get(scene.order)
    if (filled !== undefined) scene.spokenLine = filled
  }
}
