/**
 * Anthropic pricing table — расчёт estimated cost по usage tokens.
 *
 * Цены указаны USD per 1M tokens по официальной странице Anthropic.
 * Lookup идёт по префиксу model — supports суффиксы дат (claude-haiku-4-5-20251001).
 *
 * Cache pricing standard для Anthropic: cache read = 0.1× input, cache write = 1.25× input.
 */

interface ModelPricing {
  /** USD per 1M input tokens (без cache) */
  inputPerMtok: number
  /** USD per 1M output tokens */
  outputPerMtok: number
}

/**
 * Ставки моделей, USD за 1M токенов.
 *
 * Экспортирована ради теста (Important 5 финального ревью): тест обязан читать
 * ставки ОТСЮДА, а не повторять их своими литералами — повторённая константа
 * проверяет только то, что кто-то дважды набрал одно число, и на ошибку в
 * САМОЙ таблице реагирует так же, как на её отсутствие (никак).
 */
export const ANTHROPIC_PRICING_TABLE: ReadonlyArray<{ prefix: string; pricing: ModelPricing }> = [
  { prefix: "claude-opus-4", pricing: { inputPerMtok: 15, outputPerMtok: 75 } },
  { prefix: "claude-sonnet-4", pricing: { inputPerMtok: 3, outputPerMtok: 15 } },
  { prefix: "claude-haiku-4", pricing: { inputPerMtok: 0.8, outputPerMtok: 4 } },
  { prefix: "claude-3-7-sonnet", pricing: { inputPerMtok: 3, outputPerMtok: 15 } },
  { prefix: "claude-3-5-sonnet", pricing: { inputPerMtok: 3, outputPerMtok: 15 } },
  { prefix: "claude-3-5-haiku", pricing: { inputPerMtok: 0.8, outputPerMtok: 4 } },
  { prefix: "claude-3-opus", pricing: { inputPerMtok: 15, outputPerMtok: 75 } },
]

/** Чтение кэша дешевле обычного входа. Экспортирован по той же причине, что {@link ANTHROPIC_PRICING_TABLE}. */
export const ANTHROPIC_CACHE_READ_MULTIPLIER = 0.1
/** Запись кэша дороже обычного входа. Экспортирован по той же причине, что {@link ANTHROPIC_PRICING_TABLE}. */
export const ANTHROPIC_CACHE_WRITE_MULTIPLIER = 1.25

export interface AnthropicUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheCreateTokens?: number
}

function lookupPricing(model: string): ModelPricing | null {
  const lower = model.toLowerCase()
  for (const { prefix, pricing } of ANTHROPIC_PRICING_TABLE) {
    if (lower.startsWith(prefix)) return pricing
  }
  return null
}

/**
 * Считает цену вызова Claude по токенам.
 *
 * ЭТО БИЛЛИНГОВАЯ ФУНКЦИЯ. Прежний докстринг говорил «используется для daily
 * summary и balance estimate, не для биллинга» — с коммита `b8aa3a4` именно
 * она определяет сумму, которая уходит в `AiAuditLog` и
 * `Video.totalCostActual` для шага `edit_plan`
 * (`video-pipeline-steps.ts`, `priceEditPlanModelCalls`). Оговорка
 * «не для биллинга» была снята финальным ревью ветки (Important 5) вместе с
 * первым в проекте тестом на её арифметику
 * (`tests/unit/fixes/anthropic-cost-pricing.spec.ts`).
 *
 * Возвращает `null`, если модель неизвестна (forward compat: не валим аудит).
 * Именно `null`, а НЕ ноль: ноль означал бы «вызов бесплатен» и молча стёр бы
 * реальный расход из учёта — вызывающий обязан различать эти два случая.
 */
export function calculateAnthropicCost(model: string, usage: AnthropicUsage): number | null {
  const pricing = lookupPricing(model)
  if (!pricing) return null

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPerMtok
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPerMtok
  const cacheReadCost =
    ((usage.cacheReadTokens ?? 0) / 1_000_000) * pricing.inputPerMtok * ANTHROPIC_CACHE_READ_MULTIPLIER
  const cacheWriteCost =
    ((usage.cacheCreateTokens ?? 0) / 1_000_000) * pricing.inputPerMtok * ANTHROPIC_CACHE_WRITE_MULTIPLIER

  return inputCost + outputCost + cacheReadCost + cacheWriteCost
}
