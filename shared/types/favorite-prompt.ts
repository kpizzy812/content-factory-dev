/**
 * Типы для фичи "Избранные промты" (FavoritePrompt).
 * Используется как shared-контракт между сервером, composables и UI.
 */

import type { KlingPromptPattern } from './kling-pattern'

export interface FavoritePromptAppRef {
  id: number
  name: string
}

export interface FavoritePromptSourceVideoRef {
  id: number
  scenarioId: number
}

export interface FavoritePromptSourceAssetRef {
  id: number
  order: number
  video?: FavoritePromptSourceVideoRef | null
}

export interface FavoritePrompt {
  id: number
  userId: number
  appId: number | null
  app?: FavoritePromptAppRef | null
  promptText: string
  sourceVideoAssetId: number | null
  sourceVideoAsset?: FavoritePromptSourceAssetRef | null
  tags: string[]
  notes: string | null
  isPublic: boolean
  usageCount: number
  lastUsedAt: string | null
  createdAt: string
  updatedAt: string
  /** Структурный паттерн (Haiku-extractor). null пока не проанализирован. */
  aiPatternAnalysis: KlingPromptPattern | null
  /** Время последнего успешного анализа. null если ещё не анализировался / упало. */
  aiAnalyzedAt: string | null
  /** Сообщение последней ошибки анализа (truncated 500). null если ok. */
  aiAnalysisError: string | null
  /** Сколько раз агент пытался проанализировать. >=3 — больше не пытаемся (hard cap). */
  aiAnalysisAttempts: number
}

export interface FavoritePromptListMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

export interface FavoritePromptCreateInput {
  promptText: string
  appId?: number | null
  sourceVideoAssetId?: number | null
  tags?: string[]
  notes?: string | null
  isPublic?: boolean
}

export interface FavoritePromptUpdateInput {
  appId?: number | null
  tags?: string[]
  notes?: string | null
  isPublic?: boolean
}

export interface FavoritePromptListQuery {
  appId?: number | 'all' | 'null' | null
  tags?: string // CSV
  search?: string
  page?: number
  perPage?: number
}
