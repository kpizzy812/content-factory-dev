/**
 * Pure helpers для /api/ai/suggest/entity endpoint.
 * Вынесены в отдельный модуль, чтобы можно было импортировать в unit-тестах
 * без подтягивания Nuxt-глобалов (defineEventHandler, readBody и т.д.),
 * которые присутствуют только в Nitro runtime.
 */

import { nodeFieldSchemas } from '~~/app/utils/pipeline-node-schema'

export type EntityNodeType = 'character_entity' | 'scene_entity'

const ENTITY_TO_NODE_TYPE: Record<string, EntityNodeType> = {
  character: 'character_entity',
  scene: 'scene_entity',
}

/**
 * Маппинг entityType → nodeType. Возвращает null для неизвестных значений
 * (handler выкинет 400).
 */
export function resolveEntityNodeType(entityType: string): EntityNodeType | null {
  return ENTITY_TO_NODE_TYPE[entityType] ?? null
}

/**
 * Нормализует AI suggestions для tags-полей: AI часто возвращает строку
 * через запятую/переносы/точки с запятой несмотря на инструкцию. Здесь
 * мы превращаем такие строки в массив трогая только tag-поля схемы.
 */
export function normalizeTagsField(
  nodeType: EntityNodeType,
  suggestions: Record<string, unknown>,
): Record<string, unknown> {
  const schema = nodeFieldSchemas[nodeType]
  if (!schema) return suggestions
  const out: Record<string, unknown> = { ...suggestions }
  for (const [key, field] of Object.entries(schema)) {
    if (field.type !== 'tags') continue
    const raw = out[key]
    if (typeof raw === 'string') {
      out[key] = raw
        .split(/[,\n;]/)
        .map(s => s.trim())
        .filter(s => s.length > 0)
    }
  }
  return out
}

/**
 * Эвристика: обнаруживает строки, похожие на секреты/токены.
 */
export function looksLikeSecret(value: string): boolean {
  const patterns = [
    /^(sk|pk|api|token|secret|key|bearer|auth)[-_]/i,
    /^eyJ[A-Za-z0-9]/,          // JWT
    /^ghp_[A-Za-z0-9]/,         // GitHub PAT
    /^xox[bpsar]-/,             // Slack tokens
    /^AKIA[A-Z0-9]/,            // AWS access key
    /password|passwd|pwd/i,
  ]
  return patterns.some(p => p.test(value))
}
