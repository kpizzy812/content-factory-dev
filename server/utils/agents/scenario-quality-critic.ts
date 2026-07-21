/**
 * Scenario Quality Critic — AI-агент сравнения N вариантов сценария.
 *
 * Один Sonnet-вызов, на вход массив всех variants (title/hook/body/cta/fullScript/storyPlan),
 * на выход — массив scores по 6 критериям + bestVariantIndex/Id + needsRework.
 *
 * Mock: фикстура server/__fixtures__/agents/{agentName}-happy.json. Для переключения
 * между happy и rework можно выставить env CRITIC_MOCK_VARIANT=rework — тогда agentName
 * станет 'scenario-quality-critic-rework' и подгрузится rework-фикстура.
 *
 * variantId в фикстуре содержит фиктивные значения. После получения данных
 * мы заменяем score.variantId на реальный input.variants[score.variantIndex].id —
 * так фикстуры остаются стабильными независимо от настоящих ID в БД.
 */

import type { CriticOutput, VariantQualityScore, CriticVerdict } from '~~/shared/types/scenario'
import { callAnthropicAgent } from './call-anthropic'

export const CRITIC_PROMPT_VERSION = 'critic-v1'
export const CRITIC_DEFAULT_THRESHOLD = 70

const VALID_VERDICTS: CriticVerdict[] = ['pass', 'pass_with_notes', 'rework', 'reject']

const SCORE_KEYS = [
  'hookStrength',
  'emotionalArc',
  'appIntegration',
  'visualClarity',
  'ctaPower',
  'viralPotential',
] as const

type ScoreKey = typeof SCORE_KEYS[number]

export interface CriticInputVariant {
  id: number
  variantIndex: number
  title: string
  hook: string
  body: string
  cta: string
  fullScript: string
  storyPlan?: unknown
}

export interface CriticInput {
  scenarioId: number
  variants: CriticInputVariant[]
  context?: {
    appName?: string
    targetPlatform?: string
    qualityThreshold?: number
  }
}

function getCriticAgentName(): string {
  // Позволяет тестам переключаться между happy и rework фикстурой без подмены файлов.
  const variant = (process.env.CRITIC_MOCK_VARIANT || '').trim().toLowerCase()
  if (variant === 'rework') return 'scenario-quality-critic-rework'
  return 'scenario-quality-critic'
}

function buildSystemPrompt(appName: string | undefined): string {
  const appBlock = appName
    ? `\nКОНТЕКСТ ПРОДУКТА: приложение «${appName}». appIntegration ≥ 6 ОБЯЗАТЕЛЬНО для verdict='pass'. Если бренд не назван явно в сценарии — appIntegration ≤ 4.\n`
    : ''
  return `Ты — Scenario Quality Critic. Сравниваешь N вариантов сценария короткого видео и выдаёшь числовую оценку по 6 критериям. Это финальный gate перед production.
${appBlock}
КРИТЕРИИ (целое число 1..10):

1) hookStrength — насколько хук удерживает в первые 3 секунды.
   1 = «приветствие, скучный setup без интриги»; 5 = «понятный сетап, но без сильного триггера»; 10 = «pattern-interrupt, любопытство сразу, конкретика».

2) emotionalArc — есть ли эмоциональный путь героя.
   1 = «один эмоциональный тон от начала до конца»; 5 = «контраст до/после, но без турнинг-поинта»; 10 = «frustration→curiosity→wow→satisfaction, чувствуется».

3) appIntegration — насколько приложение встроено органично, а не «sticker» в конце.
   1 = «бренд только в CTA, ниоткуда»; 5 = «упомянут в нужный момент, но действие не маппится на core function»; 10 = «turning point = функция приложения, имя звучит в кульминации, CTA с глаголом».

4) visualClarity — насколько визуальная сцена читаема и снимаема через AI-генератор.
   1 = «абстрактные метафоры без props/setting»; 5 = «есть setting и action, но мало деталей»; 10 = «props, lighting, camera angle, конкретные кадры — режиссёрский лист».

5) ctaPower — сила призыва к действию.
   1 = «нет CTA или мутный»; 5 = «прямое предложение без бренда или без глагола»; 10 = «глагол + бренд + причина действовать сейчас».

6) viralPotential — итоговая вирусность с учётом hook+emotion+уникальности.
   1 = «шаблон, видели 100 раз»; 5 = «крепкий стандарт TikTok/Reels»; 10 = «свежая механика, есть shareable beat, провоцирует комментарий».

ПРАВИЛА:
- Каждый score — целое число от 1 до 10.
- totalScore = round(среднее × 10), значение 0..100.
- strengths/weaknesses — 2-4 коротких пункта на русском (строки), конкретные, не общие.
- reworkSuggestions — конкретные правки, БЕЗ переписывания всего сценария. Если verdict='pass' — оставь пустой массив.
- verdict: 'pass' (totalScore≥80, нет blocker'ов), 'pass_with_notes' (70..79), 'rework' (50..69), 'reject' (<50 или критический blocker).
- bestVariantIndex — индекс варианта с максимальным totalScore. При ничьей — меньший variantIndex.
- bestVariantId — переписывается из input ПОСЛЕ ответа, можешь поставить любое значение.
- needsRework=true если ВСЕ варианты totalScore<threshold. Иначе false.
- reasoning — 2-4 предложения почему именно этот лучший. На русском.
- НЕ оценивай факты вне сценария. Не выдумывай статистику. Опирайся только на тексты hook/body/cta/fullScript и storyPlan.

ФОРМАТ ОТВЕТА: СТРОГО JSON.`
}

function buildUserPrompt(input: CriticInput): string {
  const threshold = input.context?.qualityThreshold ?? CRITIC_DEFAULT_THRESHOLD
  const variantsText = input.variants
    .map((v) => {
      const storyPlanHint = v.storyPlan
        ? `\nstoryPlan_summary: ${typeof v.storyPlan === 'object' ? JSON.stringify(v.storyPlan).slice(0, 1500) : String(v.storyPlan).slice(0, 1500)}`
        : ''
      return `### Variant ${v.variantIndex} (id=${v.id})
title: ${v.title}
hook: ${v.hook}
body: ${v.body}
cta: ${v.cta}
fullScript: ${v.fullScript}${storyPlanHint}`
    })
    .join('\n\n')

  return `Оцени и сравни ${input.variants.length} варианта(ов) сценария. Порог качества: ${threshold}/100.

${input.context?.appName ? `Приложение: ${input.context.appName}` : ''}
${input.context?.targetPlatform ? `Платформа: ${input.context.targetPlatform}` : ''}

${variantsText}

Верни строго JSON по схеме:
{
  "scores": [
    {
      "variantIndex": <number>,
      "variantId": <number>,
      "scores": {
        "hookStrength": <1-10>, "emotionalArc": <1-10>, "appIntegration": <1-10>,
        "visualClarity": <1-10>, "ctaPower": <1-10>, "viralPotential": <1-10>
      },
      "totalScore": <0-100>,
      "strengths": [<string>, ...],
      "weaknesses": [<string>, ...],
      "reworkSuggestions": [<string>, ...],
      "verdict": "pass" | "pass_with_notes" | "rework" | "reject"
    }
  ],
  "bestVariantIndex": <number>,
  "bestVariantId": <number>,
  "averageScore": <0-100>,
  "needsRework": <boolean>,
  "reasoning": <string>
}`
}

function clampScore(value: unknown, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) {
    throw new Error(`Score должен быть числом, получено: ${typeof value}`)
  }
  if (n < min || n > max) {
    throw new Error(`Score вне диапазона ${min}..${max}: ${n}`)
  }
  return Math.round(n)
}

function ensureStringArray(value: unknown, field: string, max = 8): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} должен быть массивом`)
  return (value as unknown[])
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .slice(0, max)
}

function validateCriticOutput(data: unknown): CriticOutput {
  if (!data || typeof data !== 'object') {
    throw new Error('CriticOutput должен быть объектом')
  }
  const d = data as Record<string, unknown>

  if (!Array.isArray(d.scores)) {
    throw new Error('scores должно быть массивом')
  }
  if (d.scores.length === 0) {
    throw new Error('scores не может быть пустым')
  }

  const scores: VariantQualityScore[] = (d.scores as unknown[]).map((raw, i) => {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`scores[${i}] должен быть объектом`)
    }
    const r = raw as Record<string, unknown>
    const variantIndex = Number(r.variantIndex)
    if (!Number.isFinite(variantIndex) || variantIndex < 0) {
      throw new Error(`scores[${i}].variantIndex некорректен`)
    }
    const variantId = Number(r.variantId)
    if (!Number.isFinite(variantId)) {
      throw new Error(`scores[${i}].variantId некорректен`)
    }
    if (!r.scores || typeof r.scores !== 'object') {
      throw new Error(`scores[${i}].scores должно быть объектом`)
    }
    const sc = r.scores as Record<string, unknown>
    const built: Record<ScoreKey, number> = {
      hookStrength: 0,
      emotionalArc: 0,
      appIntegration: 0,
      visualClarity: 0,
      ctaPower: 0,
      viralPotential: 0,
    }
    for (const k of SCORE_KEYS) {
      built[k] = clampScore(sc[k], 1, 10)
    }
    const verdict = String(r.verdict || '') as CriticVerdict
    if (!VALID_VERDICTS.includes(verdict)) {
      throw new Error(`scores[${i}].verdict некорректен: ${r.verdict}`)
    }
    const totalScoreRaw = Number(r.totalScore)
    const computedAverage = SCORE_KEYS.reduce((acc, k) => acc + built[k], 0) / SCORE_KEYS.length
    const totalScore = Number.isFinite(totalScoreRaw) && totalScoreRaw >= 0 && totalScoreRaw <= 100
      ? Math.round(totalScoreRaw)
      : Math.round(computedAverage * 10)

    return {
      variantIndex,
      variantId,
      scores: built,
      totalScore,
      strengths: ensureStringArray(r.strengths, `scores[${i}].strengths`, 6),
      weaknesses: ensureStringArray(r.weaknesses, `scores[${i}].weaknesses`, 6),
      reworkSuggestions: ensureStringArray(r.reworkSuggestions, `scores[${i}].reworkSuggestions`, 8),
      verdict,
    }
  })

  const bestVariantIndex = Number(d.bestVariantIndex)
  const bestVariantId = Number(d.bestVariantId)
  const averageScoreRaw = Number(d.averageScore)
  const averageScore = Number.isFinite(averageScoreRaw)
    ? Math.round(averageScoreRaw)
    : Math.round(scores.reduce((acc, s) => acc + s.totalScore, 0) / scores.length)
  const needsRework = Boolean(d.needsRework)
  const reasoning = typeof d.reasoning === 'string' ? d.reasoning : ''

  return {
    scores,
    bestVariantIndex: Number.isFinite(bestVariantIndex) ? bestVariantIndex : scores[0]!.variantIndex,
    bestVariantId: Number.isFinite(bestVariantId) ? bestVariantId : scores[0]!.variantId,
    averageScore,
    needsRework,
    reasoning,
  }
}

/**
 * Запускает один проход критика для массива variants. Не пишет в БД —
 * только AI-вызов и валидация. Persistence — в orchestrator'е.
 */
export async function runScenarioQualityCritic(input: CriticInput): Promise<CriticOutput> {
  if (!Array.isArray(input.variants) || input.variants.length === 0) {
    throw new Error('variants не может быть пустым')
  }
  const threshold = input.context?.qualityThreshold ?? CRITIC_DEFAULT_THRESHOLD

  const result = await callAnthropicAgent({
    agentName: getCriticAgentName(),
    systemPrompt: buildSystemPrompt(input.context?.appName),
    userPrompt: buildUserPrompt(input),
    maxTokens: 4096,
    validate: validateCriticOutput,
  })

  // Переписываем variantId из input.variants по variantIndex —
  // фикстуры мока хранят фиктивные id'ы, а реальные приходят только из БД.
  const idByIndex = new Map<number, number>()
  for (const v of input.variants) {
    idByIndex.set(v.variantIndex, v.id)
  }

  for (const s of result.scores) {
    const real = idByIndex.get(s.variantIndex)
    if (real !== undefined) s.variantId = real
  }

  // Best variant id — нужно переписать тоже (по индексу).
  const bestReal = idByIndex.get(result.bestVariantIndex)
  if (bestReal !== undefined) {
    result.bestVariantId = bestReal
  } else if (result.scores.length > 0) {
    // fallback: лучший по totalScore среди реально пришедших
    const sorted = [...result.scores].sort((a, b) => b.totalScore - a.totalScore)
    const top = sorted[0]!
    result.bestVariantIndex = top.variantIndex
    result.bestVariantId = top.variantId
  }

  // needsRework пересчитываем для надёжности (всё равно AI мог сбиться).
  result.needsRework = result.scores.every((s) => s.totalScore < threshold)

  return result
}
