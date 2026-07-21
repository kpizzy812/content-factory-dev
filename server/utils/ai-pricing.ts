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

const PRICING_TABLE: Array<{ prefix: string; pricing: ModelPricing }> = [
  { prefix: "claude-opus-4", pricing: { inputPerMtok: 15, outputPerMtok: 75 } },
  { prefix: "claude-sonnet-4", pricing: { inputPerMtok: 3, outputPerMtok: 15 } },
  { prefix: "claude-haiku-4", pricing: { inputPerMtok: 0.8, outputPerMtok: 4 } },
  { prefix: "claude-3-7-sonnet", pricing: { inputPerMtok: 3, outputPerMtok: 15 } },
  { prefix: "claude-3-5-sonnet", pricing: { inputPerMtok: 3, outputPerMtok: 15 } },
  { prefix: "claude-3-5-haiku", pricing: { inputPerMtok: 0.8, outputPerMtok: 4 } },
  { prefix: "claude-3-opus", pricing: { inputPerMtok: 15, outputPerMtok: 75 } },
]

const CACHE_READ_MULTIPLIER = 0.1
const CACHE_WRITE_MULTIPLIER = 1.25

export interface AnthropicUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheCreateTokens?: number
}

function lookupPricing(model: string): ModelPricing | null {
  const lower = model.toLowerCase()
  for (const { prefix, pricing } of PRICING_TABLE) {
    if (lower.startsWith(prefix)) return pricing
  }
  return null
}

/**
 * Считает estimated cost вызова Claude.
 * Возвращает null если модель неизвестна (forward compat: не валим аудит, просто пропускаем cost).
 *
 * Точность: ~ofusal $0.01 для типичных вызовов. Используется для daily summary
 * и balance estimate, не для биллинга.
 */
export function calculateAnthropicCost(model: string, usage: AnthropicUsage): number | null {
  const pricing = lookupPricing(model)
  if (!pricing) return null

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPerMtok
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPerMtok
  const cacheReadCost =
    ((usage.cacheReadTokens ?? 0) / 1_000_000) * pricing.inputPerMtok * CACHE_READ_MULTIPLIER
  const cacheWriteCost =
    ((usage.cacheCreateTokens ?? 0) / 1_000_000) * pricing.inputPerMtok * CACHE_WRITE_MULTIPLIER

  return inputCost + outputCost + cacheReadCost + cacheWriteCost
}
