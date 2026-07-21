/**
 * Continuity Director — проверяет и дополняет набор сцен на непротиворечивость и continuity.
 * Следит за единством героя, визуального кода, непрерывностью окружения, anti-loop.
 * Формирует continuity bible.
 */
import type { ContinuityBible, SceneCard, ProtagonistProfile } from '~~/shared/types/story'
import { sanitizeNegativeConstraints } from './story-architect-agent'
import { DEVICE_RULES_NOTE_FOR_AGENTS, sanitizeDevicesInScene } from '~~/shared/utils/video-prompt-helpers'

export interface ContinuityDirectorInput {
  scenes: SceneCard[]
  protagonist: ProtagonistProfile
  storyArc: {
    template: string
    premise: string
    conflict: string
    turningPoint: string
    resolution: string
  }
  visualStyle?: { colors: string[]; atmosphere: string; character: string } | null
}

export interface ContinuityDirectorResult {
  validatedScenes: SceneCard[]
  continuityBible: ContinuityBible
  issues: string[]
  fixes: string[]
}

const SYSTEM_PROMPT = `Ты — Continuity Director для AI-генерации коротких видео. Твоя задача — проверять набор сцен на непротиворечивость и continuity. Ты следишь за:

1. Единством героя — визуальные идентификаторы протагониста одинаковы во всех сценах.
2. Визуальным кодом — цветовая палитра, освещение и стиль окружения не меняются без причины.
3. Непрерывностью окружения — если герой перешёл в другое место, это должно быть обосновано.
4. Anti-loop — выявляешь повторяющиеся или почти идентичные сцены (одинаковые ракурсы, действия, визуал).
5. Переходами — каждая сцена логически следует из предыдущей.

Формируешь continuity bible — единый документ с правилами визуальной и сюжетной непрерывности.

ВАЖНО: при правке сцен поля subtitleCopy, voiceoverLine, spokenLine, visualPromptGuidance, setting, action, purpose, emotionalState, props — оставляй / переписывай НА АНГЛИЙСКОМ. Это финальные строки, идущие в видео для англоязычной аудитории. БЕЗ эмодзи и спецсимволов. Поле spokenLine (прямая речь персонажа для kling lip-sync) обязательно сохраняется в validatedScenes если оно было в исходных сценах — не удаляй его. Поле devicesInScene (массив устройств в кадре) тоже обязательно сохраняется — это триггер для downstream device-orientation rules.

Системные пояснения (issues, fixes, объяснения) могут быть на русском. Поля JSON, идущие в видео — на английском. Отвечай СТРОГО в формате JSON.
${DEVICE_RULES_NOTE_FOR_AGENTS}`

function buildPrompt(input: ContinuityDirectorInput): string {
  const visualCtx = input.visualStyle
    ? `\n## Визуальный стиль\n- Палитра: ${input.visualStyle.colors.join(', ')}\n- Атмосфера: ${input.visualStyle.atmosphere}\n- Персонаж: ${input.visualStyle.character}`
    : ''

  return `Проверь набор сцен на continuity и сформируй continuity bible.

## Протагонист
- Тип: ${input.protagonist.type}
- Описание: ${input.protagonist.description}
- Начальное состояние: ${input.protagonist.initialState}
- Финальное состояние: ${input.protagonist.finalState}
- Визуальные идентификаторы: ${input.protagonist.visualIdentifiers.join(', ')}

## Story Arc
- Шаблон: ${input.storyArc.template}
- Premise: ${input.storyArc.premise}
- Conflict: ${input.storyArc.conflict}
- Turning Point: ${input.storyArc.turningPoint}
- Resolution: ${input.storyArc.resolution}
${visualCtx}

## Сцены (${input.scenes.length} шт.)
${input.scenes.map((s, i) => `### Сцена ${i + 1} (order: ${s.order})
- Цель: ${s.purpose}
- Место: ${s.setting}
- Действие: ${s.action}
- Что меняется: ${s.whatChanges}
- Эмоция: ${s.emotionalState}
- Ракурс камеры: ${s.cameraAngle}
- Реквизит: ${s.props.join(', ') || 'нет'}
- Devices в кадре: ${s.devicesInScene && s.devicesInScene.length > 0 ? s.devicesInScene.join(', ') : 'нет'}
- Visual prompt guidance: ${s.visualPromptGuidance}
- Continuity notes: ${s.continuityNotes || 'нет'}
- Длительность: ${s.duration}`).join('\n\n')}

## Задача
Сгенерируй JSON-объект:

1. **validatedScenes** — массив сцен с обновлёнными полями continuityNotes. Каждая сцена содержит все оригинальные поля + обновлённые continuityNotes с конкретными указаниями для генерации визуала.

2. **continuityBible** — объект:
   - protagonist: объект ProtagonistProfile (type, description, initialState, finalState, visualIdentifiers)
   - visualCode: объект с полями colorPalette (массив hex), lightingConsistency (строка), environmentStyle (строка)
   - antiLoopRules: массив строк — правила против повторяющихся клипов
   - sceneTransitions: массив строк — допустимые переходы между сценами
   - forbiddenElements: массив строк — что запрещено визуально/сюжетно. ЭТИ ЭЛЕМЕНТЫ УХОДЯТ В Kling negative_prompt: пиши строго на АНГЛИЙСКОМ, 2-5 слов на элемент, и НЕ через двойное отрицание ("missing X", "no X", "without X", "lack of X" — ЗАПРЕЩЕНО). Хорошо: "studio recording equipment", "neon artificial colors", "stock-photo poses". Плохо: "отсутствие крупных планов", "missing close-ups", "no nature contact".

3. **issues** — массив строк с обнаруженными проблемами continuity (пустой массив, если проблем нет).

4. **fixes** — массив строк с описанием внесённых исправлений (пустой массив, если исправлений не было).

Ответь ТОЛЬКО JSON-объектом.`
}

function validate(data: unknown): ContinuityDirectorResult {
  const d = data as Record<string, unknown>

  if (!Array.isArray(d.validatedScenes)) {
    throw new Error('ContinuityDirector: ожидался массив validatedScenes')
  }

  if (!d.continuityBible || typeof d.continuityBible !== 'object') {
    throw new Error('ContinuityDirector: ожидался объект continuityBible')
  }

  const bible = d.continuityBible as Record<string, unknown>

  if (!bible.protagonist || typeof bible.protagonist !== 'object') {
    throw new Error('ContinuityDirector: continuityBible.protagonist отсутствует')
  }

  if (!bible.visualCode || typeof bible.visualCode !== 'object') {
    throw new Error('ContinuityDirector: continuityBible.visualCode отсутствует')
  }

  if (!Array.isArray(bible.antiLoopRules)) {
    throw new Error('ContinuityDirector: continuityBible.antiLoopRules должен быть массивом')
  }

  if (!Array.isArray(d.issues)) {
    throw new Error('ContinuityDirector: ожидался массив issues')
  }

  if (!Array.isArray(d.fixes)) {
    throw new Error('ContinuityDirector: ожидался массив fixes')
  }

  // forbiddenElements уходят в Kling negative_prompt — чистим от русского и
  // двойных отрицаний, иначе Kling начнёт ИЗБЕГАТЬ нужного.
  if (Array.isArray(bible.forbiddenElements)) {
    bible.forbiddenElements = sanitizeNegativeConstraints(bible.forbiddenElements as string[])
  }

  // devicesInScene — Claude может его выкинуть при правке. Прогоняем санитайзер
  // по каждой validatedScene; если поле есть — нормализуем, если нет — оставляем
  // undefined (caller подмёнит из исходного scene по order при необходимости).
  for (const scene of d.validatedScenes as Record<string, unknown>[]) {
    if (scene && typeof scene === 'object') {
      const devices = sanitizeDevicesInScene(scene.devicesInScene)
      scene.devicesInScene = devices.length > 0 ? devices : undefined
    }
  }

  return d as unknown as ContinuityDirectorResult
}

export async function runContinuityDirectorAgent(input: ContinuityDirectorInput): Promise<ContinuityDirectorResult> {
  // Модель: anthropicModel (Sonnet) — не указываем tier, чтобы использовалась основная модель.
  const result = await callAnthropicAgent({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildPrompt(input),
    maxTokens: 8192,
    validate,
  })

  // Защита от потери devicesInScene при правке: подменяем из исходных сцен
  // по order если в validatedScene поле выпало или пустое.
  const sourceByOrder = new Map<number, SceneCard>()
  for (const s of input.scenes) sourceByOrder.set(s.order, s)
  for (const scene of result.validatedScenes) {
    if (!scene.devicesInScene || scene.devicesInScene.length === 0) {
      const source = sourceByOrder.get(scene.order)
      if (source?.devicesInScene && source.devicesInScene.length > 0) {
        scene.devicesInScene = [...source.devicesInScene]
      }
    }
  }

  return result
}
