/**
 * Mock-обработчик вызовов Anthropic-агентов.
 * Подгружает фикстуру по имени агента из server/__fixtures__/agents/.
 */

import { loadFixture, mockDelay } from "./fixture-loader"
import { isAnthropicMockMode } from "./mode"

/**
 * Если включён mock-режим — возвращает фикстуру happy-path для указанного агента,
 * прогнав её через validate. Иначе возвращает sentinel { miss: true } и реальный
 * вызов идёт по обычной ветке.
 */
export async function tryMockAnthropicAgent<T>(
  agentName: string | undefined,
  validate: (data: unknown) => T,
): Promise<{ hit: true; value: T } | { hit: false }> {
  if (!isAnthropicMockMode()) return { hit: false }

  if (!agentName) {
    throw new Error(
      "ANTHROPIC_MOCK_MODE=true, но callAnthropicAgent вызван без agentName. " +
      "Передай agentName в опции, чтобы mock мог найти фикстуру.",
    )
  }

  await mockDelay(300)
  const data = await loadFixture<unknown>({ category: "agents", name: `${agentName}-happy` })
  return { hit: true, value: validate(data) }
}
