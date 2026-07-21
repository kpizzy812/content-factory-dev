/**
 * Subtitle Director — генерирует subtitle style profile и проверяет субтитры на сценах.
 * Следит за единообразием визуального оформления субтитров, читаемостью и размещением.
 */
import type { SceneCard, SubtitleStyleProfile } from '~~/shared/types/story'
import {
  SUBTITLE_WORDS_PER_LINE_MIN,
  SUBTITLE_WORDS_PER_LINE_MAX,
  SUBTITLE_WORDS_PER_LINE_DEFAULT,
} from '~~/shared/types/story'

export interface SubtitleDirectorInput {
  scenes: SceneCard[]
  platform: string
  visualStyle?: { colors: string[]; atmosphere: string } | null
  subtitleStrategy?: 'dynamic' | 'static' | 'minimal' | 'none'
  /**
   * Имя приложения. Если задано — director ОБЯЗАН сохранять его в subtitleCopy
   * там, где исходные сцены его уже содержали. Marketing-context inviolable.
   */
  appName?: string | null
}

export interface SubtitleDirectorResult {
  subtitleStyle: SubtitleStyleProfile
  validatedScenes: SceneCard[]
}

const SYSTEM_PROMPT = `Ты — Subtitle Director, режиссёр субтитров для коротких видео. Твоя задача:

1. Сгенерировать subtitle style profile — единый визуальный стиль субтитров для всего контейнера:
   - Typography: шрифтовое намерение (bold sans-serif), регистр, макс длина строки, макс количество строк.
   - Visual: основной цвет, обводка, тень, фон. КРЕАТИВ + ЧИТАЕМОСТЬ — см. ниже.
   - Animation: вход, выход, акцент.
   - Consistency: единообразие стиля между сценами.

2. Проверить каждую сцену:
   - Текст субтитров не длиннее 2 строк.
   - Субтитры не перекрывают лицо, UI приложения или ключевые объекты.
   - Визуальный стиль субтитров единый во всех сценах.
   - Содержание субтитров разное, но оформление единообразное.
   - subtitlePlacement корректен для платформы.

3. Обновить subtitleCopy и subtitlePlacement в каждой сцене при необходимости.

## КРИТИЧНО: читаемость субтитров (TikTok/Reels/Shorts стандарт)
Цвета — твой креатив, но они ОБЯЗАНЫ соответствовать стандарту читаемости. Видео может быть на ЛЮБОМ фоне (тёмном/светлом/пёстром), а субтитры должны оставаться видимыми.

Правила:
- **Контраст** primaryColor ↔ outlineColor — минимум 4.5:1 (WCAG AA). Тёмный текст с тёмной обводкой = баг. Светлый текст с тёмной обводкой ИЛИ тёмный текст со светлой обводкой = ОК.
- **primaryColor** должен быть ярким и насыщенным: чистый белый #FFFFFF, тёплый жёлтый #FFE500, кислотный мятный #00FFB3, неон-розовый #FF4D8D, ярко-голубой #00D4FF и т.п. Запрещены тусклые / приглушённые / тёмные цвета (тёмно-синий, серый, бордо, болотный).
- **outlineColor** для контраста: глубокий #000000 если primaryColor светлый; #FFFFFF или светлый если primaryColor тёмный. Толщина обводки рендерится bold (4-7px), это уже fixed.
- **backgroundColor** опционально: используй полупрозрачный bg только если выбрал полу-прозрачный/паттерновый стиль (Instagram caption / news ticker). Иначе null — обводки + drop shadow достаточно.
- **shadowEnabled: true** ВСЕГДА — drop shadow добавляет ещё один слой отделения от фона.
- Учитывай **палитру и атмосферу видео** (передаётся в контексте) — субтитры должны гармонировать, но не сливаться. Если видео в тёмно-синих корпоративных тонах — НЕ выбирай тёмно-синий primaryColor, выбери комплементарный яркий (например тёплый жёлтый, белый, или акцент из бренд-палитры).

## Размер и типография
- typography.wordsPerLine: дефолт 4 — стандарт TikTok/Reels. Считаются ВСЕ слова включая союзы (and, or, a). Допустимо 3 для очень короткого формата, 5-6 для длинного landscape. ЖЁСТКИЕ bounds: 3..6. Значения ниже/выше будут обрезаны runtime.
- typography.maxLineLength: оставляй около 32 (это legacy fallback). Главное — wordsPerLine.
- typography.maxLines: 2 (макс — больше перекрывает кадр)
- typography.casing: "uppercase" для high-energy hook, "sentence" для нарратива
- Жирный sans-serif шрифт (Helvetica/Arial/Inter Bold-style) — это рендерится автоматически, ты задаёшь fontIntent='bold sans-serif'

## subtitleCopy — длина текста
- Максимум 8-12 слов на сцену (умещается в 2-3 строки по 4 слова).
- Если фраза длиннее — переформулируй короче. Не рассчитывай на автоматический wrap многострочных простыней.

## Запрещено
- Тёмный текст на тёмной обводке (контраст < 3:1)
- Тусклые/приглушённые цвета (рендер их размывает)
- Эмодзи в subtitleCopy (😀, 🚀 и т.п.) — рендерятся квадратами
- УДАЛЯТЬ ИЛИ ПЕРЕПИСЫВАТЬ app name (см. правило ниже)

## App name preservation (КРИТИЧНО)
Если в исходном subtitleCopy сцены УЖЕ присутствует имя приложения (см. блок "App context" ниже), ты ОБЯЗАН сохранить его в финальном переписанном subtitleCopy этой же сцены. Не заменяй на "the app", "it", "оно", не выкидывай ради эстетики, не «перефразируй для краткости». Имя приложения — единственное звено маркетинговой ценности субтитров. Отсутствие имени = бесполезный сценарий.

Допустимо: подкорректировать формулировку вокруг имени, перенести имя на другую строку, добавить CTA-глагол перед именем.
Запрещено: убрать имя из любой сцены, где оно было.

## Язык вывода
- subtitleCopy ВСЕГДА на АНГЛИЙСКОМ — целевая аудитория англоязычная. Если входные субтитры на русском, переведи на английский.
- БЕЗ эмодзи и спецсимволов в subtitleCopy

Учитывай особенности платформы: TikTok (вертикальный, нижняя зона занята UI), Instagram Reels (аналогично), YouTube Shorts.
Системные пояснения (рассуждения) на русском, поля JSON — как описано. Отвечай СТРОГО в формате JSON.`

function buildPrompt(input: SubtitleDirectorInput): string {
  const visualCtx = input.visualStyle
    ? `\n## Визуальный стиль видео\n- Палитра: ${input.visualStyle.colors.join(', ')}\n- Атмосфера: ${input.visualStyle.atmosphere}`
    : ''

  const appCtx = input.appName && input.appName.trim()
    ? `\n## App context (NAME PRESERVATION RULE)\n- App name: **${input.appName}**\n- Если subtitleCopy исходной сцены содержит "${input.appName}" — ФИНАЛЬНЫЙ переписанный subtitleCopy ОБЯЗАН тоже содержать "${input.appName}" дословно.\n- Не сокращай имя, не заменяй на "the app", не выкидывай.`
    : ''

  return `Сгенерируй subtitle style profile и проверь субтитры в сценах.

## Платформа: ${input.platform}
## Стратегия субтитров: ${input.subtitleStrategy || 'dynamic'}
${visualCtx}${appCtx}

## Сцены (${input.scenes.length} шт.)
${input.scenes.map((s, i) => `### Сцена ${i + 1} (order: ${s.order})
- Цель: ${s.purpose}
- Действие: ${s.action}
- Эмоция: ${s.emotionalState}
- Текущие субтитры: "${s.subtitleCopy}"
- Текущее размещение: позиция=${s.subtitlePlacement.position}, выравнивание=${s.subtitlePlacement.alignment}, avoid zones=${s.subtitlePlacement.avoidZones.join(', ') || 'нет'}
- Ракурс камеры: ${s.cameraAngle}
- Длительность: ${s.duration}
- App integration: ${s.appIntegrationBeat || 'нет'}`).join('\n\n')}

## Задача
Сгенерируй JSON-объект:

1. **subtitleStyle** — объект SubtitleStyleProfile (все ключи строго camelCase):
   - typography: { fontIntent (string), casing ("uppercase"|"lowercase"|"sentence"|"mixed"), maxLineLength (number, 32 рекомендуется), wordsPerLine (number, 3..6, дефолт 4), maxLines (number, рекомендуется 2) }
   - visual: { primaryColor (hex), outlineColor (hex или null), shadowEnabled (boolean), backgroundColor (hex или null) }
   - animation: { entrance ("fade"|"slide_up"|"typewriter"|"pop"|"none"), exit ("fade"|"slide_down"|"none"), emphasis ("highlight"|"scale"|"color_shift"|"none") }
   - consistency: { maintainStyleAcrossScenes (boolean), sceneOverrideAllowed (boolean) }

2. **validatedScenes** — массив сцен с обновлёнными subtitleCopy и subtitlePlacement. Каждая сцена содержит все оригинальные поля. Исправь текст и размещение там, где нужно.

Ответь ТОЛЬКО JSON-объектом.`
}

function validate(data: unknown): SubtitleDirectorResult {
  const d = data as Record<string, unknown>

  if (!d.subtitleStyle || typeof d.subtitleStyle !== 'object') {
    throw new Error('SubtitleDirector: ожидался объект subtitleStyle')
  }

  const style = d.subtitleStyle as Record<string, unknown>

  if (!style.typography || typeof style.typography !== 'object') {
    throw new Error('SubtitleDirector: subtitleStyle.typography отсутствует')
  }

  if (!style.visual || typeof style.visual !== 'object') {
    throw new Error('SubtitleDirector: subtitleStyle.visual отсутствует')
  }

  if (!Array.isArray(d.validatedScenes)) {
    throw new Error('SubtitleDirector: ожидался массив validatedScenes')
  }

  // Санитайзер wordsPerLine: AI может вернуть число вне bounds или snake_case ключ.
  // Приводим к camelCase, clamp в 3..6, дефолт 4.
  const typography = style.typography as Record<string, unknown>
  const rawWords = typography.wordsPerLine
    ?? typography.words_per_line
    ?? typography.wordsPerLineDefault
  const parsedWords = typeof rawWords === 'number' && Number.isFinite(rawWords)
    ? Math.round(rawWords)
    : SUBTITLE_WORDS_PER_LINE_DEFAULT
  typography.wordsPerLine = Math.max(
    SUBTITLE_WORDS_PER_LINE_MIN,
    Math.min(SUBTITLE_WORDS_PER_LINE_MAX, parsedWords),
  )
  delete typography.words_per_line
  delete typography.wordsPerLineDefault

  return d as unknown as SubtitleDirectorResult
}

export async function runSubtitleDirectorAgent(input: SubtitleDirectorInput): Promise<SubtitleDirectorResult> {
  // Модель: anthropicModel (Sonnet) — не указываем tier, чтобы использовалась основная модель.
  return callAnthropicAgent({
    agentName: 'subtitle-director',
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildPrompt(input),
    maxTokens: 6144,
    validate,
  })
}
